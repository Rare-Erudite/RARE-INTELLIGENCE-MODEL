/**
 * RARE-INTELLIGENCE — Benchmark Suite
 * Standardized test battery evaluating Reasoning, Coding, Math, and Research.
 */

import { BenchmarkResult, BenchmarkTask } from '../types.js';
import { IModelProvider } from '../providers/base.js';
import { logger } from '../security/logger.js';

export const STANDARD_BENCHMARK_TASKS: BenchmarkTask[] = [
  {
    id: 'bench_reason_01',
    domain: 'reasoning',
    name: 'Multi-Step Constraint Deduction',
    prompt:
      'Three tasks A, B, and C must be ordered. Task B must be after Task A. Task C cannot be first. What are the valid orderings?',
    expectedKeywords: ['a, b, c', 'a, c, b', 'valid', 'order'],
    maxLatencyTargetMs: 4000,
  },
  {
    id: 'bench_code_01',
    domain: 'coding',
    name: 'TypeScript Safe Path Validator',
    prompt:
      'Write a concise TypeScript function "isPathContained(base: string, target: string): boolean" that prevents directory traversal without external libraries.',
    expectedKeywords: ['path.resolve', 'relative', 'startswith', 'boolean'],
    maxLatencyTargetMs: 5000,
  },
  {
    id: 'bench_math_01',
    domain: 'math',
    name: 'Precision Arithmetic & Logic',
    prompt:
      'If a server handles 15 requests per minute with a strict rate limit of 1500 requests per day, how many hours of continuous peak traffic can it sustain before hitting the daily quota?',
    expectedKeywords: ['100', 'minutes', '1.67', '1 hour 40 minutes', '1500'],
    maxLatencyTargetMs: 3500,
  },
  {
    id: 'bench_research_01',
    domain: 'research',
    name: 'Grounding & Veracity Classification',
    prompt:
      'Explain the difference between a verified factual source and a model-generated hypothesis in autonomous AI systems.',
    expectedKeywords: ['verified', 'hypothesis', 'grounding', 'audit', 'veracity'],
    maxLatencyTargetMs: 4000,
  },
];

export class BenchmarkRunner {
  public async runBenchmark(
    provider: IModelProvider,
    task: BenchmarkTask
  ): Promise<BenchmarkResult> {
    const startTime = Date.now();
    logger.info('BenchmarkRunner', `Running benchmark "${task.name}" on ${provider.name}`);

    try {
      const result = await provider.generate(task.prompt, {
        temperature: 0.1,
        maxOutputTokens: 400,
      });

      const latencyMs = result.latencyMs || Date.now() - startTime;
      const lower = result.text.toLowerCase();

      // Keyword evaluation
      const matchedKeywords = task.expectedKeywords.filter((kw) => lower.includes(kw.toLowerCase()));
      const keywordRatio = matchedKeywords.length / task.expectedKeywords.length;

      // Latency bonus / penalty
      const latencyPassed = latencyMs <= task.maxLatencyTargetMs * 1.5;

      const score = Math.round(keywordRatio * 85 + (latencyPassed ? 15 : 0));
      const passed = score >= 50;

      return {
        taskId: task.id,
        domain: task.domain,
        modelIdentifier: provider.modelIdentifier,
        provider: provider.id,
        passed,
        score,
        latencyMs,
        outputExcerpt: result.text.slice(0, 180) + (result.text.length > 180 ? '...' : ''),
        evaluationNotes: `Matched keywords: [${matchedKeywords.join(', ')}] (${Math.round(keywordRatio * 100)}%). Latency: ${latencyMs}ms.`,
        timestamp: Date.now(),
      };
    } catch (err: any) {
      return {
        taskId: task.id,
        domain: task.domain,
        modelIdentifier: provider.modelIdentifier,
        provider: provider.id,
        passed: false,
        score: 0,
        latencyMs: Date.now() - startTime,
        outputExcerpt: '',
        evaluationNotes: `Benchmark execution failed: ${err.message}`,
        timestamp: Date.now(),
      };
    }
  }

  public async runFullSuite(provider: IModelProvider): Promise<{
    results: BenchmarkResult[];
    overallScore: number;
    passedRatio: string;
  }> {
    const results: BenchmarkResult[] = [];
    for (const task of STANDARD_BENCHMARK_TASKS) {
      const res = await this.runBenchmark(provider, task);
      results.push(res);
    }

    const totalScore = results.reduce((acc, r) => acc + r.score, 0);
    const overallScore = Math.round(totalScore / results.length);
    const passedCount = results.filter((r) => r.passed).length;

    return {
      results,
      overallScore,
      passedRatio: `${passedCount}/${results.length}`,
    };
  }
}
