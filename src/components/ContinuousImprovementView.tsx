import React, { useState, useEffect } from 'react';
import { TrendingUp, Play, CheckCircle2, RotateCcw, ShieldCheck, Award, Layers, AlertTriangle } from 'lucide-react';

export const ContinuousImprovementView: React.FC = () => {
  const [candidates, setCandidates] = useState<any[]>([]);
  const [activeCandidate, setActiveCandidate] = useState<any>(null);
  const [benchmarks, setBenchmarks] = useState<any[]>([]);
  const [suiteResult, setSuiteResult] = useState<any>(null);
  const [runningBenchmark, setRunningBenchmark] = useState(false);
  const [adoptingVersion, setAdoptingVersion] = useState<string | null>(null);
  const [approverName, setApproverName] = useState('Rare-Erudite Architect');
  const [rollbackReason, setRollbackReason] = useState('Regression detected in continuous validation');

  const fetchData = async () => {
    try {
      const [upgradesRes, benchRes] = await Promise.all([
        fetch('/api/v1/upgrades'),
        fetch('/api/v1/benchmarks'),
      ]);
      const upgradesData = await upgradesRes.json();
      const benchData = await benchRes.json();

      setCandidates(upgradesData.candidates || []);
      setActiveCandidate(upgradesData.activeCandidate || null);
      setBenchmarks(benchData.tasks || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRunSuite = async () => {
    setRunningBenchmark(true);
    setSuiteResult(null);
    try {
      const res = await fetch('/api/v1/benchmarks/run', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setSuiteResult(data.suiteResult);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setRunningBenchmark(false);
    }
  };

  const handleAdopt = async (version: string) => {
    try {
      const res = await fetch('/api/v1/upgrades/adopt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version,
          approvedBy: approverName,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setAdoptingVersion(null);
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRollback = async () => {
    try {
      const res = await fetch('/api/v1/upgrades/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rollbackReason }),
      });
      const data = await res.json();
      if (data.success) {
        fetchData();
      }
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
            <TrendingUp className="w-5 h-5 text-emerald-400" />
            Permanent Continuous-Improvement Architecture
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Standardized benchmarks across reasoning, coding, math, and research. Controlled upgrade gates with human sign-off and instant rollback.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleRunSuite}
            disabled={runningBenchmark}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs flex items-center gap-2 transition-colors disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            {runningBenchmark ? 'Evaluating Tasks...' : 'Run Benchmark Battery'}
          </button>

          <button
            onClick={handleRollback}
            className="px-3 py-2 rounded-lg bg-slate-900 hover:bg-amber-950 text-slate-300 hover:text-amber-300 border border-slate-800 hover:border-amber-800 font-medium text-xs flex items-center gap-1.5 transition-colors"
            title="Roll back to previous known-good baseline"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            1-Click Rollback
          </button>
        </div>
      </div>

      {/* Active Model & Known-Good Baseline Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
          <span className="text-[10px] font-mono uppercase text-emerald-400 tracking-wider">
            Active Verified Deployment
          </span>
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-100">{activeCandidate?.version || 'N/A'}</h3>
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
              SCORE: {activeCandidate?.benchmarkScore || 0}%
            </span>
          </div>
          <p className="text-xs text-slate-400">{activeCandidate?.description}</p>
          <div className="text-[11px] font-mono text-slate-500 pt-2 border-t border-slate-800">
            Model: <span className="text-slate-300">{activeCandidate?.modelIdentifier}</span> • Approved by: <span className="text-slate-300">{activeCandidate?.approvedBy || 'Initial'}</span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
          <span className="text-[10px] font-mono uppercase text-cyan-400 tracking-wider">
            Evaluation Standard
          </span>
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-100">4 Core Capability Domains</h3>
            <span className="text-xs font-mono text-cyan-400">{benchmarks.length} Standard Tasks</span>
          </div>
          <p className="text-xs text-slate-400">
            Deductive Reasoning, TypeScript Sandboxing, Rate & Quota Mathematics, Source Grounding Classification.
          </p>
          <div className="text-[11px] font-mono text-slate-500 pt-2 border-t border-slate-800">
            Zero-Budget Adherence: <span className="text-emerald-400 font-bold">100% Free Tiers Only</span>
          </div>
        </div>
      </div>

      {/* Live Benchmark Execution Results */}
      {suiteResult && (
        <div className="p-5 rounded-xl bg-slate-900 border border-emerald-500/50 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] font-mono uppercase text-emerald-400 tracking-wider">
                Live Benchmark Battery Results
              </span>
              <h3 className="text-sm font-bold text-slate-100">
                Overall Score: {suiteResult.overallScore}/100 ({suiteResult.passedRatio} Passed)
              </h3>
            </div>
            <span className="text-xs font-mono px-2 py-1 rounded bg-slate-950 text-slate-300 border border-slate-800">
              Provider: {suiteResult.results?.[0]?.provider}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {suiteResult.results?.map((res: any, idx: number) => (
              <div
                key={idx}
                className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1 text-xs"
              >
                <div className="flex items-center justify-between font-bold">
                  <span className="capitalize text-slate-200">{res.domain}: {res.taskId}</span>
                  <span className={res.passed ? 'text-emerald-400' : 'text-red-400'}>
                    {res.score}% ({res.latencyMs}ms)
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">{res.evaluationNotes}</p>
                {res.outputExcerpt && (
                  <pre className="p-2 rounded bg-slate-900 text-[10px] font-mono text-slate-300 overflow-x-auto mt-1">
                    {res.outputExcerpt}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Capability Upgrade Candidates */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Capability Upgrade Candidate Pipeline
        </h3>
        <div className="space-y-3">
          {candidates.map((cand) => {
            const isActive = cand.status === 'active';
            const isRolledBack = cand.status === 'rolled_back';

            return (
              <div
                key={cand.version}
                className={`p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                  isActive
                    ? 'bg-slate-900/90 border-emerald-500/70 shadow-sm'
                    : isRolledBack
                    ? 'bg-slate-900/40 border-slate-800/80 opacity-75'
                    : 'bg-slate-900/60 border-slate-800'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold text-slate-100 font-mono">{cand.version}</h4>
                    <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded font-bold border ${
                      isActive
                        ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                        : isRolledBack
                        ? 'bg-amber-950 text-amber-400 border-amber-800'
                        : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}>
                      {cand.status.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">{cand.description}</p>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-slate-500 pt-1">
                    <span>Model: {cand.modelIdentifier}</span>
                    <span>•</span>
                    <span>Provider: {cand.provider}</span>
                    <span>•</span>
                    <span>Score: {cand.benchmarkScore}%</span>
                    <span>•</span>
                    <span>License: {cand.license}</span>
                  </div>
                </div>

                {!isActive && (
                  <div className="flex items-center gap-2 self-start md:self-auto">
                    <button
                      onClick={() => handleAdopt(cand.version)}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-emerald-600 text-slate-200 hover:text-white text-xs font-medium transition-colors"
                    >
                      Adopt with Sign-Off
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
