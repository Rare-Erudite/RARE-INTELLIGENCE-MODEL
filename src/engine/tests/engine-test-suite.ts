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
