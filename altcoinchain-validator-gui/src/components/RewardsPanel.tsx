import React, { useState } from 'react';
import { ValidatorRPC } from '../services/rpc';

interface RewardsPanelProps {
  pendingRewards?: bigint;
  totalRewardsClaimed?: bigint;
  onClaimRewards: () => Promise<string>;
  onRequestWithdrawal: () => Promise<string>;
  onWithdraw: () => Promise<string>;
  isValidator: boolean;
  withdrawalRequested: boolean;
  withdrawalTimeRemaining: number;
  loading: boolean;
}

export const RewardsPanel: React.FC<RewardsPanelProps> = ({
  pendingRewards,
  totalRewardsClaimed,
  onClaimRewards,
  onRequestWithdrawal,
  onWithdraw,
  isValidator,
  withdrawalRequested,
  withdrawalTimeRemaining,
  loading,
}) => {
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionType, setActionType] = useState<string>('');

  const pending = pendingRewards ? ValidatorRPC.formatALT(pendingRewards) : '0';
  const claimed = totalRewardsClaimed ? ValidatorRPC.formatALT(totalRewardsClaimed) : '0';
  const hasPendingRewards = pendingRewards && pendingRewards > 0n;
  const canWithdraw = withdrawalRequested && withdrawalTimeRemaining <= 0;

  const handleAction = async (action: () => Promise<string>, type: string) => {
    setError(null);
    setTxHash(null);
    setActionType(type);

    try {
      const hash = await action();
      setTxHash(hash);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
    }
  };

  const formatTime = (seconds: number): string => {
    if (seconds <= 0) return 'Ready';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  return (
    <div className="card rewards-panel">
      <h2>Rewards & Withdrawal</h2>

      <div className="rewards-stats">
        <div className="reward-stat">
          <label>Pending Rewards</label>
          <span className="value highlight">{parseFloat(pending).toFixed(6)} ALT</span>
        </div>
        <div className="reward-stat">
          <label>Total Claimed</label>
          <span className="value">{parseFloat(claimed).toFixed(4)} ALT</span>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}
      {txHash && (
        <div className="form-success">
          {actionType} successful: {txHash.slice(0, 10)}...
        </div>
      )}

      <div className="actions-grid">
        <button
          onClick={() => handleAction(onClaimRewards, 'Claim')}
          disabled={loading || !hasPendingRewards}
          className="btn btn-primary"
        >
          {loading && actionType === 'Claim' ? 'Processing...' : 'Claim Rewards'}
        </button>

        {isValidator && !withdrawalRequested && (
          <button
            onClick={() => handleAction(onRequestWithdrawal, 'Request')}
            disabled={loading}
            className="btn btn-warning"
          >
            {loading && actionType === 'Request' ? 'Processing...' : 'Request Withdrawal'}
          </button>
        )}

        {withdrawalRequested && (
          <div className="withdrawal-status">
            <div className="status-row">
              <span>Withdrawal Status:</span>
              <span className={canWithdraw ? 'ready' : 'pending'}>
                {canWithdraw ? 'Ready to withdraw' : formatTime(withdrawalTimeRemaining)}
              </span>
            </div>
            <button
              onClick={() => handleAction(onWithdraw, 'Withdraw')}
              disabled={loading || !canWithdraw}
              className="btn btn-success"
            >
              {loading && actionType === 'Withdraw' ? 'Processing...' : 'Withdraw Stake'}
            </button>
          </div>
        )}
      </div>

      <div className="info-section">
        <h4>Important Information</h4>
        <ul>
          <li>Rewards are distributed to validators who attest to blocks</li>
          <li>Validators receive 30% of block rewards, split by stake</li>
          <li>Withdrawal has a 7-day delay period</li>
          <li>Slashing penalty is 10% of stake</li>
        </ul>
      </div>
    </div>
  );
};
