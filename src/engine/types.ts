/**
 * RARE-INTELLIGENCE — Core Architectural Types & Interfaces
 * Explicit interfaces for a modular, production-ready AI engine.
 */

export type ExecutionEnvironment = 'free-cloud' | 'local-runtime' | 'diagnostic-sandbox';

export type ModelProviderType = 'gemini' | 'ollama' | 'local-transformers' | 'diagnostic-mock';

export type ToolPermissionLevel = 'READ_ONLY' | 'WORKSPACE_WRITE' | 'SYSTEM_COMMAND' | 'NETWORK_ACCESS';

// ==========================================
// Centralized Error Codes
// ==========================================
export type ErrorCode =
  | 'INVALID_REQUEST'
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_API_CREDENTIALS'
  | 'MODEL_NOT_FOUND'
  | 'RATE_LIMIT_EXHAUSTED'
  | 'NETWORK_FAILURE'
  | 'TIMEOUT_OR_CANCELLED'
  | 'TOOL_EXECUTION_FAILED'
  | 'PATH_TRAVERSAL_BLOCKED'
  | 'STORAGE_PERSISTENCE_FAILED'
  | 'INVALID_MODEL_RESPONSE'
  | 'PLANNING_OR_EXECUTION_FAILED'
  | 'VERIFICATION_FAILED'
  | 'REPAIR_FAILED'
  | 'CIRCUIT_BREAKER_OPEN'
  | 'INTERNAL_SERVER_ERROR'
  | 'SERVICE_UNAVAILABLE';

export interface ApiErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    correlationId: string;
    statusCode: number;
    timestamp: number;
    isTransient: boolean;
    details?: Record<string, unknown>;
  };
}

// ==========================================
// Model Providers
// ==========================================
export interface ModelMessage {
  role: 'user' | 'model' | 'system';
  content: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

export interface ModelGenerationConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  systemInstruction?: string;
  responseMimeType?: 'text/plain' | 'application/json';
  tools?: ModelToolDeclaration[];
}

export interface ModelToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ModelToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ModelGenerationResult {
  text: string;
  toolCalls?: ModelToolCall[];
  provider: ModelProviderType;
  model: string;
  latencyMs: number;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  isSimulated: boolean;
  costEstimateUSD: 0; // Strictly $0.00 under zero-budget constraints
  rawResponseMeta?: Record<string, unknown>;
}

export interface ModelProviderInfo {
  id: ModelProviderType;
  name: string;
  modelIdentifier: string;
  isAvailable: boolean;
  isConfigured: boolean;
  supportsFunctionCalling: boolean;
  supportsStreaming: boolean;
  license: string;
  freeTierStatus: {
    isFree: boolean;
    quotaNotes: string;
    rateLimitNotes: string;
  };
  statusMessage: string;
}

// ==========================================
// Tool Sandbox & Execution
// ==========================================
export interface ToolDefinition {
  name: string;
  description: string;
  permissionLevel: ToolPermissionLevel;
  parametersSchema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
      items?: Record<string, unknown>;
    }>;
    required: string[];
  };
  execute: (args: Record<string, any>, context: ExecutionContext) => Promise<ToolExecutionResult>;
}

export interface ToolExecutionResult {
  success: boolean;
  output: any;
  error?: string;
  durationMs: number;
  permissionUsed: ToolPermissionLevel;
  auditRecord: {
    timestamp: number;
    sanitizedArgs: Record<string, any>;
  };
}

export interface ExecutionContext {
  taskId?: string;
  sessionId?: string;
  workspaceRoot: string;
  dryRun?: boolean;
  permissionGrant: ToolPermissionLevel[];
  abortSignal?: AbortSignal;
}

