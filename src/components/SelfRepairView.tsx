import React, { useState, useEffect } from 'react';
import { Wrench, Play, CheckCircle2, RotateCcw, ShieldCheck, Terminal, AlertTriangle, Layers, Clock } from 'lucide-react';

export const SelfRepairView: React.FC = () => {
  const [history, setHistory] = useState<any[]>([]);
  const [runningDemo, setRunningDemo] = useState(false);
  const [demoResult, setDemoResult] = useState<any>(null);

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/v1/repair/history');
      const data = await res.json();
      setHistory(data.history || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const handleRunDemo = async () => {
    setRunningDemo(true);
    setDemoResult(null);
    try {
      const res = await fetch('/api/v1/repair/test-harmless-fault', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setDemoResult(data.testOutcome);
        fetchHistory();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setRunningDemo(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Wrench className="w-5 h-5 text-blue-400" />
            Autonomous Bounded Self-Repair
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Detects recoverable system defects, captures pre-repair checkpoints, applies minimal safe fixes, runs independent verification, and rolls back regressions.
          </p>
        </div>

        <button
          onClick={handleRunDemo}
          disabled={runningDemo}
          className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs flex items-center gap-2 transition-colors disabled:opacity-50"
        >
          <Play className="w-3.5 h-3.5 fill-white" />
          {runningDemo ? 'Executing 12-Stage Lifecycle...' : 'Test Harmless Fault Self-Repair Demo'}
        </button>
      </div>

      {/* 12-Stage Lifecycle Banner */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2 text-xs">
        <span className="font-semibold text-slate-200">The 12-Stage Autonomous Repair Lifecycle</span>
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono text-slate-400">
          {['DETECT', 'COLLECT_EVIDENCE', 'CLASSIFY', 'IDENTIFY_ROOT_CAUSE', 'SELECT_REMEDIATION', 'CHECK_PERMISSIONS', 'CREATE_CHECKPOINT', 'APPLY_REPAIR', 'RUN_TESTS', 'INDEPENDENT_VERIFICATION', 'ACCEPT/ROLLBACK', 'RECORD_OUTCOME'].map((step, idx) => (
            <React.Fragment key={step}>
              <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-cyan-300">
                {step}
              </span>
              {idx < 11 && <span className="text-slate-600">→</span>}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Demo Outcome Display */}
      {demoResult && (
        <div className="p-5 rounded-xl bg-slate-900 border border-blue-500/60 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] font-mono text-blue-400 uppercase tracking-wider">
                Reproducible Harmless Fault Demonstration
              </span>
              <h3 className="text-sm font-bold text-slate-100 mt-0.5">
                Outcome: {demoResult.repairResult?.status} ({demoResult.repairResult?.durationMs}ms)
              </h3>
            </div>

            <span className="text-xs font-mono px-2.5 py-1 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-bold flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> INDEPENDENTLY VERIFIED
            </span>
          </div>

          {/* Audit Execution Steps */}
          <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs space-y-1.5 overflow-x-auto">
            {demoResult.auditLog?.map((line: string, i: number) => (
              <div key={i} className="text-slate-300">
                {line}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
              <span className="text-slate-500 font-mono text-[11px]">PRE-REPAIR EVIDENCE</span>
              <p className="text-slate-300">{demoResult.repairResult?.preRepairEvidence}</p>
            </div>
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
              <span className="text-slate-500 font-mono text-[11px]">POST-REPAIR VERIFICATION</span>
              <p className="text-emerald-400">{demoResult.repairResult?.postRepairVerification?.verificationDetails}</p>
            </div>
          </div>
        </div>
      )}

      {/* Durable Repair History */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Durable Repair Execution History ({history.length})
        </h3>
        <div className="space-y-2.5">
          {history.map((rep) => (
            <div
              key={rep.repairId}
              className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2 text-xs"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-cyan-400 font-bold">{rep.repairId}</span>
                  <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded font-bold border ${
                    rep.status === 'REPAIRED_AND_VERIFIED'
                      ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                      : 'bg-amber-950 text-amber-400 border-amber-800'
                  }`}>
                    {rep.status}
                  </span>
                </div>
                <span className="text-slate-500 font-mono text-[11px]">
                  Subsystem: {rep.targetSubsystem} • {rep.durationMs}ms
                </span>
              </div>

              <p className="text-slate-300">{rep.postRepairVerification?.verificationDetails}</p>

              <div className="text-[11px] font-mono text-slate-500 flex items-center gap-4 pt-1 border-t border-slate-800/80">
                <span>Checkpoint: {rep.checkpointId || 'None'}</span>
                <span>•</span>
                <span>Rollback Performed: {rep.rollbackPerformed ? 'YES' : 'NO'}</span>
              </div>
            </div>
          ))}

          {history.length === 0 && (
            <div className="p-8 text-center text-slate-500 border border-slate-800 rounded-xl">
              No previous self-repair actions recorded. Click "Test Harmless Fault Self-Repair Demo" to run a verified simulation.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
