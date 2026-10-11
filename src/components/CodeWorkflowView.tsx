import React, { useState } from 'react';
import { Code2, Play, CheckCircle2, ShieldAlert, FileCode2, ArrowRight } from 'lucide-react';

export const CodeWorkflowView: React.FC = () => {
  const [targetFile, setTargetFile] = useState('metadata.json');
  const [goal, setGoal] = useState('Verify structural JSON integrity and schema balance');
  const [running, setRunning] = useState(false);
  const [workflowResult, setWorkflowResult] = useState<any>(null);

  const handleRunWorkflow = async () => {
    setRunning(true);
    setWorkflowResult(null);

    try {
      const res = await fetch('/api/v1/workflows/code-repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetFile,
          goal,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setWorkflowResult(data.result);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <Code2 className="w-5 h-5 text-cyan-400" />
          Autonomous Software Building & Self-Repair Workflow
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Inspects project files, analyzes code syntax and structure, applies bounded modifications, tests results, and produces an audit report.
        </p>
      </div>

      {/* Target File Config */}
      <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Target Workspace File</label>
            <input
              type="text"
              value={targetFile}
              onChange={(e) => setTargetFile(e.target.value)}
              disabled={running}
              className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Workflow Goal</label>
            <input
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              disabled={running}
              className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-slate-800">
          <span className="text-xs text-slate-500">
            Pipeline: Inspect → Analyze AST → Sandboxed Edit → Static Syntax Check → Report
          </span>
          <button
            onClick={handleRunWorkflow}
            disabled={running || !targetFile.trim()}
            className="px-5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs flex items-center gap-2 transition-colors disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            {running ? 'Running Workflow...' : 'Execute Coding Workflow'}
          </button>
        </div>
      </div>

      {/* Workflow Output */}
      {workflowResult && (
        <div className="space-y-4">
          {/* Header */}
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {workflowResult.completed ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              ) : (
                <ShieldAlert className="w-5 h-5 text-red-400" />
              )}
              <div>
                <span className="text-xs font-mono text-cyan-400">WORKFLOW: {workflowResult.workflowId}</span>
                <h4 className="text-sm font-bold text-slate-200">
                  Target: {workflowResult.targetFile} ({workflowResult.completed ? 'COMPLETED' : 'HALTED'})
                </h4>
              </div>
            </div>

            <div className="text-xs font-mono text-slate-400">
              Duration: {workflowResult.auditReport?.totalDurationMs}ms
            </div>
          </div>

          {/* Step Sequence */}
          <div className="space-y-2.5">
            {workflowResult.steps?.map((step: any, idx: number) => (
              <div
                key={idx}
                className="p-3.5 rounded-lg bg-slate-900/80 border border-slate-800 space-y-1.5 text-xs font-mono"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-slate-950 text-cyan-400 border border-slate-800">
                      Phase: {step.phase}
                    </span>
                    <span className="text-slate-200">{step.description}</span>
                  </div>
                  <span className="text-slate-500">{step.durationMs}ms</span>
                </div>

                {step.details && (
                  <pre className="p-2.5 rounded bg-slate-950 text-[11px] text-slate-400 overflow-x-auto whitespace-pre-wrap mt-1">
                    {JSON.stringify(step.details, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