// ==========================================
// Tasks & Planning
// ==========================================
export interface TaskStep {
  id: string;
  title: string;
  description: string;
  dependencies: string[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped' | 'repaired';
  assignedTool?: string;
  toolArgs?: Record<string, any>;
  toolResult?: ToolExecutionResult;
  verificationCriteria: string;
  verificationPassed?: boolean;
  verificationNotes?: string;
  error?: string;
  repairAttempts: number;
  output?: string;
}

export interface TaskPlan {
  id: string;
  objective: string;
  constraints: string[];
  steps: TaskStep[];
  status: 'planned' | 'executing' | 'completed' | 'failed' | 'partially_completed';
  createdAt: number;
  updatedAt: number;
  summary?: string;
  iterationLimit: number;
  currentIteration: number;
  checkpointId?: string;
}

export interface VerificationCheck {
  criterion: string;
  passed: boolean;
  reason: string;
  severity: 'blocker' | 'warning' | 'info';
}

export interface VerificationReport {
  overallPassed: boolean;
  score: number; // 0 to 100
  checks: VerificationCheck[];
  truthfulnessConfirmed: boolean;
  unverifiedClaims: string[];
  recommendation: 'accept' | 'repair' | 'reject';
}

// ==========================================
// Memory & Storage Collections
// ==========================================
export type MemoryCategory =
  | 'preference'
  | 'project_fact'
  | 'checkpoint'
  | 'conversation'
  | 'benchmark'
  | 'diagnostic'
  | 'repair_audit';

export interface MemoryItem {
  id: string;
  key: string;
  content: string;
  category: MemoryCategory;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  source: 'user_input' | 'verified_tool' | 'engine_checkpoint' | 'diagnostic_system';
  isPersistent: boolean;
}

// ==========================================
// Diagnostics Subsystem
// ==========================================
export type DiagnosticStatus =
  | 'HEALTHY'
  | 'DEGRADED'
  | 'REPAIRABLE'
  | 'REPAIRING'
  | 'REPAIRED_AND_VERIFIED'
  | 'REPAIR_FAILED'
  | 'NEEDS_AUTHORIZED_INTERVENTION';

export type DiagnosticSubsystem =
  | 'server_api'
  | 'provider_health'
  | 'tool_registry'
  | 'filesystem_sandbox'
  | 'storage_integrity'
  | 'project_manifest'
  | 'syntax_integrity'
  | 'task_executor'
  | 'upgrade_registry'
  | 'budget_enforcement';

export interface DiagnosticFinding {
  id: string;
  subsystem: DiagnosticSubsystem;
  severity: 'blocker' | 'warning' | 'info';
  title: string;
  evidence: string;
  suspectedRootCause?: string;
  isRepairable: boolean;
  suggestedRemediation?: string;
}

export interface DiagnosticReport {
  runId: string;
  timestamp: number;
  targetSystem: string;
  version: string;
  overallStatus: DiagnosticStatus;
  checksPerformedCount: number;
  findings: DiagnosticFinding[];
  remediationPlan?: {
    recommendedAction: string;
    canAutoRepair: boolean;
    requiredPermissions: ToolPermissionLevel[];
  };
  durationMs: number;
}

// ==========================================
// Autonomous Self-Repair Subsystem
// ==========================================
export interface RepairActionLog {
  step: string;
  timestamp: number;
  status: 'passed' | 'failed' | 'skipped';
  details: string;
}

export interface SelfRepairResult {
  repairId: string;
  findingId: string;
  targetSubsystem: DiagnosticSubsystem;
  status: 'REPAIRED_AND_VERIFIED' | 'REPAIR_FAILED' | 'NEEDS_AUTHORIZED_INTERVENTION' | 'ROLLED_BACK';
  checkpointId?: string;
  actionsTaken: RepairActionLog[];
  preRepairEvidence: string;
  postRepairVerification: {
    verified: boolean;
    verificationDetails: string;
    testRunResults?: { passed: number; failed: number };
  };
  rollbackPerformed: boolean;
  durationMs: number;
}

// ==========================================
// Checkpoints & Self-Build
// ==========================================
export interface WorkspaceCheckpoint {
  id: string;
  name: string;
  createdAt: number;
  files: Record<string, string>; // path -> content snapshot
  metadata: Record<string, any>;
}

export interface ProjectBuildPlan {
  id: string;
  goal: string;
  targetFiles: string[];
  checkpointId: string;
  phases: Array<{
    name: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    details?: string;
  }>;
  status: 'planned' | 'executing' | 'completed' | 'failed' | 'rolled_back';
  diffs?: Array<{ file: string; changes: string }>;
}

// ==========================================
// Assistant Foundation (RARE-THE-SIXTH)
// ==========================================
export interface ResearchFinding {
  query: string;
  decomposedQuestions: string[];
  verifiedFacts: Array<{ source: string; content: string; reliability: 'high' | 'medium' }>;
  hypotheses: string[];
  contradictionsDetected: string[];
  summary: string;
}

export interface DocumentChunk {
  chunkIndex: number;
  content: string;
  charStart: number;
  charEnd: number;
  estimatedTokens: number;
}

export interface ExtractedDocumentData {
  filename: string;
  format: 'text' | 'markdown' | 'json' | 'csv' | 'pdf' | 'docx' | 'unknown';
  lineCount: number;
  summary: string;
  tables?: Array<{ headers: string[]; rows: string[][] }>;
  chunks?: DocumentChunk[];
  isScannedOrEncrypted?: boolean;
  requiresOcr?: boolean;
  metadata: Record<string, any>;
}

// ==========================================
// Benchmarks & Upgrades
// ==========================================
export interface BenchmarkTask {
  id: string;
  domain: 'reasoning' | 'coding' | 'math' | 'research';
  name: string;
  prompt: string;
  expectedKeywords: string[];
  validationFunction?: (output: string) => boolean;
  maxLatencyTargetMs: number;
}

export interface BenchmarkResult {
  taskId: string;
  domain: string;
  modelIdentifier: string;
  provider: ModelProviderType;
  passed: boolean;
  score: number; // 0 - 100
  latencyMs: number;
  outputExcerpt: string;
  evaluationNotes: string;
  timestamp: number;
}

export interface CapabilityUpgradeCandidate {
  version: string;
  modelIdentifier: string;
  provider: ModelProviderType;
  description: string;
  license: string;
  freeTierVerified: boolean;
  benchmarkScore: number;
  status: 'candidate' | 'canary_testing' | 'active' | 'rolled_back' | 'rejected';
  reasons: string[];
  evaluatedAt: number;
  approvedBy?: string;
}

export type EngineOperationalState =
  | 'STARTING'
  | 'ONLINE'
  | 'OFFLINE'
  | 'DEGRADED'
  | 'LOCAL_AI_AVAILABLE'
  | 'ONLINE_AI_AVAILABLE'
  | 'NO_AI_PROVIDER_AVAILABLE'
  | 'RECOVERING';

export type TaskNetworkDependency = 'local_only' | 'online_preferred' | 'online_required';

export interface HardwareResourceSummary {
  platform: string;
  arch: string;
  totalMemMB: number;
  freeMemMB: number;
  cpuCount: number;
  freeDiskMB: number;
  totalDiskMB: number;
  storageDurability: 'persistent_filesystem' | 'ephemeral_sandbox';
  recommendedMaxModelParam: string;
  deviceTarget: 'cloud_preview' | 'desktop' | 'mobile_android';
  notes: string;
}

export interface LocalInstalledModel {
  name: string;
  sizeBytes?: number;
  format?: string;
  modifiedAt?: number;
  paramSize?: string;
  contextWindowLimit?: number;
  quantization?: string;
}

export interface LocalRuntimeInfo {
  runtimeType: 'ollama' | 'llama_cpp' | 'custom_local';
  endpointUrl: string;
  isReachable: boolean;
  activeModel: string;
  installedModels: LocalInstalledModel[];
  hardwareResources: HardwareResourceSummary;
  statusMessage: string;
}

export interface ModelCompatibilityAssessment {
  modelName: string;
  paramSize: string;
  estimatedRamMB: number;
  estimatedDiskMB: number;
  contextWindowLimit: number;
  quantization: string;
  isCompatibleWithHost: boolean;
  isCompatibleWithTargetPhone: boolean;
  readinessStatus: 'ready_installed' | 'requires_download' | 'hardware_insufficient';
  recommendationNotes: string;
}

export type ModelSetupStage =
  | 'idle'
  | 'checking_storage'
  | 'downloading'
  | 'verifying_integrity'
  | 'ready'
  | 'failed'
  | 'cancelled';

export interface ModelSetupProgress {
  modelName: string;
  stage: ModelSetupStage;
  progressPercent: number;
  downloadedBytes: number;
  totalBytes: number;
  statusMessage: string;
  updatedAt: number;
  error?: string;
}

export interface TaskProviderRequirements {
  requiresNetwork?: boolean;
  requiresFunctionCalling?: boolean;
  requiresStreaming?: boolean;
  preferredType?: 'local' | 'online' | 'deterministic' | 'diagnostic';
  taskType?: 'inference' | 'tool_execution' | 'diagnostic';
}

export interface ProviderSelectionDecision {
  selectedProviderId: ModelProviderType;
  providerName: string;
  reason: string;
  isLocal: boolean;
  isOnline: boolean;
  isSimulated: boolean;
  candidatesEvaluated: Array<{
    id: ModelProviderType;
    eligible: boolean;
    rejectionReason?: string;
  }>;
}

export interface ConversationSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ModelMessage[];
  metadata?: Record<string, any>;
}

