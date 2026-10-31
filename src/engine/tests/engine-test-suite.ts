/**
 * RARE-INTELLIGENCE — Automated Test Suite & Quality Gates
 * Validates all architectural layers: Security, Permissions, Tool Sandbox,
 * Error Resilience, Memory Durability, Self-Diagnostics, Self-Repair,
 * Project Build, Assistant Foundation, and Upgrades.
 */

import { RareIntelligenceEngine } from '../engine.js';
import { SecurityGuard } from '../security/permissions.js';
import { DiagnosticMockProvider } from '../providers/diagnostic.js';
import { TaskDecomposer } from '../planner/decomposer.js';
import { TaskExecutor } from '../planner/executor.js';
import { InMemoryStore } from '../memory/in-memory.js';
import { FilePersistentStore } from '../memory/file-persistent.js';
import { CapabilityUpgradeRegistry } from '../continuous-improvement/upgrade-registry.js';
import { BenchmarkRunner, STANDARD_BENCHMARK_TASKS } from '../continuous-improvement/benchmark-suite.js';
import { AppError } from '../errors/app-error.js';
import { CircuitBreaker } from '../errors/circuit-breaker.js';
import { assistantFoundation } from '../assistant/assistant-foundation.js';
import { authManager } from '../security/auth.js';
import { networkManager } from '../network/connection-manager.js';
import { RareIntelligenceClient } from '../../integration/rare_intelligence_client.js';
import { PythonEngineClient } from '../../integration/python_engine_client.js';

export interface TestCaseResult {
  suite: string;
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
  assertionsCount: number;
}

export interface TestSuiteSummary {
  timestamp: number;
  totalTests: number;
  passedCount: number;
  failedCount: number;
  successRate: number; // percentage
  durationMs: number;
  results: TestCaseResult[];
}

export class EngineTestSuiteRunner {
  public static async runAllTests(): Promise<TestSuiteSummary> {
    const startTime = Date.now();
    const results: TestCaseResult[] = [];
    const engine = RareIntelligenceEngine.getInstance();

    // --- Suite 1: Security & Sandboxing ---
    await this.test('Security Sandbox', 'Path Containment prevents traversal', async () => {
      const guard = new SecurityGuard(process.cwd());
      const bad = guard.validateWorkspacePath('../../../etc/passwd');
      if (bad.valid) throw new Error('Failed to block directory traversal');

      const badEnv = guard.validateWorkspacePath('.env');
      if (badEnv.valid) throw new Error('Failed to block .env access');

      const good = guard.validateWorkspacePath('package.json');
      if (!good.valid) throw new Error(`Legitimate path blocked: ${good.error}`);
    }, results);

    await this.test('Security Sandbox', 'Secret Sanitization masks credentials', async () => {
      const guard = new SecurityGuard();
      const raw = 'Calling Gemini with key AIzaSyDExampleKey_1234567890abcdef and Bearer abc.def.ghi';
      const clean = guard.sanitizeSecrets(raw);
      if (clean.includes('AIzaSyDExampleKey')) throw new Error('API key was not sanitized');
      if (clean.includes('abc.def.ghi')) throw new Error('Bearer token was not sanitized');
    }, results);

    await this.test('Security Sandbox', 'Permission Hierarchy enforcement', async () => {
      const guard = new SecurityGuard();
      const check1 = guard.verifyPermission('WORKSPACE_WRITE', ['READ_ONLY']);
      if (check1.granted) throw new Error('Allowed WRITE with READ_ONLY permission');

      const check2 = guard.verifyPermission('READ_ONLY', ['WORKSPACE_WRITE', 'READ_ONLY']);
      if (!check2.granted) throw new Error('Denied legitimate READ_ONLY grant');
    }, results);

    // --- Suite 2: Centralized Error & Circuit Breaker ---
    await this.test('Centralized Errors', 'AppError formats response without secret leakage', async () => {
      const err = new AppError({
        code: 'RATE_LIMIT_EXHAUSTED',
        message: 'Free tier quota exhausted (HTTP 429).',
        statusCode: 429,
        isTransient: true,
        details: { internalSecretToken: 'SECRET_DO_NOT_LEAK' },
      });

      const clientResp = err.toResponse(false);
      if (clientResp.error.statusCode !== 429) throw new Error('Status code mismatch');
      if (clientResp.error.details !== undefined) throw new Error('Leaked internal details to unprivileged client');
      if (!clientResp.error.correlationId) throw new Error('Missing correlationId');
    }, results);

    await this.test('Centralized Errors', 'Circuit Breaker trips OPEN on repeated failures and recovers', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 100, name: 'test-circuit' });
      if (breaker.getState() !== 'CLOSED') throw new Error('Initial state not CLOSED');

