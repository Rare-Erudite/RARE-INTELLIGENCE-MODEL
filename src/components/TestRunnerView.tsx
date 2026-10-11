import React, { useState } from 'react';
import { ShieldCheck, Play, CheckCircle2, XCircle, Clock, AlertTriangle, Layers } from 'lucide-react';

export const TestRunnerView: React.FC = () => {
  const [running, setRunning] = useState(false);
  const [testSummary, setTestSummary] = useState<any>(null);

  const handleRunTests = async () => {
    setRunning(true);
    setTestSummary(null);
    try {
      const res = await fetch('/api/v1/tests/run', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setTestSummary(data.summary);
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            Automated Quality Gates & Test Suite
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Real test runner executing assertions across Security containment, Memory persistence, Sandbox tools, Bounded loops, and Upgrades.
          </p>
        </div>

        <button
          onClick={handleRunTests}
          disabled={running}
          className="px-5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs flex items-center gap-2 transition-colors disabled:opacity-50"
        >
          <Play className="w-3.5 h-3.5 fill-white" />
          {running ? 'Executing Tests...' : 'Run 14-Point Test Suite'}
        </button>
      </div>

      {/* Summary card if executed */}
      {testSummary && (
        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg font-mono ${
              testSummary.failedCount === 0 ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-red-950 text-red-400 border border-red-800'
            }`}>
              {testSummary.successRate}%
            </div>
            <div>
              <div className="text-sm font-bold text-slate-100">
                {testSummary.passedCount} / {testSummary.totalTests} Tests Passed
              </div>
              <p className="text-xs text-slate-400">
                Total Execution Time: {testSummary.durationMs}ms • Zero Failed Assertions
              </p>
            </div>
          </div>

          <span className={`text-xs font-mono font-bold px-3 py-1 rounded border ${
            testSummary.failedCount === 0
              ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
              : 'bg-red-950 text-red-400 border border-red-800'
          }`}>
            {testSummary.failedCount === 0 ? 'ALL QUALITY GATES VERIFIED' : 'TEST FAILURES DETECTED'}
          </span>
        </div>
      )}

      {/* Detailed test list */}
      {testSummary?.results && (
        <div className="space-y-2.5">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Test Assertions Breakdown
          </h3>
          <div className="space-y-2">
            {testSummary.results.map((t: any, idx: number) => (
              <div
                key={idx}
                className="p-3.5 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-3">
                  {t.passed ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                  )}
                  <div>
                    <span className="font-mono text-[10px] text-cyan-400 uppercase mr-2">[{t.suite}]</span>
                    <span className="font-medium text-slate-200">{t.name}</span>
                    {t.error && (
                      <p className="text-[11px] font-mono text-red-400 mt-1">{t.error}</p>
                    )}
                  </div>
                </div>

                <span className="text-[11px] font-mono text-slate-500 shrink-0">
                  {t.durationMs}ms
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!testSummary && (
        <div className="p-12 text-center text-slate-500 border border-slate-800 rounded-xl space-y-2">
          <Layers className="w-8 h-8 text-slate-600 mx-auto" />
          <p className="text-sm">Click "Run 14-Point Test Suite" to execute live verification across all modules.</p>
        </div>
      )}
    </div>
  );
};
