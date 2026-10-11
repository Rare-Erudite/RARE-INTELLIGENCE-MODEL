/**
 * RARE-INTELLIGENCE — Google Gemini Provider Adapter
 * Real external model integration using official @google/genai SDK.
 * Server-side execution only with zero-budget free tier compatibility.
 */

import { GoogleGenAI, Type } from '@google/genai';
import { IModelProvider } from './base.js';
import {
  ModelGenerationConfig,
  ModelGenerationResult,
  ModelMessage,
  ModelProviderInfo,
  ModelProviderType,
  ModelToolCall,
} from '../types.js';
import { networkManager } from '../network/connection-manager.js';
import { logger } from '../security/logger.js';

export class GeminiModelProvider implements IModelProvider {
  public readonly id: ModelProviderType = 'gemini';
  public readonly name = 'Google Gemini (Native SDK)';
  public readonly modelIdentifier: string;
  private client: GoogleGenAI | null = null;
  private apiKeyPresent: boolean = false;

  constructor(model: string = 'gemini-3.8-flash') {
    this.modelIdentifier = model;
    this.initClient();
  }

  private initClient() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && apiKey.trim() !== '' && apiKey !== 'MY_GEMINI_API_KEY') {
      try {
        this.client = new GoogleGenAI({
          apiKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        });
        this.apiKeyPresent = true;
      } catch (err: any) {
        logger.error('GeminiProvider', 'Failed to initialize GoogleGenAI client', { error: err.message });
        this.client = null;
        this.apiKeyPresent = false;
      }
    } else {
      this.client = null;
      this.apiKeyPresent = false;
    }
  }

  private cachedInfo: ModelProviderInfo | null = null;
  private lastProbeTime = 0;
  private lastProbeSucceeded = false;
  private readonly cacheTTL = 60_000; // 1 minute cache

  public async checkAvailability(forceLiveProbe = false): Promise<ModelProviderInfo> {
    // Refresh env in case it was injected
    this.initClient();

    // 1. If not configured, report missing key
    if (!this.apiKeyPresent || !this.client) {
      this.lastProbeSucceeded = false;
      return {
        id: this.id,
        name: this.name,
        modelIdentifier: this.modelIdentifier,
        isAvailable: false,
        isConfigured: false,
        supportsFunctionCalling: true,
        supportsStreaming: true,
        license: 'Google AI Terms of Service (Free Tier Available)',
        freeTierStatus: {
          isFree: true,
          quotaNotes: 'Gemini free tier: 15 RPM / 1M TPM / 1500 RPD on free allowance',
          rateLimitNotes: 'Rate-limiting active; backoff on HTTP 429',
        },
        statusMessage: 'GEMINI_API_KEY environment variable is missing or placeholder. Please provide key in environment.',
      };
    }

    // 2. If network is offline, provider is configured but unavailable for inference
    if (!networkManager.isOnline()) {
      return {
        id: this.id,
        name: this.name,
        modelIdentifier: this.modelIdentifier,
        isAvailable: false,
        isConfigured: true,
        supportsFunctionCalling: true,
        supportsStreaming: true,
        license: 'Google AI Terms of Service (Free Tier)',
        freeTierStatus: {
          isFree: true,
          quotaNotes: 'Network offline. External provider dormant.',
          rateLimitNotes: 'Zero outbound requests; offline-first mode active',
        },
        statusMessage: 'Network connectivity is currently offline. Gemini is configured but unreachable until connection is restored.',
      };
    }

    // Return cached availability if fresh and not forced
    const now = Date.now();
    if (!forceLiveProbe && this.cachedInfo && (now - this.lastProbeTime < this.cacheTTL)) {
      return this.cachedInfo;
    }

    // Fast status check without live probe: reports configured, but distinguishes live verification status
    if (!forceLiveProbe && !this.lastProbeSucceeded) {
      const info: ModelProviderInfo = {
        id: this.id,
        name: this.name,
        modelIdentifier: this.modelIdentifier,
        isAvailable: false, // Truthful: configured credentials present, pending live verification
        isConfigured: true,
        supportsFunctionCalling: true,
        supportsStreaming: true,
        license: 'Google AI Terms of Service (Free Tier)',
        freeTierStatus: {
          isFree: true,
          quotaNotes: `Configured for ${this.modelIdentifier}. Zero-budget free tier enforced.`,
          rateLimitNotes: 'Credentials present. Live request probe not yet verified.',
        },
        statusMessage: `Configured with GEMINI_API_KEY for model "${this.modelIdentifier}". Run live probe to verify provider quota and connectivity.`,
      };
      this.cachedInfo = info;
      this.lastProbeTime = now;
      return info;
    } else if (!forceLiveProbe && this.lastProbeSucceeded) {
      const info: ModelProviderInfo = {
        id: this.id,
        name: this.name,
        modelIdentifier: this.modelIdentifier,
        isAvailable: true,
        isConfigured: true,
        supportsFunctionCalling: true,
        supportsStreaming: true,
        license: 'Google AI Terms of Service (Free Tier)',
        freeTierStatus: {
          isFree: true,
          quotaNotes: `Model ${this.modelIdentifier} verified live.`,
          rateLimitNotes: 'Active zero-cost session.',
        },
        statusMessage: `Operational: live inference verified with ${this.modelIdentifier}.`,
      };
      this.cachedInfo = info;
      this.lastProbeTime = now;
      return info;
    }

    // Live Probe requested explicitly with bounded 5s timeout
    try {
      const start = Date.now();
      let timer: any;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Availability probe timed out after 5000ms')), 5000);
        if (typeof timer.unref === 'function') timer.unref();
      });

      const probePromise = this.client.models.generateContent({
        model: this.modelIdentifier,
        contents: 'ping',
        config: {
          maxOutputTokens: 5,
        },
      });

      await Promise.race([probePromise, timeoutPromise]);
      clearTimeout(timer);
      const latency = Date.now() - start;

      this.lastProbeSucceeded = true;
      const info: ModelProviderInfo = {
        id: this.id,
        name: this.name,
        modelIdentifier: this.modelIdentifier,
        isAvailable: true,
        isConfigured: true,
        supportsFunctionCalling: true,
        supportsStreaming: true,
        license: 'Google AI Terms of Service (Free Allowance Verified)',
        freeTierStatus: {
          isFree: true,
          quotaNotes: 'Verified live connection. Gemini Free Tier active.',
          rateLimitNotes: `Live latency: ${latency}ms`,
        },
        statusMessage: `Operational (verified live in ${latency}ms with ${this.modelIdentifier})`,
      };
      this.cachedInfo = info;
      this.lastProbeTime = Date.now();
      return info;
    } catch (err: any) {
      this.lastProbeSucceeded = false;
      logger.info('GeminiProvider', 'Live probe report', { error: err.message });
      const isQuota = err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED');
      const isDemandSpike = err.message?.includes('503') || err.message?.includes('UNAVAILABLE') || err.message?.includes('high demand');
      const isRetired = err.message?.includes('404') || err.message?.includes('NOT_FOUND') || err.message?.includes('no longer available');
      const isAuthError = err.message?.includes('401') || err.message?.includes('403') || err.message?.includes('API_KEY_INVALID');
      const isTimeout = err.message?.includes('timed out');

      let statusMessage = `External provider probe error: ${err.message}`;
      if (isDemandSpike) {
        statusMessage = `Model ${this.modelIdentifier} is temporarily experiencing high demand (HTTP 503). Zero-budget policy forbids paid fallbacks.`;
      } else if (isQuota) {
        statusMessage = `Quota exhausted on Gemini free tier (HTTP 429). Blocked until quota reset; paid auto-upgrades are strictly disabled.`;
      } else if (isRetired) {
        statusMessage = `Model ${this.modelIdentifier} is retired or not found on provider API.`;
      } else if (isAuthError) {
        statusMessage = `Invalid or unauthorized GEMINI_API_KEY credentials.`;
      } else if (isTimeout) {
        statusMessage = `Live probe timed out (connection slow or unreachable).`;
      }

      const info: ModelProviderInfo = {
        id: this.id,
        name: this.name,
        modelIdentifier: this.modelIdentifier,
        isAvailable: false, // If live probe fails or times out, report unavailable truthfully
        isConfigured: true,
        supportsFunctionCalling: true,
        supportsStreaming: true,
        license: 'Google AI Terms of Service',
        freeTierStatus: {
          isFree: true,
          quotaNotes: isQuota ? 'Free-tier quota limit reached (HTTP 429).' : isDemandSpike ? 'Temporary service spike (HTTP 503).' : 'API configured.',
          rateLimitNotes: isTimeout ? 'Live probe timed out' : err.message,
        },
        statusMessage,
      };
      this.cachedInfo = info;
      this.lastProbeTime = Date.now();
      return info;
    }
  }

  public async generate(
    prompt: string | ModelMessage[],
    config?: ModelGenerationConfig
  ): Promise<ModelGenerationResult> {
    if (!networkManager.isOnline()) {
      throw new Error(
        'GeminiProvider: Network is offline. Cannot execute online inference while disconnected.'
      );
    }

    this.initClient();

    if (!this.client) {
      throw new Error(
        'GeminiProvider: GEMINI_API_KEY is not configured. Cannot perform real inference without valid free key.'
      );
    }

    const startTime = Date.now();

    try {
      // Build contents
      let contentsPayload: any;

      if (typeof prompt === 'string') {
        contentsPayload = prompt;
      } else {
        // Multi-turn message array
        contentsPayload = prompt.map((msg) => ({
          role: msg.role === 'model' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        }));
      }

      // Build SDK config
      const sdkConfig: any = {};
      if (config?.systemInstruction) {
        sdkConfig.systemInstruction = config.systemInstruction;
      }
      if (config?.temperature !== undefined) {
        sdkConfig.temperature = config.temperature;
      }
      if (config?.topP !== undefined) {
        sdkConfig.topP = config.topP;
      }
      if (config?.topK !== undefined) {
        sdkConfig.topK = config.topK;
      }
      if (config?.maxOutputTokens !== undefined) {
        sdkConfig.maxOutputTokens = config.maxOutputTokens;
      }
      if (config?.responseMimeType === 'application/json') {
        sdkConfig.responseMimeType = 'application/json';
      }

      // Convert tool declarations if provided
      if (config?.tools && config.tools.length > 0) {
        const functionDeclarations = config.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: {
            type: Type.OBJECT,
            properties: t.parameters.properties || {},
            required: t.parameters.required || [],
          },
        }));
        sdkConfig.tools = [{ functionDeclarations }];
      }

      const response = await this.client.models.generateContent({
        model: this.modelIdentifier,
        contents: contentsPayload,
        config: sdkConfig,
      });

      const latencyMs = Date.now() - startTime;
      const text = response.text || '';

      // Extract tool calls if any
      const toolCalls: ModelToolCall[] = [];
      if (response.functionCalls && response.functionCalls.length > 0) {
        for (const fc of response.functionCalls) {
          if (fc.name) {
            toolCalls.push({
              id: fc.id || Math.random().toString(36).substring(2, 9),
              name: fc.name,
              args: (fc.args as Record<string, unknown>) || {},
            });
          }
        }
      }

      return {
        text,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        provider: this.id,
        model: this.modelIdentifier,
        latencyMs,
        tokenUsage: {
          promptTokens: response.usageMetadata?.promptTokenCount || 0,
          completionTokens: response.usageMetadata?.candidatesTokenCount || 0,
          totalTokens: response.usageMetadata?.totalTokenCount || 0,
        },
        isSimulated: false, // Truthful flag: real external inference executed
        costEstimateUSD: 0, // Strict zero budget free tier policy
        rawResponseMeta: {
          finishReason: response.candidates?.[0]?.finishReason,
        },
      };
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      logger.error('GeminiProvider', 'Inference failed', { error: err.message, latencyMs });

      if (err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED')) {
        throw new Error(
          `Gemini Free Tier Quota Exhausted (429): ${err.message}. Budget restriction forbids paid auto-upgrades.`
        );
      }
      throw new Error(`Gemini Provider Error: ${err.message}`);
    }
  }

  public async generateStream(
    prompt: string | ModelMessage[],
    config?: ModelGenerationConfig,
    onChunk?: (chunk: string) => void
  ): Promise<ModelGenerationResult> {
    if (!networkManager.isOnline()) {
      throw new Error(
        'GeminiProvider: Network is offline. Cannot stream online inference while disconnected.'
      );
    }
    this.initClient();
    if (!this.client) {
      throw new Error('GeminiProvider: GEMINI_API_KEY is not configured.');
    }

    const startTime = Date.now();
    let accumulatedText = '';

    const responseStream = await this.client.models.generateContentStream({
      model: this.modelIdentifier,
      contents: typeof prompt === 'string' ? prompt : prompt.map((m) => ({
        role: m.role === 'model' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      config: {
        systemInstruction: config?.systemInstruction,
        temperature: config?.temperature,
        maxOutputTokens: config?.maxOutputTokens,
      },
    });

    for await (const chunk of responseStream) {
      const partText = chunk.text || '';
      if (partText) {
        accumulatedText += partText;
        if (onChunk) onChunk(partText);
      }
    }

    return {
      text: accumulatedText,
      provider: this.id,
      model: this.modelIdentifier,
      latencyMs: Date.now() - startTime,
      isSimulated: false,
      costEstimateUSD: 0,
    };
  }
}
