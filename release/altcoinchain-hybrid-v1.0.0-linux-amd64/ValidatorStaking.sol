// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

/**
 * @title ValidatorStaking
 * @notice Staking contract for Altcoinchain hybrid PoW/PoS consensus
 * @dev Deployed at 0x0000000000000000000000000000000000001000
 *
 * Validators stake ALT to participate in block attestation.
 * Block rewards (1 ALT per block) are distributed proportionally based on stake.
 *
 * Key parameters:
 * - Minimum stake: 32 ALT
 * - Withdrawal delay: 7 days
 * - Slashing penalty: 10% for double attestation
 */
contract ValidatorStaking {
    // ============ Constants ============
    uint256 public constant MIN_STAKE = 32 ether; // 32 ALT
    uint256 public constant WITHDRAWAL_DELAY = 7 days;
    uint256 public constant SLASHING_PENALTY_PERCENT = 10;

    // ============ State Variables ============

    // Validator info
    struct Validator {
        uint256 stake;              // Amount staked
        uint256 pendingRewards;     // Unclaimed rewards
        uint256 lastRewardBlock;    // Last block rewards were calculated
        bool isActive;              // Currently active validator
    }

    // Withdrawal request
    struct WithdrawalRequest {
        uint256 amount;
        uint256 unlockTime;
    }

    mapping(address => Validator) public validators;
    mapping(address => WithdrawalRequest) public withdrawalRequests;

    address[] public validatorList;
    mapping(address => uint256) public validatorIndex; // 1-indexed (0 means not in list)

    uint256 public totalStaked;
    uint256 public totalValidators;
    uint256 public rewardPool;          // Accumulated rewards to distribute
    uint256 public lastRewardBlock;     // Last block reward was received
    uint256 public accRewardPerShare;   // Accumulated rewards per share (scaled by 1e18)

    // Slashing tracking
    mapping(address => bool) public slashed;

    // ============ Events ============

    event Staked(address indexed validator, uint256 amount, uint256 totalStake);
    event WithdrawalRequested(address indexed validator, uint256 amount, uint256 unlockTime);
    event Withdrawn(address indexed validator, uint256 amount);
    event RewardsClaimed(address indexed validator, uint256 amount);
    event RewardsReceived(uint256 amount, uint256 blockNumber);
    event ValidatorSlashed(address indexed validator, uint256 penalty);
    event ValidatorActivated(address indexed validator);
    event ValidatorDeactivated(address indexed validator);

    // ============ Modifiers ============

    modifier onlyActiveValidator() {
        require(validators[msg.sender].isActive, "Not an active validator");
        _;
    }

    modifier notSlashed() {
        require(!slashed[msg.sender], "Validator has been slashed");
        _;
    }

    // ============ External Functions ============

    /**
     * @notice Stake ALT to become a validator
     * @dev Minimum stake is 32 ALT. Can add to existing stake.
     */
    function stake() external payable notSlashed {
        require(msg.value > 0, "Must stake some ALT");

        Validator storage v = validators[msg.sender];

        // Update rewards before changing stake
        _updateRewards(msg.sender);

        uint256 newStake = v.stake + msg.value;
        require(newStake >= MIN_STAKE, "Minimum stake is 32 ALT");

        // Add to validator list if new
        if (!v.isActive && newStake >= MIN_STAKE) {
            _activateValidator(msg.sender);
        }

        v.stake = newStake;
        totalStaked += msg.value;

        emit Staked(msg.sender, msg.value, newStake);
    }

    /**
     * @notice Request withdrawal of staked ALT
     * @param amount Amount to withdraw
     * @dev Starts 7-day withdrawal delay. Validator becomes inactive if stake falls below minimum.
     */
    function requestWithdrawal(uint256 amount) external onlyActiveValidator {
        Validator storage v = validators[msg.sender];
        require(amount > 0, "Amount must be > 0");
        require(amount <= v.stake, "Insufficient stake");
        require(withdrawalRequests[msg.sender].amount == 0, "Pending withdrawal exists");

        // Update rewards before changing stake
        _updateRewards(msg.sender);

        // Create withdrawal request
        withdrawalRequests[msg.sender] = WithdrawalRequest({
            amount: amount,
            unlockTime: block.timestamp + WITHDRAWAL_DELAY
        });

        // Reduce stake immediately (affects reward calculation)
        v.stake -= amount;
        totalStaked -= amount;

        // Deactivate if below minimum
        if (v.stake < MIN_STAKE) {
            _deactivateValidator(msg.sender);
        }

        emit WithdrawalRequested(msg.sender, amount, block.timestamp + WITHDRAWAL_DELAY);
    }

    /**
     * @notice Complete withdrawal after delay period
     */
    function withdraw() external {
        WithdrawalRequest storage req = withdrawalRequests[msg.sender];
        require(req.amount > 0, "No pending withdrawal");
        require(block.timestamp >= req.unlockTime, "Withdrawal still locked");

        uint256 amount = req.amount;
        delete withdrawalRequests[msg.sender];

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @notice Claim accumulated rewards
     */
    function claimRewards() external {
        _updateRewards(msg.sender);

        Validator storage v = validators[msg.sender];
        uint256 rewards = v.pendingRewards;
        require(rewards > 0, "No rewards to claim");

        v.pendingRewards = 0;

        (bool success, ) = msg.sender.call{value: rewards}("");
        require(success, "Transfer failed");

        emit RewardsClaimed(msg.sender, rewards);
    }

    /**
     * @notice Get pending rewards for a validator
     * @param validator Address of the validator
     * @return Pending reward amount
     */
    function getPendingRewards(address validator) external view returns (uint256) {
        Validator storage v = validators[validator];
        if (v.stake == 0) return v.pendingRewards;

        uint256 pending = v.pendingRewards;
        if (totalStaked > 0) {
            uint256 accReward = accRewardPerShare + (rewardPool * 1e18 / totalStaked);
            pending += (v.stake * accReward / 1e18) - (v.stake * accRewardPerShare / 1e18);
        }
        return pending;
    }

    /**
     * @notice Check if an address is an active validator
     * @param validator Address to check
     * @return True if active validator
     */
    function isValidator(address validator) external view returns (bool) {
        return validators[validator].isActive;
    }

    /**
     * @notice Get stake amount for a validator
     * @param validator Address of the validator
     * @return Staked amount
     */
    function getStake(address validator) external view returns (uint256) {
        return validators[validator].stake;
    }

    /**
     * @notice Get all active validators
     * @return Array of validator addresses
     */
    function getValidators() external view returns (address[] memory) {
        return validatorList;
    }

    /**
     * @notice Get validator count
     * @return Number of active validators
     */
    function getValidatorCount() external view returns (uint256) {
        return totalValidators;
    }

    // ============ Consensus Layer Functions ============

    /**
     * @notice Receive block rewards from consensus layer
     * @dev Called by the consensus engine when a block is finalized
     *      Anyone can call this, but only actual ETH sent counts
     */
    receive() external payable {
        if (msg.value > 0) {
            _distributeRewards(msg.value);
        }
    }

    /**
     * @notice Slash a validator for misbehavior (double attestation)
     * @param validator Address of the validator to slash
     * @dev Can only be called by consensus layer (block.coinbase check or governance)
     *      For simplicity, this version allows slashing by providing proof
     */
    function slash(address validator) external {
        // In production, this should verify proof of misbehavior
        // For now, only allow self-slash or governance
        require(msg.sender == validator || msg.sender == address(this), "Unauthorized");
        require(!slashed[validator], "Already slashed");
        require(validators[validator].stake > 0, "Not a validator");

        Validator storage v = validators[validator];
        uint256 penalty = v.stake * SLASHING_PENALTY_PERCENT / 100;

        v.stake -= penalty;
        totalStaked -= penalty;
        slashed[validator] = true;

        // Burned (sent to zero address effectively by not redistributing)
        // In production, could go to a treasury or be redistributed

        if (v.stake < MIN_STAKE) {
            _deactivateValidator(validator);
        }

        emit ValidatorSlashed(validator, penalty);
    }

    // ============ Internal Functions ============

    function _distributeRewards(uint256 amount) internal {
        if (totalStaked == 0) {
            // No validators, rewards go to pool for later
            rewardPool += amount;
            return;
        }

        // Distribute to reward pool
        rewardPool += amount;

        // Update accumulated reward per share
        accRewardPerShare += (amount * 1e18) / totalStaked;
        lastRewardBlock = block.number;

        emit RewardsReceived(amount, block.number);
    }

    function _updateRewards(address validator) internal {
        Validator storage v = validators[validator];

        if (v.stake > 0 && totalStaked > 0) {
            // Calculate pending rewards based on stake proportion
            uint256 pending = (v.stake * accRewardPerShare / 1e18) -
                             (v.stake * v.lastRewardBlock / 1e18);

            // Simplified: just add proportional share of reward pool
            if (rewardPool > 0) {
                uint256 share = (rewardPool * v.stake) / totalStaked;
                v.pendingRewards += share;
                rewardPool -= share;
            }
        }

        v.lastRewardBlock = block.number;
    }

    function _activateValidator(address validator) internal {
        Validator storage v = validators[validator];

        if (!v.isActive) {
            v.isActive = true;
            validatorList.push(validator);
            validatorIndex[validator] = validatorList.length; // 1-indexed
            totalValidators++;

            emit ValidatorActivated(validator);
        }
    }

    function _deactivateValidator(address validator) internal {
        Validator storage v = validators[validator];

        if (v.isActive) {
            v.isActive = false;

            // Remove from validator list (swap and pop)
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
            }

            totalValidators--;

            emit ValidatorDeactivated(validator);
        }
    }
}
