import React, { useState, useEffect } from 'react';
import { Layers, RotateCcw, Plus, CheckCircle2, ShieldCheck, FileCode, Clock } from 'lucide-react';

export const SelfBuildView: React.FC = () => {
  const [checkpoints, setCheckpoints] = useState<any[]>([]);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null);

  const fetchCheckpoints = async () => {
    try {
      const res = await fetch('/api/v1/build/checkpoints');
      const data = await res.json();
      setCheckpoints(data.checkpoints || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchCheckpoints();
  }, []);

  const handleRestore = async (id: string) => {
    setRestoringId(id);
    setRestoreMsg(null);
    try {
      const res = await fetch(`/api/v1/build/checkpoints/${id}/restore`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setRestoreMsg(`Successfully restored workspace to checkpoint [${id}].`);
        fetchCheckpoints();
      }
    } catch (err: any) {
      setRestoreMsg(`Restore failed: ${err.message}`);
    } finally {
      setRestoringId(null);
    }
  };

  const handleCreateSnapshot = async () => {
    try {
      const res = await fetch('/api/v1/storage/backup', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setRestoreMsg(`Backup created at: ${data.backupPath}`);
        fetchCheckpoints();
      }
    } catch (err: any) {
      setRestoreMsg(`Backup failed: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Layers className="w-5 h-5 text-purple-400" />
            Self-Build Checkpoints & Workspace Rollback
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Capture recoverable workspace snapshots prior to self-modification, verify build gates, and perform atomic rollbacks.
          </p>
        </div>

        <button
          onClick={handleCreateSnapshot}
          className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium text-xs flex items-center gap-2 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Capture Storage Backup
        </button>
      </div>

      {restoreMsg && (
        <div className="p-3.5 rounded-xl bg-purple-950/60 border border-purple-800 text-xs text-purple-200">
          {restoreMsg}
        </div>
      )}

      {/* Checkpoints List */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Saved Workspace Checkpoints ({checkpoints.length})
        </h3>
        <div className="space-y-2.5">
          {checkpoints.map((cp) => (
            <div
              key={cp.id}
              className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-cyan-400 font-bold">{cp.id}</span>
                  <span className="font-semibold text-slate-200">{cp.name}</span>
                </div>
                <div className="flex items-center gap-3 text-[11px] font-mono text-slate-500">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {new Date(cp.createdAt).toLocaleString()}
                  </span>
                  <span>•</span>
                  <span>Files Snapshot: {Object.keys(cp.files || {}).length}</span>
                </div>
              </div>

              <button
                onClick={() => handleRestore(cp.id)}
                disabled={restoringId === cp.id}
                className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-purple-700 text-slate-300 hover:text-white border border-slate-800 hover:border-purple-600 text-xs font-medium flex items-center gap-1.5 transition-colors self-start sm:self-auto disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {restoringId === cp.id ? 'Restoring...' : 'Restore Checkpoint'}
              </button>
            </div>
          ))}

          {checkpoints.length === 0 && (
            <div className="p-8 text-center text-slate-500 border border-slate-800 rounded-xl">
              No checkpoints recorded yet. Checkpoints are automatically generated before self-repair and project build tasks.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
