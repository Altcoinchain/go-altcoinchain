// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.0;

/// @title ValidatorStaking - Staking contract for Altcoinchain hybrid PoW/PoS consensus
/// @notice Manages validator nodes and delegator stakes for the hybrid consensus mechanism
/// @dev Validators need 20,000 ALT to run a node. Delegators need 32 ALT to stake with a validator.
///      Only online validators (who attest to blocks) earn rewards for themselves and their delegators.
contract ValidatorStaking {
    // Constants
    uint256 public constant MIN_VALIDATOR_STAKE = 20000 ether;  // 20,000 ALT to run validator node
    uint256 public constant MIN_DELEGATION = 32 ether;  // 32 ALT minimum delegation
    uint256 public constant WITHDRAWAL_DELAY = 7 days;  // 7 day withdrawal delay
    uint256 public constant SLASH_PERCENTAGE = 10;  // 10% slashing penalty
    uint256 private constant PRECISION = 1e18;  // Precision for reward calculations

    // Validator structure (node operators)
    struct Validator {
        uint256 selfStake;                // Validator's own stake
        uint256 totalDelegated;           // Total delegated to this validator
        uint256 accRewardPerShare;        // Accumulated rewards per share for delegators
        uint256 pendingRewards;           // Validator's pending rewards (from fee + self-stake)
        uint256 totalRewardsClaimed;      // Total rewards claimed
        uint256 lastActiveBlock;          // Last block this validator attested to
        uint256 commission;               // Commission percentage (0-100, validator sets this)
        bool active;                      // Whether validator is accepting delegations
        bool slashed;                     // Whether validator has been slashed
    }

    // Delegator structure
    struct Delegator {
        address validator;                // Which validator they delegated to
        uint256 amount;                   // Amount delegated
        uint256 rewardDebt;               // Reward debt for accurate calculation
        uint256 pendingRewards;           // Accumulated rewards
        uint256 totalRewardsClaimed;      // Total rewards claimed
        uint256 withdrawalRequestTime;    // When withdrawal was requested
        bool withdrawalRequested;         // Whether withdrawal is pending
    }

    // State variables
    mapping(address => Validator) public validators;
    mapping(address => Delegator) public delegators;
    address[] public validatorList;

    uint256 public totalValidatorStake;      // Total stake from validators themselves
    uint256 public totalDelegatedStake;      // Total delegated stake
    uint256 public activeValidatorCount;
    uint256 public totalRewardsDistributed;

    // Events
    event ValidatorRegistered(address indexed validator, uint256 stake);
    event ValidatorDeactivated(address indexed validator);
    event Delegated(address indexed delegator, address indexed validator, uint256 amount);
    event DelegationAdded(address indexed delegator, uint256 amount, uint256 newTotal);
    event WithdrawalRequested(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 stakeAmount, uint256 rewardsAmount);
    event RewardsClaimed(address indexed user, uint256 amount);
    event RewardsDistributed(address indexed validator, uint256 validatorReward, uint256 delegatorReward);
    event ValidatorAttested(address indexed validator, uint256 blockNumber);
    event Slashed(address indexed validator, uint256 amount, string reason);

    // Errors
    error BelowMinimumStake(uint256 sent, uint256 required);
    error AlreadyValidator();
    error AlreadyDelegating();
    error NotValidator();
    error NotDelegating();
    error ValidatorSlashed();
    error ValidatorNotActive();
    error WithdrawalAlreadyRequested();
    error WithdrawalNotRequested();
    error WithdrawalDelayNotPassed(uint256 remaining);
    error NoRewardsToClaim();
    error TransferFailed();
    error InvalidValidator();

    // ============ VALIDATOR FUNCTIONS ============

    /// @notice Register as a validator node operator
    /// @dev Requires minimum 20,000 ALT stake
    function registerValidator() external payable {
        if (msg.value < MIN_VALIDATOR_STAKE) {
            revert BelowMinimumStake(msg.value, MIN_VALIDATOR_STAKE);
        }
        if (validators[msg.sender].selfStake > 0) {
            revert AlreadyValidator();
        }
        if (validators[msg.sender].slashed) {
            revert ValidatorSlashed();
        }

        validators[msg.sender] = Validator({
            selfStake: msg.value,
            totalDelegated: 0,
            accRewardPerShare: 0,
            pendingRewards: 0,
            totalRewardsClaimed: 0,
            lastActiveBlock: block.number,
            commission: 10,  // Default 10% commission
            active: true,
            slashed: false
        });

        validatorList.push(msg.sender);
        totalValidatorStake += msg.value;
        activeValidatorCount++;

        emit ValidatorRegistered(msg.sender, msg.value);
    }

    /// @notice Add more stake to validator position
    function addValidatorStake() external payable {
        Validator storage v = validators[msg.sender];
        if (v.selfStake == 0) {
            revert NotValidator();
        }
        if (!v.active) {
            revert ValidatorNotActive();
        }

        v.selfStake += msg.value;
        totalValidatorStake += msg.value;
    }

    /// @notice Deactivate validator (stop accepting delegations, begin withdrawal process)
    function deactivateValidator() external {
        Validator storage v = validators[msg.sender];
        if (v.selfStake == 0) {
            revert NotValidator();
        }
        if (!v.active) {
            revert ValidatorNotActive();
        }

        v.active = false;
        activeValidatorCount--;

        emit ValidatorDeactivated(msg.sender);
    }

    /// @notice Record that a validator attested to a block (called by consensus)
    /// @dev This marks the validator as online and eligible for the next reward distribution
    /// @param validator The validator address that attested
    function recordAttestation(address validator) external {
        Validator storage v = validators[validator];
        if (v.selfStake > 0 && v.active) {
            v.lastActiveBlock = block.number;
            emit ValidatorAttested(validator, block.number);
        }
    }

    /// @notice Set validator commission rate
    /// @param newCommission New commission percentage (0-100)
    function setCommission(uint256 newCommission) external {
        Validator storage v = validators[msg.sender];
        if (v.selfStake == 0) {
            revert NotValidator();
        }
        require(newCommission <= 100, "Commission cannot exceed 100%");
        v.commission = newCommission;
    }

    // ============ DELEGATOR FUNCTIONS ============

    /// @notice Delegate stake to a validator
    /// @param validator The validator to delegate to
    function delegate(address validator) external payable {
        if (msg.value < MIN_DELEGATION) {
            revert BelowMinimumStake(msg.value, MIN_DELEGATION);
        }
        if (delegators[msg.sender].amount > 0) {
            revert AlreadyDelegating();
        }

        Validator storage v = validators[validator];
        if (v.selfStake == 0 || !v.active) {
            revert InvalidValidator();
        }

        // Calculate reward debt so new delegators don't claim old rewards
        uint256 rewardDebt = (msg.value * v.accRewardPerShare) / PRECISION;

        delegators[msg.sender] = Delegator({
            validator: validator,
            amount: msg.value,
            rewardDebt: rewardDebt,
            pendingRewards: 0,
            totalRewardsClaimed: 0,
            withdrawalRequestTime: 0,
            withdrawalRequested: false
        });

        v.totalDelegated += msg.value;
        totalDelegatedStake += msg.value;

        emit Delegated(msg.sender, validator, msg.value);
    }

    /// @notice Add more stake to existing delegation
    function addDelegation() external payable {
        Delegator storage d = delegators[msg.sender];
        if (d.amount == 0) {
            revert NotDelegating();
        }
        if (d.withdrawalRequested) {
            revert WithdrawalAlreadyRequested();
        }

        Validator storage v = validators[d.validator];

        // Harvest pending rewards before changing stake
        _updateDelegatorRewards(msg.sender);

        d.amount += msg.value;
        v.totalDelegated += msg.value;
        totalDelegatedStake += msg.value;

        // Update reward debt
        d.rewardDebt = (d.amount * v.accRewardPerShare) / PRECISION;

        emit DelegationAdded(msg.sender, msg.value, d.amount);
    }

    /// @notice Request withdrawal of delegation
    function requestWithdrawal() external {
        Delegator storage d = delegators[msg.sender];
        if (d.amount == 0) {
            revert NotDelegating();
        }
        if (d.withdrawalRequested) {
            revert WithdrawalAlreadyRequested();
        }

        // Harvest pending rewards
        _updateDelegatorRewards(msg.sender);

        Validator storage v = validators[d.validator];
        v.totalDelegated -= d.amount;
        totalDelegatedStake -= d.amount;

        d.withdrawalRequested = true;
        d.withdrawalRequestTime = block.timestamp;

        emit WithdrawalRequested(msg.sender, d.amount);
    }

    /// @notice Complete withdrawal after delay
    function withdraw() external {
        Delegator storage d = delegators[msg.sender];
        if (!d.withdrawalRequested) {
            revert WithdrawalNotRequested();
        }

        uint256 timePassed = block.timestamp - d.withdrawalRequestTime;
        if (timePassed < WITHDRAWAL_DELAY) {
            revert WithdrawalDelayNotPassed(WITHDRAWAL_DELAY - timePassed);
        }

        uint256 stakeAmount = d.amount;
        uint256 rewardsAmount = d.pendingRewards;
        uint256 totalAmount = stakeAmount + rewardsAmount;

        // Clear delegator data
        delete delegators[msg.sender];

        // Transfer funds
        (bool success, ) = payable(msg.sender).call{value: totalAmount}("");
        if (!success) {
            revert TransferFailed();
        }

        emit Withdrawn(msg.sender, stakeAmount, rewardsAmount);
    }

    /// @notice Claim accumulated rewards without withdrawing stake
    function claimRewards() external {
        // Check if caller is a validator
        Validator storage v = validators[msg.sender];
        if (v.selfStake > 0) {
            if (v.pendingRewards == 0) {
                revert NoRewardsToClaim();
            }

            uint256 rewards = v.pendingRewards;
            v.pendingRewards = 0;
            v.totalRewardsClaimed += rewards;

            (bool success, ) = payable(msg.sender).call{value: rewards}("");
            if (!success) {
                revert TransferFailed();
            }

            emit RewardsClaimed(msg.sender, rewards);
            return;
        }

        // Otherwise check if delegator
        Delegator storage d = delegators[msg.sender];
        if (d.amount > 0) {
            _updateDelegatorRewards(msg.sender);

            if (d.pendingRewards == 0) {
                revert NoRewardsToClaim();
            }

            uint256 rewards = d.pendingRewards;
            d.pendingRewards = 0;
            d.totalRewardsClaimed += rewards;

            (bool success, ) = payable(msg.sender).call{value: rewards}("");
            if (!success) {
                revert TransferFailed();
            }

            emit RewardsClaimed(msg.sender, rewards);
            return;
        }

        revert NoRewardsToClaim();
    }

    // ============ REWARD DISTRIBUTION ============

    /// @notice Distribute block rewards to a validator and their delegators
    /// @dev Called by consensus engine. Only online validators receive rewards.
    ///      Validator takes commission from delegator rewards, rest split by stake.
    /// @param validator The validator address to reward
    function distributeRewards(address validator) external payable {
        if (msg.value == 0) return;

        Validator storage v = validators[validator];
        if (v.selfStake == 0 || v.slashed) return;

        // Check if validator was recently active (within last 256 blocks)
        if (block.number - v.lastActiveBlock > 256) {
            // Validator offline, no rewards
            return;
        }

        uint256 totalStake = v.selfStake + v.totalDelegated;
        if (totalStake == 0) return;

        // Calculate validator's share based on self-stake
        uint256 validatorStakeShare = (msg.value * v.selfStake) / totalStake;

        // Calculate delegator share before commission
        uint256 delegatorShareBeforeCommission = msg.value - validatorStakeShare;

        // Validator takes commission from delegator rewards
        uint256 commission = (delegatorShareBeforeCommission * v.commission) / 100;
        uint256 delegatorShareAfterCommission = delegatorShareBeforeCommission - commission;

        // Validator gets: stake share + commission
        v.pendingRewards += validatorStakeShare + commission;

        // Delegators share the rest proportionally
        if (v.totalDelegated > 0 && delegatorShareAfterCommission > 0) {
            v.accRewardPerShare += (delegatorShareAfterCommission * PRECISION) / v.totalDelegated;
        }

        totalRewardsDistributed += msg.value;

        emit RewardsDistributed(validator, validatorStakeShare + commission, delegatorShareAfterCommission);
    }

    /// @notice Internal function to update delegator rewards
    function _updateDelegatorRewards(address delegator) internal {
        Delegator storage d = delegators[delegator];
        if (d.amount > 0 && !d.withdrawalRequested) {
            Validator storage v = validators[d.validator];
            uint256 accumulatedReward = (d.amount * v.accRewardPerShare) / PRECISION;
            uint256 pendingReward = accumulatedReward - d.rewardDebt;
            d.pendingRewards += pendingReward;
            d.rewardDebt = accumulatedReward;
        }
    }

    // ============ SLASHING ============

    /// @notice Slash a validator for misbehavior
    function slash(address validator, string calldata reason) external {
        Validator storage v = validators[validator];
        if (v.selfStake == 0) {
            revert NotValidator();
        }

        uint256 slashAmount = (v.selfStake * SLASH_PERCENTAGE) / 100;
        v.selfStake -= slashAmount;
        v.slashed = true;
        v.active = false;

        totalValidatorStake -= slashAmount;
        if (v.active) {
            activeValidatorCount--;
        }

        emit Slashed(validator, slashAmount, reason);
    }

    // ============ VIEW FUNCTIONS ============

    /// @notice Get validator information
    function getValidator(address addr) external view returns (Validator memory) {
        return validators[addr];
    }

    /// @notice Get delegator information
    function getDelegator(address addr) external view returns (Delegator memory) {
        return delegators[addr];
    }

    /// @notice Get all active validator addresses
    function getActiveValidators() external view returns (address[] memory) {
        address[] memory active = new address[](activeValidatorCount);
        uint256 idx = 0;

        for (uint256 i = 0; i < validatorList.length && idx < activeValidatorCount; i++) {
            if (validators[validatorList[i]].active && !validators[validatorList[i]].slashed) {
                active[idx++] = validatorList[i];
            }
        }

        return active;
    }

    /// @notice Get all validator addresses
    function getAllValidators() external view returns (address[] memory) {
        return validatorList;
    }

    /// @notice Check if address is an active validator
    function isValidator(address addr) external view returns (bool) {
        Validator storage v = validators[addr];
        return v.selfStake >= MIN_VALIDATOR_STAKE && v.active && !v.slashed;
    }

    /// @notice Check if validator is online (attested recently)
    function isValidatorOnline(address addr) external view returns (bool) {
        Validator storage v = validators[addr];
        return v.active && !v.slashed && (block.number - v.lastActiveBlock <= 256);
    }

    /// @notice Get total stake for a validator (self + delegated)
    function getValidatorTotalStake(address addr) external view returns (uint256) {
        Validator storage v = validators[addr];
        return v.selfStake + v.totalDelegated;
    }

    /// @notice Get pending rewards for a delegator
    function getDelegatorPendingRewards(address addr) external view returns (uint256) {
        Delegator storage d = delegators[addr];
        if (d.amount == 0) return 0;

        Validator storage v = validators[d.validator];
        uint256 accumulatedReward = (d.amount * v.accRewardPerShare) / PRECISION;
        uint256 pendingReward = accumulatedReward - d.rewardDebt;
        return d.pendingRewards + pendingReward;
    }

    /// @notice Get validator count
    function getValidatorCount() external view returns (uint256) {
        return validatorList.length;
    }

    /// @notice Get total staked (validators + delegators)
    function getTotalStaked() external view returns (uint256) {
        return totalValidatorStake + totalDelegatedStake;
    }

    /// @notice Calculate withdrawal time remaining
    function getWithdrawalTimeRemaining(address addr) external view returns (uint256) {
        Delegator storage d = delegators[addr];
        if (!d.withdrawalRequested) return 0;

        uint256 timePassed = block.timestamp - d.withdrawalRequestTime;
        if (timePassed >= WITHDRAWAL_DELAY) return 0;

        return WITHDRAWAL_DELAY - timePassed;
    }

    // ============ RECEIVE ============

    /// @notice Receive function - rewards should use distributeRewards() instead
    receive() external payable {}
    fallback() external payable {}
}
