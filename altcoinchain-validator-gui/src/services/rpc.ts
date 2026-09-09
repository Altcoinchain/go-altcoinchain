import { ethers } from 'ethers';

// Staking contract ABI (minimal interface for GUI)
const STAKING_ABI = [
  "function stake() payable",
  "function addStake() payable",
  "function requestWithdrawal()",
  "function withdraw()",
  "function claimRewards()",
  "function getValidator(address addr) view returns (tuple(uint256 stake, uint256 activationBlock, uint256 withdrawalRequestBlock, uint256 withdrawalRequestTime, uint256 pendingRewards, uint256 totalRewardsClaimed, bool active, bool slashed))",
  "function getActiveValidators() view returns (address[])",
  "function getAllValidators() view returns (address[])",
  "function isValidator(address addr) view returns (bool)",
  "function canAttest(address addr) view returns (bool)",
  "function getValidatorStake(address addr) view returns (uint256)",
  "function getValidatorRewards(address addr) view returns (uint256)",
  "function getValidatorCount() view returns (uint256)",
  "function getWithdrawalTimeRemaining(address addr) view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "function activeValidatorCount() view returns (uint256)",
  "function MIN_STAKE() view returns (uint256)",
  "function WITHDRAWAL_DELAY() view returns (uint256)",
  "event Staked(address indexed validator, uint256 amount, uint256 activationBlock)",
  "event StakeAdded(address indexed validator, uint256 amount, uint256 newTotal)",
  "event WithdrawalRequested(address indexed validator, uint256 requestBlock, uint256 requestTime)",
  "event Withdrawn(address indexed validator, uint256 stakeAmount, uint256 rewardsAmount)",
  "event RewardsClaimed(address indexed validator, uint256 amount)",
  "event Slashed(address indexed validator, uint256 amount, string reason)"
];

// Default RPC URL and staking contract address
const DEFAULT_RPC_URL = 'http://localhost:8545';
const STAKING_CONTRACT_ADDRESS = '0x0000000000000000000000000000000000001000';

export interface ValidatorInfo {
  stake: bigint;
  activationBlock: bigint;
  withdrawalRequestBlock: bigint;
  withdrawalRequestTime: bigint;
  pendingRewards: bigint;
  totalRewardsClaimed: bigint;
  active: boolean;
  slashed: boolean;
}

export interface NetworkStats {
  totalValidators: number;
  activeValidators: number;
  totalStaked: bigint;
  minStake: bigint;
  lastFinalizedBlock: bigint;
  finalityThreshold: number;
}

export interface FinalityStatus {
  blockNumber: bigint;
  blockHash: string;
  isFinalized: boolean;
  attesterCount: number;
  totalValidators: number;
  attestingStake: bigint;
  totalStake: bigint;
  stakePercent: number;
  threshold: number;
}

export class ValidatorRPC {
  private provider: ethers.JsonRpcProvider;
  private stakingContract: ethers.Contract;
  private signer: ethers.Signer | null = null;

