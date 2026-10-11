import React, { useState } from 'react';
import { MessageSquare, Send, Bot, User, Clock, Zap, Cpu } from 'lucide-react';

export const ChatView: React.FC = () => {
  const [messages, setMessages] = useState<any[]>([
    {
      role: 'model',
      content: 'RARE-INTELLIGENCE Engine online. Context management and tool calling active under zero-budget constraints. How can I assist RARE-THE-SIXTH?',
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [lastMeta, setLastMeta] = useState<any>(null);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sending) return;

    const userMsg = {
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setSending(true);

    try {
      const res = await fetch('/api/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      const data = await res.json();
      if (data.success && data.result) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'model',
            content: data.result.text,
            timestamp: Date.now(),
            provider: data.result.provider,
            isSimulated: data.result.isSimulated,
            latencyMs: data.result.latencyMs,
          },
        ]);
        setLastMeta(data.result);
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'model',
          content: `Inference Error: ${err.message}`,
          timestamp: Date.now(),
          isError: true,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4 flex flex-col h-[650px]">
      {/* Title */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-800">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-cyan-400" />
            Context-Managed Conversational Engine
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Bounded context window (max 20 turns) with automatic token budgeting.
          </p>
        </div>

        {lastMeta && (
          <div className="flex items-center gap-3 text-xs font-mono">
            <span className="text-slate-400 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> {lastMeta.latencyMs}ms
            </span>
            <span className="text-cyan-400 flex items-center gap-1">
              <Cpu className="w-3.5 h-3.5" /> {lastMeta.provider}
            </span>
            {lastMeta.isSimulated && (
              <span className="px-1.5 py-0.5 rounded bg-amber-950 text-amber-400 border border-amber-800 text-[10px]">
                Simulated Mock
              </span>
            )}
          </div>
        )}
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-2">
        {messages.map((m, i) => {
          const isUser = m.role === 'user';
          return (
            <div
              key={i}
              className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : ''}`}
            >
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold ${
                  isUser
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-800 text-cyan-400 border border-slate-700'
                }`}
              >
                {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>

              <div
                className={`max-w-[80%] rounded-xl px-4 py-3 text-xs leading-relaxed space-y-1 ${
                  isUser
                    ? 'bg-cyan-950/60 border border-cyan-800/60 text-cyan-100'
                    : m.isError
                    ? 'bg-red-950/50 border border-red-900 text-red-200'
                    : 'bg-slate-900 border border-slate-800 text-slate-200'
                }`}
              >
                <div className="whitespace-pre-wrap">{m.content}</div>
                {m.provider && (
                  <div className="text-[10px] font-mono text-slate-500 pt-1 border-t border-slate-800/60 flex items-center justify-between">
                    <span>Provider: {m.provider}</span>
                    <span>{m.latencyMs}ms</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Input Box */}
      <form onSubmit={handleSend} className="pt-2">
        <div className="relative flex items-center">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={sending}
            placeholder="Send message to RARE-INTELLIGENCE..."
            className="w-full pl-4 pr-24 py-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-sans"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="absolute right-2 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send</span>
          </button>
        </div>
      </form>
    </div>
  );
};
