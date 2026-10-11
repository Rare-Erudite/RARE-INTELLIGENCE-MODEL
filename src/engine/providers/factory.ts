/**
 * RARE-INTELLIGENCE — Provider Registry & Intelligent Selector
 * Manages provider registration, availability probes, zero-budget routing,
 * and offline-first policy decisions.
 */

import { IModelProvider } from './base.js';
import { GeminiModelProvider } from './gemini.js';
import { OllamaModelProvider } from './ollama.js';
import { DiagnosticMockProvider } from './diagnostic.js';
import { LocalTransformersProvider } from './transformers-local.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import {
  ModelProviderInfo,
  ModelProviderType,
  ProviderSelectionDecision,
  TaskProviderRequirements,
} from '../types.js';
import { networkManager } from '../network/connection-manager.js';
import { logger } from '../security/logger.js';

export class ProviderManager {
  private providers: Map<ModelProviderType, IModelProvider> = new Map();
  private activeProviderType: ModelProviderType = 'local-transformers';

  constructor() {
    // Register available zero-cost providers with local neural model first
    this.registerProvider(new LocalTransformersProvider());
    this.registerProvider(new OllamaModelProvider('llama3.2:1b'));
    this.registerProvider(new GeminiModelProvider('gemini-3.8-flash'));
    this.registerProvider(new OpenAICompatibleProvider());
    this.registerProvider(new DiagnosticMockProvider());

    // By default, preferred zero-cost provider is local-transformers
    this.activeProviderType = 'local-transformers';

    // Optional operator override (e.g. RARE_DEFAULT_PROVIDER=openai-compatible to use a
    // user-supplied-key or free local OpenAI-compatible endpoint without paid services).
    const preferredEnv = process.env.RARE_DEFAULT_PROVIDER as ModelProviderType | undefined;
    if (preferredEnv && this.providers.has(preferredEnv)) {
      this.activeProviderType = preferredEnv;
    }
  }

  public registerProvider(provider: IModelProvider) {
    this.providers.set(provider.id, provider);
  }