  constructor(rpcUrl: string = DEFAULT_RPC_URL) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.stakingContract = new ethers.Contract(
      STAKING_CONTRACT_ADDRESS,
      STAKING_ABI,
      this.provider
    );
  }

  // Connect with a wallet
  async connectWallet(privateKey: string): Promise<string> {
    const wallet = new ethers.Wallet(privateKey, this.provider);
    this.signer = wallet;
    this.stakingContract = this.stakingContract.connect(wallet) as ethers.Contract;
    return wallet.address;
  }

  // Disconnect wallet
  disconnectWallet(): void {
    this.signer = null;
    this.stakingContract = new ethers.Contract(
      STAKING_CONTRACT_ADDRESS,
      STAKING_ABI,
      this.provider
    );
  }

  // Get connected wallet address
  getConnectedAddress(): string | null {
    if (this.signer && 'address' in this.signer) {
      return (this.signer as ethers.Wallet).address;
    }
    return null;
  }

  // Check if wallet is connected
  isConnected(): boolean {
    return this.signer !== null;
  }

  // Get wallet balance
  async getBalance(address: string): Promise<bigint> {
    return await this.provider.getBalance(address);
  }

  // Get current block number
  async getBlockNumber(): Promise<number> {
    return await this.provider.getBlockNumber();
  }

  // Get validator info
  async getValidatorInfo(address: string): Promise<ValidatorInfo> {
    const result = await this.stakingContract.getValidator(address);
    return {
      stake: result.stake,
      activationBlock: result.activationBlock,
      withdrawalRequestBlock: result.withdrawalRequestBlock,
      withdrawalRequestTime: result.withdrawalRequestTime,
      pendingRewards: result.pendingRewards,
      totalRewardsClaimed: result.totalRewardsClaimed,
      active: result.active,
      slashed: result.slashed,
    };
  }

  // Get active validators
  async getActiveValidators(): Promise<string[]> {
    return await this.stakingContract.getActiveValidators();
  }

  // Get all validators
  async getAllValidators(): Promise<string[]> {
    return await this.stakingContract.getAllValidators();
  }

  // Check if address is a validator
  async isValidator(address: string): Promise<boolean> {
    return await this.stakingContract.isValidator(address);
  }

  // Check if validator can attest
  async canAttest(address: string): Promise<boolean> {
    return await this.stakingContract.canAttest(address);
  }

  // Get validator stake
  async getValidatorStake(address: string): Promise<bigint> {
    return await this.stakingContract.getValidatorStake(address);
  }

  // Get validator pending rewards
  async getValidatorRewards(address: string): Promise<bigint> {
    return await this.stakingContract.getValidatorRewards(address);
  }

  // Get total validator count
  async getValidatorCount(): Promise<bigint> {
    return await this.stakingContract.getValidatorCount();
  }

  // Get withdrawal time remaining
  async getWithdrawalTimeRemaining(address: string): Promise<bigint> {
    return await this.stakingContract.getWithdrawalTimeRemaining(address);
  }

  // Get total staked
  async getTotalStaked(): Promise<bigint> {
    return await this.stakingContract.totalStaked();
  }

  // Get active validator count
  async getActiveValidatorCount(): Promise<bigint> {
    return await this.stakingContract.activeValidatorCount();
  }

  // Get minimum stake requirement
  async getMinStake(): Promise<bigint> {
    return await this.stakingContract.MIN_STAKE();
  }

  // Get withdrawal delay
  async getWithdrawalDelay(): Promise<bigint> {
    return await this.stakingContract.WITHDRAWAL_DELAY();
  }

  // Stake ALT to become a validator
  async stake(amount: bigint): Promise<ethers.TransactionResponse> {
    if (!this.signer) {
      throw new Error('Wallet not connected');
    }
    return await this.stakingContract.stake({ value: amount });
  }

  // Add more stake to existing position
  async addStake(amount: bigint): Promise<ethers.TransactionResponse> {
    if (!this.signer) {
      throw new Error('Wallet not connected');
    }
    return await this.stakingContract.addStake({ value: amount });
  }

  // Request withdrawal
  async requestWithdrawal(): Promise<ethers.TransactionResponse> {
    if (!this.signer) {
      throw new Error('Wallet not connected');
    }
    return await this.stakingContract.requestWithdrawal();
  }

  // Complete withdrawal
  async withdraw(): Promise<ethers.TransactionResponse> {
    if (!this.signer) {
      throw new Error('Wallet not connected');
    }
    return await this.stakingContract.withdraw();
  }

  // Claim rewards
  async claimRewards(): Promise<ethers.TransactionResponse> {
    if (!this.signer) {
      throw new Error('Wallet not connected');
    }
    return await this.stakingContract.claimRewards();
  }

  // Get network stats via validator RPC API
  async getNetworkStats(): Promise<NetworkStats | null> {
    try {
      const result = await this.provider.send('validator_getNetworkStats', []);
      return {
        totalValidators: result.totalValidators,
        activeValidators: result.activeValidators,
        totalStaked: BigInt(result.totalStaked),
        minStake: BigInt(result.minStake),
        lastFinalizedBlock: BigInt(result.lastFinalizedBlock),
        finalityThreshold: result.finalityThreshold,
      };
    } catch {
      // If RPC method not available, return null
      return null;
    }
  }

  // Get finality status
  async getFinalityStatus(blockNumber: number | 'latest'): Promise<FinalityStatus | null> {
    try {
      const result = await this.provider.send('validator_getFinalityStatus', [blockNumber]);
      if (!result) return null;
      return {
        blockNumber: BigInt(result.blockNumber),
        blockHash: result.blockHash,
        isFinalized: result.isFinalized,
        attesterCount: result.attesterCount,
        totalValidators: result.totalValidators,
        attestingStake: BigInt(result.attestingStake || '0'),
        totalStake: BigInt(result.totalStake || '0'),
        stakePercent: result.stakePercent || 0,
        threshold: result.threshold,
      };
    } catch {
      return null;
    }
  }

  // Format wei to ALT (18 decimals)
  static formatALT(wei: bigint): string {
    return ethers.formatEther(wei);
  }

  // Parse ALT to wei
  static parseALT(alt: string): bigint {
    return ethers.parseEther(alt);
  }
}

// Singleton instance
export const validatorRPC = new ValidatorRPC();
