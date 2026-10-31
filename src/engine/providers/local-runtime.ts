/**
 * RARE-INTELLIGENCE — Local Model Runtime & Setup Manager
 * Replaceable local inference abstraction supporting Ollama and edge runtimes.
 * Enforces explicit setup operations, storage verification, progress tracking,
 * and zero-budget resource awareness.
 */

import {
  LocalInstalledModel,
  LocalRuntimeInfo,
  ModelCompatibilityAssessment,
  ModelSetupProgress,
  ModelSetupStage,
} from '../types.js';
import { DeviceHardwareEvaluator } from './device-evaluator.js';
import { logger } from '../security/logger.js';

export interface ILocalInferenceRuntime {
  readonly runtimeType: 'ollama' | 'llama_cpp' | 'custom_local';
  readonly endpointUrl: string;
  isReachable(): Promise<boolean>;
  getInstalledModels(): Promise<LocalInstalledModel[]>;
  getLoadedModels?(): Promise<string[]>;
  hasVerifiedInference?(): boolean;
  pullModel?(
    modelName: string,
    onProgress: (progress: ModelSetupProgress) => void,
    abortSignal?: AbortSignal
  ): Promise<boolean>;
}

export class LocalModelManager {
  private static instance: LocalModelManager;
  private runtime: ILocalInferenceRuntime | null = null;
  private activeSetupProgress: ModelSetupProgress | null = null;
  private setupAbortController: AbortController | null = null;

  public static getInstance(): LocalModelManager {
    if (!LocalModelManager.instance) {
      LocalModelManager.instance = new LocalModelManager();
    }
    return LocalModelManager.instance;
  }

  public registerRuntime(runtime: ILocalInferenceRuntime): void {
    this.runtime = runtime;
    logger.info('LocalModelManager', `Registered local inference runtime [${runtime.runtimeType}] at ${runtime.endpointUrl}`);
  }

  public getRuntime(): ILocalInferenceRuntime | null {
    return this.runtime;
  }

  public async getInstalledModels(): Promise<LocalInstalledModel[]> {
    if (!this.runtime) return [];
    try {
      return await this.runtime.getInstalledModels();
    } catch (err: any) {
      logger.warn('LocalModelManager', `Failed to query installed models: ${err.message}`);
      return [];
    }
  }

  public async getRuntimeInfo(activeModelIdentifier: string): Promise<LocalRuntimeInfo> {
    const hardwareResources = DeviceHardwareEvaluator.inspectHostResources();
    if (!this.runtime) {
      return {
        runtimeType: 'ollama',
        endpointUrl: 'http://127.0.0.1:11434',
        isReachable: false,
        activeModel: activeModelIdentifier,
        modelInstalled: false,
        modelLoaded: false,
        inferenceVerified: false,
        installedModels: [],
        hardwareResources,
        statusMessage: 'No local inference runtime registered or daemon offline.',
      };
    }

    const isReachable = await this.runtime.isReachable();
    const installedModels = isReachable ? await this.runtime.getInstalledModels() : [];
    const canonicalName = (name: string) => name.toLowerCase().replace(/:latest$/, '');
    const isModelInstalled = installedModels.some((m) =>
      canonicalName(m.name) === canonicalName(activeModelIdentifier)
    );
    const loadedModels = isReachable && this.runtime.getLoadedModels
      ? await this.runtime.getLoadedModels()
      : [];
    const isModelLoaded = loadedModels.some((name) =>
      canonicalName(name) === canonicalName(activeModelIdentifier)
    );

    let statusMessage = '';
    if (!isReachable) {
      statusMessage = `Local runtime offline: Could not connect to ${this.runtime.endpointUrl}. Ensure the daemon (e.g. "ollama serve") is running.`;
    } else if (isModelInstalled) {
      statusMessage = `Local runtime reachable at ${this.runtime.endpointUrl}; model "${activeModelIdentifier}" is installed${isModelLoaded ? ' and loaded' : ''}. ${this.runtime.hasVerifiedInference?.() ? 'A previous inference request succeeded.' : 'Inference has not yet been verified.'}`;
    } else {
      statusMessage = `Local runtime reachable at ${this.runtime.endpointUrl}, but model "${activeModelIdentifier}" is not downloaded. Use explicit Setup Model action to pull.`;
    }

    return {
      runtimeType: this.runtime.runtimeType,
      endpointUrl: this.runtime.endpointUrl,
      isReachable,
      activeModel: activeModelIdentifier,
      modelInstalled: isModelInstalled,
      modelLoaded: isModelLoaded,
      inferenceVerified: this.runtime.hasVerifiedInference?.() ?? false,
      installedModels,
      hardwareResources,
      statusMessage,
    };
  }

  public getModelCatalog(): ModelCompatibilityAssessment[] {
    return DeviceHardwareEvaluator.getKnownModelCatalog();
  }

  public getActiveSetupProgress(): ModelSetupProgress | null {
    return this.activeSetupProgress;
  }