export interface OperationalStateReport {
  engineStarted: boolean;
  localStorageAvailable: boolean;
  localModelAvailable: boolean;
  onlineProviderAvailable: boolean;
  fullRequestedCapabilityAvailable: boolean;
  offlineCapabilities: string[];
  networkDependentCapabilities: string[];
  summaryMessage: string;
}

export interface PersistentQueuedTask {
  taskId: string;
  objective: string;
  networkDependency: TaskNetworkDependency;
  status: 'pending' | 'running' | 'paused_waiting_network' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  updatedAt: number;
  resumable: boolean;
  executedStepIds: string[];
  executionAttempts: number;
  idempotencyToken: string;
  lastCheckpointId?: string;
  plan?: TaskPlan;
  error?: string;
}

export interface EngineInitializationResult {
  initializedAt: number;
  operationalState: EngineOperationalState;
  operationalReport: OperationalStateReport;
  storageReady: boolean;
  storageType: string;
  localRuntimeReady: boolean;
  onlineProvidersReady: boolean;
  capabilities: {
    offlineToolsCount: number;
    onlineToolsCount: number;
    activeProviderId: ModelProviderType;
  };
}

export interface EngineHealthStatus {
  status: 'healthy' | 'degraded' | 'offline';
  operationalState: EngineOperationalState;
  operationalReport?: OperationalStateReport;
  isOnline: boolean;
  version: string;
  uptimeSeconds: number;
  activeProvider: ModelProviderType;
  availableProviders: ModelProviderInfo[];
  localRuntime?: LocalRuntimeInfo;
  memoryStorageType: 'file-backed-persistent' | 'in-memory-volatile';
  memoryItemsCount: number;
  registeredToolsCount: number;
  lastBenchmarkScore?: number;
  zeroBudgetPolicyEnforced: boolean;
  queuedTasksCount?: {
    total: number;
    pending: number;
    running?: number;
    paused: number;
    completed: number;
    failed?: number;
  };
}
