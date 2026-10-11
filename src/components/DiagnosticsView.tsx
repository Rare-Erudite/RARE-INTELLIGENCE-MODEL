import React, { useState } from 'react';
import { Activity, Play, CheckCircle2, AlertTriangle, XCircle, Wrench, RefreshCw, ShieldCheck, FileText } from 'lucide-react';

export const DiagnosticsView: React.FC = () => {
  const [report, setReport] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [repairMsg, setRepairMsg] = useState<string | null>(null);

  const handleRunDiagnostics = async () => {
    setRunning(true);
    setRepairMsg(null);
    try {
      const res = await fetch('/api/v1/diagnostics/run');
      const data = await res.json();
      if (data.success) {
        setReport(data.report);
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setRunning(false);
    }
  };

  const handleTriggerRepair = async (findingId?: string) => {
    setRepairing(true);
    setRepairMsg(null);
    try {
      const res = await fetch('/api/v1/repair/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ findingId }),
      });
      const data = await res.json();
      if (data.success) {
        setRepairMsg(`Autonomous self-repair executed on ${data.outcomes.length} finding(s). Re-running diagnostics...`);
        // Re-run diagnostics to verify
        setTimeout(handleRunDiagnostics, 1000);
      }
    } catch (err: any) {
      setRepairMsg(`Self-repair error: ${err.message}`);
    } finally {
      setRepairing(false);
    }
  };

  const SUBSYSTEMS = [
    { id: 'server_api', name: 'Server & Express Gateway', desc: 'Process memory, port binding, and endpoint routes' },
    { id: 'provider_health', name: 'Model Providers & Quota', desc: 'Gemini, Ollama, Diagnostic sandbox connectivity' },
    { id: 'tool_registry', name: 'Tool Registry Integrity', desc: 'Core safe tools, parameter schemas, and permissions' },
    { id: 'filesystem_sandbox', name: 'Filesystem Sandbox', desc: 'Workspace containment and traversal defense' },
    { id: 'storage_integrity', name: 'Durable Storage & Backups', desc: 'Atomic writes, checksum verification, rotating backups' },
    { id: 'project_manifest', name: 'Project Manifest (package.json)', desc: 'Valid JSON, required npm scripts, dependencies' },
    { id: 'syntax_integrity', name: 'Syntax Balance & Static AST', desc: 'Balanced curly braces and clean code structure' },
    { id: 'task_executor', name: 'Task Planner & Runtime', desc: 'Dependency DAG, iteration bounds, timeout safety' },
    { id: 'upgrade_registry', name: 'Upgrade Baseline & Rollback', desc: 'Active version candidate and known-good rollback' },
    { id: 'budget_enforcement', name: 'Zero-Budget Perimeter', desc: 'Strict $0.00 policy and paid fallback prohibition' },
  ];

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Activity className="w-5 h-5 text-cyan-400" />
            The Self-Diagnostic Engine
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Deep multi-subsystem auditing across server health, provider quotas, security sandboxing, storage integrity, and code syntax.
          </p>
        </div>

        <button
          onClick={handleRunDiagnostics}
          disabled={running}
          className="px-5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs flex items-center gap-2 transition-colors disabled:opacity-50"
        >
          <Play className="w-3.5 h-3.5 fill-white" />
          {running ? 'Auditing Subsystems...' : 'Run Full Diagnostics'}
        </button>
      </div>

      {/* Report Summary Card */}
      {report && (
        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-cyan-400">RUN ID: {report.runId}</span>
                <span className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded border ${
                  report.overallStatus === 'HEALTHY'
                    ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                    : report.overallStatus === 'REPAIRABLE'
                    ? 'bg-blue-950 text-blue-400 border-blue-800'
                    : 'bg-amber-950 text-amber-400 border-amber-800'
                }`}>
                  STATUS: {report.overallStatus}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Target: {report.targetSystem} • Checked in {report.durationMs}ms ({report.checksPerformedCount} Subsystems)
              </p>
            </div>

            {report.findings?.some((f: any) => f.isRepairable) && (
              <button
                onClick={() => handleTriggerRepair()}
                disabled={repairing}
                className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                <Wrench className="w-3.5 h-3.5" />
                {repairing ? 'Repairing...' : 'Execute Autonomous Self-Repair'}
              </button>
            )}
          </div>

          {/* Remediation message if triggered */}
          {repairMsg && (
            <div className="p-3 rounded-lg bg-blue-950/60 border border-blue-800 text-xs text-blue-200">
              {repairMsg}
            </div>
          )}

          {/* Findings List */}
          {report.findings?.length > 0 ? (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Detected Diagnostic Findings ({report.findings.length})
              </h3>
              <div className="space-y-2.5">
                {report.findings.map((finding: any) => (
                  <div
                    key={finding.id}
                    className={`p-4 rounded-xl border text-xs space-y-2 ${
                      finding.severity === 'blocker'
                        ? 'bg-red-950/40 border-red-900 text-red-200'
                        : 'bg-amber-950/30 border-amber-900 text-amber-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800">
                            [{finding.subsystem}]
                          </span>
                          <span className="font-bold text-slate-100">{finding.title}</span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1">Evidence: {finding.evidence}</p>
                      </div>

                      {finding.isRepairable && (
                        <button
                          onClick={() => handleTriggerRepair(finding.id)}
                          disabled={repairing}
                          className="px-2.5 py-1 rounded bg-slate-900 hover:bg-blue-600 text-blue-300 hover:text-white border border-blue-800 text-[11px] font-mono transition-colors shrink-0"
                        >
                          Auto-Repair
                        </button>
                      )}
                    </div>

                    {finding.suggestedRemediation && (
                      <div className="text-[11px] font-mono text-slate-400 pt-1 border-t border-slate-800/80">
                        Suggested Remediation: <span className="text-cyan-300">{finding.suggestedRemediation}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-lg bg-emerald-950/30 border border-emerald-900/60 flex items-center gap-3 text-xs text-emerald-300">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <div>
                <span className="font-bold text-emerald-200">Zero Faults Detected.</span>
                <p className="text-emerald-400/90 text-[11px]">All 10 subsystems verified nominal, sandboxed, and adhering to strict $0.00 zero-budget rules.</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Subsystem Coverage Matrix */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Diagnostic Subsystem Coverage
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {SUBSYSTEMS.map((sub, idx) => (
            <div
              key={sub.id}
              className="p-3.5 rounded-lg bg-slate-900/80 border border-slate-800 flex items-start gap-3"
            >
              <div className="w-6 h-6 rounded bg-slate-950 border border-slate-800 flex items-center justify-center text-[10px] font-mono text-cyan-400 shrink-0 mt-0.5">
                {idx + 1}
              </div>
              <div>
                <span className="text-xs font-bold text-slate-200">{sub.name}</span>
                <p className="text-[11px] text-slate-400 mt-0.5">{sub.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
