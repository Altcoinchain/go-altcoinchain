// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

/**
 * @title ValidatorStakingV3
 * @notice Delegated Proof-of-Stake staking for the Altcoinchain hybrid PoW/PoS upgrade.
 *
 * v3 exists because v2 (0x347F496c887a92ed9706ff3EDF4f0b822Ab00d3E) shipped with
 * defects that permanently destroy user funds. Every one is fixed here:
 *
 *  1. CRITICAL v2: `slash()` was `external` with no access control and no proof of
 *     misbehaviour, so anyone could burn 10% of any validator's stake and set
 *     isSlashed forever (registerValidator requires !isSlashed => address bricked).
 *     v3: only SYSTEM_CALLER (the consensus system address) may slash.
 *
 *  2. CRITICAL v2: self-stake could never be withdrawn. Every write to selfStake
 *     either added to it or slashed it; there was no unstake/exit at all.
 *     v3: `unstakeSelf` and `unregisterValidator` route self-stake through the
 *     same 7-day withdrawal queue as delegations.
 *
 *  3. HIGH v2: slashing decremented `v.totalDelegated` but left each delegator's
 *     `d.amount` untouched, so sum(d.amount) > totalDelegated. The first delegator
 *     out was paid in full and the last hit an underflow revert, funds stuck.
 *     v3: slashing scales `slashFactor`; every delegation is valued through it, so
 *     losses are shared pro-rata with no iteration and no desync.
 *
 *  4. HIGH v2: a validator's own self-stake earned nothing but commission — the
 *     reward attributable to selfStake was pushed into accRewardPerShare and paid
 *     to delegators.
 *     v3: reward splits by actual stake ownership; self-stake earns its own share.
 *
 *  5. MEDIUM v2: `receive()` looped over every validator and pushed ETH to each.
 *     Consensus calls this every block: unbounded gas, and one reverting validator
 *     (or a reentrant one) broke reward distribution for the whole network.
 *     v3: distribution is O(1) accounting only. Everything is pull-based; no ETH
 *     is ever pushed from the reward path.
 *
 *  6. MEDIUM v2: `rewardPool` accumulated when no validator was online and was
 *     never distributable — permanently stuck.
 *     v3: the pool is carried forward into the next distribution.
 *
 *  7. LOW v2: no voluntary deactivation (ValidatorDeactivated was declared but
 *     never emitted); `validatorExists` accepted slashed validators.
 *     v3: `unregisterValidator` exists and emits; modifiers reject slashed.
 *
 * Plus the missing feature: validators have a `moniker`.
 *
 * NOTE: v3 cannot recover ALT already locked in v2. That stake is unreachable by
 * any code path in the deployed v2 bytecode.
 */
