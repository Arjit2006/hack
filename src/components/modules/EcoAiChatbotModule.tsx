import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Bot, Check, Copy, Download, RefreshCw, Send, Trash2 } from 'lucide-react';
import { FormattedMarkdown } from '../FormattedMarkdown';
import { apiFetch } from '../../lib/apiFetch';
import { auth } from '../../lib/firebase';
import { GeoLocation, OverviewPayload } from '../../types/env';
import { safeFilename } from '../../lib/exportUtils';

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  mode?: 'gemini' | 'basic_mode';
  modelUsed?: string;
  modelLabel?: string;
  modeLabel?: string;
  sources?: string[];
  timestamp: string;
}

interface EcoAiChatbotModuleProps {
  location: GeoLocation;
  overview: OverviewPayload | null;
}

interface ChatErrorState {
  message: string;
  failedQuestion: string;
}

export const EcoAiChatbotModule: React.FC<EcoAiChatbotModuleProps> = ({ location, overview }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [reportingPeriod, setReportingPeriod] = useState('Last 7 days');
  const [loading, setLoading] = useState(false);
  const [errorState, setErrorState] = useState<ChatErrorState | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const cityLabel = location.city || 'Delhi';
  const suggestedChips = [
    `Current AQI in ${cityLabel}`,
    'Is the water safe?',
    'Top recommendations today',
    'Explain the anomalies',
  ];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading, errorState]);

  const sendQuestion = async (q: string, options?: { isRetry?: boolean }) => {
    const clean = q.trim();
    if (!clean || loading) return;
    setErrorState(null);

    const priorHistory = messages.slice(-6).map((m) => ({ role: m.role, text: m.text }));
    if (!options?.isRetry) {
      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        text: clean,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');
    }

    setLoading(true);

    try {
      const token = await auth.currentUser?.getIdToken().catch(() => undefined);
      const json = await apiFetch<{
        answer?: string;
        mode?: 'gemini' | 'basic_mode';
        modelUsed?: string;
        modelLabel?: string;
        modeLabel?: string;
        groundedSources?: string[];
      }>('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          question: clean,
          location: {
            name: location.name,
            countryCode: location.countryCode,
            latitude: location.latitude,
            longitude: location.longitude,
          },
          reportingPeriod,
          wqiSnapshot: overview?.water.wqi ?? undefined,
          wmiSnapshot: overview?.waste.wmi ?? undefined,
          history: priorHistory,
        }),
      });

      if (!json.answer) {
        throw new Error('EcoAI returned an empty answer. Please retry.');
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `m-${Date.now()}`,
          role: 'model',
          text: json.answer!,
          mode: json.mode,
          modelUsed: json.modelUsed,
          modelLabel: json.modelLabel || (json.mode === 'basic_mode' ? 'Basic mode' : 'Gemini 4 Hydrogen'),
          modeLabel: json.modeLabel,
          sources: json.groundedSources,
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      const friendly =
        err instanceof Error && err.message
          ? err.message
          : 'Unable to reach EcoAI right now. Please check your connection and try again.';
      setErrorState({
        message: friendly,
        failedQuestion: clean,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async (msg: ChatMessage) => {
    await navigator.clipboard.writeText(msg.text);
    setCopiedId(msg.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleDownloadText = (msg: ChatMessage) => {
    const blob = new Blob(
      [
        `EcoIntelligence — EcoAI Environmental Report\nLocation: ${location.name}\nPeriod: ${reportingPeriod}\nGenerated: ${msg.timestamp}\n\n${msg.text}\n`,
      ],
      { type: 'text/plain;charset=utf-8' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const citySlug = safeFilename(location?.city || location?.name || 'Delhi');
    a.download = `EcoAI_${citySlug}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl flex flex-col min-h-[480px] h-[calc(100vh-15rem)] lg:h-[calc(100vh-12rem)]">
      {/* Chat Toolbar */}
      <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-[#14532D]/10 flex items-center justify-center text-[#14532D] shrink-0">
            <Bot className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900">EcoAI – Environmental Intelligence Assistant</h2>
            <p className="text-xs text-slate-500 truncate">
              Grounded in verified backend telemetry for <strong>{location.name}</strong>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="ecoai-period" className="sr-only">
            Reporting Period
          </label>
          <select
            id="ecoai-period"
            value={reportingPeriod}
            onChange={(e) => setReportingPeriod(e.target.value)}
            className="min-h-[44px] sm:min-h-[34px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
          >
            <option value="Last 24 hours">Last 24 hours</option>
            <option value="Last 7 days">Last 7 days</option>
            <option value="Last 30 days">Last 30 days</option>
          </select>
          <button
            type="button"
            onClick={() => {
              setMessages([]);
              setErrorState(null);
            }}
            className="min-h-[44px] sm:min-h-[34px] inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#F9FBFA]">
        {messages.length === 0 ? (
          <div className="max-w-2xl mx-auto py-8 space-y-5">
            <div className="text-center space-y-1.5">
              <p className="text-sm font-semibold text-slate-800">
                Ask EcoAI about {cityLabel}&apos;s verified environmental readings, indices, or risks
              </p>
              <p className="text-xs text-slate-500">
                EcoAI retrieves live backend measurements and exact WQI/WMI calculations before answering and never fabricates unavailable readings.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {suggestedChips.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={loading}
                  onClick={() => void sendQuestion(prompt)}
                  className="text-left min-h-[44px] p-3 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:border-[#14532D]/50 hover:bg-emerald-50/40 transition-colors disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-3xl rounded-xl p-4 text-sm space-y-2 ${
                  m.role === 'user'
                    ? 'bg-[#14532D] text-white'
                    : 'bg-white border border-slate-200 text-slate-800'
                }`}
              >
                {m.role === 'model' && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-semibold whitespace-nowrap ${
                        m.mode === 'basic_mode'
                          ? 'border-amber-200 bg-amber-50 text-amber-800'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      }`}
                    >
                      {m.modelLabel || (m.mode === 'basic_mode' ? 'Basic mode' : 'Gemini 4 Hydrogen')}
                    </span>
                  </div>
                )}
                <div className="whitespace-pre-wrap leading-relaxed text-[13px]">
                  <FormattedMarkdown content={m.text} />
                </div>
                {m.role === 'model' && (
                  <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                    <span className="truncate max-w-md">
                      Sources: {m.sources?.join(' · ') || 'Connected backend feeds'}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleCopy(m)}
                        className="inline-flex items-center gap-1 hover:text-slate-900 min-h-[32px] px-1"
                      >
                        {copiedId === m.id ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedId === m.id ? 'Copied' : 'Copy'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadText(m)}
                        className="inline-flex items-center gap-1 hover:text-slate-900 min-h-[32px] px-1"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        {/* Typing Indicator Bubble */}
        {loading && (
          <div className="flex justify-start" aria-live="polite">
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-600 flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1" aria-hidden="true">
                <span className="w-1.5 h-1.5 rounded-full bg-[#14532D] animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[#14532D] animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[#14532D] animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
              <span>EcoAI is checking verified telemetry and drafting an answer...</span>
            </div>
          </div>
        )}

        {/* Friendly Chat Error Bubble with Retry */}
        {errorState && (
          <div className="flex justify-start" role="alert">
            <div className="max-w-xl bg-red-50 border border-red-200 rounded-xl p-3.5 text-xs text-red-900 space-y-2.5">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{errorState.message}</span>
              </div>
              <div>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void sendQuestion(errorState.failedQuestion, { isRetry: true })}
                  className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-red-800 text-white rounded-lg hover:bg-red-900 disabled:opacity-50"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Retry</span>
                </button>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Suggested Chips Bar when conversation started */}
      {messages.length > 0 && (
        <div className="px-3 pt-2 pb-1 border-t border-slate-100 bg-white flex items-center gap-1.5 overflow-x-auto">
          {suggestedChips.map((chip) => (
            <button
              key={chip}
              type="button"
              disabled={loading}
              onClick={() => void sendQuestion(chip)}
              className="px-2.5 py-1.5 text-[11px] font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-md hover:border-[#14532D]/40 hover:bg-emerald-50/40 whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      {/* Input Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void sendQuestion(input);
        }}
        className="p-3 border-t border-slate-200 bg-white flex items-center gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void sendQuestion(input);
            }
          }}
          placeholder={`Ask about air, water, waste, energy, or risks in ${cityLabel}...`}
          className="flex-1 min-w-0 min-h-[44px] px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#14532D]"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-white bg-[#14532D] rounded-lg hover:bg-[#166534] disabled:opacity-50 shrink-0"
        >
          <Send className="w-4 h-4" aria-hidden="true" />
          <span className="hidden sm:inline">{loading ? 'Sending...' : 'Ask EcoAI'}</span>
        </button>
      </form>
    </div>
  );
};
