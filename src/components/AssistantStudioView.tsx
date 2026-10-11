import React, { useState } from 'react';
import { Bot, Search, FileSpreadsheet, Globe, Mic, ShieldAlert, CheckCircle2, AlertTriangle, Table } from 'lucide-react';

export const AssistantStudioView: React.FC = () => {
  // Research Tab State
  const [researchTopic, setResearchTopic] = useState('Zero-budget AI runtime persistence guarantees');
  const [researchResult, setResearchResult] = useState<any>(null);
  const [runningResearch, setRunningResearch] = useState(false);

  // Document Tab State
  const [docContent, setDocContent] = useState('id,name,role,status\n1,RARE-ENGINE,Intelligence,active\n2,RARE-THE-SIXTH,Consumer,planned\n3,Operator,Architect,authorized');
  const [docFilename, setDocFilename] = useState('registry.csv');
  const [parsedDoc, setParsedDoc] = useState<any>(null);

  // URL Tab State
  const [urlInput, setUrlInput] = useState('https://example.com');
  const [urlOutcome, setUrlOutcome] = useState<any>(null);
  const [readingUrl, setReadingUrl] = useState(false);

  const handleRunResearch = async () => {
    setRunningResearch(true);
    setResearchResult(null);
    try {
      const res = await fetch('/api/v1/assistant/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: researchTopic,
          notes: [
            'System specification requires strictly $0.00 incurred expenses.',
            'Note assumes unlimited cloud SQL database without cost.',
            'Local file persistent store uses atomic rename swapping.',
          ],
        }),
      });
      const data = await res.json();
      if (data.success) {
        setResearchResult(data.research);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setRunningResearch(false);
    }
  };

  const handleParseDoc = async () => {
    try {
      const res = await fetch('/api/v1/assistant/document-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: docFilename, content: docContent }),
      });
      const data = await res.json();
      if (data.success) {
        setParsedDoc(data.parsed);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleReadUrl = async () => {
    setReadingUrl(true);
    setUrlOutcome(null);
    try {
      const res = await fetch('/api/v1/assistant/safe-url-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput }),
      });
      const data = await res.json();
      setUrlOutcome(data.outcome || data.error);
    } catch (err) {
      console.error(err);
    } finally {
      setReadingUrl(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <Bot className="w-5 h-5 text-cyan-400" />
          Future General Assistant Foundation (RARE-THE-SIXTH)
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Modular capabilities for grounded research, document extraction, SSRF-safe URL retrieval, and multimodal contracts.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Module 1: Grounded Research */}
        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
          <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <Search className="w-4 h-4 text-cyan-400" /> Grounded Research & Contradiction Detection
          </h3>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-400">Research Topic</label>
            <input
              type="text"
              value={researchTopic}
              onChange={(e) => setResearchTopic(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <button
            onClick={handleRunResearch}
            disabled={runningResearch}
            className="w-full py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs transition-colors disabled:opacity-50"
          >
            {runningResearch ? 'Decomposing & Analyzing...' : 'Conduct Grounded Research'}
          </button>

          {researchResult && (
            <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 text-xs space-y-2">
              <div className="font-semibold text-cyan-300">{researchResult.summary}</div>

              {/* Contradictions */}
              {researchResult.contradictionsDetected?.length > 0 && (
                <div className="p-2 rounded bg-red-950/40 border border-red-900/60 text-red-300 space-y-1">
                  <span className="font-bold flex items-center gap-1 text-[11px]">
                    <AlertTriangle className="w-3 h-3 text-red-400" /> Detected Contradictions:
                  </span>
                  {researchResult.contradictionsDetected.map((c: string, i: number) => (
                    <div key={i} className="text-[11px] font-mono">{c}</div>
                  ))}
                </div>
              )}

              {/* Verified Facts */}
              <div className="space-y-1 pt-1">
                <span className="text-slate-400 font-bold text-[11px]">Verified Facts ({researchResult.verifiedFacts?.length}):</span>
                {researchResult.verifiedFacts?.map((f: any, i: number) => (
                  <div key={i} className="text-[11px] text-slate-300 flex items-start gap-1.5">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                    <span><strong className="text-slate-200">[{f.source}]:</strong> {f.content}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Module 2: Document Understanding & CSV Parsing */}
        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
          <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" /> Document & Table Extraction
          </h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-400">Filename</label>
              <input
                type="text"
                value={docFilename}
                onChange={(e) => setDocFilename(e.target.value)}
                className="px-2 py-1 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-cyan-400"
              />
            </div>
            <textarea
              value={docContent}
              onChange={(e) => setDocContent(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
            />
          </div>
          <button
            onClick={handleParseDoc}
            className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition-colors"
          >
            Parse Document Content
          </button>

          {parsedDoc && (
            <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 text-xs space-y-2">
              <div className="font-semibold text-emerald-300">{parsedDoc.summary}</div>
              {parsedDoc.tables && parsedDoc.tables[0] && (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] border-collapse font-mono">
                    <thead>
                      <tr className="border-b border-slate-800 text-cyan-400">
                        {parsedDoc.tables[0].headers.map((h: string, idx: number) => (
                          <th key={idx} className="p-1 text-left">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsedDoc.tables[0].rows.map((row: string[], rIdx: number) => (
                        <tr key={rIdx} className="border-b border-slate-800/40 text-slate-300">
                          {row.map((cell: string, cIdx: number) => (
                            <td key={cIdx} className="p-1">{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Module 3: Safe URL Reader with SSRF Defense */}
        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <Globe className="w-4 h-4 text-blue-400" /> Safe URL Reader (SSRF Firewall)
            </h3>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-950 text-blue-400 border border-blue-800">
              ANTI-SSRF ACTIVE
            </span>
          </div>
          <div className="space-y-2">
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="e.g. https://example.com"
              className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setUrlInput('http://127.0.0.1:3000/internal-secret')}
                className="text-[10px] text-amber-400 hover:text-amber-300 font-mono"
              >
                Test Blocked 127.0.0.1
              </button>
              <span className="text-slate-600 text-xs">•</span>
              <button
                type="button"
                onClick={() => setUrlInput('http://169.254.169.254/meta-data')}
                className="text-[10px] text-amber-400 hover:text-amber-300 font-mono"
              >
                Test Blocked Metadata IP
              </button>
            </div>
          </div>
          <button
            onClick={handleReadUrl}
            disabled={readingUrl}
            className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition-colors disabled:opacity-50"
          >
            {readingUrl ? 'Checking SSRF & Fetching...' : 'Fetch URL Content'}
          </button>

          {urlOutcome && (
            <div className={`p-3.5 rounded-lg border text-xs space-y-1 font-mono ${
              urlOutcome.success ? 'bg-slate-950 border-slate-800 text-slate-300' : 'bg-red-950/40 border-red-900 text-red-200'
            }`}>
              <div className="flex items-center justify-between font-bold">
                <span>{urlOutcome.success ? 'SAFE & FETCHED' : 'BLOCKED / FAILED'}</span>
                {urlOutcome.statusCode && <span>HTTP {urlOutcome.statusCode}</span>}
              </div>
              {urlOutcome.error && <p className="text-red-300">{urlOutcome.error}</p>}
              {urlOutcome.textExcerpt && <p className="text-slate-300 text-[11px] whitespace-pre-wrap">{urlOutcome.textExcerpt}</p>}
            </div>
          )}
        </div>

        {/* Module 4: Multimodal Contracts Matrix */}
        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
          <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <Mic className="w-4 h-4 text-purple-400" /> Multimodal Contracts Matrix
          </h3>
          <div className="space-y-2.5 text-xs">
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-200">Audio Transcription</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
                  gemini-3.5-transcribe
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Streaming PCM WebSocket contract prepared for RARE-THE-SIXTH voice input.</p>
            </div>

            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-200">Speech Synthesis (TTS)</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
                  gemini-3.8-flash-lite-tts
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Unary WAV and raw PCM streaming contracts ready for client playback.</p>
            </div>

            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-emerald-300 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Image Understanding
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
                  OPERATIONAL
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Multimodal vision parts supported via server Gemini generateContent API.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
