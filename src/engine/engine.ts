/**
 * RARE-INTELLIGENCE — Central Engine Orchestrator
 * Single unified point of entry for RARE-THE-SIXTH integration.
 * Enforces offline-first deterministic startup, zero budget, modular architecture,
 * and clear distinction between engine initialization and model inference.
 */

import path from 'path';
import { ProviderManager } from './providers/factory.js';
import { ToolRegistry } from './tools/registry.js';
import { BUILTIN_TOOLS } from './tools/builtin.js';
import { FilePersistentStore } from './memory/file-persistent.js';
import { InMemoryStore } from './memory/in-memory.js';
import { IMemoryStore } from './memory/base.js';
import { TaskDecomposer } from './planner/decomposer.js';
import { TaskExecutor } from './planner/executor.js';
import { PersistentTaskQueue } from './planner/task-queue.js';
import { OutputVerifier } from './verification/evaluator.js';
import { BenchmarkRunner } from './continuous-improvement/benchmark-suite.js';
import { CapabilityUpgradeRegistry } from './continuous-improvement/upgrade-registry.js';
import { CodingWorkflowEngine } from './workflows/coding-workflow.js';
import { SelfDiagnosticsEngine } from './diagnostics/diagnostics-engine.js';
import { SelfRepairEngine } from './repair/self-repair-engine.js';
import { ProjectBuildEngine } from './self-build/project-builder.js';
import { AssistantFoundation } from './assistant/assistant-foundation.js';
import { CircuitBreaker } from './errors/circuit-breaker.js';
import { AppError } from './errors/app-error.js';
import { NetworkTransitionManager, networkManager } from './network/connection-manager.js';
import { OllamaModelProvider } from './providers/ollama.js';
import { LocalTransformersProvider } from './providers/transformers-local.js';
import { LocalModelManager } from './providers/local-runtime.js';
import {
  EngineConfig,
  DEFAULT_CONFIG,
} from './config.js';
import {
  ConversationSession,
  DiagnosticReport,
  EngineHealthStatus,
  EngineInitializationResult,
  EngineOperationalState,
  ExecutionContext,
  LocalRuntimeInfo,
  ModelGenerationConfig,
  ModelGenerationResult,
  ModelMessage,
  ModelProviderType,
  OperationalStateReport,
  PersistentQueuedTask,
  SelfRepairResult,
  TaskNetworkDependency,
  TaskPlan,
  VerificationReport,
} from './types.js';
import { logger } from './security/logger.js';

export class RareIntelligenceEngine {
  private static instance: RareIntelligenceEngine;

  public readonly config: EngineConfig;
  public readonly providers: ProviderManager;
  public readonly tools: ToolRegistry;
  public readonly memory: IMemoryStore;
  public readonly durableStore: FilePersistentStore;
  public readonly localModelManager: LocalModelManager;
  public readonly decomposer: TaskDecomposer;
  public readonly executor: TaskExecutor;
  public readonly taskQueue: PersistentTaskQueue;
  public readonly verifier: OutputVerifier;
  public readonly benchmarks: BenchmarkRunner;
  public readonly upgrades: CapabilityUpgradeRegistry;
  public readonly codingWorkflows: CodingWorkflowEngine;
  public readonly diagnostics: SelfDiagnosticsEngine;
  public readonly repair: SelfRepairEngine;
  public readonly selfBuild: ProjectBuildEngine;
  public readonly assistant: AssistantFoundation;
  public readonly networkManager: NetworkTransitionManager;
  public readonly providerCircuitBreaker: CircuitBreaker;

  private operationalState: EngineOperationalState = 'STARTING';
  private operationalReport: OperationalStateReport | null = null;
  private startTime: number = Date.now();

