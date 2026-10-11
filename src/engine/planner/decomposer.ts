/**
 * RARE-INTELLIGENCE — Task Planner & Decomposer
 * Analyzes objectives, identifies constraints, and builds executable step graphs.
 */

import { TaskPlan, TaskStep } from '../types.js';

export class TaskDecomposer {
  /**
   * Decomposes a high-level objective into structured steps with assigned tools and verification criteria.
   */
  public decomposeObjective(objective: string, constraints: string[] = []): TaskPlan {
    const planId = 'plan_' + Math.random().toString(36).substring(2, 9);
    const lower = objective.toLowerCase();

    const steps: TaskStep[] = [];

    // Step 1: Inspection & Environment Analysis
    steps.push({
      id: 'step_1_inspect',
      title: 'Inspect Project & Runtime Context',
      description: 'Check active environment, available tools, and read relevant workspace state.',
      dependencies: [],
      status: 'pending',
      assignedTool: 'system_status',
      toolArgs: {},
      verificationCriteria: 'Runtime metrics and security perimeter verified.',
      repairAttempts: 0,
    });

    // Step 2: Domain-specific execution step
    if (lower.includes('code') || lower.includes('file') || lower.includes('build') || lower.includes('project')) {
      steps.push({
        id: 'step_2_read_manifest',
        title: 'Inspect Target Files or Manifest',
        description: 'Read workspace files to understand structure before applying modifications.',
        dependencies: ['step_1_inspect'],
        status: 'pending',
        assignedTool: 'file_read',
        toolArgs: { path: 'package.json' },
        verificationCriteria: 'File contents retrieved and verified structurally valid.',
        repairAttempts: 0,
      });

      steps.push({
        id: 'step_3_analyze_code',
        title: 'Analyze Structural Integrity',
        description: 'Perform syntax and static analysis on code representation.',
        dependencies: ['step_2_read_manifest'],
        status: 'pending',
        assignedTool: 'code_analyze',
        toolArgs: { code: '{\n  "status": "valid"\n}' },
        verificationCriteria: 'Balanced braces, valid export structures, and zero syntax faults.',
        repairAttempts: 0,
      });
    } else if (lower.includes('math') || lower.includes('calculate') || lower.includes('compute')) {
      steps.push({
        id: 'step_2_compute',
        title: 'Execute Precise Mathematical Evaluation',
        description: 'Run safe AST-based calculator tool without arbitrary code execution.',
        dependencies: ['step_1_inspect'],
        status: 'pending',
        assignedTool: 'calculator_eval',
        toolArgs: { expression: '3.14159265 * 42' },
        verificationCriteria: 'Finite numerical result computed and verified.',
        repairAttempts: 0,
      });
    } else if (lower.includes('research') || lower.includes('retrieve') || lower.includes('search')) {
      steps.push({
        id: 'step_2_research',
        title: 'Information Retrieval & Fact Grounding',
        description: 'Retrieve grounded knowledge items and categorize source veracity.',
        dependencies: ['step_1_inspect'],
        status: 'pending',
        assignedTool: 'web_grounding',
        toolArgs: { query: objective },
        verificationCriteria: 'Retrieved items classified into verified facts vs hypotheses.',
        repairAttempts: 0,
      });
    } else {
      // General intelligence task
      steps.push({
        id: 'step_2_execute_task',
        title: 'Execute Core Objective Logic',
        description: 'Synthesize solution according to user constraints and verifiable evidence.',
        dependencies: ['step_1_inspect'],
        status: 'pending',
        verificationCriteria: 'Constraints satisfied with zero unverified assertions.',
        repairAttempts: 0,
      });
    }

    // Final Step: Verification & Truthful Audit
    steps.push({
      id: 'step_final_verify',
      title: 'Verify Results & Synthesize Truthful Report',
      description: 'Audit output against non-negotiable zero-budget constraints and check for incomplete work.',
      dependencies: steps.map((s) => s.id),
      status: 'pending',
      verificationCriteria: 'All dependencies completed, no fabricated assertions, zero incurred cost.',
      repairAttempts: 0,
    });

    return {
      id: planId,
      objective,
      constraints: [
        'Zero budget ($0.00) enforced',
        'Truthful reporting only; no fabricated results',
        'Bounded iteration limit',
        ...constraints,
      ],
      steps,
      status: 'planned',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      iterationLimit: 10,
      currentIteration: 0,
    };
  }
}