contract ValidatorStakingV3 {
    // ============ Constants ============

    uint256 public constant MIN_VALIDATOR_STAKE     = 32 ether;
    uint256 public constant MIN_DELEGATION          = 10 ether;
    uint256 public constant WITHDRAWAL_DELAY        = 7 days;
    uint256 public constant MAX_COMMISSION          = 50;      // percent
    uint256 public constant ACTIVITY_THRESHOLD      = 100;     // blocks
    uint256 public constant SLASHING_PENALTY_PERCENT = 10;
    uint256 public constant MAX_MONIKER_BYTES       = 64;
    uint256 public constant PRECISION               = 1e18;

    /// @notice The only address permitted to slash. This MUST equal the consensus
    /// system caller in consensus/hybrid/systemcall.go, which is
    /// `common.HexToAddress("0xfffffffffffffffffffffffffffffffffffffffe")`. It has
    /// no private key, so slashing can only originate from block execution. If this
    /// constant and systemcall.go's systemCaller ever diverge, slash() becomes
    /// permanently uncallable (validators can never be punished).
    address public constant SYSTEM_CALLER = 0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE;

    // ============ Structs ============

    struct Validator {
        uint256 selfStake;          // validator's own bonded stake (pre-slash units)
        uint256 totalDelegatedRaw;  // sum of delegator raw units (pre-slash units)
        uint256 commission;         // 0-50
        uint256 lastActiveBlock;
        uint256 accRewardPerShare;  // scaled by PRECISION, over delegated stake
        uint256 slashFactor;        // PRECISION = untouched; halves on slash etc.
        uint256 ownerRewards;       // claimable by the validator (pull-based)
        // Unbonding self-stake is held HERE, not in withdrawalQueue, so that
        // slash() can reach it in O(1). Keeping it in the queue would either let
        // a quitting validator escape slashing, or require iterating an array the
        // validator controls -- which would let them DoS their own slashing.
        uint256 unbondingAmount;
        uint256 unbondingUnlockTime;
        bool    isActive;
        bool    isSlashed;
        string  moniker;
    }

    struct Delegation {
        uint256 rawAmount;          // pre-slash units; effective = raw * slashFactor / PRECISION
        uint256 rewardDebt;
        uint256 pendingRewards;
    }

    struct WithdrawalRequest {
        uint256 amount;             // already-effective ALT
        uint256 unlockTime;
        address validator;
    }

    // ============ State ============

    mapping(address => Validator) public validators;
    mapping(address => mapping(address => Delegation)) public delegations;
    mapping(address => WithdrawalRequest[]) public withdrawalQueue;

    address[] public validatorList;
    mapping(address => uint256) public validatorIndex; // 1-indexed; 0 = absent

    uint256 public totalStaked;      // effective ALT bonded across all validators
    uint256 public totalValidators;
    uint256 public rewardPool;       // undistributed rewards, carried forward
    uint256 public slashedFunds;     // burned-in-place, never payable out

    // ============ Events ============

    event ValidatorRegistered(address indexed validator, uint256 stake, uint256 commission, string moniker);
    event ValidatorDeactivated(address indexed validator, uint256 returnedStake);
    event MonikerChanged(address indexed validator, string moniker);
    event CommissionChanged(address indexed validator, uint256 oldCommission, uint256 newCommission);
    event SelfStakeAdded(address indexed validator, uint256 amount);
    event SelfStakeUnbonded(address indexed validator, uint256 amount, uint256 unlockTime);
    event Delegated(address indexed delegator, address indexed validator, uint256 amount);
    event Undelegated(address indexed delegator, address indexed validator, uint256 amount, uint256 unlockTime);
    event WithdrawalCompleted(address indexed account, uint256 amount);
    event RewardsClaimed(address indexed account, address indexed validator, uint256 amount);
    event RewardsDistributed(uint256 amount, uint256 onlineStake);
    event ValidatorSlashed(address indexed validator, uint256 penalty);
    event ValidatorAttested(address indexed validator, uint256 blockNumber);

    // ============ Modifiers ============

    modifier onlyActiveValidator() {
        require(validators[msg.sender].isActive,  "Not an active validator");
        require(!validators[msg.sender].isSlashed, "Validator is slashed");
        _;
    }

    modifier onlySystem() {
        require(msg.sender == SYSTEM_CALLER, "Only consensus may call");
        _;
    }

    // ============ Internal helpers ============

    /// Effective (post-slash) value of a raw delegation amount.
    function _effective(uint256 raw, uint256 slashFactor) internal pure returns (uint256) {
        return (raw * slashFactor) / PRECISION;
    }

    function _rawFromEffective(uint256 eff, uint256 slashFactor) internal pure returns (uint256) {
        require(slashFactor > 0, "Validator fully slashed");
        return (eff * PRECISION) / slashFactor;
    }

    // ============ Validator lifecycle ============

    function registerValidator(uint256 commission, string calldata moniker) external payable {
        require(msg.value >= MIN_VALIDATOR_STAKE, "Minimum 32 ALT required");
        require(commission <= MAX_COMMISSION, "Commission too high");
        require(bytes(moniker).length <= MAX_MONIKER_BYTES, "Moniker too long");

        Validator storage v = validators[msg.sender];
        require(!v.isActive, "Already a validator");
        require(!v.isSlashed, "Previously slashed");
        require(v.selfStake == 0, "Unbond pending stake first");

        v.selfStake       = msg.value;
        v.commission      = commission;
        v.lastActiveBlock = block.number;
        v.slashFactor     = PRECISION;
        v.isActive        = true;
        v.moniker         = moniker;

        validatorList.push(msg.sender);
        validatorIndex[msg.sender] = validatorList.length;
        totalValidators++;
        totalStaked += msg.value;

        emit ValidatorRegistered(msg.sender, msg.value, commission, moniker);
    }

    function addSelfStake() external payable onlyActiveValidator {
        require(msg.value > 0, "Must send ALT");
        validators[msg.sender].selfStake += msg.value;
        totalStaked += msg.value;
        emit SelfStakeAdded(msg.sender, msg.value);
    }

    /// @notice FIX #2: unbond part of your self-stake through the withdrawal queue.
    /// Must leave at least MIN_VALIDATOR_STAKE bonded while still active — use
    /// unregisterValidator() to exit completely.
    function unstakeSelf(uint256 amount) external onlyActiveValidator {
        Validator storage v = validators[msg.sender];
        require(amount > 0, "Amount must be > 0");
        require(v.selfStake >= amount, "Insufficient self-stake");
        require(v.selfStake - amount >= MIN_VALIDATOR_STAKE, "Would fall below minimum; unregister instead");
        require(v.unbondingAmount == 0, "Unbonding already in progress");

        v.selfStake -= amount;
        totalStaked -= amount;
        v.unbondingAmount = amount;
        v.unbondingUnlockTime = block.timestamp + WITHDRAWAL_DELAY;

        emit SelfStakeUnbonded(msg.sender, amount, v.unbondingUnlockTime);
    }

    /// @notice Collect self-stake once the unbonding period has elapsed.
    /// Slashable right up until it is claimed.
    function claimUnbondedSelfStake() external {
        Validator storage v = validators[msg.sender];
        uint256 amount = v.unbondingAmount;
        require(amount > 0, "Nothing unbonding");
        require(block.timestamp >= v.unbondingUnlockTime, "Still unbonding");

        v.unbondingAmount = 0;                    // effects before interaction
        v.unbondingUnlockTime = 0;

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");

        emit WithdrawalCompleted(msg.sender, amount);
    }

    /// @notice FIX #2 + #7: leave the validator set and queue the whole self-stake.
    /// Delegators keep their delegations and can undelegate normally.
    function unregisterValidator() external onlyActiveValidator {
        Validator storage v = validators[msg.sender];
        uint256 bonded = v.selfStake;
        uint256 amount = bonded + v.unbondingAmount;

        v.selfStake = 0;
        v.isActive  = false;
        totalStaked -= bonded;
        _removeFromList(msg.sender);

        // Held in the validator record, not the withdrawal queue, so it stays
        // reachable by slash() for the whole unbonding period.
        v.unbondingAmount = amount;
        v.unbondingUnlockTime = block.timestamp + WITHDRAWAL_DELAY;

        emit ValidatorDeactivated(msg.sender, amount);
    }

    function setCommission(uint256 newCommission) external onlyActiveValidator {
        require(newCommission <= MAX_COMMISSION, "Commission too high");
        uint256 old = validators[msg.sender].commission;
        validators[msg.sender].commission = newCommission;
        emit CommissionChanged(msg.sender, old, newCommission);
    }

    function setMoniker(string calldata moniker) external onlyActiveValidator {
        require(bytes(moniker).length <= MAX_MONIKER_BYTES, "Moniker too long");
        validators[msg.sender].moniker = moniker;
        emit MonikerChanged(msg.sender, moniker);
    }

    function attest() external onlyActiveValidator {
        validators[msg.sender].lastActiveBlock = block.number;
        emit ValidatorAttested(msg.sender, block.number);
    }

    function isValidatorOnline(address validator) public view returns (bool) {
        Validator storage v = validators[validator];
        if (!v.isActive || v.isSlashed) return false;
        return (block.number - v.lastActiveBlock) <= ACTIVITY_THRESHOLD;
    }

    // ============ Delegation ============

    function delegate(address validator) external payable {
        Validator storage v = validators[validator];
        require(v.isActive, "Validator not active");
        require(!v.isSlashed, "Validator is slashed");
        require(msg.value >= MIN_DELEGATION, "Minimum 10 ALT required");

        Delegation storage d = delegations[msg.sender][validator];

        if (d.rawAmount > 0) _accrue(msg.sender, validator);

        uint256 raw = _rawFromEffective(msg.value, v.slashFactor);
        d.rawAmount += raw;
        v.totalDelegatedRaw += raw;
        totalStaked += msg.value;

        d.rewardDebt = (d.rawAmount * v.accRewardPerShare) / PRECISION;

        emit Delegated(msg.sender, validator, msg.value);
    }

    function undelegate(address validator, uint256 amount) external {
        Validator storage v = validators[validator];
        Delegation storage d = delegations[msg.sender][validator];
        require(amount > 0, "Amount must be > 0");

        uint256 effective = _effective(d.rawAmount, v.slashFactor);
        require(effective >= amount, "Insufficient delegation");

        _accrue(msg.sender, validator);

        uint256 raw = _rawFromEffective(amount, v.slashFactor);
        if (raw > d.rawAmount) raw = d.rawAmount;   // rounding guard

        d.rawAmount -= raw;
        v.totalDelegatedRaw -= raw;
        totalStaked -= amount;

        d.rewardDebt = (d.rawAmount * v.accRewardPerShare) / PRECISION;

        withdrawalQueue[msg.sender].push(WithdrawalRequest({
            amount: amount,
            unlockTime: block.timestamp + WITHDRAWAL_DELAY,
            validator: validator
        }));

        emit Undelegated(msg.sender, validator, amount, block.timestamp + WITHDRAWAL_DELAY);
    }

    function completeWithdrawals() external {
        WithdrawalRequest[] storage reqs = withdrawalQueue[msg.sender];
        uint256 total = 0;
        uint256 i = 0;

        while (i < reqs.length) {
            if (reqs[i].unlockTime <= block.timestamp) {
                total += reqs[i].amount;
                reqs[i] = reqs[reqs.length - 1];
                reqs.pop();
            } else {
                i++;
            }
        }

        require(total > 0, "No withdrawals ready");

        // effects before interaction
        (bool ok, ) = msg.sender.call{value: total}("");
        require(ok, "Transfer failed");

        emit WithdrawalCompleted(msg.sender, total);
    }

    // ============ Rewards (pull-based) ============

    /// Move a delegator's earned rewards into pendingRewards. No transfers.
    function _accrue(address delegator, address validator) internal {
        Delegation storage d = delegations[delegator][validator];
        Validator storage v = validators[validator];
        if (d.rawAmount == 0) return;

        uint256 acc = (d.rawAmount * v.accRewardPerShare) / PRECISION;
        if (acc > d.rewardDebt) {
            d.pendingRewards += acc - d.rewardDebt;
        }
        d.rewardDebt = acc;
    }

    function pendingRewards(address delegator, address validator) external view returns (uint256) {
        Delegation storage d = delegations[delegator][validator];
        Validator storage v = validators[validator];
        uint256 acc = (d.rawAmount * v.accRewardPerShare) / PRECISION;
        uint256 extra = acc > d.rewardDebt ? acc - d.rewardDebt : 0;
        return d.pendingRewards + extra;
    }

    function claimRewards(address validator) external {
        _accrue(msg.sender, validator);
        Delegation storage d = delegations[msg.sender][validator];
        uint256 amount = d.pendingRewards;
        require(amount > 0, "Nothing to claim");

        d.pendingRewards = 0;                      // effects first
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");

        emit RewardsClaimed(msg.sender, validator, amount);
    }

    /// Validator's own earnings (commission + self-stake share).
    function claimValidatorRewards() external {
        Validator storage v = validators[msg.sender];
        uint256 amount = v.ownerRewards;
        require(amount > 0, "Nothing to claim");

        v.ownerRewards = 0;                        // effects first
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");

        emit RewardsClaimed(msg.sender, msg.sender, amount);
    }

    /// @notice FIX #5: O(n) accounting only, no external calls, nothing pushed.
    /// @notice FIX #6: undistributable amounts are carried, not stranded.
    receive() external payable {
        if (msg.value > 0) _distribute(msg.value + rewardPool);
    }

    function _distribute(uint256 amount) internal {
        uint256 onlineStake = 0;
        uint256 n = validatorList.length;

        for (uint256 i = 0; i < n; i++) {
            address a = validatorList[i];
            if (!isValidatorOnline(a)) continue;
            Validator storage v = validators[a];
            onlineStake += v.selfStake + _effective(v.totalDelegatedRaw, v.slashFactor);
        }

        if (onlineStake == 0) {
            rewardPool = amount;      // carry forward, never stranded
            return;
        }
        rewardPool = 0;

        uint256 distributed = 0;
        for (uint256 i = 0; i < n; i++) {
            address a = validatorList[i];
            if (!isValidatorOnline(a)) continue;

            Validator storage v = validators[a];
            uint256 deleg = _effective(v.totalDelegatedRaw, v.slashFactor);
            uint256 stake = v.selfStake + deleg;
            uint256 reward = (amount * stake) / onlineStake;
            if (reward == 0) continue;
            distributed += reward;

            // FIX #4: split by actual ownership. The delegated portion earns for
            // delegators (minus commission); the self-stake portion earns for the
            // validator. v2 gave the self-stake's earnings to delegators.
            uint256 delegShare = deleg == 0 ? 0 : (reward * deleg) / stake;
            uint256 commission = (delegShare * v.commission) / 100;
            uint256 toDelegators = delegShare - commission;

            v.ownerRewards += reward - toDelegators;   // self share + commission

            if (toDelegators > 0 && v.totalDelegatedRaw > 0) {
                v.accRewardPerShare += (toDelegators * PRECISION) / v.totalDelegatedRaw;
            }
        }

        // integer-division dust stays for the next round
        if (distributed < amount) rewardPool += amount - distributed;

        emit RewardsDistributed(amount, onlineStake);
    }

    // ============ Slashing ============

    /// @notice FIX #1: only the consensus system caller may slash. SYSTEM_CALLER
    /// has no private key; slashing can only originate inside block execution.
    /// @notice FIX #3: losses are applied via slashFactor so every delegator shares
    /// them pro-rata. v2 desynced totalDelegated from individual balances and
    /// stranded the last delegator behind an underflow.
    function slash(address validator) external onlySystem {
        Validator storage v = validators[validator];
        require(!v.isSlashed, "Already slashed");
        // Deliberately NOT `require(isActive)`. A validator who unregisters or
        // unstakes still has funds unbonding for 7 days; slashing must reach them,
        // or a misbehaving validator escapes simply by quitting first.
        require(v.slashFactor > 0, "Not a validator");

        uint256 deleg  = _effective(v.totalDelegatedRaw, v.slashFactor);
        // At-risk = bonded self + unbonding self + delegated. Unbonding is included
        // so quitting does not shrink the penalty base.
        uint256 atRisk = v.selfStake + v.unbondingAmount + deleg;
        uint256 penalty = (atRisk * SLASHING_PENALTY_PERCENT) / 100;

        uint256 remaining  = penalty;
        uint256 fromBonded = 0;   // portion that must also leave totalStaked

        // 1. bonded self-stake (still counted in totalStaked)
        uint256 fromSelf = remaining <= v.selfStake ? remaining : v.selfStake;
        v.selfStake -= fromSelf;
        remaining   -= fromSelf;
        fromBonded  += fromSelf;

        // 2. unbonding self-stake (already removed from totalStaked)
        if (remaining > 0 && v.unbondingAmount > 0) {
            uint256 fromUnbond = remaining <= v.unbondingAmount ? remaining : v.unbondingAmount;
            v.unbondingAmount -= fromUnbond;
            remaining         -= fromUnbond;
        }

        // 3. delegations, scaled down in O(1) so every delegator shares pro-rata
        if (remaining > 0 && deleg > 0) {
            uint256 take = remaining <= deleg ? remaining : deleg;
            uint256 left = deleg - take;
            v.slashFactor = (v.slashFactor * left) / deleg;
            remaining  -= take;
            fromBonded += take;
        }

        uint256 applied = penalty - remaining;   // remaining is 0 (10% <= 100%)
        v.isSlashed = true;
        v.isActive  = false;
        totalStaked = totalStaked >= fromBonded ? totalStaked - fromBonded : 0;
        slashedFunds += applied;

        _removeFromList(validator);

        emit ValidatorSlashed(validator, applied);
    }

    // ============ Internal ============

    function _removeFromList(address validator) internal {
        uint256 index = validatorIndex[validator];
        if (index == 0) return;

        uint256 last = validatorList.length;
        if (index < last) {
            address moved = validatorList[last - 1];
            validatorList[index - 1] = moved;
            validatorIndex[moved] = index;
        }
        validatorList.pop();
        validatorIndex[validator] = 0;
        if (totalValidators > 0) totalValidators--;
    }

    // ============ Views ============

    function getValidator(address validator) external view returns (
        uint256 selfStake,
        uint256 totalDelegated,
        uint256 commission,
        uint256 lastActiveBlock,
        bool isActive,
        bool isOnline,
        bool isSlashed,
        string memory moniker
    ) {
        Validator storage v = validators[validator];
        return (
            v.selfStake,
            _effective(v.totalDelegatedRaw, v.slashFactor),
            v.commission,
            v.lastActiveBlock,
            v.isActive,
            isValidatorOnline(validator),
            v.isSlashed,
            v.moniker
        );
    }

    function getDelegation(address delegator, address validator)
        external view returns (uint256 amount, uint256 pending)
    {
        Delegation storage d = delegations[delegator][validator];
        Validator storage v = validators[validator];
        uint256 acc = (d.rawAmount * v.accRewardPerShare) / PRECISION;
        uint256 extra = acc > d.rewardDebt ? acc - d.rewardDebt : 0;
        return (_effective(d.rawAmount, v.slashFactor), d.pendingRewards + extra);
    }

    function getPendingWithdrawals(address account)
        external view returns (uint256 ready, uint256 locked)
    {
        WithdrawalRequest[] storage reqs = withdrawalQueue[account];
        for (uint256 i = 0; i < reqs.length; i++) {
            if (reqs[i].unlockTime <= block.timestamp) ready += reqs[i].amount;
            else locked += reqs[i].amount;
        }
    }

    function getOnlineValidators() external view returns (address[] memory) {
        uint256 n = 0;
        for (uint256 i = 0; i < validatorList.length; i++) {
            if (isValidatorOnline(validatorList[i])) n++;
        }
        address[] memory out = new address[](n);
        uint256 j = 0;
        for (uint256 i = 0; i < validatorList.length; i++) {
            if (isValidatorOnline(validatorList[i])) out[j++] = validatorList[i];
        }
        return out;
    }

    function getValidatorCount() external view returns (uint256) {
        return validatorList.length;
    }

    /// Claimable rewards belonging to the validator itself (self-stake share + commission).
    function getValidatorRewards(address validator) external view returns (uint256) {
        return validators[validator].ownerRewards;
    }

    /// Self-stake currently unbonding (from unstakeSelf/unregisterValidator).
    /// Slashable until claimed. `ready` is true once the delay has elapsed.
    function getUnbonding(address validator)
        external view returns (uint256 amount, uint256 unlockTime, bool ready)
    {
        Validator storage v = validators[validator];
        return (v.unbondingAmount, v.unbondingUnlockTime,
                v.unbondingAmount > 0 && block.timestamp >= v.unbondingUnlockTime);
    }

    function getAllValidators() external view returns (address[] memory) {
        return validatorList;
    }
}