  private constructor(customConfig: Partial<EngineConfig> = {}) {
    // -------------------------------------------------------------
    // STEP 1: Load local application and engine configuration
    // -------------------------------------------------------------
    this.config = { ...DEFAULT_CONFIG, ...customConfig };
    this.networkManager = networkManager;

    // -------------------------------------------------------------
    // STEP 2: Initialize logging and deterministic diagnostic services
    // -------------------------------------------------------------
    this.providerCircuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 30000,
      name: 'provider-circuit',
    });

    // -------------------------------------------------------------
    // STEP 3: Initialize local persistent storage (network-independent)
    // -------------------------------------------------------------
    try {
      this.durableStore = new FilePersistentStore();
      this.memory = this.durableStore;
    } catch (err: any) {
      logger.warn('Engine', `File persistent store initialization failed: ${err.message}. Falling back to volatile store.`);
      this.durableStore = new FilePersistentStore(path.resolve(process.cwd(), 'data', 'fallback'));
      this.memory = new InMemoryStore();
    }

    // -------------------------------------------------------------
    // STEP 4: Validate and recover local state where possible
    // (FilePersistentStore loads disk records, verifies checksums, restores from backup if needed)
    // -------------------------------------------------------------

    // -------------------------------------------------------------
    // STEP 5: Load capability registry and locally available tools
    // -------------------------------------------------------------
    this.tools = new ToolRegistry();
    for (const tool of BUILTIN_TOOLS) {
      this.tools.register(tool);
    }

    this.decomposer = new TaskDecomposer();
    this.verifier = new OutputVerifier();
    this.benchmarks = new BenchmarkRunner();
    this.upgrades = new CapabilityUpgradeRegistry();
    this.codingWorkflows = new CodingWorkflowEngine(this.tools);
    this.assistant = new AssistantFoundation();

    // -------------------------------------------------------------
    // STEP 6 & 7: Detect available local inference runtimes & local model
    // -------------------------------------------------------------
    this.localModelManager = LocalModelManager.getInstance();
    this.providers = new ProviderManager();

    this.taskQueue = new PersistentTaskQueue(
      this.durableStore,
      this.decomposer,
      this.tools,
      this.networkManager
    );
    this.executor = new TaskExecutor(this.tools, this.providers.getActiveProvider());

    this.diagnostics = new SelfDiagnosticsEngine(
      this.durableStore,
      this.providers,
      this.tools,
      this.upgrades
    );
    this.repair = new SelfRepairEngine(this.durableStore, this.tools);
    this.selfBuild = new ProjectBuildEngine(this.durableStore, this.tools);

    // -------------------------------------------------------------
    // STEP 8, 9, 10: Non-blocking asynchronous startup completion
    // -------------------------------------------------------------
    this.executeOfflineFirstStartup();
  }

  public static getInstance(config?: Partial<EngineConfig>): RareIntelligenceEngine {
    if (!RareIntelligenceEngine.instance) {
      RareIntelligenceEngine.instance = new RareIntelligenceEngine(config);
    }
    return RareIntelligenceEngine.instance;
  }

  /**
   * Deterministic 10-Step Offline-First Startup Completion:
   * Initializes local capabilities first; non-blocking probe for external providers.
   * Reports truthful distinction between engine start and real AI inference availability.
   */
  private async executeOfflineFirstStartup(): Promise<EngineInitializationResult> {
    const start = Date.now();
    logger.info('Engine', `Initiating deterministic offline-first engine initialization (v${this.config.engineVersion})...`);

    // Verify storage readiness
    const storageReady = this.durableStore.isPersistent;

    // Detect local model runtime
    const ollamaProvider = this.providers.getProvider('ollama') as OllamaModelProvider;
    let localModelReady = false;
    let localRuntimeReachable = false;
    let localRuntimeInfo: LocalRuntimeInfo | null = null;
    try {
      localRuntimeInfo = await ollamaProvider.getLocalRuntimeInfo();
      localRuntimeReachable = localRuntimeInfo.isReachable;
      localModelReady = (await ollamaProvider.checkAvailability()).isAvailable;
    } catch {
      localModelReady = false;
      localRuntimeReachable = false;
    }

    // Determine network reachability with bounded non-blocking probe (max 600ms)
    let isOnline = false;
    try {
      isOnline = await this.networkManager.probeConnectivity(600);
    } catch {
      isOnline = false;
    }

    // Determine operational state
    if (!isOnline) {
      this.operationalState = localModelReady ? 'LOCAL_AI_AVAILABLE' : 'OFFLINE';
    } else {
      this.operationalState = localModelReady ? 'LOCAL_AI_AVAILABLE' : 'ONLINE';
    }

    const localTools = this.tools.getAll().filter((t) => t.permissionLevel !== 'NETWORK_ACCESS');
    const networkTools = this.tools.getAll().filter((t) => t.permissionLevel === 'NETWORK_ACCESS');

    // Step 10: Build truthful operational report
    this.operationalReport = {
      engineStarted: true,
      localStorageAvailable: storageReady,
      localModelAvailable: localModelReady,
      onlineProviderAvailable: isOnline,
      fullRequestedCapabilityAvailable: isOnline && (localModelReady || Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY')),
      offlineCapabilities: [
        `Deterministic Tools (${localTools.length} registered)`,
        'Local File Persistence & Rotating Backups',
        'Offline Task Planning & Step Decomposition',
        'Syntax Integrity & Code Analysis',
        'Self-Diagnostics & Self-Repair Engine',
        localModelReady
          ? `Local Model Available (${ollamaProvider.modelIdentifier}${localRuntimeInfo?.inferenceVerified ? ', inference previously verified' : ', inference not yet verified'})`
          : 'Diagnostic Sandbox Mock Inference',
      ],
      networkDependentCapabilities: [
        'Google Gemini Remote Inference',
        'Web Grounding & External Documentation Search',
        'Model Registry Pulls & Downloads',
      ],
      summaryMessage: !isOnline
        ? (localModelReady
            ? `Engine operational in OFFLINE mode with local model available${localRuntimeInfo?.inferenceVerified ? ' and inference previously verified' : '; inference not yet verified'}.`
            : 'Engine operational in OFFLINE mode with deterministic tools and diagnostic sandbox (no local AI daemon detected).')
        : 'Engine operational in HYBRID ONLINE/OFFLINE mode.',
    };

    // Optional opt-in bootstrap of the in-process local ONNX model.
    // Disabled by default: loading weights can exceed small container memory limits,
    // so it is only attempted on explicit opt-in, and any failure degrades gracefully
    // to the next available provider without crashing startup.
    if (String(process.env.RARE_AUTO_LOAD_LOCAL_MODEL).toLowerCase() === 'true') {
      const bootstrapLocal = this.providers.getProvider('local-transformers') as LocalTransformersProvider;
      void bootstrapLocal
        .loadModel()
        .then(() => {
          this.providers.setActiveProvider('local-transformers');
          logger.info('Engine', 'Opt-in local ONNX model auto-loaded and set active.');
        })
        .catch((err: any) => {
          logger.warn(
            'Engine',
            `Opt-in local model auto-load skipped: ${err.message}. Continuing with other providers.`
          );
        });
    }

    logger.info(
      'Engine',
      `Offline startup complete in ${Date.now() - start}ms. State: [${this.operationalState}]. Local Runtime: ${localRuntimeReachable ? 'ONLINE' : 'OFFLINE'}. Storage: [${this.memory.storageType}].`
    );

    return {
      initializedAt: Date.now(),
      operationalState: this.operationalState,
      operationalReport: this.operationalReport,
      storageReady,
      storageType: this.memory.storageType,
      localRuntimeReady: localRuntimeReachable,
      onlineProvidersReady: isOnline,
      capabilities: {
        offlineToolsCount: localTools.length,
        onlineToolsCount: networkTools.length,
        activeProviderId: this.providers.getActiveProvider().id,
      },
    };
  }

  /**
   * Real Operational Health & State Audit
   */
  public async getHealth(): Promise<EngineHealthStatus> {
    const isOnline = this.networkManager.isOnline();
    const providerInfos = await this.providers.getAvailableProvidersInfo();
    const active = this.providers.getActiveProvider();
    const activeInfo = providerInfos.find((p) => p.id === active.id);
    const memoryItems = await this.memory.list();

    const ollamaProvider = this.providers.getProvider('ollama') as OllamaModelProvider;
    const localRuntimeInfo: LocalRuntimeInfo = await ollamaProvider.getLocalRuntimeInfo();

    const localTransformersProvider = this.providers.getProvider('local-transformers') as LocalTransformersProvider;
    const isTransformersReady = localTransformersProvider.isReady;
    const hasCachedWeights = localTransformersProvider.hasCachedWeights();

    const ollamaInfo = providerInfos.find((provider) => provider.id === 'ollama');
    const localModelReady = isTransformersReady || Boolean(ollamaInfo?.isAvailable);

    // Derive operational state
    let state: EngineOperationalState = 'HEALTHY' as any;
    if (!isOnline) {
      state = localModelReady ? 'LOCAL_AI_AVAILABLE' : 'OFFLINE';
    } else if (activeInfo?.isAvailable) {
      state = (active.id === 'ollama' || active.id === 'local-transformers') ? 'LOCAL_AI_AVAILABLE' : 'ONLINE_AI_AVAILABLE';
    } else {
      state = localModelReady ? 'LOCAL_AI_AVAILABLE' : 'NO_AI_PROVIDER_AVAILABLE';
    }

    const queueStats = this.taskQueue.getQueueStats();
    const localTools = this.tools.getAll().filter((t) => t.permissionLevel !== 'NETWORK_ACCESS');
    const networkTools = this.tools.getAll().filter((t) => t.permissionLevel === 'NETWORK_ACCESS');

    const operationalReport: OperationalStateReport = {
      engineStarted: true,
      localStorageAvailable: this.durableStore.isPersistent,
      localModelAvailable: localModelReady,
      onlineProviderAvailable: isOnline,
      fullRequestedCapabilityAvailable: isOnline && (localModelReady || activeInfo?.isAvailable || false),
      offlineCapabilities: [
        `Deterministic Tools (${localTools.length} registered)`,
        'Local File Persistence & Rotating Backups',
        'Offline Task Planning & Step Decomposition',
        'Syntax Integrity & Code Analysis',
        'Self-Diagnostics & Self-Repair Engine',
        localModelReady
          ? `Local Model Available (${isTransformersReady ? localTransformersProvider.modelIdentifier : ollamaProvider.modelIdentifier}${localRuntimeInfo.inferenceVerified ? ', inference previously verified' : ', inference not yet verified'})`
          : (hasCachedWeights ? 'Local Model Weights Present on Disk (not loaded; inference not available)' : 'Diagnostic Sandbox Mock Inference'),
      ],
      networkDependentCapabilities: [
        'Google Gemini Remote Inference',
        'Web Grounding & External Documentation Search',
        'Model Registry Pulls & Downloads',
      ],
      summaryMessage: !isOnline
        ? (localModelReady
            ? `Engine operational in OFFLINE mode with local model available${localRuntimeInfo.inferenceVerified || isTransformersReady ? ' and inference verified' : '; inference not yet verified'}.`
            : 'Engine operational in OFFLINE mode with deterministic tools and diagnostic sandbox (no local AI daemon detected).')
        : 'Engine operational in HYBRID ONLINE/OFFLINE mode.',
    };

    return {
      status: activeInfo?.isAvailable ? 'healthy' : 'degraded',
      operationalState: state,
      operationalReport,
      isOnline,
      version: this.config.engineVersion,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      activeProvider: active.id,
      availableProviders: providerInfos,
      localRuntime: localRuntimeInfo,
      memoryStorageType: this.memory.storageType,
      memoryItemsCount: memoryItems.length,
      registeredToolsCount: this.tools.getAll().length,
      lastBenchmarkScore: this.upgrades.getActiveCandidate()?.benchmarkScore,
      zeroBudgetPolicyEnforced: this.config.zeroBudgetPolicy.strictlyFreeOnly,
      queuedTasksCount: queueStats,
    };
  }

  /**
   * Conversational inference with context management & circuit breaker protection
   */
  public async chat(
    messages: ModelMessage[],
    options?: ModelGenerationConfig & { allowDiagnosticFallback?: boolean }
  ): Promise<ModelGenerationResult> {
    const activeProvider = this.providers.getActiveProvider();
    const decision = await this.providers.resolveProviderForTask({
      preferredType: activeProvider.id === 'gemini' ? 'online' : 'local',
      allowDiagnosticFallback: options?.allowDiagnosticFallback ?? (activeProvider.id === 'diagnostic-mock'),
    });

    const targetProvider = this.providers.getProvider(decision.selectedProviderId);

    // Guard: Prevent ordinary chat from silently returning diagnostic mock output
    if (
      targetProvider.id === 'diagnostic-mock' &&
      activeProvider.id !== 'diagnostic-mock' &&
      !options?.allowDiagnosticFallback
    ) {
      const localProvider = this.providers.getProvider('local-transformers') as LocalTransformersProvider;
      const statusMsg = localProvider.hasCachedWeights()
        ? `Local open-weight neural model "${localProvider.manifest.name}" weights are present on disk but not loaded into memory. Click "Load Local Model" or call /api/v1/providers/load-local to load weights into memory.`
        : `Local open-weight neural model "${localProvider.manifest.name}" weights are not installed. Click "Setup Model" in Provider Hub or run model setup to download open weights.`;

      throw new AppError({
        code: 'NO_AI_PROVIDER_READY',
        message: `Real neural inference is not ready: ${statusMsg} Ordinary chat will not silently substitute mock answers.`,
        statusCode: 503,
      });
    }

    // Context management: slice if exceeding limit
    const maxMessages = this.config.safetyLimits.maxContextMessages;
    const boundedMessages = messages.length > maxMessages ? messages.slice(-maxMessages) : messages;

    const toolDeclarations = this.tools.getDeclarationsForModel();
    const configWithTools: ModelGenerationConfig = {
      ...options,
      tools: toolDeclarations,
    };

    // If simulating offline or physically offline, verify target provider is local
    if (!this.networkManager.isOnline() && targetProvider.id === 'gemini') {
      throw new AppError({
        code: 'NETWORK_OFFLINE',
        message: 'Active provider "gemini" requires an external network connection, but engine is currently OFFLINE. Switch to local open-weight model or diagnostic mock.',
        statusCode: 503,
      });
    }

    // Execute through circuit breaker
    return await this.providerCircuitBreaker.execute(async () => {
      return await targetProvider.generate(boundedMessages, configWithTools);
    });
  }

  /**
   * High-Level Autonomous Task Execution
   */
  public async executeTask(
    objective: string,
    context?: Partial<ExecutionContext>,
    constraints: string[] = []
  ): Promise<{ plan: TaskPlan; verification: VerificationReport }> {
    const execContext: ExecutionContext = {
      workspaceRoot: this.config.workspace.rootDir,
      permissionGrant: ['READ_ONLY', 'WORKSPACE_WRITE', 'NETWORK_ACCESS'],
      ...context,
    };

    const plan = this.decomposer.decomposeObjective(objective, constraints);
    const executor = new TaskExecutor(this.tools, this.providers.getActiveProvider());

    const result = await executor.executePlan(plan, execContext);

    // Save task and checkpoint in durable store
    this.durableStore.saveTask(result.plan);
    await this.memory.set({
      key: `checkpoint_${plan.id}`,
      content: `Objective: "${plan.objective}". Status: ${plan.status}. Score: ${result.verification.score}%.`,
      category: 'checkpoint',
      tags: ['task_run', plan.status],
      source: 'engine_checkpoint',
    });

    return result;
  }

  /**
   * Offline Task Queue: Enqueue a task for persistent scheduling
   */
  public enqueueTask(
    objective: string,
    networkDependency: TaskNetworkDependency = 'local_only',
    constraints: string[] = []
  ): PersistentQueuedTask {
    return this.taskQueue.enqueueTask(objective, networkDependency, constraints);
  }

  /**
   * Run full system diagnostics and record durable report
   */
  public async runDiagnostics(): Promise<DiagnosticReport> {
    return await this.diagnostics.runFullDiagnostics();
  }

  /**
   * Trigger autonomous repair on recoverable findings
   */
  public async runAutonomousRepair(findingId?: string): Promise<SelfRepairResult[]> {
    const report = await this.diagnostics.runFullDiagnostics();
    const targetFindings = findingId
      ? report.findings.filter((f) => f.id === findingId)
      : report.findings.filter((f) => f.isRepairable);

    const repairOutcomes: SelfRepairResult[] = [];
    for (const finding of targetFindings) {
      const outcome = await this.repair.executeRepair(finding, ['WORKSPACE_WRITE']);
      repairOutcomes.push(outcome);
    }

    return repairOutcomes;
  }

  // Conversation Session Management
  public saveConversation(session: ConversationSession): void {
    this.durableStore.saveConversation(session);
  }

  public getConversation(id: string): ConversationSession | null {
    return this.durableStore.getConversation(id);
  }

  public listConversations(): ConversationSession[] {
    return this.durableStore.listConversations();
  }

  public deleteConversation(id: string): boolean {
    return this.durableStore.deleteConversation(id);
  }
}

export const engine = RareIntelligenceEngine.getInstance();