  /**
   * Explicit model setup operation:
   * 1. Storage checks
   * 2. Device compatibility check
   * 3. Non-blocking progress reporting
   * 4. Cancellation support
   */
  public async initiateModelSetup(modelName: string): Promise<ModelSetupProgress> {
    if (this.activeSetupProgress && this.activeSetupProgress.stage === 'downloading') {
      throw new Error(
        `Another model download is already in progress (${this.activeSetupProgress.modelName}). Cancel or wait before starting a new setup.`
      );
    }

    const assessment = DeviceHardwareEvaluator.assessModel(modelName);
    const host = DeviceHardwareEvaluator.inspectHostResources();

    // 1. Stage: checking_storage
    this.activeSetupProgress = {
      modelName,
      stage: 'checking_storage',
      progressPercent: 5,
      downloadedBytes: 0,
      totalBytes: assessment.estimatedDiskMB * 1024 * 1024,
      statusMessage: 'Verifying available host disk storage and RAM capacity...',
      updatedAt: Date.now(),
    };

    const requiredFreeMB = assessment.estimatedDiskMB + 500;
    if (host.freeDiskMB < requiredFreeMB) {
      const errMessage = `Insufficient storage: Model "${modelName}" requires ~${assessment.estimatedDiskMB}MB, plus 500MB safety margin, but host only has ${host.freeDiskMB}MB free.`;
      this.activeSetupProgress = {
        modelName,
        stage: 'failed',
        progressPercent: 0,
        downloadedBytes: 0,
        totalBytes: assessment.estimatedDiskMB * 1024 * 1024,
        statusMessage: errMessage,
        error: errMessage,
        updatedAt: Date.now(),
      };
      logger.error('LocalModelManager', errMessage);
      return this.activeSetupProgress;
    }

    const requiredRamMB = assessment.estimatedRamMB + 512;
    if (host.freeMemMB < requiredRamMB || !assessment.isCompatibleWithHost) {
      const errMessage = `Insufficient available memory: model "${modelName}" is estimated to need ${assessment.estimatedRamMB}MB plus 512MB runtime reserve, but only ${host.freeMemMB}MB is currently free. Model setup was stopped before download.`;
      this.activeSetupProgress = {
        modelName,
        stage: 'failed',
        progressPercent: 0,
        downloadedBytes: 0,
        totalBytes: assessment.estimatedDiskMB * 1024 * 1024,
        statusMessage: errMessage,
        error: errMessage,
        updatedAt: Date.now(),
      };
      logger.warn('LocalModelManager', errMessage);
      return this.activeSetupProgress;
    }

    // 2. Check if runtime is reachable
    if (!this.runtime || !(await this.runtime.isReachable())) {
      const errMessage = `Local runtime daemon offline at ${this.runtime?.endpointUrl || '127.0.0.1:11434'}. Cannot pull model without running daemon.`;
      this.activeSetupProgress = {
        modelName,
        stage: 'failed',
        progressPercent: 0,
        downloadedBytes: 0,
        totalBytes: assessment.estimatedDiskMB * 1024 * 1024,
        statusMessage: errMessage,
        error: errMessage,
        updatedAt: Date.now(),
      };
      return this.activeSetupProgress;
    }

    // 3. Initiate download through runtime adapter with cancellation
    this.setupAbortController = new AbortController();
    this.activeSetupProgress = {
      modelName,
      stage: 'downloading',
      progressPercent: 10,
      downloadedBytes: 0,
      totalBytes: assessment.estimatedDiskMB * 1024 * 1024,
      statusMessage: `Connecting to model registry to pull ${modelName}...`,
      updatedAt: Date.now(),
    };

    if (this.runtime.pullModel) {
      try {
        const pulled = await this.runtime.pullModel(
          modelName,
          (prog) => {
            this.activeSetupProgress = prog;
          },
          this.setupAbortController.signal
        );
        const canonicalName = (name: string) => name.toLowerCase().replace(/:latest$/, '');
        const installed = await this.runtime.getInstalledModels();
        const isInstalled = installed.some((model) =>
          canonicalName(model.name) === canonicalName(modelName)
        );
        if (!pulled || !isInstalled) {
          throw new Error(`Runtime did not confirm that model "${modelName}" was installed.`);
        }
        this.activeSetupProgress = {
          modelName,
          stage: 'ready',
          progressPercent: 100,
          downloadedBytes: assessment.estimatedDiskMB * 1024 * 1024,
          totalBytes: assessment.estimatedDiskMB * 1024 * 1024,
          statusMessage: `Model "${modelName}" is present in the runtime model list. Inference has not yet been verified.`,
          updatedAt: Date.now(),
        };
      } catch (err: any) {
        if (this.setupAbortController.signal.aborted) {
          this.activeSetupProgress = {
            modelName,
            stage: 'cancelled',
            progressPercent: 0,
            downloadedBytes: 0,
            totalBytes: assessment.estimatedDiskMB * 1024 * 1024,
            statusMessage: 'Model setup cancelled by user.',
            updatedAt: Date.now(),
          };
          return this.activeSetupProgress;
        }

        this.activeSetupProgress = {
          modelName,
          stage: 'failed',
          progressPercent: 0,
          downloadedBytes: 0,
          totalBytes: assessment.estimatedDiskMB * 1024 * 1024,
          statusMessage: `Model setup failed: ${err.message}`,
          error: err.message,
          updatedAt: Date.now(),
        };
        return this.activeSetupProgress;
      }
    } else {
      this.activeSetupProgress = {
        modelName,
        stage: 'failed',
        progressPercent: 0,
        downloadedBytes: 0,
        totalBytes: assessment.estimatedDiskMB * 1024 * 1024,
        statusMessage: `The registered runtime cannot download models. No model was installed.`,
        error: 'Runtime does not support model downloads.',
        updatedAt: Date.now(),
      };
    }

    return this.activeSetupProgress;
  }

  public cancelModelSetup(): boolean {
    if (this.setupAbortController && this.activeSetupProgress?.stage === 'downloading') {
      this.setupAbortController.abort();
      if (this.activeSetupProgress) {
        this.activeSetupProgress.stage = 'cancelled';
        this.activeSetupProgress.statusMessage = 'Model setup cancelled by user.';
        this.activeSetupProgress.updatedAt = Date.now();
      }
      logger.info('LocalModelManager', 'Model setup operation aborted by operator.');
      return true;
    }
    return false;
  }
}
