import React, { useState } from 'react';
import { Cpu, ShieldCheck, Zap, Activity, RefreshCw, Wifi, WifiOff, HardDrive } from 'lucide-react';

interface HeaderProps {
  health: any;
  onRefresh: () => void;
  loading: boolean;
}

export const Header: React.FC<HeaderProps> = ({ health, onRefresh, loading }) => {
  const [togglingNetwork, setTogglingNetwork] = useState(false);
  const isHealthy = health?.status === 'healthy';
  const isOnline = health?.isOnline;
  const activeProvider = health?.activeProvider || 'loading...';
  const memoryType = health?.memoryStorageType === 'file-backed-persistent' ? 'Disk-Persistent' : 'In-Memory (Volatile)';
  const localRuntime = health?.localRuntime;
  const hasLocalModel = localRuntime?.isReachable && localRuntime?.installedModels?.length > 0;

  const toggleSimulatedOffline = async () => {
    setTogglingNetwork(true);
    try {
      await fetch('/api/v1/network/toggle-simulated-offline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: isOnline }),
      });
      onRefresh();
    } catch (err) {
      console.error('Failed to toggle network state', err);
    } finally {
      setTogglingNetwork(false);
    }
  };

  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-50 px-4 lg:px-8 py-3">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 text-white font-black text-xl tracking-wider">
            R
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-slate-100 tracking-tight">RARE-INTELLIGENCE</h1>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800/60">
                v{health?.version || '1.0.0'}
              </span>
            </div>
            <p className="text-xs text-slate-400 flex items-center gap-1.5">
              <span>Target Engine:</span>
              <span className="text-cyan-400 font-medium">RARE-THE-SIXTH</span>
              <span className="text-slate-600">•</span>
              <span className="text-emerald-400 font-medium flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 inline" /> $0.00 Free Budget Enforced
              </span>
            </p>
          </div>
        </div>

        {/* Status Indicators */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Network State & Offline Simulation Toggle */}
          <button
            onClick={toggleSimulatedOffline}
            disabled={togglingNetwork}
            title={isOnline ? 'Click to simulate 100% OFFLINE operation' : 'Click to restore online network reachability'}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-mono transition-colors ${
              isOnline
                ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/60 hover:bg-emerald-900/40'
                : 'bg-amber-950/60 text-amber-300 border-amber-700/80 hover:bg-amber-900/60 animate-pulse'
            }`}
          >
            {isOnline ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                <span>ONLINE</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-amber-400" />
                <span>OFFLINE MODE</span>
              </>
            )}
          </button>

          {/* Local Model Status */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 font-mono">
            <span className={`w-2 h-2 rounded-full ${hasLocalModel ? 'bg-cyan-400' : 'bg-slate-500'}`} />
            <span className="text-slate-400">Local AI:</span>
            <span className={hasLocalModel ? 'text-cyan-300 font-medium' : 'text-slate-400'}>
              {hasLocalModel ? localRuntime.activeModel : 'Offline Sandbox'}
            </span>
          </div>

          {/* Active Provider Badge */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800">
            <Cpu className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-slate-400">Active:</span>
            <span className="text-cyan-300 font-mono font-medium">{activeProvider}</span>
          </div>

          {/* Storage Durability */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800">
            <HardDrive className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-slate-400">Storage:</span>
            <span className={`font-mono ${health?.memoryStorageType === 'file-backed-persistent' ? 'text-purple-300' : 'text-amber-300'}`}>
              {memoryType}
            </span>
          </div>

          {/* Refresh button */}
          <button
            onClick={onRefresh}
            disabled={loading}
            title="Refresh engine status"
            className="p-1.5 rounded-md bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
    </header>
  );
};
