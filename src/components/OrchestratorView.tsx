import React, { useState } from 'react';
import { Play, CheckCircle2, XCircle, Clock, Wrench, ShieldAlert, Sparkles, ArrowRight, CornerDownRight } from 'lucide-react';

const PRESET_OBJECTIVES = [
  {
    title: 'Inspect Workspace & Analyze Code Structure',
    objective: 'Inspect project manifest package.json and perform syntax structural analysis on core code modules.',
  },
  {
    title: 'Evaluate Precision Math & Quota Sustainability',
    objective: 'Calculate peak sustained runtime: (1500 daily requests / 15 requests per minute) / 60 hours under strict free tier.',
  },
  {
    title: 'Grounded Research on Verification Veracity',
    objective: 'Retrieve and classify architectural facts regarding unverified assumptions vs grounded verifiable claims.',
  },
  {
    title: 'Comprehensive System Health & Perimeter Audit',
    objective: 'Execute full system status inspection, memory check, and zero-budget policy perimeter compliance verification.',
  },
];

export const OrchestratorView: React.FC = () => {
  const [objective, setObjective] = useState(PRESET_OBJECTIVES[0].objective);
  const [isRunning, setIsRunning] = useState(false);
  const [taskResult, setTaskResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExecute = async () => {
    if (!objective.trim()) return;
    setIsRunning(true);
    setError(null);
    setTaskResult(null);

    try {
      const res = await fetch('/api/v1/tasks/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective,
          constraints: ['Zero budget only', 'No fabricated tool execution'],
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Task execution failed');
      }
      setTaskResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Title & Introduction */}
      <div>
        <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-cyan-400" />
          Autonomous Task Orchestration & Bounded Execution
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Decomposes complex goals into manageable steps, executes registered safe tools, inspects actual results, and conducts strict post-execution verification.
        </p>
      </div>

      {/* Objective Input Card */}
      <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
            Task Objective
          </label>
          <textarea
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            rows={3}
            disabled={isRunning}
            placeholder="Describe an objective for RARE-INTELLIGENCE to plan and execute..."
            className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-sm focus:outline-none focus:border-cyan-500 font-mono transition-colors disabled:opacity-60"
          />
        </div>

        {/* Quick Presets */}
        <div>
          <span className="text-xs text-slate-400 font-medium mr-2">Presets:</span>
          <div className="flex flex-wrap gap-2 mt-1.5">
            {PRESET_OBJECTIVES.map((p, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setObjective(p.objective)}
                disabled={isRunning}
                className="text-xs px-2.5 py-1 rounded bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-colors text-left"
              >
                {p.title}
              </button>
            ))}
          </div>
        </div>

        {/* Action Button */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800">
          <div className="text-xs text-slate-500 flex items-center gap-2">
            <span>Bound: Max 10 iterations</span>
            <span>•</span>
            <span>Cost: $0.00</span>
          </div>

          <button
            onClick={handleExecute}
            disabled={isRunning || !objective.trim()}
            className="px-5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-sm flex items-center gap-2 shadow-lg shadow-cyan-600/20 transition-all disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            {isRunning ? (
              <>
                <Clock className="w-4 h-4 animate-spin" />
                Planning & Executing...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-white" />
                Plan & Execute
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error notification */}
      {error && (
        <div className="p-4 rounded-xl bg-red-950/60 border border-red-800 text-red-200 text-sm flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-red-300">Execution Error</div>
            <p className="mt-0.5 text-xs text-red-300/90">{error}</p>
          </div>
        </div>
      )}

      {/* Execution Results */}
      {taskResult && (
        <div className="space-y-6">
          {/* Plan Header */}
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-cyan-400">PLAN ID: {taskResult.plan?.id}</span>
                <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${
                  taskResult.plan?.status === 'completed' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-amber-950 text-amber-400 border border-amber-800'
                }`}>
                  {taskResult.plan?.status}
                </span>
              </div>
              <h3 className="text-sm font-semibold text-slate-200 mt-1">{taskResult.plan?.objective}</h3>
            </div>

            <div className="flex items-center gap-4 text-xs font-mono">
              <div className="text-right">
                <div className="text-slate-400">Iterations</div>
                <div className="text-slate-200 font-bold">{taskResult.plan?.currentIteration} / {taskResult.plan?.iterationLimit}</div>
              </div>
              <div className="text-right">
                <div className="text-slate-400">Quality Score</div>
                <div className={`font-bold ${taskResult.verification?.score >= 80 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {taskResult.verification?.score}/100
                </div>
              </div>
            </div>
          </div>

          {/* Steps Timeline */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Executed Plan Steps</h3>
            <div className="space-y-3">
              {taskResult.plan?.steps?.map((step: any, idx: number) => {
                const isComplete = step.status === 'completed' || step.status === 'repaired';
                return (
                  <div
                    key={step.id || idx}
                    className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5">
                          {isComplete ? (
                            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                          ) : (
                            <XCircle className="w-5 h-5 text-red-400" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-slate-500">#{idx + 1}</span>
                            <h4 className="text-sm font-semibold text-slate-200">{step.title}</h4>
                            {step.status === 'repaired' && (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-950 text-blue-400 border border-blue-800">
                                Repaired (Attempt {step.repairAttempts})
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">{step.description}</p>
                        </div>
                      </div>

                      {step.assignedTool && (
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-cyan-300">
                          <Wrench className="w-3 h-3 text-cyan-400" />
                          <span>{step.assignedTool}</span>
                        </div>
                      )}
                    </div>

                    {/* Tool Result or Output */}
                    {step.toolResult && (
                      <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono space-y-1.5 overflow-x-auto">
                        <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-slate-800/80 pb-1">
                          <span className="text-emerald-400 flex items-center gap-1">
                            <CornerDownRight className="w-3 h-3" /> Audit Record: Permission {step.toolResult.permissionUsed}
                          </span>
                          <span>Duration: {step.toolResult.durationMs}ms</span>
                        </div>
                        <pre className="text-slate-300 text-[11px] whitespace-pre-wrap">
                          {JSON.stringify(step.toolResult.output, null, 2)}
                        </pre>
                      </div>
                    )}

                    {step.output && !step.toolResult && (
                      <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300">
                        {step.output}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Verification Report Card */}
          {taskResult.verification && (
            <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-200">Verification & Quality Gate Report</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Truthfulness and constraint satisfaction audit</p>
                </div>
                <div className="text-right">
                  <span className={`text-xs font-mono font-bold px-2 py-1 rounded ${
                    taskResult.verification.overallPassed ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-red-950 text-red-400 border border-red-800'
                  }`}>
                    RECOMMENDATION: {taskResult.verification.recommendation.toUpperCase()}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {taskResult.verification.checks?.map((chk: any, i: number) => (
                  <div
                    key={i}
                    className={`p-3 rounded-lg border text-xs space-y-1 ${
                      chk.passed
                        ? 'bg-slate-950/80 border-slate-800 text-slate-300'
                        : 'bg-red-950/40 border-red-900 text-red-200'
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold">
                      <span>{chk.criterion}</span>
                      <span className={chk.passed ? 'text-emerald-400' : 'text-red-400'}>
                        {chk.passed ? 'PASSED' : 'FAILED'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">{chk.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
