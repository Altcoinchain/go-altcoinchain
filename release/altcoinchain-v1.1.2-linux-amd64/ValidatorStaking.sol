// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

/**
 * @title ValidatorStaking
 * @notice Delegated Proof of Stake contract for Altcoinchain hybrid PoW/PoS
 * @dev Deployed at 0x0000000000000000000000000000000000001000
 *
 * Features:
 * - Validators must be online and actively attesting to earn rewards
 * - Users can delegate ALT to validators
 * - Validators charge commission fees on delegator rewards
 * - Withdrawal delay for undelegating (7 days)
 * - Slashing for misbehavior
 */
contract ValidatorStaking {
    // ============ Constants ============
    uint256 public constant MIN_VALIDATOR_STAKE = 1000 ether;  // 1000 ALT to run a validator
    uint256 public constant MIN_DELEGATION = 10 ether;         // 10 ALT minimum delegation
    uint256 public constant WITHDRAWAL_DELAY = 7 days;
    uint256 public constant MAX_COMMISSION = 50;               // Max 50% commission
    uint256 public constant ACTIVITY_THRESHOLD = 100;          // Must attest within 100 blocks
    uint256 public constant SLASHING_PENALTY_PERCENT = 10;

    // ============ Structs ============

    struct Validator {
        uint256 selfStake;           // Validator's own stake
        uint256 totalDelegated;      // Total delegated to this validator
        uint256 commission;          // Commission rate (0-50%)
        uint256 lastActiveBlock;     // Last block validator attested
        uint256 accRewardPerShare;   // Accumulated rewards per share (scaled by 1e18)
        bool isActive;               // Currently active
        bool isSlashed;              // Has been slashed
    }

    struct Delegation {
        uint256 amount;              // Delegated amount
        uint256 rewardDebt;          // Reward debt for proper accounting
        uint256 pendingRewards;      // Unclaimed rewards
    }

    struct WithdrawalRequest {
        uint256 amount;
        uint256 unlockTime;
        address validator;           // Which validator was undelegated from
    }

    // ============ State Variables ============

    mapping(address => Validator) public validators;
    mapping(address => mapping(address => Delegation)) public delegations; // delegator => validator => delegation
    mapping(address => WithdrawalRequest[]) public withdrawalQueue;

    address[] public validatorList;
    mapping(address => uint256) public validatorIndex; // 1-indexed

    uint256 public totalStaked;
    uint256 public totalValidators;
    uint256 public rewardPool;

    // ============ Events ============

    event ValidatorRegistered(address indexed validator, uint256 stake, uint256 commission);
    event ValidatorDeactivated(address indexed validator);
    event CommissionChanged(address indexed validator, uint256 oldCommission, uint256 newCommission);
    event Delegated(address indexed delegator, address indexed validator, uint256 amount);
    event Undelegated(address indexed delegator, address indexed validator, uint256 amount, uint256 unlockTime);
    event WithdrawalCompleted(address indexed delegator, uint256 amount);
    event RewardsClaimed(address indexed delegator, address indexed validator, uint256 amount);
    event ValidatorRewarded(address indexed validator, uint256 amount, uint256 blockNumber);
    event ValidatorSlashed(address indexed validator, uint256 penalty);
    event ValidatorAttested(address indexed validator, uint256 blockNumber);

    // ============ Modifiers ============

    modifier onlyActiveValidator() {
        require(validators[msg.sender].isActive, "Not an active validator");
        require(!validators[msg.sender].isSlashed, "Validator is slashed");
        _;
    }

    modifier validatorExists(address validator) {
        require(validators[validator].selfStake > 0 || validators[validator].isActive, "Validator does not exist");
        _;
    }

    // ============ Validator Functions ============

    /**
     * @notice Register as a validator with self-stake
     * @param commission Commission rate (0-50%)
     */
    function registerValidator(uint256 commission) external payable {
        require(msg.value >= MIN_VALIDATOR_STAKE, "Minimum 1000 ALT required");
        require(commission <= MAX_COMMISSION, "Commission too high");
        require(!validators[msg.sender].isActive, "Already a validator");
        require(!validators[msg.sender].isSlashed, "Previously slashed");

        Validator storage v = validators[msg.sender];
        v.selfStake = msg.value;
        v.commission = commission;
        v.lastActiveBlock = block.number;
        v.isActive = true;

        // Add to validator list
        validatorList.push(msg.sender);
        validatorIndex[msg.sender] = validatorList.length;
        totalValidators++;
        totalStaked += msg.value;

        emit ValidatorRegistered(msg.sender, msg.value, commission);
    }

    /**
     * @notice Add more self-stake as a validator
     */
    function addSelfStake() external payable onlyActiveValidator {
        require(msg.value > 0, "Must send ALT");

        validators[msg.sender].selfStake += msg.value;
        totalStaked += msg.value;
    }

    /**
     * @notice Update validator commission (only affects future rewards)
     * @param newCommission New commission rate
     */
    function setCommission(uint256 newCommission) external onlyActiveValidator {
        require(newCommission <= MAX_COMMISSION, "Commission too high");

        uint256 oldCommission = validators[msg.sender].commission;
        validators[msg.sender].commission = newCommission;

        emit CommissionChanged(msg.sender, oldCommission, newCommission);
    }

    /**
     * @notice Called by consensus layer when validator attests to a block
     * @param validator Address of the attesting validator
     * @dev Only callable by consensus (block.coinbase or system)
     */
    function recordAttestation(address validator) external {
        // In production, verify caller is consensus layer
        require(validators[validator].isActive, "Not active validator");

        validators[validator].lastActiveBlock = block.number;
        emit ValidatorAttested(validator, block.number);
    }

    /**
     * @notice Check if a validator is currently online (active recently)
     * @param validator Address to check
     */
    function isValidatorOnline(address validator) public view returns (bool) {
        if (!validators[validator].isActive) return false;
        if (validators[validator].isSlashed) return false;

        return (block.number - validators[validator].lastActiveBlock) <= ACTIVITY_THRESHOLD;
    }

    // ============ Delegation Functions ============

    /**
     * @notice Delegate ALT to a validator
     * @param validator Address of the validator to delegate to
     */
    function delegate(address validator) external payable validatorExists(validator) {
        require(msg.value >= MIN_DELEGATION, "Minimum 10 ALT required");
        require(validators[validator].isActive, "Validator not active");
        require(!validators[validator].isSlashed, "Validator is slashed");

        Validator storage v = validators[validator];
        Delegation storage d = delegations[msg.sender][validator];

        // Claim any pending rewards first
        if (d.amount > 0) {
            _claimRewards(msg.sender, validator);
        }

        // Update delegation
        d.amount += msg.value;
        d.rewardDebt = (d.amount * v.accRewardPerShare) / 1e18;

        v.totalDelegated += msg.value;
        totalStaked += msg.value;

        emit Delegated(msg.sender, validator, msg.value);
    }

    /**
     * @notice Request to undelegate from a validator
     * @param validator Address of the validator
     * @param amount Amount to undelegate
     */
    function undelegate(address validator, uint256 amount) external {
        Delegation storage d = delegations[msg.sender][validator];
        require(d.amount >= amount, "Insufficient delegation");
        require(amount > 0, "Amount must be > 0");

        // Claim pending rewards first
        _claimRewards(msg.sender, validator);

        // Update delegation
        d.amount -= amount;
        d.rewardDebt = (d.amount * validators[validator].accRewardPerShare) / 1e18;

        validators[validator].totalDelegated -= amount;
        totalStaked -= amount;

        // Add to withdrawal queue
        withdrawalQueue[msg.sender].push(WithdrawalRequest({
            amount: amount,
            unlockTime: block.timestamp + WITHDRAWAL_DELAY,
            validator: validator
        }));

        emit Undelegated(msg.sender, validator, amount, block.timestamp + WITHDRAWAL_DELAY);
    }

    /**
     * @notice Complete pending withdrawals that have passed the delay
     */
    function completeWithdrawals() external {
        WithdrawalRequest[] storage requests = withdrawalQueue[msg.sender];
        uint256 totalAmount = 0;
        uint256 i = 0;

        while (i < requests.length) {
            if (requests[i].unlockTime <= block.timestamp) {
                totalAmount += requests[i].amount;

                // Remove from array (swap and pop)
                requests[i] = requests[requests.length - 1];
                requests.pop();
            } else {
                i++;
            }
        }

        require(totalAmount > 0, "No withdrawals ready");

        (bool success, ) = msg.sender.call{value: totalAmount}("");
        require(success, "Transfer failed");

        emit WithdrawalCompleted(msg.sender, totalAmount);
    }

    /**
     * @notice Claim delegation rewards from a validator
     * @param validator Address of the validator
     */
    function claimRewards(address validator) external {
        _claimRewards(msg.sender, validator);
    }

    function _claimRewards(address delegator, address validator) internal {
        Delegation storage d = delegations[delegator][validator];
        Validator storage v = validators[validator];

        if (d.amount == 0) return;

        uint256 pending = ((d.amount * v.accRewardPerShare) / 1e18) - d.rewardDebt + d.pendingRewards;

        if (pending > 0) {
            d.pendingRewards = 0;
            d.rewardDebt = (d.amount * v.accRewardPerShare) / 1e18;

            (bool success, ) = delegator.call{value: pending}("");
            require(success, "Transfer failed");

            emit RewardsClaimed(delegator, validator, pending);
        }
    }

    // ============ Reward Distribution ============

    /**
     * @notice Distribute rewards to online validators only
     * @dev Called by consensus layer with validator reward portion
     */
    receive() external payable {
        if (msg.value > 0) {
            _distributeRewards(msg.value);
        }
    }

    function _distributeRewards(uint256 amount) internal {
        // Count online validators and their total stake
        uint256 onlineStake = 0;
        uint256 onlineCount = 0;

        for (uint256 i = 0; i < validatorList.length; i++) {
            address v = validatorList[i];
            if (isValidatorOnline(v)) {
                onlineStake += validators[v].selfStake + validators[v].totalDelegated;
                onlineCount++;
            }
        }

        if (onlineStake == 0 || onlineCount == 0) {
            // No online validators, add to reward pool for later
            rewardPool += amount;
            return;
        }

        // Distribute proportionally to online validators
        for (uint256 i = 0; i < validatorList.length; i++) {
            address vAddr = validatorList[i];
            Validator storage v = validators[vAddr];

            if (!isValidatorOnline(vAddr)) continue;

            uint256 validatorTotalStake = v.selfStake + v.totalDelegated;
            uint256 validatorReward = (amount * validatorTotalStake) / onlineStake;

            if (validatorReward == 0) continue;

            // Split reward: commission to validator, rest to delegators
            uint256 commission = (validatorReward * v.commission) / 100;
            uint256 delegatorReward = validatorReward - commission;

            // Validator gets commission + their share of delegator rewards
            uint256 validatorShare = commission;
            if (v.totalDelegated > 0) {
                // Update accumulated reward per share for delegators
                v.accRewardPerShare += (delegatorReward * 1e18) / v.totalDelegated;
            } else {
                // No delegators, validator gets everything
                validatorShare = validatorReward;
            }

            // Send validator their commission
            if (validatorShare > 0) {
                (bool success, ) = vAddr.call{value: validatorShare}("");
                if (!success) {
                    // Failed to send, add to their pending
                    delegations[vAddr][vAddr].pendingRewards += validatorShare;
                }
            }

            emit ValidatorRewarded(vAddr, validatorReward, block.number);
        }
    }

    // ============ Slashing ============

    /**
     * @notice Slash a validator for misbehavior
     * @param validator Address to slash
     * @dev In production, requires proof of misbehavior
     */
    function slash(address validator) external {
        // In production, verify proof of misbehavior
        require(validators[validator].isActive, "Not active");
        require(!validators[validator].isSlashed, "Already slashed");

        Validator storage v = validators[validator];

        uint256 totalValidatorStake = v.selfStake + v.totalDelegated;
        uint256 penalty = (totalValidatorStake * SLASHING_PENALTY_PERCENT) / 100;

        // Slash from self-stake first, then delegated
        if (v.selfStake >= penalty) {
            v.selfStake -= penalty;
        } else {
            uint256 remaining = penalty - v.selfStake;
            v.selfStake = 0;
            v.totalDelegated -= remaining;
        }

        v.isSlashed = true;
        v.isActive = false;
        totalStaked -= penalty;

        // Remove from active list
        _removeValidator(validator);

        emit ValidatorSlashed(validator, penalty);
    }

    function _removeValidator(address validator) internal {
        uint256 index = validatorIndex[validator];
        if (index > 0) {
            uint256 lastIndex = validatorList.length;
            if (index < lastIndex) {
                address lastValidator = validatorList[lastIndex - 1];
                validatorList[index - 1] = lastValidator;
                validatorIndex[lastValidator] = index;
            }
            validatorList.pop();
            validatorIndex[validator] = 0;
            totalValidators--;
        }
    }

    // ============ View Functions ============

    function getValidator(address validator) external view returns (
        uint256 selfStake,
        uint256 totalDelegated,
        uint256 commission,
        uint256 lastActiveBlock,
        bool isActive,
        bool isOnline,
        bool isSlashed
    ) {
        Validator storage v = validators[validator];
        return (
            v.selfStake,
            v.totalDelegated,
            v.commission,
            v.lastActiveBlock,
            v.isActive,
            isValidatorOnline(validator),
            v.isSlashed
        );
    }

    function getDelegation(address delegator, address validator) external view returns (
        uint256 amount,
        uint256 pendingRewards
    ) {
        Delegation storage d = delegations[delegator][validator];
        Validator storage v = validators[validator];

        uint256 pending = 0;
        if (d.amount > 0) {
            pending = ((d.amount * v.accRewardPerShare) / 1e18) - d.rewardDebt + d.pendingRewards;
        }

        return (d.amount, pending);
    }

    function getPendingWithdrawals(address user) external view returns (
        uint256 totalPending,
        uint256 totalReady
    ) {
        WithdrawalRequest[] storage requests = withdrawalQueue[user];

        for (uint256 i = 0; i < requests.length; i++) {
            if (requests[i].unlockTime <= block.timestamp) {
                totalReady += requests[i].amount;
            } else {
                totalPending += requests[i].amount;
            }
        }
    }

    function getOnlineValidators() external view returns (address[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < validatorList.length; i++) {
            if (isValidatorOnline(validatorList[i])) count++;
        }

        address[] memory online = new address[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < validatorList.length; i++) {
            if (isValidatorOnline(validatorList[i])) {
                online[j++] = validatorList[i];
            }
        }

        return online;
    }

    function getValidatorCount() external view returns (uint256) {
        return totalValidators;
    }

    function getAllValidators() external view returns (address[] memory) {
        return validatorList;
    }
}
