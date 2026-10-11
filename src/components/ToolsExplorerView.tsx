import React, { useState, useEffect } from 'react';
import { Wrench, Shield, CheckCircle2, Play, Terminal, ShieldAlert } from 'lucide-react';

export const ToolsExplorerView: React.FC = () => {
  const [tools, setTools] = useState<any[]>([]);
  const [selectedTool, setSelectedTool] = useState<any>(null);
  const [toolArgsInput, setToolArgsInput] = useState<string>('{}');
  const [execResult, setExecResult] = useState<any>(null);
  const [executing, setExecuting] = useState(false);

  useEffect(() => {
    fetch('/api/v1/tools')
      .then((res) => res.json())
      .then((data) => {
        setTools(data.tools || []);
        if (data.tools?.length > 0) {
          setSelectedTool(data.tools[0]);
          setDefaultArgs(data.tools[0]);
        }
      });
  }, []);

  const setDefaultArgs = (tool: any) => {
    if (tool.name === 'file_read') {
      setToolArgsInput(JSON.stringify({ path: 'package.json' }, null, 2));
    } else if (tool.name === 'file_list') {
      setToolArgsInput(JSON.stringify({ directory: '.' }, null, 2));
    } else if (tool.name === 'calculator_eval') {
      setToolArgsInput(JSON.stringify({ expression: '(14 * 5) + (2^3)' }, null, 2));
    } else if (tool.name === 'code_analyze') {
      setToolArgsInput(JSON.stringify({ code: 'export function hello() { return "world"; }' }, null, 2));
    } else if (tool.name === 'system_status') {
      setToolArgsInput('{}');
    } else if (tool.name === 'web_grounding') {
      setToolArgsInput(JSON.stringify({ query: 'autonomous AI bounded execution loops' }, null, 2));
    } else {
      setToolArgsInput('{}');
    }
  };

  const handleSelectTool = (tool: any) => {
    setSelectedTool(tool);
    setDefaultArgs(tool);
    setExecResult(null);
  };

  const handleExecute = async () => {
    if (!selectedTool) return;
    setExecuting(true);
    setExecResult(null);

    try {
      const parsedArgs = JSON.parse(toolArgsInput);
      const res = await fetch('/api/v1/tools/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: selectedTool.name,
          args: parsedArgs,
          dryRun: false,
        }),
      });

      const data = await res.json();
      setExecResult(data.result);
    } catch (err: any) {
      setExecResult({ success: false, error: 'JSON parse error or network fault: ' + err.message });
    } finally {
      setExecuting(false);
    }
  };

  const handleTestTraversal = async () => {
    // Tests security perimeter by intentionally issuing a traversal attempt
    setExecuting(true);
    setExecResult(null);
    try {
      const res = await fetch('/api/v1/tools/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'file_read',
          args: { path: '../../../../etc/passwd' },
        }),
      });
      const data = await res.json();
      setExecResult(data.result);
    } catch (err: any) {
      setExecResult({ success: false, error: err.message });
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <Wrench className="w-5 h-5 text-cyan-400" />
          Tool Registry & Security Execution Sandbox
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Typed tool interfaces with explicit permission tiers, input validation, and containment guards against path traversal.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Tool List Sidebar */}
        <div className="space-y-2">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">
            Registered Tools ({tools.length})
          </span>
          <div className="space-y-2">
            {tools.map((t) => {
              const isSelected = selectedTool?.name === t.name;
              return (
                <button
                  key={t.name}
                  onClick={() => handleSelectTool(t)}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${
                    isSelected
                      ? 'bg-slate-900 border-cyan-500/70 text-slate-100 shadow-sm'
                      : 'bg-slate-900/50 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-cyan-300">{t.name}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800">
                      {t.permissionLevel}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1 line-clamp-1">{t.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Tool Details & Interactive Runner */}
        <div className="lg:col-span-2 space-y-4">
          {selectedTool ? (
            <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
              {/* Tool Header */}
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-base font-bold text-slate-100 font-mono flex items-center gap-2">
                    {selectedTool.name}
                  </h3>
                  <p className="text-xs text-slate-300 mt-1">{selectedTool.description}</p>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-purple-300">
                  <Shield className="w-3.5 h-3.5 text-purple-400" />
                  <span>{selectedTool.permissionLevel}</span>
                </div>
              </div>

              {/* Schema parameters */}
              <div>
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                  Parameters Schema
                </span>
                <pre className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-400 overflow-x-auto">
                  {JSON.stringify(selectedTool.parametersSchema, null, 2)}
                </pre>
              </div>

              {/* Arguments Editor */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Arguments (JSON)
                  </span>
                  <button
                    onClick={handleTestTraversal}
                    type="button"
                    className="text-[11px] text-amber-400 hover:text-amber-300 flex items-center gap-1"
                  >
                    <ShieldAlert className="w-3 h-3" /> Test Sandbox Traversal Defense
                  </button>
                </div>
                <textarea
                  value={toolArgsInput}
                  onChange={(e) => setToolArgsInput(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                />
              </div>

              {/* Execute Button */}
              <div className="flex justify-end">
                <button
                  onClick={handleExecute}
                  disabled={executing}
                  className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs flex items-center gap-2 transition-colors disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5 fill-white" />
                  {executing ? 'Executing...' : `Execute ${selectedTool.name}`}
                </button>
              </div>

              {/* Execution Audit Result */}
              {execResult && (
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2 mt-4">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="flex items-center gap-1.5 font-bold">
                      {execResult.success ? (
                        <span className="text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-4 h-4" /> SUCCESS
                        </span>
                      ) : (
                        <span className="text-red-400 flex items-center gap-1">
                          <ShieldAlert className="w-4 h-4" /> BLOCKED / FAILED
                        </span>
                      )}
                    </span>
                    <span className="text-slate-500">{execResult.durationMs ?? 0}ms</span>
                  </div>

                  {execResult.error && (
                    <div className="p-2.5 rounded bg-red-950/60 border border-red-900 text-xs text-red-200 font-mono">
                      {execResult.error}
                    </div>
                  )}

                  {execResult.output && (
                    <pre className="p-3 rounded bg-slate-900 text-xs font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap max-h-60">
                      {JSON.stringify(execResult.output, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="p-8 text-center text-slate-500 border border-slate-800 rounded-xl">
              Select a tool from the left to inspect its schema and test execution.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
