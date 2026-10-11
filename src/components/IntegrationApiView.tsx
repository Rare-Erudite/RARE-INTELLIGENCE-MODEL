import React, { useState } from 'react';
import { Terminal, Copy, Check, ExternalLink, Code } from 'lucide-react';

export const IntegrationApiView: React.FC = () => {
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const TS_CLIENT_SNIPPET = `/**
 * RARE-THE-SIXTH — Intelligence Client Integration SDK
 * Connects directly to RARE-INTELLIGENCE Versioned API v1.
 */

export class RareIntelligenceClient {
  constructor(private baseUrl: string = 'http://localhost:3000/api/v1') {}

  async checkHealth() {
    const res = await fetch(\`\${this.baseUrl}/engine/health\`);
    return await res.json();
  }

  async executeTask(objective: string, constraints: string[] = []) {
    const res = await fetch(\`\${this.baseUrl}/tasks/execute\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objective, constraints }),
    });
    return await res.json();
  }

  async chat(messages: Array<{ role: 'user' | 'model'; content: string }>) {
    const res = await fetch(\`\${this.baseUrl}/chat\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
    return await res.json();
  }

  async queryMemory(category?: string) {
    const url = category ? \`\${this.baseUrl}/memory?category=\${category}\` : \`\${this.baseUrl}/memory\`;
    const res = await fetch(url);
    return await res.json();
  }
}`;

  const ENDPOINTS = [
    {
      method: 'GET',
      path: '/api/v1/engine/health',
      desc: 'Probe engine readiness, active provider, memory persistence type, uptime, and tool count.',
      curl: `curl -s http://localhost:3000/api/v1/engine/health`,
    },
    {
      method: 'POST',
      path: '/api/v1/tasks/execute',
      desc: 'Plan, decompose, and execute multi-step autonomous task with post-verification report.',
      curl: `curl -X POST http://localhost:3000/api/v1/tasks/execute \\
  -H "Content-Type: application/json" \\
  -d '{"objective": "Analyze workspace files", "constraints": ["Zero budget only"]}'`,
    },
    {
      method: 'POST',
      path: '/api/v1/chat',
      desc: 'Send multi-turn conversational context with tool declarations.',
      curl: `curl -X POST http://localhost:3000/api/v1/chat \\
  -H "Content-Type: application/json" \\
  -d '{"messages": [{"role": "user", "content": "Ping engine status"}]}'`,
    },
    {
      method: 'GET',
      path: '/api/v1/providers',
      desc: 'List model providers, live status, licenses, and free-tier quotas.',
      curl: `curl -s http://localhost:3000/api/v1/providers`,
    },
    {
      method: 'GET',
      path: '/api/v1/memory',
      desc: 'Query long-term persistent memory items, preferences, and checkpoints.',
      curl: `curl -s http://localhost:3000/api/v1/memory`,
    },
    {
      method: 'POST',
      path: '/api/v1/tests/run',
      desc: 'Run comprehensive 14-point test suite on all architecture layers.',
      curl: `curl -X POST http://localhost:3000/api/v1/tests/run`,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <Terminal className="w-5 h-5 text-cyan-400" />
          RARE-THE-SIXTH — Versioned REST API & SDK Reference
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Complete programmatic endpoints and client TypeScript SDK for RARE-THE-SIXTH to control RARE-INTELLIGENCE.
        </p>
      </div>

      {/* TypeScript SDK Snippet */}
      <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <Code className="w-4 h-4 text-cyan-400" /> TypeScript Integration Client (Zero-Dependency)
          </h3>
          <button
            onClick={() => copyToClipboard(TS_CLIENT_SNIPPET, 'ts_sdk')}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1.5 transition-colors"
          >
            {copied === 'ts_sdk' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied === 'ts_sdk' ? 'Copied' : 'Copy SDK Code'}</span>
          </button>
        </div>

        <pre className="p-4 rounded-lg bg-slate-950 border border-slate-800/80 text-xs font-mono text-cyan-300/90 overflow-x-auto max-h-72">
          {TS_CLIENT_SNIPPET}
        </pre>
      </div>

      {/* Endpoints Catalog */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Documented API Endpoints
        </h3>
        <div className="space-y-3">
          {ENDPOINTS.map((ep, idx) => (
            <div
              key={idx}
              className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2.5"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-mono text-xs">
                  <span className={`px-2 py-0.5 rounded font-bold ${
                    ep.method === 'GET' ? 'bg-blue-950 text-blue-400 border border-blue-800' : 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                  }`}>
                    {ep.method}
                  </span>
                  <span className="text-slate-100 font-bold">{ep.path}</span>
                </div>

                <button
                  onClick={() => copyToClipboard(ep.curl, `curl_${idx}`)}
                  className="px-2.5 py-1 rounded bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 text-[11px] font-mono flex items-center gap-1.5 self-start sm:self-auto transition-colors"
                >
                  {copied === `curl_${idx}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copied === `curl_${idx}` ? 'Copied curl' : 'Copy curl'}</span>
                </button>
              </div>

              <p className="text-xs text-slate-400">{ep.desc}</p>

              <pre className="p-2.5 rounded bg-slate-950 border border-slate-800/60 text-[11px] font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap">
                {ep.curl}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
