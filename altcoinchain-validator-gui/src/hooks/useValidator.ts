import { useState, useEffect, useCallback } from 'react';
import { validatorRPC, ValidatorInfo, NetworkStats, ValidatorRPC } from '../services/rpc';

export interface UseValidatorReturn {
  // Connection state
  isConnected: boolean;
  address: string | null;
  balance: string;

  // Validator state
  validatorInfo: ValidatorInfo | null;
  isValidator: boolean;
  canAttest: boolean;
  withdrawalTimeRemaining: number;

  // Network state
  networkStats: NetworkStats | null;
  blockNumber: number;

  // Loading states
  loading: boolean;
  error: string | null;

  // Actions
  connect: (privateKey: string) => Promise<void>;
  disconnect: () => void;
  stake: (amount: string) => Promise<string>;
  addStake: (amount: string) => Promise<string>;
  requestWithdrawal: () => Promise<string>;
  withdraw: () => Promise<string>;
  claimRewards: () => Promise<string>;
  refresh: () => Promise<void>;
}

export function useValidator(): UseValidatorReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState('0');
  const [validatorInfo, setValidatorInfo] = useState<ValidatorInfo | null>(null);
  const [isValidator, setIsValidator] = useState(false);
  const [canAttest, setCanAttest] = useState(false);
  const [withdrawalTimeRemaining, setWithdrawalTimeRemaining] = useState(0);
  const [networkStats, setNetworkStats] = useState<NetworkStats | null>(null);
  const [blockNumber, setBlockNumber] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refresh all data
  const refresh = useCallback(async () => {
    try {
      setError(null);

      // Get block number
      const block = await validatorRPC.getBlockNumber();
      setBlockNumber(block);

      // Get network stats
      const stats = await validatorRPC.getNetworkStats();
      if (stats) {
        setNetworkStats(stats);
      }

      // If connected, get validator-specific data
      if (address) {
        const bal = await validatorRPC.getBalance(address);
        setBalance(ValidatorRPC.formatALT(bal));

        const info = await validatorRPC.getValidatorInfo(address);
        setValidatorInfo(info);

        const isVal = await validatorRPC.isValidator(address);
        setIsValidator(isVal);

        const canAtt = await validatorRPC.canAttest(address);
        setCanAttest(canAtt);

        const timeRemaining = await validatorRPC.getWithdrawalTimeRemaining(address);
        setWithdrawalTimeRemaining(Number(timeRemaining));
      }
    } catch (err) {
      console.error('Error refreshing data:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [address]);

  // Connect wallet
  const connect = useCallback(async (privateKey: string) => {
    setLoading(true);
    setError(null);
    try {
      const addr = await validatorRPC.connectWallet(privateKey);
      setAddress(addr);
      setIsConnected(true);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  // Disconnect wallet
  const disconnect = useCallback(() => {
    validatorRPC.disconnectWallet();
    setIsConnected(false);
    setAddress(null);
    setBalance('0');
    setValidatorInfo(null);
    setIsValidator(false);
    setCanAttest(false);
  }, []);

  // Stake ALT
  const stake = useCallback(async (amount: string): Promise<string> => {
    setLoading(true);
    setError(null);
    try {
      const wei = ValidatorRPC.parseALT(amount);
      const tx = await validatorRPC.stake(wei);
      await tx.wait();
      await refresh();
      return tx.hash;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Stake failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  // Add stake
  const addStake = useCallback(async (amount: string): Promise<string> => {
    setLoading(true);
    setError(null);
    try {
      const wei = ValidatorRPC.parseALT(amount);
      const tx = await validatorRPC.addStake(wei);
      await tx.wait();
      await refresh();
      return tx.hash;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Add stake failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  // Request withdrawal
  const requestWithdrawal = useCallback(async (): Promise<string> => {
    setLoading(true);
    setError(null);
    try {
      const tx = await validatorRPC.requestWithdrawal();
      await tx.wait();
      await refresh();
      return tx.hash;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Request withdrawal failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  // Complete withdrawal
  const withdraw = useCallback(async (): Promise<string> => {
    setLoading(true);
    setError(null);
    try {
      const tx = await validatorRPC.withdraw();
      await tx.wait();
      await refresh();
      return tx.hash;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Withdrawal failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  // Claim rewards
  const claimRewards = useCallback(async (): Promise<string> => {
    setLoading(true);
    setError(null);
    try {
      const tx = await validatorRPC.claimRewards();
      await tx.wait();
      await refresh();
      return tx.hash;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Claim rewards failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  // Initial load and polling
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15000); // Refresh every 15 seconds
    return () => clearInterval(interval);
  }, [refresh]);

  return {
    isConnected,
    address,
    balance,
    validatorInfo,
    isValidator,
    canAttest,
    withdrawalTimeRemaining,
    networkStats,
    blockNumber,
    loading,
    error,
    connect,
    disconnect,
    stake,
    addStake,
    requestWithdrawal,
    withdraw,
    claimRewards,
    refresh,
  };
}
