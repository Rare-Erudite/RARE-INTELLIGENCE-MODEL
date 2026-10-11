/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  MessageSquare,
  Cpu,
  Wrench,
  Database,
  TrendingUp,
  Code2,
  ShieldCheck,
  Terminal,
  Activity,
  Layers,
  Bot,
} from 'lucide-react';
import { Header } from './components/Header.tsx';
import { OrchestratorView } from './components/OrchestratorView.tsx';
import { ChatView } from './components/ChatView.tsx';
import { ProviderHubView } from './components/ProviderHubView.tsx';
import { ToolsExplorerView } from './components/ToolsExplorerView.tsx';
import { MemoryView } from './components/MemoryView.tsx';
import { ContinuousImprovementView } from './components/ContinuousImprovementView.tsx';
import { CodeWorkflowView } from './components/CodeWorkflowView.tsx';
import { TestRunnerView } from './components/TestRunnerView.tsx';
import { IntegrationApiView } from './components/IntegrationApiView.tsx';
import { DiagnosticsView } from './components/DiagnosticsView.tsx';
import { SelfRepairView } from './components/SelfRepairView.tsx';
import { SelfBuildView } from './components/SelfBuildView.tsx';
import { AssistantStudioView } from './components/AssistantStudioView.tsx';

type TabType =
  | 'orchestrator'
  | 'diagnostics'
  | 'repair'
  | 'selfBuild'
  | 'assistant'
  | 'chat'
  | 'providers'
  | 'tools'
  | 'memory'
  | 'benchmarks'
  | 'workflows'
  | 'tests'
  | 'api';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('orchestrator');
  const [health, setHealth] = useState<any>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);

  const fetchHealth = async () => {
    setLoadingHealth(true);
    try {
      const res = await fetch('/api/v1/engine/health');
      const data = await res.json();
      setHealth(data.health);
    } catch (err) {
      console.error('Failed to probe engine health:', err);
    } finally {
      setLoadingHealth(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 45000);
    return () => clearInterval(interval);
  }, []);

  const TABS = [
    { id: 'orchestrator' as TabType, label: 'Autonomous Tasks', icon: Sparkles },
    { id: 'diagnostics' as TabType, label: 'Self-Diagnostics', icon: Activity },
    { id: 'repair' as TabType, label: 'Self-Repair', icon: Wrench },
    { id: 'selfBuild' as TabType, label: 'Self-Build Checkpoints', icon: Layers },
    { id: 'assistant' as TabType, label: 'Assistant Studio', icon: Bot },
    { id: 'chat' as TabType, label: 'Chat Engine', icon: MessageSquare },
    { id: 'providers' as TabType, label: 'Model Providers', icon: Cpu },
    { id: 'tools' as TabType, label: 'Tool Sandbox', icon: Wrench },
    { id: 'memory' as TabType, label: 'Durable Storage', icon: Database },
    { id: 'benchmarks' as TabType, label: 'Continuous Upgrades', icon: TrendingUp },
    { id: 'workflows' as TabType, label: 'Code Repair', icon: Code2 },
    { id: 'tests' as TabType, label: 'Quality Gates', icon: ShieldCheck },
    { id: 'api' as TabType, label: 'RARE-THE-SIXTH API', icon: Terminal },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Global Engine Header */}
      <Header
        health={health}
        onRefresh={fetchHealth}
        loading={loadingHealth}
      />

      {/* Navigation Sub-Header */}
      <div className="border-b border-slate-800/80 bg-slate-900/60 sticky top-[57px] z-40 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 lg:px-8">
          <nav className="flex items-center gap-1 overflow-x-auto py-2 scrollbar-none">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
                    isActive
                      ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/80 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-cyan-400' : 'text-slate-500'}`} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 lg:px-8 py-6">
        {activeTab === 'orchestrator' && <OrchestratorView />}
        {activeTab === 'diagnostics' && <DiagnosticsView />}
        {activeTab === 'repair' && <SelfRepairView />}
        {activeTab === 'selfBuild' && <SelfBuildView />}
        {activeTab === 'assistant' && <AssistantStudioView />}
        {activeTab === 'chat' && <ChatView />}
        {activeTab === 'providers' && <ProviderHubView onProviderChanged={fetchHealth} />}
        {activeTab === 'tools' && <ToolsExplorerView />}
        {activeTab === 'memory' && <MemoryView />}
        {activeTab === 'benchmarks' && <ContinuousImprovementView />}
        {activeTab === 'workflows' && <CodeWorkflowView />}
        {activeTab === 'tests' && <TestRunnerView />}
        {activeTab === 'api' && <IntegrationApiView />}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950/80 py-4 px-4 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>RARE-INTELLIGENCE Engine • Built to power and continuously improve RARE-THE-SIXTH</span>
          <span className="font-mono text-emerald-400/80">Strict Free Tier Enforced • $0.00 Incurred Expense</span>
        </div>
      </footer>
    </div>
  );
}