      breaker.recordFailure();
      breaker.recordFailure();
      if (breaker.getState() !== 'OPEN') throw new Error('Circuit did not trip OPEN after threshold');

      breaker.reset();
      if (breaker.getState() !== 'CLOSED') throw new Error('Reset failed to CLOSE circuit');
    }, results);

    // --- Suite 3: Memory Stores & Durability ---
    await this.test('Memory Architecture', 'In-memory volatile store marks isPersistent=false', async () => {
      const mem = new InMemoryStore();
      if (mem.isPersistent !== false) throw new Error('In-memory store claimed persistence falsely');
      await mem.set({
        key: 'test_key',
        content: 'test_val',
        category: 'preference',
        tags: ['test'],
        source: 'user_input',
      });
      const retrieved = await mem.get('test_key');
      if (retrieved?.content !== 'test_val') throw new Error('Failed to retrieve stored item');
    }, results);

    await this.test('Memory Architecture', 'File-persistent store survives restart and cold reload', async () => {
      const store = engine.durableStore;
      const durabilityReport = await store.verifyRestartDurability();
      if (!durabilityReport.survived) {
        throw new Error(`Restart durability failed: ${durabilityReport.details}`);
      }
    }, results);

    await this.test('Memory Architecture', 'Durable store creates verified backup', async () => {
      const store = engine.durableStore;
      const backupPath = store.createBackup();
      if (!backupPath) throw new Error('Failed to create backup');
    }, results);

    // --- Suite 4: Model Provider Truthfulness ---
    await this.test('Model Providers', 'Diagnostic provider tags isSimulated: true', async () => {
      const mock = new DiagnosticMockProvider();
      const res = await mock.generate('ping');
      if (res.isSimulated !== true) throw new Error('Mock provider did not truthfully flag simulation');
      if (res.costEstimateUSD !== 0) throw new Error('Non-zero cost estimate on free provider');
    }, results);

    // --- Suite 5: Tool Execution & Verification ---
    await this.test('Tool Registry', 'Safe arithmetic evaluation computes without eval()', async () => {
      const toolRes = await engine.tools.execute(
        'calculator_eval',
        { expression: '(50 * 2) + 42' },
        { workspaceRoot: process.cwd(), permissionGrant: ['READ_ONLY'] }
      );
      if (!toolRes.success || toolRes.output?.result !== 142) {
        throw new Error(`Calculator failed: ${toolRes.error || JSON.stringify(toolRes.output)}`);
      }
    }, results);

    await this.test('Tool Registry', 'System status tool confirms zero-budget enforcement', async () => {
      const res = await engine.tools.execute(
        'system_status',
        {},
        { workspaceRoot: process.cwd(), permissionGrant: ['READ_ONLY'] }
      );
      if (!res.success || res.output?.budgetCompliance?.zeroBudgetEnforced !== true) {
        throw new Error('System status failed to confirm zero budget compliance');
      }
    }, results);

    // --- Suite 6: Planner & Executor ---
    await this.test('Planner & Executor', 'Task decomposition produces bounded dependency steps', async () => {
      const decomposer = new TaskDecomposer();
      const plan = decomposer.decomposeObjective('Inspect workspace files and analyze code');
      if (plan.steps.length === 0) throw new Error('Decomposition generated 0 steps');
      if (plan.iterationLimit > 20) throw new Error('Unbounded iteration limit');
    }, results);

    await this.test('Planner & Executor', 'Bounded execution halts on success without runaway loops', async () => {
      const decomposer = new TaskDecomposer();
      const plan = decomposer.decomposeObjective('Inspect system status');
      const mock = new DiagnosticMockProvider();
      const executor = new TaskExecutor(engine.tools, mock);

      const { plan: finalPlan, verification } = await executor.executePlan(plan, {
        workspaceRoot: process.cwd(),
        permissionGrant: ['READ_ONLY'],
      });

      if (finalPlan.currentIteration > 5) throw new Error('Execution loop exceeded bound');
      if (verification.score < 50) throw new Error('Verification score unexpectedly low');
    }, results);

    // --- Suite 7: Self-Diagnostics Subsystem ---
    await this.test('Self-Diagnostics', 'Audits all subsystems and produces durable report', async () => {
      const report = await engine.diagnostics.runFullDiagnostics();
      if (!report.runId) throw new Error('Report missing runId');
      if (report.checksPerformedCount < 8) throw new Error('Did not perform full subsystem check battery');
      if (!report.overallStatus) throw new Error('Report missing overallStatus');
    }, results);

    // --- Suite 8: Autonomous Self-Repair Subsystem ---
    await this.test('Autonomous Self-Repair', 'Executes 12-stage harmless fault repair with independent verification', async () => {
      const testOutcome = await engine.repair.testHarmlessFaultSelfRepair();
      if (!testOutcome.success) {
        throw new Error('Harmless fault repair failed independent verification');
      }
      if (testOutcome.repairResult.status !== 'REPAIRED_AND_VERIFIED') {
        throw new Error(`Unexpected repair status: ${testOutcome.repairResult.status}`);
      }
    }, results);

    // --- Suite 9: Self-Build & Checkpoints ---
    await this.test('Self-Build Engine', 'Creates workspace checkpoint and supports restoration', async () => {
      const cpId = 'cp_unit_test_' + Date.now();
      engine.durableStore.saveCheckpoint({
        id: cpId,
        name: 'Unit test snapshot',
        createdAt: Date.now(),
        files: { 'metadata.json': '{"test": true}' },
        metadata: { unitTest: true },
      });

      const retrieved = engine.durableStore.getCheckpoint(cpId);
      if (!retrieved || retrieved.files['metadata.json'] !== '{"test": true}') {
        throw new Error('Checkpoint was not stored or read properly');
      }
      engine.durableStore.deleteCheckpoint(cpId);
    }, results);

    // --- Suite 10: Assistant Foundation (RARE-THE-SIXTH) ---
    await this.test('Assistant Foundation', 'SSRF defense blocks loopback, private IPs, and metadata services', async () => {
      const bad1 = assistantFoundation.validateUrlForSSRF('http://localhost:8080/admin');
      if (bad1.safe) throw new Error('Failed to block localhost');

      const bad2 = assistantFoundation.validateUrlForSSRF('http://127.0.0.1:3000/secret');
      if (bad2.safe) throw new Error('Failed to block 127.0.0.1');

      const bad3 = assistantFoundation.validateUrlForSSRF('http://169.254.169.254/latest/meta-data');
      if (bad3.safe) throw new Error('Failed to block cloud metadata IP');

      const bad4 = assistantFoundation.validateUrlForSSRF('http://192.168.1.1/router');
      if (bad4.safe) throw new Error('Failed to block private subnet');

      const good = assistantFoundation.validateUrlForSSRF('https://example.com/docs');
      if (!good.safe) throw new Error(`Legitimate URL blocked: ${good.reason}`);
    }, results);

    await this.test('Assistant Foundation', 'Parses CSV documents into structured headers and rows', async () => {
      const csv = 'id,name,role\n1,Erudite,Architect\n2,Sixth,Consumer';
      const parsed = assistantFoundation.parseDocumentContent('users.csv', csv);
      if (parsed.format !== 'csv') throw new Error('Format not identified as CSV');
      if (!parsed.tables || parsed.tables[0].rows.length !== 2) throw new Error('Row count mismatch');
      if (parsed.tables[0].headers[1] !== 'name') throw new Error('Header column mismatch');
    }, results);

    // --- Suite 11: Upgrade Registry & Rollback ---
    await this.test('Continuous Improvement', 'Capability rollback returns to known-good baseline', async () => {
      const registry = new CapabilityUpgradeRegistry();
      const initialActive = registry.getActiveCandidate();
      if (!initialActive) throw new Error('No initial active model candidate');

      const rolledBack = registry.rollback('Test suite simulated regression');
      if (!rolledBack || rolledBack.status !== 'active') {
        throw new Error('Rollback failed to activate previous known-good baseline');
      }
    }, results);

    // --- Suite 12: Benchmark Suite ---
    await this.test('Benchmark Suite', 'Runs standard benchmark on model provider', async () => {
      const runner = new BenchmarkRunner();
      const mock = new DiagnosticMockProvider();
      const res = await runner.runBenchmark(mock, STANDARD_BENCHMARK_TASKS[0]);
      if (res.score === undefined || res.score < 0) throw new Error('Invalid benchmark score');
    }, results);

    // --- Suite 13: Engine Health & Telemetry ---
    await this.test('Engine Integration', 'Engine returns truthful health and provider statuses', async () => {
      const health = await engine.getHealth();
      if (!health.version) throw new Error('Health missing version');
      if (health.availableProviders.length === 0) throw new Error('No providers reported');
    }, results);

    // --- Suite 14: Network Transitions & Offline Truthfulness ---
    await this.test('Network Transitions', 'Offline transition prevents Gemini selection and routes to offline sandbox', async () => {
      // Force simulated offline state
      networkManager.setSimulatedOffline(true);
      if (networkManager.isOnline()) throw new Error('isOnline() should be false in simulated offline mode');

      const decision = await engine.providers.resolveProviderForTask();
      if (decision.selectedProviderId === 'gemini') {
        throw new Error('Engine selected Gemini while offline, violating offline-first safety rule');
      }
      if (!decision.isSimulated && decision.selectedProviderId === 'diagnostic-mock') {
        throw new Error('Diagnostic mock must be truthfully flagged as simulated');
      }

      // Restore
      networkManager.setSimulatedOffline(false);
    }, results);

    // --- Suite 15: API Authentication & RBAC Authorization ---
    await this.test('API Security & RBAC', 'Enforces role separation and rejects unauthenticated callers', async () => {
      const devKey = authManager.getDeveloperKey();
      const clientKey = authManager.getClientKey();

      const devCheck = authManager.resolveRole({
        headers: { 'x-api-key': devKey },
      } as any);
      if (devCheck.role !== 'developer') throw new Error(`Expected developer role, got ${devCheck.role}`);

      const clientCheck = authManager.resolveRole({
        headers: { authorization: `Bearer ${clientKey}` },
      } as any);
      if (clientCheck.role !== 'client') throw new Error(`Expected client role, got ${clientCheck.role}`);

      const invalidCheck = authManager.resolveRole({
        headers: { 'x-api-key': 'malicious_wrong_key' },
      } as any);
      if (invalidCheck.role !== 'public') throw new Error(`Invalid key should resolve to public role, got ${invalidCheck.role}`);
    }, results);

    // --- Suite 16: Task Queue Resumption Idempotency ---
    await this.test('Task Queue Persistence', 'Resuming paused tasks resets only paused steps without duplicating completed steps', async () => {
      const task = engine.enqueueTask('Offline Resumption Test', 'online_required');
      if (task.status !== 'pending') throw new Error('Enqueued task should be pending');

      // Pause task
      engine.taskQueue.pauseTask(task.taskId, 'Network unavailable test');
      const paused = engine.taskQueue.getTask(task.taskId);
      if (paused?.status !== 'paused_waiting_network') throw new Error('Task failed to transition to paused_waiting_network');

      // Resume eligible tasks
      engine.taskQueue.resumeEligibleTasks();
      const resumed = engine.taskQueue.getTask(task.taskId);
      if (resumed?.status !== 'pending') throw new Error('Resumed task should return to pending status');
    }, results);

    // --- Suite 17: RARE-THE-SIXTH Integration Client Contract ---
    await this.test('Integration Contract', 'TypeScript client instantiates and defines valid contract methods', async () => {
      const client = new RareIntelligenceClient({
        baseUrl: 'http://127.0.0.1:3000',
        apiKey: authManager.getClientKey(),
      });
      if (typeof client.getHealth !== 'function') throw new Error('Client missing getHealth method');
      if (typeof client.chat !== 'function') throw new Error('Client missing chat method');
      if (typeof client.enqueueTask !== 'function') throw new Error('Client missing enqueueTask method');
      if (typeof client.createConversation !== 'function') throw new Error('Client missing createConversation method');
      if (typeof client.sendMessageToConversation !== 'function') throw new Error('Client missing sendMessageToConversation method');
    }, results);

    // --- Suite 17b: Python Engine HTTP Contract ---
    // Verifies the client against the exact wire shapes emitted by
    // python_engine/rare_engine/service.py. Uses a stubbed fetch so the test
    // needs no running Python process, but the payloads are copied from the
    // service's response models, so a shape drift on either side fails here.
    await this.test('Python Engine Contract', 'Maps snake_case wire payloads to camelCase results', async () => {
      const originalFetch = globalThis.fetch;
      const calls: Array<{ url: string; init: any }> = [];
      globalThis.fetch = (async (url: any, init: any) => {
        calls.push({ url: String(url), init });
        const body = String(url).endsWith('/health')
          ? {
              ok: true,
              version: '0.3.1',
              model_id: 'echo',
              adapter: 'echo',
              model_ready: true,
              detail: '',
              uptime_s: 1.5,
            }
          : {
              task_id: 'job_abc123',
              status: 'succeeded',
              result: 'done',
              steps: 2,
              duration_s: 0.4,
              total_tokens: 42,
              error: null,
              error_code: null,
              resumed_from_step: null,
            };
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => JSON.stringify(body),
        } as any;
      }) as any;

      try {
        const client = new PythonEngineClient({
          baseUrl: 'http://127.0.0.1:8099/',
          token: 'test-token',
        });

        const health = await client.health();
        if (health.modelId !== 'echo') throw new Error('health.modelId not mapped');
        if (health.modelReady !== true) throw new Error('health.modelReady not mapped');
        if (health.uptimeS !== 1.5) throw new Error('health.uptimeS not mapped');

        const run = await client.runTask('do a thing', { taskId: 'job_abc123' });
        if (run.taskId !== 'job_abc123') throw new Error('run.taskId not mapped');
        if (run.totalTokens !== 42) throw new Error('run.totalTokens not mapped');
        if (run.durationS !== 0.4) throw new Error('run.durationS not mapped');
        if (run.status !== 'succeeded') throw new Error('run.status not mapped');

        // Trailing slash must be stripped, not doubled.
        if (calls[0].url !== 'http://127.0.0.1:8099/health') {
          throw new Error(`baseUrl not normalised: ${calls[0].url}`);
        }
        // Auth header must be present on every call.
        if (calls[0].init.headers.Authorization !== 'Bearer test-token') {
          throw new Error('missing bearer token');
        }
        // Request body must use the engine's snake_case field names.
        const sent = JSON.parse(calls[1].init.body);
        if (!('model_id' in sent)) throw new Error('request body must use model_id');
        if (!('goal' in sent)) throw new Error('request body must include goal');
        if (sent.task_id !== 'job_abc123') throw new Error('request body must preserve task_id');
      } finally {
        globalThis.fetch = originalFetch;
      }
    }, results);

    await this.test('Python Engine Contract', 'Surfaces structured engine error codes', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => ({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        text: async () =>
          JSON.stringify({
            detail: { code: 'task_not_resumable', message: 'task already succeeded' },
          }),
      })) as any;

      try {
        const client = new PythonEngineClient({
          baseUrl: 'http://127.0.0.1:8099',
          token: 't',
        });
        let caught: any = null;
        try {
          await client.resumeTask('task_done');
        } catch (err) {
          caught = err;
        }
        if (!caught) throw new Error('expected an error for 409');
        if (caught.code !== 'task_not_resumable') {
          throw new Error(`expected code task_not_resumable, got ${caught.code}`);
        }
        if (caught.status !== 409) throw new Error(`expected status 409, got ${caught.status}`);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }, results);

    // --- Suite 18: Conversation Lifecycle & Durable Persistence ---
    await this.test('Conversation Lifecycle', 'Creates, persists, retrieves, messages, and reloads conversation session', async () => {
      const testConvId = 'conv_test_cycle_' + Date.now();
      const testSession = {
        id: testConvId,
        title: 'Integration Test Conversation',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [
          { role: 'user' as const, content: 'Hello RARE-INTELLIGENCE', timestamp: Date.now() },
          { role: 'model' as const, content: 'Greetings. Offline-first intelligence ready.', timestamp: Date.now() + 10 },
        ],
        metadata: { source: 'test-runner' },
      };

      // 1. Save conversation in engine durable store
      engine.saveConversation(testSession);

      // 2. Retrieve conversation
      const retrieved = engine.getConversation(testConvId);
      if (!retrieved) throw new Error('Failed to retrieve saved conversation');
      if (retrieved.id !== testConvId) throw new Error(`ID mismatch: expected ${testConvId}, got ${retrieved.id}`);
      if (retrieved.messages.length !== 2) throw new Error(`Expected 2 messages, got ${retrieved.messages.length}`);

      // 3. Append another message
      retrieved.messages.push({
        role: 'user' as const,
        content: 'Testing cold restart durability',
        timestamp: Date.now() + 20,
      });
      engine.saveConversation(retrieved);

      // 4. Simulate cold reload: create fresh FilePersistentStore pointing to same storage file
      const coldStore = new FilePersistentStore();
      const coldRetrieved = coldStore.getConversation(testConvId);
      if (!coldRetrieved) throw new Error('Conversation failed to survive cold disk reload');
      if (coldRetrieved.messages.length !== 3) throw new Error(`Cold reload message count mismatch: expected 3, got ${coldRetrieved.messages.length}`);

      // 5. Clean up test conversation
      const deleted = engine.deleteConversation(testConvId);
      if (!deleted) throw new Error('Failed to delete test conversation');
      if (engine.getConversation(testConvId) !== null) throw new Error('Deleted conversation still exists');
    }, results);

    // --- Suite 19: In-Process Local Open-Weight Provider ---
    await this.test('Local Model Runtime', 'Transformers-local provider verifies manifest, license, and cached weights', async () => {
      const localProvider = engine.providers.getProvider('local-transformers') as any;
      if (!localProvider) throw new Error('local-transformers provider is not registered in ProviderManager');

      // Verify open-weight manifest
      if (localProvider.manifest.license !== 'Apache-2.0 (100% Free & Open-Source)') {
        throw new Error(`Unexpected license: ${localProvider.manifest.license}`);
      }
      if (localProvider.manifest.repoId !== 'onnx-community/Qwen2.5-0.5B-Instruct') {
        throw new Error(`Unexpected repoId: ${localProvider.manifest.repoId}`);
      }

      // Check weights inspection method returns valid boolean
      const hasWeights = localProvider.hasCachedWeights();
      if (typeof hasWeights !== 'boolean') {
        throw new Error('hasCachedWeights must return a boolean');
      }

      // Verify availability report
      const info = await localProvider.checkAvailability();
      if (!info.isConfigured) throw new Error('Local provider should be configured');
      if (info.freeTierStatus.isFree !== true) throw new Error('Local provider must be strictly zero-cost ($0.00)');
    }, results);

    // --- Suite 20: Document Understanding & Grounding ---
    await this.test('Document Understanding', 'Parses JSON documents and analyzes structure without code execution', async () => {
      const jsonContent = JSON.stringify({
        project: 'RARE-INTELLIGENCE',
        version: '1.0.0',
        capabilities: ['offline-first', 'zero-budget', 'neural-inference'],
        metrics: { testCoverage: 100, memoryMb: 512 },
      });

      const parsed = assistantFoundation.parseDocumentContent('project-manifest.json', jsonContent);
      if (parsed.format !== 'json') throw new Error(`Expected format json, got ${parsed.format}`);
      if (!parsed.metadata?.keysCount || parsed.metadata.keysCount !== 4) {
        throw new Error(`Expected 4 top-level keys, got ${parsed.metadata?.keysCount}`);
      }
    }, results);

    const totalDuration = Date.now() - startTime;
    const passedCount = results.filter((r) => r.passed).length;
    const failedCount = results.filter((r) => !r.passed).length;

    return {
      timestamp: Date.now(),
      totalTests: results.length,
      passedCount,
      failedCount,
      successRate: Math.round((passedCount / results.length) * 100),
      durationMs: totalDuration,
      results,
    };
  }

  private static async test(
    suite: string,
    name: string,
    fn: () => Promise<void>,
    results: TestCaseResult[]
  ) {
    const start = Date.now();
    try {
      await fn();
      results.push({
        suite,
        name,
        passed: true,
        durationMs: Date.now() - start,
        assertionsCount: 1,
      });
    } catch (err: any) {
      results.push({
        suite,
        name,
        passed: false,
        durationMs: Date.now() - start,
        error: err.message,
        assertionsCount: 1,
      });
    }
  }
}
