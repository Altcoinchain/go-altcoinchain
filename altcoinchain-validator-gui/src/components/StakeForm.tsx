import React, { useState } from 'react';
import { ValidatorRPC } from '../services/rpc';

interface StakeFormProps {
  isValidator: boolean;
  onStake: (amount: string) => Promise<string>;
  onAddStake: (amount: string) => Promise<string>;
  loading: boolean;
  minStake?: bigint;
}

export const StakeForm: React.FC<StakeFormProps> = ({
  isValidator,
  onStake,
  onAddStake,
  loading,
  minStake,
}) => {
  const [amount, setAmount] = useState('');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const minStakeAlt = minStake ? ValidatorRPC.formatALT(minStake) : '32';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setTxHash(null);

    try {
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        setError('Please enter a valid amount');
        return;
      }

      if (!isValidator && amountNum < parseFloat(minStakeAlt)) {
        setError(`Minimum stake is ${minStakeAlt} ALT`);
        return;
      }

      const hash = isValidator
        ? await onAddStake(amount)
        : await onStake(amount);

      setTxHash(hash);
      setAmount('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
    }
  };

  return (
    <div className="card stake-form">
      <h2>{isValidator ? 'Add Stake' : 'Become a Validator'}</h2>

      {!isValidator && (
        <p className="info-text">
          Stake at least {minStakeAlt} ALT to become a validator and start earning rewards.
        </p>
      )}

      <form onSubmit={handleSubmit}>
        <div className="input-group">
          <input
            type="number"
            step="0.0001"
            min="0"
            placeholder={isValidator ? 'Amount to add' : `Min ${minStakeAlt}`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={loading}
          />
          <span className="input-suffix">ALT</span>
        </div>

        {error && <div className="form-error">{error}</div>}

        {txHash && (
          <div className="form-success">
            Transaction submitted: {txHash.slice(0, 10)}...
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !amount}
          className="btn btn-primary btn-full"
        >
          {loading ? 'Processing...' : isValidator ? 'Add Stake' : 'Stake Now'}
        </button>
      </form>

      <div className="stake-info">
        <div className="info-item">
          <span>Minimum Stake</span>
          <span>{minStakeAlt} ALT</span>
        </div>
        <div className="info-item">
          <span>Activation Delay</span>
          <span>~256 blocks</span>
        </div>
        <div className="info-item">
          <span>Withdrawal Delay</span>
          <span>7 days</span>
        </div>
      </div>
    </div>
  );
};