  public getProvider(id: ModelProviderType): IModelProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`Provider "${id}" is not registered in RARE-INTELLIGENCE.`);
    }
    return provider;
  }

  public getActiveProvider(): IModelProvider {
    return this.getProvider(this.activeProviderType);
  }

  public setActiveProvider(id: ModelProviderType) {
    if (!this.providers.has(id)) {
      throw new Error(`Unknown provider "${id}". Allowed: ${Array.from(this.providers.keys()).join(', ')}`);
    }
    this.activeProviderType = id;
    logger.info('ProviderManager', `Active model provider switched to: ${id}`);
  }

  /**
   * Offline-First Provider Selection Policy:
   * Evaluates network, configuration, local installation, and task needs.
   */
  public async resolveProviderForTask(
    requirements: TaskProviderRequirements = {}
  ): Promise<ProviderSelectionDecision> {
    const isOnline = networkManager.isOnline();
    const evaluated: ProviderSelectionDecision['candidatesEvaluated'] = [];

    // 1. Diagnostic explicitly requested
    if (requirements.preferredType === 'diagnostic') {
      return {
        selectedProviderId: 'diagnostic-mock',
        providerName: 'RARE Diagnostic Sandbox',
        reason: 'Explicit diagnostic preference requested for reproducible testing.',
        isLocal: true,
        isOnline: false,
        isSimulated: true,
        candidatesEvaluated: [
          { id: 'diagnostic-mock', eligible: true },
        ],
      };
    }

    // 2. Evaluate Local Neural Providers (In-Process Transformers & Ollama Daemon)
    const localTransformers = this.getProvider('local-transformers') as LocalTransformersProvider;
    let localTransformersEligible = false;
    let localTransformersRejection: string | undefined;
    try {
      const ltInfo = await localTransformers.checkAvailability();
      if (ltInfo.isAvailable) {
        localTransformersEligible = true;
      } else {
        localTransformersRejection = ltInfo.statusMessage;
      }
    } catch (err: any) {
      localTransformersRejection = err.message;
    }
    evaluated.push({
      id: 'local-transformers',
      eligible: localTransformersEligible,
      rejectionReason: localTransformersRejection,
    });

    const ollama = this.getProvider('ollama') as OllamaModelProvider;
    let ollamaEligible = false;
    let ollamaRejectionReason: string | undefined;

    try {
      const ollamaInfo = await ollama.checkAvailability();
      if (ollamaInfo.isAvailable) {
        ollamaEligible = true;
      } else {
        ollamaRejectionReason = ollamaInfo.statusMessage;
      }
    } catch (err: any) {
      ollamaRejectionReason = `Probe failure: ${err.message}`;
    }

    evaluated.push({
      id: 'ollama',
      eligible: ollamaEligible,
      rejectionReason: ollamaRejectionReason,
    });

    // OpenAI-compatible endpoint (user-supplied key or free local server)
    const openai = this.getProvider('openai-compatible') as OpenAICompatibleProvider;
    let openaiEligible = false;
    let openaiRejectionReason: string | undefined;
    try {
      const openaiInfo = await openai.checkAvailability();
      if (openaiInfo.isAvailable || openaiInfo.isConfigured) {
        openaiEligible = true;
      } else {
        openaiRejectionReason = openaiInfo.statusMessage;
      }
    } catch (err: any) {
      openaiRejectionReason = `Probe failure: ${err.message}`;
    }
    evaluated.push({
      id: 'openai-compatible',
      eligible: openaiEligible,
      rejectionReason: openaiRejectionReason,
    });

    // If offline, local execution is mandatory
    if (!isOnline) {
      if (localTransformersEligible) {
        return {
          selectedProviderId: 'local-transformers',
          providerName: localTransformers.name,
          reason: 'Network is offline. In-process local neural model (Qwen2.5-0.5B ONNX) is loaded in memory for genuine offline inference.',
          isLocal: true,
          isOnline: false,
          isSimulated: false,
          candidatesEvaluated: evaluated,
        };
      }

      if (ollamaEligible) {
        return {
          selectedProviderId: 'ollama',
          providerName: ollama.name,
          reason: 'Network is offline. Local Ollama runtime is verified ready for offline inference.',
          isLocal: true,
          isOnline: false,
          isSimulated: false,
          candidatesEvaluated: evaluated,
        };
      }

      // If local model is not installed/running when offline
      return {
        selectedProviderId: 'diagnostic-mock',
        providerName: 'RARE Diagnostic Sandbox (Deterministic Mock)',
        reason: 'Network is offline and no local open-weight model is active in memory. Falling back safely to deterministic offline sandbox (deterministic mock, NOT genuine AI inference).',
        isLocal: true,
        isOnline: false,
        isSimulated: true,
        candidatesEvaluated: evaluated,
      };
    }

    // If online, check Gemini availability
    const gemini = this.getProvider('gemini');
    let geminiEligible = false;
    let geminiRejectionReason: string | undefined;

    try {
      const geminiInfo = await gemini.checkAvailability(false);
      if (geminiInfo.isAvailable || (geminiInfo.isConfigured && isOnline)) {
        geminiEligible = true;
      } else {
        geminiRejectionReason = geminiInfo.statusMessage;
      }
    } catch (err: any) {
      geminiRejectionReason = err.message;
    }

    evaluated.push({
      id: 'gemini',
      eligible: geminiEligible,
      rejectionReason: geminiRejectionReason,
    });

    // If local was preferred and eligible, prefer it
    if (requirements.preferredType === 'local') {
      if (localTransformersEligible) {
        return {
          selectedProviderId: 'local-transformers',
          providerName: localTransformers.name,
          reason: 'Local execution preferred; in-process neural model verified ready in memory.',
          isLocal: true,
          isOnline: false,
          isSimulated: false,
          candidatesEvaluated: evaluated,
        };
      }
      if (ollamaEligible) {
        return {
          selectedProviderId: 'ollama',
          providerName: ollama.name,
          reason: 'Local execution preferred by caller; local runtime verified ready.',
          isLocal: true,
          isOnline: false,
          isSimulated: false,
          candidatesEvaluated: evaluated,
        };
      }
    }

    // OpenAI-compatible endpoint (user-supplied key or free local server)
    if (
      openaiEligible &&
      (this.activeProviderType === 'openai-compatible' ||
        (requirements.preferredType === 'online' && !geminiEligible))
    ) {
      return {
        selectedProviderId: 'openai-compatible',
        providerName: openai.name,
        reason: openai.isLocalEndpoint
          ? 'Free local OpenAI-compatible server is active; genuine inference executed at the operator endpoint.'
          : 'User-configured OpenAI-compatible endpoint (operator-supplied key) is active; genuine inference executed at the operator endpoint.',
        isLocal: openai.isLocalEndpoint,
        isOnline: !openai.isLocalEndpoint,
        isSimulated: false,
        candidatesEvaluated: evaluated,
      };
    }

    // Online execution with Gemini
    if (geminiEligible && this.activeProviderType === 'gemini') {
      return {
        selectedProviderId: 'gemini',
        providerName: gemini.name,
        reason: 'Online connectivity verified and Gemini Free Tier is active.',
        isLocal: false,
        isOnline: true,
        isSimulated: false,
        candidatesEvaluated: evaluated,
      };
    }

    // Default to active provider if eligible
    const active = this.getActiveProvider();
    const activeEvaluated = evaluated.find((e) => e.id === active.id);
    if (activeEvaluated?.eligible) {
      return {
        selectedProviderId: active.id,
        providerName: active.name,
        reason: `Active provider [${active.id}] is verified available.`,
        isLocal: active.id !== 'gemini',
        isOnline: active.id === 'gemini',
        isSimulated: active.id === 'diagnostic-mock',
        candidatesEvaluated: evaluated,
      };
    }

    // Fallback safely to diagnostic mock
    return {
      selectedProviderId: 'diagnostic-mock',
      providerName: 'RARE Diagnostic Sandbox (Deterministic Mock)',
      reason: 'No configured real AI model currently ready. Routed safely to deterministic offline sandbox.',
      isLocal: true,
      isOnline: false,
      isSimulated: true,
      candidatesEvaluated: evaluated,
    };
  }

  public async getAvailableProvidersInfo(): Promise<ModelProviderInfo[]> {
    const infos: ModelProviderInfo[] = [];
    for (const [id, provider] of this.providers.entries()) {
      try {
        const info = await provider.checkAvailability();
        infos.push(info);
      } catch (err: any) {
        infos.push({
          id,
          name: provider.name,
          modelIdentifier: provider.modelIdentifier,
          isAvailable: false,
          isConfigured: false,
          supportsFunctionCalling: false,
          supportsStreaming: false,
          license: 'Unknown',
          freeTierStatus: {
            isFree: true,
            quotaNotes: 'Error during probe',
            rateLimitNotes: err.message,
          },
          statusMessage: `Probe error: ${err.message}`,
        });
      }
    }
    return infos;
  }
}
