import React from 'react';
import { NetworkStats as NetworkStatsType, ValidatorRPC } from '../services/rpc';

interface NetworkStatsProps {
  stats: NetworkStatsType | null;
  blockNumber: number;
}

export const NetworkStats: React.FC<NetworkStatsProps> = ({ stats, blockNumber }) => {
  const totalStaked = stats?.totalStaked ? ValidatorRPC.formatALT(stats.totalStaked) : '0';
  const minStake = stats?.minStake ? ValidatorRPC.formatALT(stats.minStake) : '32';

  return (
    <div className="card network-stats">
      <h2>Network Overview</h2>

      <div className="stats-grid">
        <div className="stat-item">
          <label>Current Block</label>
          <span className="value">{blockNumber.toLocaleString()}</span>
        </div>

        <div className="stat-item">
          <label>Active Validators</label>
          <span className="value highlight">{stats?.activeValidators ?? '-'}</span>
        </div>

        <div className="stat-item">
          <label>Total Validators</label>
          <span className="value">{stats?.totalValidators ?? '-'}</span>
        </div>

        <div className="stat-item">
          <label>Total Staked</label>
          <span className="value">{parseFloat(totalStaked).toFixed(2)} ALT</span>
        </div>

        <div className="stat-item">
          <label>Last Finalized</label>
          <span className="value">{stats?.lastFinalizedBlock?.toString() ?? '-'}</span>
        </div>

        <div className="stat-item">
          <label>Finality Threshold</label>
          <span className="value">{stats?.finalityThreshold ?? 67}%</span>
        </div>

        <div className="stat-item">
          <label>Min Stake</label>
          <span className="value">{minStake} ALT</span>
        </div>
      </div>

      <div className="network-indicators">
        <div className="indicator active">
          <span className="dot"></span>
          <span>Network Online</span>
        </div>
        <div className={`indicator ${stats?.activeValidators && stats.activeValidators > 0 ? 'active' : 'warning'}`}>
          <span className="dot"></span>
          <span>Validators Active</span>
        </div>
        <div className={`indicator ${blockNumber > 0 ? 'active' : ''}`}>
          <span className="dot"></span>
          <span>Blocks Synced</span>
        </div>
      </div>
    </div>
  );
};
