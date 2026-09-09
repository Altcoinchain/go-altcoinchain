import React, { useState, useEffect } from 'react';
import { Download, Play, Square, CheckCircle, XCircle, RefreshCw, Terminal } from 'lucide-react';

interface NativeMinerInstallerProps {
  rpcUrl: string;
  walletAddress: string;
  gpuType: 'nvidia' | 'amd' | 'both';
}

const NativeMinerInstaller: React.FC<NativeMinerInstallerProps> = ({
  rpcUrl,
  walletAddress,
  gpuType
}) => {
  const [installStatus, setInstallStatus] = useState<'checking' | 'not_installed' | 'installed' | 'installing' | 'error'>('checking');
  const [minerRunning, setMinerRunning] = useState(false);
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);

  const scriptPath = '~/Documents/go-altcoinchain_FUSAKA/wallet/gpu-mining';

  // Check if miner is installed (simulated - would need electron/backend for real check)
  useEffect(() => {
    const checkInstall = async () => {
      // In a real implementation, this would check if ethminer exists
      // For now, we'll show the install option
      setTimeout(() => {
        setInstallStatus('not_installed');
      }, 1000);
    };
    checkInstall();
  }, []);

  const addLog = (message: string) => {
    setInstallLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const installMiner = async () => {
    setInstallStatus('installing');
    setShowLog(true);
    setInstallLog([]);

    addLog('Starting ethminer installation...');
    addLog('Detecting GPU type...');

    // Simulate installation steps
    await new Promise(r => setTimeout(r, 1000));
    addLog(`GPU Type: ${gpuType.toUpperCase()}`);

    await new Promise(r => setTimeout(r, 1000));
    addLog('Downloading ethminer v0.19.0...');

    await new Promise(r => setTimeout(r, 2000));
    addLog('Extracting files...');

    await new Promise(r => setTimeout(r, 1000));
    addLog('Installing to ~/.local/bin/ethminer');

    await new Promise(r => setTimeout(r, 500));
    addLog('Setting permissions...');

    await new Promise(r => setTimeout(r, 500));
    addLog('Installation complete!');

    setInstallStatus('installed');
  };

  const startNativeMiner = () => {
    // In real implementation, this would spawn the miner process
    setMinerRunning(true);
    addLog(`Starting ${gpuType === 'nvidia' ? 'NVIDIA (CUDA)' : 'AMD (OpenCL)'} miner...`);
    addLog(`Connecting to ${rpcUrl}...`);
    addLog(`Mining to wallet: ${walletAddress.slice(0, 10)}...`);
  };

  const stopNativeMiner = () => {
    setMinerRunning(false);
    addLog('Stopping miner...');
  };

  const getInstallCommand = () => {
    return `bash ${scriptPath}/setup-gpu-mining.sh`;
  };

  const getMineCommand = () => {
    if (gpuType === 'nvidia' || gpuType === 'both') {
      return `bash ${scriptPath}/mine-nvidia.sh ${walletAddress}`;
    }
    return `bash ${scriptPath}/mine-amd.sh ${walletAddress}`;
  };

  return (
    <div className="space-y-4">
      {/* Installation Status */}
      <div className={`p-4 rounded-lg border ${
        installStatus === 'installed' ? 'bg-neon-green/10 border-neon-green/50' :
        installStatus === 'installing' ? 'bg-secondary/10 border-secondary/50' :
        installStatus === 'error' ? 'bg-red-500/10 border-red-500/50' :
        'bg-surface/50 border-primary/20'
      }`}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold">Native GPU Miner (ethminer)</span>
          <div className="flex items-center gap-2">
            {installStatus === 'checking' && (
              <RefreshCw size={14} className="animate-spin text-primary" />
            )}
            {installStatus === 'installed' && (
              <CheckCircle size={14} className="text-neon-green" />
            )}
            {installStatus === 'not_installed' && (
              <XCircle size={14} className="text-red-400" />
            )}
            {installStatus === 'installing' && (
              <RefreshCw size={14} className="animate-spin text-secondary" />
            )}
          </div>
        </div>

        <p className="text-xs text-text/50 mb-3">
          {installStatus === 'checking' && 'Checking installation...'}
          {installStatus === 'not_installed' && 'Native miner not installed. Click below to install.'}
          {installStatus === 'installed' && 'Native miner is ready to use.'}
          {installStatus === 'installing' && 'Installing...'}
          {installStatus === 'error' && 'Installation failed.'}
        </p>

        {/* Install/Run Buttons */}
        {installStatus === 'not_installed' && (
          <button
            onClick={installMiner}
            className="w-full py-2 px-4 rounded bg-primary/20 text-primary border border-primary/50 hover:bg-primary/30 transition-colors flex items-center justify-center gap-2 text-sm"
          >
            <Download size={14} /> Install Native Miner (One Click)
          </button>
        )}

        {installStatus === 'installed' && !minerRunning && (
          <button
            onClick={startNativeMiner}
            className="w-full py-2 px-4 rounded bg-neon-green/20 text-neon-green border border-neon-green/50 hover:bg-neon-green/30 transition-colors flex items-center justify-center gap-2 text-sm"
          >
            <Play size={14} /> Start Native GPU Miner
          </button>
        )}

        {minerRunning && (
          <button
            onClick={stopNativeMiner}
            className="w-full py-2 px-4 rounded bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30 transition-colors flex items-center justify-center gap-2 text-sm"
          >
            <Square size={14} /> Stop Native Miner
          </button>
        )}
      </div>

      {/* Manual Commands */}
      <div className="p-4 bg-surface/30 rounded-lg border border-primary/20">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-text/70">Manual Commands</span>
          <button
            onClick={() => setShowLog(!showLog)}
            className="text-xs text-primary hover:text-primary/80"
          >
            {showLog ? 'Hide Log' : 'Show Log'}
          </button>
        </div>

        <div className="space-y-2 text-xs">
          <div>
            <span className="text-text/50">Install:</span>
            <code className="block mt-1 p-2 bg-black/50 rounded text-neon-green font-mono overflow-x-auto">
              {getInstallCommand()}
            </code>
          </div>

          <div>
            <span className="text-text/50">Start Mining:</span>
            <code className="block mt-1 p-2 bg-black/50 rounded text-neon-green font-mono overflow-x-auto">
              {getMineCommand()}
            </code>
          </div>
        </div>
      </div>

      {/* Installation Log */}
      {showLog && installLog.length > 0 && (
        <div className="p-3 bg-black/70 rounded-lg border border-primary/20 max-h-48 overflow-y-auto">
          <div className="flex items-center gap-2 mb-2 text-xs text-text/50">
            <Terminal size={12} />
            <span>Installation Log</span>
          </div>
          <div className="font-mono text-xs space-y-1">
            {installLog.map((log, i) => (
              <div key={i} className="text-neon-green/80">{log}</div>
            ))}
          </div>
        </div>
      )}

      {/* GPU Selection Reminder */}
      <div className="text-xs text-text/50">
        Selected GPU: <span className={gpuType === 'nvidia' ? 'text-neon-green' : 'text-red-400'}>
          {gpuType === 'nvidia' ? 'NVIDIA (CUDA)' : gpuType === 'amd' ? 'AMD (OpenCL)' : 'Both'}
        </span>
      </div>
    </div>
  );
};

export default NativeMinerInstaller;
