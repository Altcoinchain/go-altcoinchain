import React from 'react';
import { useValidator } from '../hooks/useValidator';
import { ValidatorStatus } from './ValidatorStatus';
import { StakeForm } from './StakeForm';
import { RewardsPanel } from './RewardsPanel';
import { NetworkStats } from './NetworkStats';
import './Dashboard.css';

export const Dashboard: React.FC = () => {
  const validator = useValidator();

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Altcoinchain Validator</h1>
        <div className="connection-status">
          {validator.isConnected ? (
            <div className="connected">
              <span className="status-dot active"></span>
              <span className="address">{validator.address?.slice(0, 6)}...{validator.address?.slice(-4)}</span>
              <span className="balance">{parseFloat(validator.balance).toFixed(4)} ALT</span>
              <button onClick={validator.disconnect} className="btn btn-secondary">
                Disconnect
              </button>
            </div>
          ) : (
            <ConnectWallet onConnect={validator.connect} loading={validator.loading} />
          )}
        </div>
      </header>

      {validator.error && (
        <div className="error-banner">
          {validator.error}
          <button onClick={() => validator.refresh()}>Retry</button>
        </div>
      )}

      <div className="dashboard-content">
        <div className="main-panel">
          <NetworkStats stats={validator.networkStats} blockNumber={validator.blockNumber} />

          {validator.isConnected && (
            <>
              <ValidatorStatus
                validatorInfo={validator.validatorInfo}
                isValidator={validator.isValidator}
                canAttest={validator.canAttest}
                withdrawalTimeRemaining={validator.withdrawalTimeRemaining}
                address={validator.address}
              />

              <div className="actions-row">
                <StakeForm
                  isValidator={validator.isValidator}
                  onStake={validator.stake}
                  onAddStake={validator.addStake}
                  loading={validator.loading}
                  minStake={validator.networkStats?.minStake}
                />

                <RewardsPanel
                  pendingRewards={validator.validatorInfo?.pendingRewards}
                  totalRewardsClaimed={validator.validatorInfo?.totalRewardsClaimed}
                  onClaimRewards={validator.claimRewards}
                  onRequestWithdrawal={validator.requestWithdrawal}
                  onWithdraw={validator.withdraw}
                  isValidator={validator.isValidator}
                  withdrawalRequested={Number(validator.validatorInfo?.withdrawalRequestBlock || 0) > 0}
                  withdrawalTimeRemaining={validator.withdrawalTimeRemaining}
                  loading={validator.loading}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// Connect wallet component
interface ConnectWalletProps {
  onConnect: (privateKey: string) => Promise<void>;
  loading: boolean;
}

const ConnectWallet: React.FC<ConnectWalletProps> = ({ onConnect, loading }) => {
  const [privateKey, setPrivateKey] = React.useState('');
  const [showInput, setShowInput] = React.useState(false);

  const handleConnect = async () => {
    if (privateKey.trim()) {
      try {
        await onConnect(privateKey.trim());
        setPrivateKey('');
        setShowInput(false);
      } catch {
        // Error handled in parent
      }
    }
  };

  if (!showInput) {
    return (
      <button onClick={() => setShowInput(true)} className="btn btn-primary">
        Connect Wallet
      </button>
    );
  }

  return (
    <div className="connect-form">
      <input
        type="password"
        placeholder="Enter private key"
        value={privateKey}
        onChange={(e) => setPrivateKey(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
        disabled={loading}
      />
      <button onClick={handleConnect} disabled={loading || !privateKey} className="btn btn-primary">
        {loading ? 'Connecting...' : 'Connect'}
      </button>
      <button onClick={() => setShowInput(false)} className="btn btn-secondary">
        Cancel
      </button>
    </div>
  );
};
