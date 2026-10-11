import React, { useState, useEffect } from 'react';
import { Database, Search, Plus, Trash2, HardDrive, AlertTriangle, Tag, Sparkles } from 'lucide-react';

export const MemoryView: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [storageInfo, setStorageInfo] = useState<any>({});
  const [loading, setLoading] = useState(false);

  // New item form
  const [newKey, setNewKey] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState('project_fact');
  const [newTags, setNewTags] = useState('architecture, directive');

  const fetchMemory = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/memory');
      const data = await res.json();
      setItems(data.items || []);
      setStorageInfo({
        storageType: data.storageType,
        isPersistent: data.isPersistent,
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMemory();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.trim() || !newContent.trim()) return;

    try {
      const res = await fetch('/api/v1/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: newKey.trim(),
          content: newContent.trim(),
          category: newCategory,
          tags: newTags.split(',').map((t) => t.trim()).filter(Boolean),
          source: 'user_input',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setNewKey('');
        setNewContent('');
        fetchMemory();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (key: string) => {
    try {
      await fetch(`/api/v1/memory/${key}`, { method: 'DELETE' });
      fetchMemory();
    } catch (err) {
      console.error(err);
    }
  };

  const filteredItems = items.filter((item) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.key.toLowerCase().includes(q) ||
      item.content.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q) ||
      item.tags?.some((t: string) => t.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <Database className="w-5 h-5 text-purple-400" />
          Memory Architecture & Knowledge Store
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Replaceable persistent storage adapter managing long-term preferences, project architecture, and task checkpoints.
        </p>
      </div>

      {/* Persistence Durability Badge Card */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-purple-950/80 border border-purple-800 flex items-center justify-center text-purple-400">
            <HardDrive className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-200">ACTIVE STORAGE ADAPTER:</span>
              <span className="text-xs font-mono font-bold text-purple-300">
                {storageInfo.storageType || 'Detecting...'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {storageInfo.isPersistent
                ? 'Durability Guaranteed: Backed by local atomic JSON files on disk. Survives restarts without external database cost.'
                : 'Warning: Running on volatile in-memory store. Data will reset on server restart.'}
            </p>
          </div>
        </div>

        <span className={`text-[11px] font-mono font-bold px-2.5 py-1 rounded border ${
          storageInfo.isPersistent
            ? 'bg-purple-950 text-purple-300 border-purple-800'
            : 'bg-amber-950 text-amber-300 border-amber-800'
        }`}>
          {storageInfo.isPersistent ? 'PERSISTENT DISK STORE' : 'VOLATILE STORE'}
        </span>
      </div>

      {/* Search & Add Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Add Knowledge Item Form */}
        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
          <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <Plus className="w-4 h-4 text-cyan-400" /> Store Memory Item
          </h3>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Key Identifier</label>
              <input
                type="text"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="e.g. system_security_guideline"
                className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Category</label>
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
              >
                <option value="project_fact">Project Fact</option>
                <option value="preference">User Preference</option>
                <option value="checkpoint">Task Checkpoint</option>
                <option value="conversation">Conversation</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Tags (comma separated)</label>
              <input
                type="text"
                value={newTags}
                onChange={(e) => setNewTags(e.target.value)}
                placeholder="tag1, tag2"
                className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Memory Content</label>
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                rows={3}
                placeholder="Enter verified fact or preference..."
                className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
              />
            </div>

            <button
              type="submit"
              disabled={!newKey.trim() || !newContent.trim()}
              className="w-full py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium text-xs transition-colors disabled:opacity-50"
            >
              Commit to Store
            </button>
          </form>
        </div>

        {/* Stored Items List */}
        <div className="lg:col-span-2 space-y-3">
          {/* Search bar */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search memory keys, content, or tags..."
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
            />
          </div>

          {/* Items */}
          <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
            {filteredItems.map((item) => (
              <div
                key={item.key}
                className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2 hover:border-slate-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-xs font-mono font-bold text-cyan-300">{item.key}</span>
                    <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800 ml-2">
                      {item.category}
                    </span>
                  </div>
                  <button
                    onClick={() => handleDelete(item.key)}
                    className="text-slate-500 hover:text-red-400 p-1 transition-colors"
                    title="Delete item"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed font-sans">{item.content}</p>

                <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-800/60 font-mono">
                  <div className="flex items-center gap-1.5">
                    <Tag className="w-3 h-3 text-slate-500" />
                    <span>{item.tags?.join(', ') || 'no tags'}</span>
                  </div>
                  <span>Source: {item.source}</span>
                </div>
              </div>
            ))}

            {filteredItems.length === 0 && (
              <div className="p-8 text-center text-slate-500 border border-slate-800 rounded-xl">
                No memory items matching query.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
