import React, { useState, useEffect } from 'react';
import {
  Cpu,
  Server,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Zap,
  ShieldAlert,
  AlertTriangle,
  HardDrive,
  Download,
  Smartphone,
  Laptop,
  Check,
  StopCircle,
  Clock,
  Layers,
  ArrowRight,
} from 'lucide-react';

interface ProviderHubProps {
  onProviderChanged: () => void;
}

export const ProviderHubView: React.FC<ProviderHubProps> = ({ onProviderChanged }) => {
  const [providers, setProviders] = useState<any[]>([]);
  const [activeProvider, setActiveProvider] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<any>(null);

  // Operational State & Offline Capabilities
  const [operationalReport, setOperationalReport] = useState<any>(null);

  // Hardware & Catalog State
  const [hardware, setHardware] = useState<any>(null);
  const [profiles, setProfiles] = useState<any>(null);
  const [activeProfileOverride, setActiveProfileOverride] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<any[]>([]);
  const [installedModels, setInstalledModels] = useState<any[]>([]);

  // Setup runner state
  const [setupModelName, setSetupModelName] = useState<string>('llama3.2:1b');
  const [setupProgress, setSetupProgress] = useState<any>(null);
  const [setupRunning, setSetupRunning] = useState<boolean>(false);

  const fetchAllData = async () => {
    setLoading(true);
    try {
      // 1. Providers
      const provRes = await fetch('/api/v1/providers');
      const provData = await provRes.json();
      setProviders(provData.providers || []);
      setActiveProvider(provData.activeProvider || '');

      // 2. Health & Operational Report
      const healthRes = await fetch('/api/v1/engine/health');
      const healthData = await healthRes.json();
      setOperationalReport(healthData.health?.operationalReport || null);

      // 3. Hardware & Profiles
      const hwRes = await fetch('/api/v1/runtime/hardware');
      const hwData = await hwRes.json();
      setHardware(hwData.hardware || null);
      setProfiles(hwData.profiles || null);
      setActiveProfileOverride(hwData.activeOverride || null);

      // 4. Model Catalog
      const catRes = await fetch('/api/v1/runtime/models/catalog');
      const catData = await catRes.json();
      setCatalog(catData.catalog || []);

      // 5. Installed Models
      const instRes = await fetch('/api/v1/runtime/models/installed');
      const instData = await instRes.json();
      setInstalledModels(instData.installed || []);

      // 6. Setup Status
      const setupRes = await fetch('/api/v1/runtime/models/setup/status');
      const setupData = await setupRes.json();
      if (setupData.setupProgress) {
        setSetupProgress(setupData.setupProgress);
        if (setupData.setupProgress.stage === 'downloading') {
          setSetupRunning(true);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  // Poll progress if setup is running
  useEffect(() => {
    let interval: any;
    if (setupRunning) {
      interval = setInterval(async () => {
        try {
          const res = await fetch('/api/v1/runtime/models/setup/status');
          const data = await res.json();
          if (data.setupProgress) {
            setSetupProgress(data.setupProgress);
            if (data.setupProgress.stage === 'ready' || data.setupProgress.stage === 'failed' || data.setupProgress.stage === 'cancelled') {
              setSetupRunning(false);
              fetchAllData();
            }
          }
        } catch {
          setSetupRunning(false);
        }
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [setupRunning]);

  const handleSwitch = async (id: string) => {
    try {
      const res = await fetch('/api/v1/providers/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: id }),
      });
      const data = await res.json();
      if (data.success) {
        setActiveProvider(id);
        onProviderChanged();
        fetchAllData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleTestProbe = async (id: string) => {
    setTestingId(id);
    setTestResult(null);
    try {
      const res = await fetch('/api/v1/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: id }),
      });
      const data = await res.json();
      setTestResult({ id, probe: data.probe });
    } catch (err: any) {
      setTestResult({ id, error: err.message });
    } finally {
      setTestingId(null);
    }
  };

  const handleTargetProfileSwitch = async (profile: 'host' | 'mobile_android' | null) => {
    try {
      await fetch('/api/v1/runtime/hardware/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile }),
      });
      fetchAllData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleStartModelSetup = async (modelName: string) => {
    setSetupRunning(true);
    try {
      const res = await fetch('/api/v1/runtime/models/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelName }),
      });
      const data = await res.json();
      if (data.progress) {
        setSetupProgress(data.progress);
      }
    } catch (err: any) {
      console.error(err);
      setSetupRunning(false);
    }
  };

  const handleCancelModelSetup = async () => {
    try {
      await fetch('/api/v1/runtime/models/setup/cancel', { method: 'POST' });
      setSetupRunning(false);
      fetchAllData();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-cyan-400" />
            Offline-First Model Provider Architecture & Runtime
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Deterministic offline initialization, swappable local runtime, hardware resource evaluation, and truthful state reporting.
          </p>
        </div>

        <button
          onClick={fetchAllData}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs flex items-center gap-2 self-start transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Runtime
        </button>
      </div>

      {/* Operational State Distinction Report (Directive 3) */}
      {operationalReport && (
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-cyan-400" />
              <h3 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider">
                Operational State Verification
              </h3>
            </div>
            <span className="text-[11px] font-mono text-cyan-400">
              {operationalReport.summaryMessage}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs font-mono">
            <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
              <span className="text-slate-400">Engine Started:</span>
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> YES
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
              <span className="text-slate-400">Local Storage:</span>
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> READY
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
              <span className="text-slate-400">Local Model:</span>
              <span className={operationalReport.localModelAvailable ? 'text-cyan-400 font-bold' : 'text-slate-500'}>
                {operationalReport.localModelAvailable ? 'INSTALLED' : 'NONE'}
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
              <span className="text-slate-400">Online Provider:</span>
              <span className={operationalReport.onlineProviderAvailable ? 'text-emerald-400 font-bold' : 'text-amber-400'}>
                {operationalReport.onlineProviderAvailable ? 'REACHABLE' : 'OFFLINE'}
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
              <span className="text-slate-400">Full Capabilities:</span>
              <span className={operationalReport.fullRequestedCapabilityAvailable ? 'text-emerald-400 font-bold' : 'text-amber-400'}>
                {operationalReport.fullRequestedCapabilityAvailable ? 'FULL' : 'OFFLINE-SAFE'}
              </span>
            </div>
          </div>

          {/* Offline Capabilities List */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 text-xs">
            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 space-y-1.5">
              <span className="text-emerald-400 font-semibold font-mono flex items-center gap-1.5 text-[11px]">
                <CheckCircle2 className="w-3.5 h-3.5" /> 100% OFFLINE CAPABILITIES (Zero Network Needed):
              </span>
              <ul className="space-y-1 text-slate-300 text-[11px]">
                {operationalReport.offlineCapabilities?.map((c: string, idx: number) => (
                  <li key={idx} className="flex items-center gap-1.5">
                    <span className="text-emerald-500">•</span>
                    {c}
                  </li>
                ))}
              </ul>
            </div>

            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 space-y-1.5">
              <span className="text-amber-400 font-semibold font-mono flex items-center gap-1.5 text-[11px]">
                <AlertTriangle className="w-3.5 h-3.5" /> NETWORK-DEPENDENT CAPABILITIES:
              </span>
              <ul className="space-y-1 text-slate-400 text-[11px]">
                {operationalReport.networkDependentCapabilities?.map((c: string, idx: number) => (
                  <li key={idx} className="flex items-center gap-1.5">
                    <span className="text-amber-500">•</span>
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Provider Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {providers.map((p) => {
          const isActive = activeProvider === p.id;
          const isOperational = p.isAvailable;

          return (
            <div
              key={p.id}
              className={`p-5 rounded-xl border flex flex-col justify-between transition-all ${
                isActive
                  ? 'bg-slate-900/90 border-cyan-500/70 shadow-lg shadow-cyan-950/40 ring-1 ring-cyan-500/50'
                  : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="space-y-3">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[10px] font-mono uppercase text-slate-500 tracking-wider">
                      Provider ID: {p.id}
                    </span>
                    <h3 className="text-base font-bold text-slate-100 mt-0.5">{p.name}</h3>
                  </div>

                  {isActive && (
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800">
                      ACTIVE
                    </span>
                  )}
                </div>

                {/* Model Identifier */}
                <div className="px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800/80 font-mono text-xs text-slate-300">
                  <span className="text-slate-500 text-[11px] block">Model Identifier:</span>
                  <span className="font-bold text-cyan-300">{p.modelIdentifier}</span>
                </div>

                {/* Availability status */}
                <div className="flex items-center gap-2 text-xs">
                  {isOperational ? (
                    <div className="flex items-center gap-1.5 text-emerald-400">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span className="font-medium">Operational & Ready</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-amber-400">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span className="font-medium">Unavailable / Offline</span>
                    </div>
                  )}
                </div>

                {/* Diagnostic message */}
                <p className="text-xs text-slate-400 leading-relaxed min-h-[44px]">
                  {p.statusMessage}
                </p>

                {/* Quotas & License */}
                <div className="space-y-1 pt-2 border-t border-slate-800/70 text-[11px] font-mono text-slate-400">
                  <div>
                    <span className="text-slate-500">License:</span> {p.license}
                  </div>
                  <div>
                    <span className="text-slate-500">Quota:</span> {p.freeTierStatus?.quotaNotes}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="pt-4 mt-4 border-t border-slate-800 flex items-center justify-between gap-2">
                <button
                  onClick={() => handleTestProbe(p.id)}
                  disabled={testingId === p.id}
                  className="px-2.5 py-1 rounded bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-mono transition-colors"
                >
                  {testingId === p.id ? 'Probing...' : 'Live Probe'}
                </button>

                {!isActive && (
                  <button
                    onClick={() => handleSwitch(p.id)}
                    className="px-3 py-1 rounded bg-slate-800 hover:bg-cyan-600 text-slate-200 hover:text-white text-xs font-medium transition-colors"
                  >
                    Select Provider
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Live Probe Modal / Output */}
      {testResult && (
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-mono font-bold text-slate-200 uppercase">
              Live Probe Report: {testResult.id}
            </h4>
            <button
              onClick={() => setTestResult(null)}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              Dismiss
            </button>
          </div>
          <pre className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(testResult.probe || testResult.error, null, 2)}
          </pre>
        </div>
      )}

      {/* Device Hardware Resources & Target Phone Profile (Directive 6) */}
      {hardware && (
        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-purple-400" />
                Hardware Resources & Target Device Profile Evaluation
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Evaluates host workstation vs future Android mobile phone constraints (RAM, thermals, disk space).
              </p>
            </div>

            {/* Target Profile Switcher */}
            <div className="flex items-center gap-1.5 p-1 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono">
              <button
                onClick={() => handleTargetProfileSwitch(null)}
                className={`px-2.5 py-1 rounded flex items-center gap-1.5 transition-colors ${
                  activeProfileOverride === null
                    ? 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Laptop className="w-3.5 h-3.5" />
                Host Runtime ({hardware.platform})
              </button>
              <button
                onClick={() => handleTargetProfileSwitch('mobile_android')}
                className={`px-2.5 py-1 rounded flex items-center gap-1.5 transition-colors ${
                  activeProfileOverride === 'mobile_android'
                    ? 'bg-purple-950 text-purple-300 border border-purple-800'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                Target Android Phone (RARE-THE-SIXTH)
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80">
              <span className="text-slate-500 block text-[11px]">System Memory (RAM):</span>
              <span className="text-slate-200 font-bold text-sm">{hardware.totalMemMB} MB</span>
              <span className="text-slate-500 block text-[10px] mt-0.5">Free: {hardware.freeMemMB} MB</span>
            </div>
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80">
              <span className="text-slate-500 block text-[11px]">Available Disk Space:</span>
              <span className="text-slate-200 font-bold text-sm">{hardware.freeDiskMB} MB</span>
              <span className="text-slate-500 block text-[10px] mt-0.5">Total: {hardware.totalDiskMB} MB</span>
            </div>
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80">
              <span className="text-slate-500 block text-[11px]">Storage Durability:</span>
              <span className="text-purple-300 font-bold text-xs uppercase">{hardware.storageDurability}</span>
              <span className="text-slate-500 block text-[10px] mt-0.5">Atomic File Backed</span>
            </div>
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80">
              <span className="text-slate-500 block text-[11px]">Max Model Recommendation:</span>
              <span className="text-cyan-300 font-bold text-sm">{hardware.recommendedMaxModelParam}</span>
              <span className="text-slate-500 block text-[10px] mt-0.5">Edge Quantized</span>
            </div>
          </div>

          <p className="text-xs text-slate-400 italic bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/60">
            {hardware.notes}
          </p>
        </div>
      )}

      {/* Local Model Management & Explicit Setup Operation (Directive 5) */}
      <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Download className="w-4 h-4 text-emerald-400" />
              Local Model Runtime & Setup Manager
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Discovers installed open-weight models, enforces explicit setup with storage checks, and avoids surprise gigabyte downloads.
            </p>
          </div>

          {/* Installed count badge */}
          <span className="px-2.5 py-1 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-cyan-400 self-start">
            Installed Models: {installedModels.length}
          </span>
        </div>

        {/* In-Flight Setup Progress Bar */}
        {setupProgress && setupProgress.stage !== 'idle' && (
          <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-300 font-bold">
                Setup: {setupProgress.modelName} ({setupProgress.stage})
              </span>
              <span className="text-cyan-400">{setupProgress.progressPercent}%</span>
            </div>

            <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  setupProgress.stage === 'failed'
                    ? 'bg-rose-500'
                    : setupProgress.stage === 'ready'
                    ? 'bg-emerald-400'
                    : 'bg-cyan-500'
                }`}
                style={{ width: `${setupProgress.progressPercent}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
              <span>{setupProgress.statusMessage}</span>
              {setupRunning && (
                <button
                  onClick={handleCancelModelSetup}
                  className="px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800 text-[10px] flex items-center gap-1 hover:bg-rose-900"
                >
                  <StopCircle className="w-3 h-3" /> Cancel Setup
                </button>
              )}
            </div>
          </div>
        )}

        {/* Installed Models List */}
        {installedModels.length > 0 ? (
          <div className="space-y-2">
            <h4 className="text-xs font-mono font-bold text-slate-400 uppercase">
              Installed Open-Weight Models:
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {installedModels.map((m, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 flex items-center justify-between text-xs"
                >
                  <div>
                    <span className="font-bold text-cyan-300 font-mono">{m.name}</span>
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                      Format: {m.format || 'gguf'} • Size: {m.sizeBytes ? `${Math.round(m.sizeBytes / 1048576)} MB` : 'N/A'} • Context: {m.contextWindowLimit || 8192} tok
                    </div>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
                    Ready Offline
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-3 rounded-lg bg-slate-950/70 border border-slate-800/80 text-xs text-slate-400 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              No open-weight model currently installed in local daemon. RARE operates offline using deterministic diagnostics and in-process sandbox until a model is installed.
            </span>
          </div>
        )}

        {/* Model Catalog Table */}
        <div className="space-y-2 pt-2 border-t border-slate-800/70">
          <h4 className="text-xs font-mono font-bold text-slate-400 uppercase">
            Compatible Edge Model Catalog:
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono text-slate-300">
              <thead className="bg-slate-950 text-slate-500 text-[11px] border-b border-slate-800">
                <tr>
                  <th className="py-2 px-3">Model</th>
                  <th className="py-2 px-3">Params</th>
                  <th className="py-2 px-3">Est. RAM</th>
                  <th className="py-2 px-3">Est. Disk</th>
                  <th className="py-2 px-3">Mobile Android</th>
                  <th className="py-2 px-3 text-right">Explicit Setup</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {catalog.map((m, idx) => (
                  <tr key={idx} className="hover:bg-slate-950/40">
                    <td className="py-2.5 px-3 font-bold text-cyan-300">{m.modelName}</td>
                    <td className="py-2.5 px-3 text-slate-400">{m.paramSize}</td>
                    <td className="py-2.5 px-3 text-slate-400">{m.estimatedRamMB} MB</td>
                    <td className="py-2.5 px-3 text-slate-400">{m.estimatedDiskMB} MB</td>
                    <td className="py-2.5 px-3">
                      {m.isCompatibleWithTargetPhone ? (
                        <span className="text-emerald-400 flex items-center gap-1 text-[11px]">
                          <Check className="w-3 h-3" /> Compatible
                        </span>
                      ) : (
                        <span className="text-amber-400 text-[11px]">Too Large for Mobile</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {m.readinessStatus === 'ready_installed' ? (
                        <span className="text-purple-400 text-[11px]">Bundled In Engine</span>
                      ) : (
                        <button
                          onClick={() => handleStartModelSetup(m.modelName)}
                          disabled={setupRunning}
                          className="px-2.5 py-1 rounded bg-slate-800 hover:bg-emerald-600 text-slate-200 hover:text-white text-[11px] font-mono transition-colors disabled:opacity-50"
                        >
                          Setup Model
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
