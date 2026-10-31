/**
 * RARE-INTELLIGENCE — Ollama & Local Model Adapter
 * Connects to locally hosted inference runtimes (e.g. Ollama, llama.cpp, LocalAI).
 * TRUTHFUL IMPLEMENTATION: Probes actual endpoint. Never fakes success if local runtime is offline.
 * Supports model catalog discovery, hardware resource awareness, and explicit model setup.
 */

import { IModelProvider } from './base.js';
import {
  LocalInstalledModel,
  LocalRuntimeInfo,
  ModelCompatibilityAssessment,
  ModelGenerationConfig,
  ModelGenerationResult,
  ModelMessage,
  ModelProviderInfo,
  ModelProviderType,
  ModelSetupProgress,
} from '../types.js';
import { DeviceHardwareEvaluator } from './device-evaluator.js';
import { ILocalInferenceRuntime, LocalModelManager } from './local-runtime.js';
import { logger } from '../security/logger.js';

export class OllamaModelProvider implements IModelProvider, ILocalInferenceRuntime {
  public readonly id: ModelProviderType = 'ollama';
  public readonly name = 'Ollama / Local Open-Weight Runtime';
  public readonly runtimeType = 'ollama' as const;
  public readonly modelIdentifier: string;
  private hostUrl: string;
  private inferenceVerified = false;

  constructor(model: string = 'llama3.2:1b', hostUrl?: string) {
    this.modelIdentifier = model;
    this.hostUrl = (hostUrl || process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/+$/, '');
    LocalModelManager.getInstance().registerRuntime(this);
  }

  public get endpointUrl(): string {
    return this.hostUrl;
  }

  public getHostUrl(): string {
    return this.hostUrl;
  }

  public setHostUrl(url: string): void {
    this.hostUrl = url.replace(/\/+$/, '');
    this.inferenceVerified = false;
  }

  public hasVerifiedInference(): boolean {
    return this.inferenceVerified;
  }

