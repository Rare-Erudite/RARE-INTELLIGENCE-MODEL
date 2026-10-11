/**
 * RARE-INTELLIGENCE — OpenAI-Compatible Provider Adapter
 * Connects to any OpenAI Chat Completions-compatible endpoint:
 *   • A user-supplied hosted key (OpenAI, Groq, OpenRouter, Together, Fireworks, ...)
 *   • A free LOCAL server that speaks the same API (llama.cpp `--server`, LM Studio,
 *     vLLM, LocalAI, text-generation-webui, or the Ollama OpenAI shim).
 *
 * BUDGET POLICY: the engine itself never spends money and never auto-upgrades to a
 * paid tier. Any cost is explicitly the operator's choice, incurred at *their*
 * endpoint/key. Without a configured endpoint/key this provider reports itself
 * unavailable truthfully and the engine falls back gracefully to a free/local path.
 */

import { IModelProvider } from './base.js';
import {
  ModelGenerationConfig,
  ModelGenerationResult,
  ModelMessage,
  ModelProviderInfo,
  ModelProviderType,
} from '../types.js';
import { networkManager } from '../network/connection-manager.js';
import { logger } from '../security/logger.js';

export class OpenAICompatibleProvider implements IModelProvider {
  public readonly id: ModelProviderType = 'openai-compatible';
  public readonly name = 'OpenAI-Compatible Endpoint (user-supplied key or free local server)';
  public readonly modelIdentifier: string;

  private baseUrl: string;
  private apiKey: string | null;

  private cachedInfo: ModelProviderInfo | null = null;
  private lastProbeTime = 0;
  private lastProbeSucceeded = false;
  private readonly cacheTTL = 60_000;

  constructor(baseUrl?: string, model?: string, apiKey?: string | null) {
    this.baseUrl = (baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.modelIdentifier = model || process.env.OPENAI_MODEL || 'gpt-4o-mini';

    const rawKey = apiKey !== undefined ? apiKey : process.env.OPENAI_API_KEY;
    // A key that is missing, empty, or an obvious redacted/placeholder token is NOT a credential.
    const looksReal = !!rawKey && rawKey.trim().length > 8 && !/^dtn_secret|^MY_|placeholder|redacted/i.test(rawKey.trim());
    this.apiKey = looksReal ? rawKey!.trim() : null;
  }

  /** True when the endpoint is a loopback/local server (no external cost, no key needed). */
  public get isLocalEndpoint(): boolean {
    try {
      const host = new URL(this.baseUrl).hostname;
      return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1';
    } catch {
      return false;
    }
  }

  public async checkAvailability(forceLiveProbe = false): Promise<ModelProviderInfo> {
    const configured = Boolean(this.apiKey) || this.isLocalEndpoint;

    const base: ModelProviderInfo = {
      id: this.id,
      name: this.name,
      modelIdentifier: this.modelIdentifier,
      isAvailable: false,
      isConfigured: configured,
      supportsFunctionCalling: true,
      supportsStreaming: true,
      license: this.isLocalEndpoint
        ? 'Open-Weights / Self-Hosted (100% free local compute)'
        : 'Operator-supplied key — cost billed by the operator, not by the engine',
      freeTierStatus: {
        isFree: true,
        quotaNotes: this.isLocalEndpoint
          ? 'Local endpoint — hardware bound, zero network cost.'
          : 'Engine incurs $0.00; any usage cost is the operator\'s explicit choice at their own endpoint.',
        rateLimitNotes: 'No engine-imposed rate limit; the endpoint enforces its own quota.',
      },
      statusMessage: '',
    };

    if (!configured) {
      base.statusMessage =
        'OpenAI-compatible endpoint not configured. Set OPENAI_BASE_URL + OPENAI_API_KEY (hosted), or point OPENAI_BASE_URL at a free local server (e.g. http://127.0.0.1:8080/v1).';
      return base;
    }

    if (!this.isLocalEndpoint && !networkManager.isOnline()) {
      base.statusMessage =
        'Endpoint configured but the network is offline. External OpenAI-compatible calls are dormant until connectivity returns.';
      return base;
    }

    const now = Date.now();
    if (!forceLiveProbe && this.cachedInfo && now - this.lastProbeTime < this.cacheTTL) {
      return this.cachedInfo;
    }

    if (!forceLiveProbe) {
      base.isAvailable = this.lastProbeSucceeded;
      base.statusMessage = this.lastProbeSucceeded
        ? `Operational: last live request to ${this.baseUrl} succeeded.`
        : `Configured for ${this.baseUrl} (model "${this.modelIdentifier}"). Run a live probe to verify reachability.`;
      this.cachedInfo = base;
      this.lastProbeTime = now;
      return base;
    }

    // Bounded live probe — GET /models is cheap and universal across compatible servers.
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      if (typeof timer.unref === 'function') timer.unref();
      const res = await fetch(`${this.baseUrl}/models`, {
        signal: controller.signal,
        headers: this.authHeaders(),
      });
      clearTimeout(timer);
      this.lastProbeSucceeded = res.ok;
      base.isAvailable = res.ok;
      base.statusMessage = res.ok
        ? `Operational: ${this.baseUrl} responded to a live probe.`
        : `Endpoint responded with HTTP ${res.status} (${res.statusText}).`;
    } catch (err: any) {
      this.lastProbeSucceeded = false;
      base.isAvailable = false;
      base.statusMessage = `Live probe failed for ${this.baseUrl}: ${err.message}`;
      logger.info('OpenAICompatibleProvider', base.statusMessage);
    }
    this.cachedInfo = base;
    this.lastProbeTime = Date.now();
    return base;
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
    return headers;
  }

  public async generate(
    prompt: string | ModelMessage[],
    config?: ModelGenerationConfig
  ): Promise<ModelGenerationResult> {
    const configured = Boolean(this.apiKey) || this.isLocalEndpoint;
    if (!configured) {
      throw new Error(
        'OpenAICompatibleProvider: no endpoint/key configured. Set OPENAI_BASE_URL/OPENAI_API_KEY (or a local OPENAI_BASE_URL) before requesting inference.'
      );
    }
    if (!this.isLocalEndpoint && !networkManager.isOnline()) {
      throw new Error('OpenAICompatibleProvider: network is offline. Cannot execute remote inference while disconnected.');
    }

    const startTime = Date.now();
    const messages: Array<{ role: string; content: string }> = [];
    if (config?.systemInstruction) {
      messages.push({ role: 'system', content: config.systemInstruction });
    }
    if (typeof prompt === 'string') {
      messages.push({ role: 'user', content: prompt });
    } else {
      for (const m of prompt) {
        messages.push({ role: m.role === 'model' ? 'assistant' : m.role, content: m.content });
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    if (typeof timer.unref === 'function') timer.unref();

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.authHeaders(),
        signal: controller.signal,
        body: JSON.stringify({
          model: this.modelIdentifier,
          messages,
          temperature: config?.temperature ?? 0.7,
          top_p: config?.topP,
          max_tokens: config?.maxOutputTokens,
          stream: false,
        }),
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`OpenAICompatibleProvider: HTTP ${res.status} from ${this.baseUrl}. ${body.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content?.trim() || '';

    return {
      text,
      provider: this.id,
      model: this.modelIdentifier,
      latencyMs: Date.now() - startTime,
      tokenUsage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
      isSimulated: false, // Genuine inference at a real (user-chosen) endpoint.
      costEstimateUSD: 0, // The engine itself spends nothing.
    };
  }
}
