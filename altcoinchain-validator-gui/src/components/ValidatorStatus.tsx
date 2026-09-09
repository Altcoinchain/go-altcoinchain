import React from 'react';
import { ValidatorInfo } from '../services/rpc';
import { ValidatorRPC } from '../services/rpc';

interface ValidatorStatusProps {
  validatorInfo: ValidatorInfo | null;
  isValidator: boolean;
  canAttest: boolean;
  withdrawalTimeRemaining: number;
  address: string | null;
}

export const ValidatorStatus: React.FC<ValidatorStatusProps> = ({
  validatorInfo,
  isValidator,
  canAttest,
  withdrawalTimeRemaining,
  address,
}) => {
  if (!validatorInfo || !address) {
    return (
      <div className="card validator-status">
        <h2>Validator Status</h2>
        <p className="status-message">Connect a wallet to view validator status</p>
      </div>
    );
  }

  const stake = ValidatorRPC.formatALT(validatorInfo.stake);
  const pendingRewards = ValidatorRPC.formatALT(validatorInfo.pendingRewards);
  const totalClaimed = ValidatorRPC.formatALT(validatorInfo.totalRewardsClaimed);

  const getStatusBadge = () => {
    if (validatorInfo.slashed) {
      return <span className="badge badge-danger">Slashed</span>;
    }
    if (Number(validatorInfo.withdrawalRequestBlock) > 0) {
      return <span className="badge badge-warning">Withdrawing</span>;
    }
    if (!validatorInfo.active) {
      return <span className="badge badge-secondary">Inactive</span>;
    }
    if (canAttest) {
      return <span className="badge badge-success">Active</span>;
    }
    return <span className="badge badge-info">Activating</span>;
  };

  const formatTime = (seconds: number): string => {
    if (seconds <= 0) return 'Ready';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  return (
    <div className="card validator-status">
      <div className="card-header">
        <h2>Validator Status</h2>
        {getStatusBadge()}
      </div>

      <div className="stats-grid">
        <div className="stat-item">
          <label>Your Stake</label>
          <span className="value">{parseFloat(stake).toFixed(4)} ALT</span>
        </div>

        <div className="stat-item">
          <label>Pending Rewards</label>
          <span className="value highlight">{parseFloat(pendingRewards).toFixed(6)} ALT</span>
        </div>

        <div className="stat-item">
          <label>Total Claimed</label>
          <span className="value">{parseFloat(totalClaimed).toFixed(4)} ALT</span>
        </div>

        <div className="stat-item">
          <label>Activation Block</label>
          <span className="value">{validatorInfo.activationBlock.toString()}</span>
        </div>

        {Number(validatorInfo.withdrawalRequestBlock) > 0 && (
          <>
            <div className="stat-item">
              <label>Withdrawal Requested</label>
              <span className="value">Block {validatorInfo.withdrawalRequestBlock.toString()}</span>
            </div>
            <div className="stat-item">
              <label>Time Remaining</label>
              <span className="value">{formatTime(withdrawalTimeRemaining)}</span>
            </div>
          </>
        )}
      </div>

      <div className="status-indicators">
        <div className={`indicator ${isValidator ? 'active' : ''}`}>
          <span className="dot"></span>
          <span>Registered Validator</span>
        </div>
        <div className={`indicator ${canAttest ? 'active' : ''}`}>
          <span className="dot"></span>
          <span>Can Attest</span>
        </div>
        <div className={`indicator ${validatorInfo.slashed ? 'danger' : ''}`}>
          <span className="dot"></span>
          <span>Not Slashed</span>
        </div>
      </div>
    </div>
  );
};