  public async getLoadedModels(): Promise<string[]> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);
      if (typeof timeoutId.unref === 'function') timeoutId.unref();
      const response = await fetch(`${this.hostUrl}/api/ps`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!response.ok) return [];
      const payload = (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
      return (payload.models || []).map((model) => model.name || model.model || '').filter(Boolean);
    } catch {
      return [];
    }
  }

  public async isReachable(): Promise<boolean> {
    return this.pingDaemon();
  }

  public async getInstalledModels(): Promise<LocalInstalledModel[]> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);
      if (typeof timeoutId.unref === 'function') timeoutId.unref();

      const res = await fetch(`${this.hostUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) return [];

      const data = (await res.json()) as {
        models?: Array<{
          name: string;
          size?: number;
          modified_at?: string;
          details?: { parameter_size?: string; format?: string; quantization_level?: string };
        }>;
      };

      return (data.models || []).map((m) => ({
        name: m.name,
        sizeBytes: m.size,
        format: m.details?.format || 'gguf',
        modifiedAt: m.modified_at ? new Date(m.modified_at).getTime() : Date.now(),
        paramSize: m.details?.parameter_size,
        quantization: m.details?.quantization_level || 'Q4_K_M',
        contextWindowLimit: 8192,
      }));
    } catch {
      return [];
    }
  }

  public async pullModel(
    modelName: string,
    onProgress: (progress: ModelSetupProgress) => void,
    abortSignal?: AbortSignal
  ): Promise<boolean> {
    try {
      const res = await fetch(`${this.hostUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName, stream: true }),
        signal: abortSignal,
      });

      if (!res.ok) {
        throw new Error(`Ollama HTTP error ${res.status}: ${await res.text()}`);
      }

      if (!res.body) {
        throw new Error('No response stream received from Ollama daemon');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let total = 0;
      let completed = 0;

      while (true) {
        if (abortSignal?.aborted) {
          reader.cancel();
          throw new Error('Download aborted by user');
        }

        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter((l) => l.trim() !== '');

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.total) total = data.total;
            if (data.completed) completed = data.completed;

            const percent = total > 0 ? Math.round((completed / total) * 100) : 10;
            onProgress({
              modelName,
              stage: percent >= 100 ? 'verifying_integrity' : 'downloading',
              progressPercent: percent,
              downloadedBytes: completed,
              totalBytes: total,
              statusMessage: data.status || `Downloading ${modelName}...`,
              updatedAt: Date.now(),
            });
          } catch {
            // Ignore partial JSON lines in stream
          }
        }
      }

      onProgress({
        modelName,
        stage: 'verifying_integrity',
        progressPercent: 99,
        downloadedBytes: total,
        totalBytes: total,
        statusMessage: `Download finished for "${modelName}"; checking runtime installation.`,
        updatedAt: Date.now(),
      });
      return true;
    } catch (err: any) {
      if (abortSignal?.aborted) {
        throw new Error('Setup cancelled by operator.');
      }
      throw err;
    }
  }

  public async getLocalRuntimeInfo(): Promise<LocalRuntimeInfo> {
    return LocalModelManager.getInstance().getRuntimeInfo(this.modelIdentifier);
  }

  private async pingDaemon(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1000);
      if (typeof timeoutId.unref === 'function') timeoutId.unref();

      const res = await fetch(`${this.hostUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return res.ok;
    } catch {
      return false;
    }
  }

  public planModelDownload(modelName: string): ModelCompatibilityAssessment {
    return DeviceHardwareEvaluator.assessModel(modelName);
  }

  public async checkAvailability(): Promise<ModelProviderInfo> {
    try {
      const runtimeInfo = await this.getLocalRuntimeInfo();

      if (!runtimeInfo.isReachable) {
        return {
          id: this.id,
          name: this.name,
          modelIdentifier: this.modelIdentifier,
          isAvailable: false,
          isConfigured: false,
          supportsFunctionCalling: false,
          supportsStreaming: false,
          license: 'Open-Weights (Llama / Mistral / Qwen)',
          freeTierStatus: {
            isFree: true,
            quotaNotes: 'No local daemon detected at ' + this.hostUrl,
            rateLimitNotes: 'Hardware bounded; offline capable',
          },
          statusMessage: runtimeInfo.statusMessage,
        };
      }

      const hasSelectedModel = runtimeInfo.installedModels.some((m) =>
        m.name.toLowerCase().replace(/:latest$/, '') === this.modelIdentifier.toLowerCase().replace(/:latest$/, '')
      );
      const canLoadOnHost = runtimeInfo.modelLoaded ||
        DeviceHardwareEvaluator.assessModel(this.modelIdentifier).isCompatibleWithHost;
      const isAvailable = hasSelectedModel && canLoadOnHost;

      return {
        id: this.id,
        name: this.name,
        modelIdentifier: this.modelIdentifier,
        isAvailable,
        isConfigured: true,
        supportsFunctionCalling: false,
        supportsStreaming: false,
        license: 'Open-Weights / Self-Hosted (100% Free Local Compute)',
        freeTierStatus: {
          isFree: true,
          quotaNotes: `${runtimeInfo.installedModels.length} local models installed. Selected model ${hasSelectedModel ? 'is installed' : 'is missing'}; ${runtimeInfo.modelLoaded ? 'it is loaded' : 'it is not loaded'}.`,
          rateLimitNotes: 'Hardware bound; zero network dependency',
        },
        statusMessage: isAvailable
          ? runtimeInfo.statusMessage
          : hasSelectedModel
          ? `${runtimeInfo.statusMessage} Available RAM is below the estimated safe loading budget.`
          : runtimeInfo.statusMessage,
      };
    } catch (err: any) {
      return {
        id: this.id,
        name: this.name,
        modelIdentifier: this.modelIdentifier,
        isAvailable: false,
        isConfigured: false,
        supportsFunctionCalling: false,
        supportsStreaming: false,
        license: 'Open-Weights (Llama / Mistral / Qwen)',
        freeTierStatus: {
          isFree: true,
          quotaNotes: 'Probe error',
          rateLimitNotes: err.message,
        },
        statusMessage: `Local runtime probe failed: ${err.message}`,
      };
    }
  }

  public async generate(
    prompt: string | ModelMessage[],
    config?: ModelGenerationConfig
  ): Promise<ModelGenerationResult> {
    const startTime = Date.now();

    // Verify availability before calling
    const status = await this.checkAvailability();
    if (!status.isAvailable) {
      throw new Error(
        `OllamaProvider: Cannot execute local inference. Reason: ${status.statusMessage}. The engine refuses to fabricate model responses.`
      );
    }

    try {
      const promptText =
        typeof prompt === 'string'
          ? prompt
          : prompt.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');

      const controller = new AbortController();
      const timeoutMs = 60000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      if (typeof timeoutId.unref === 'function') timeoutId.unref();

      const res = await fetch(`${this.hostUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.modelIdentifier,
          prompt: promptText,
          system: config?.systemInstruction,
          stream: false,
          options: {
            temperature: config?.temperature,
            top_p: config?.topP,
            top_k: config?.topK,
            num_predict: config?.maxOutputTokens,
          },
        }),
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`Ollama API error HTTP ${res.status}: ${await res.text()}`);
      }

      const data = (await res.json()) as { response: string; prompt_eval_count?: number; eval_count?: number };
      this.inferenceVerified = typeof data.response === 'string' && data.response.trim().length > 0;
      const latencyMs = Date.now() - startTime;

      return {
        text: data.response || '',
        provider: this.id,
        model: this.modelIdentifier,
        latencyMs,
        tokenUsage: {
          promptTokens: data.prompt_eval_count || 0,
          completionTokens: data.eval_count || 0,
          totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
        },
        isSimulated: false, // Genuine local model execution
        costEstimateUSD: 0,
      };
    } catch (err: any) {
      logger.error('OllamaProvider', 'Local generation failed', { error: err.message });
      throw new Error(`Ollama Local Execution Failed: ${err.message}`);
    }
  }
}
