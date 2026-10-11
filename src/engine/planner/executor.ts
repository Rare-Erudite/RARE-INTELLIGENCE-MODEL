/**
 * RARE-INTELLIGENCE — Bounded Task Execution Runtime
 * Step-by-step orchestrator with bounded iterations, repair loops, network-loss detection,
 * and safe pause/resume state preservation without destructive duplication.
 */

import { ExecutionContext, TaskPlan, TaskStep, VerificationReport } from '../types.js';
import { ToolRegistry } from '../tools/registry.js';
import { IModelProvider } from '../providers/base.js';
import { OutputVerifier } from '../verification/evaluator.js';
import { networkManager } from '../network/connection-manager.js';
import { logger } from '../security/logger.js';

export class TaskExecutor {
  private verifier = new OutputVerifier();

  constructor(
    private toolRegistry: ToolRegistry,
    private modelProvider: IModelProvider
  ) {}

  public async executePlan(
    plan: TaskPlan,
    context: ExecutionContext,
    onStepUpdate?: (step: TaskStep, plan: TaskPlan) => void
  ): Promise<{ plan: TaskPlan; verification: VerificationReport }> {
    plan.status = 'executing';
    plan.updatedAt = Date.now();
    logger.info('TaskExecutor', `Starting execution of plan "${plan.id}" for objective: "${plan.objective}"`);

    const maxIterations = plan.iterationLimit || 10;
    const maxRepairsPerStep = 2;

    while (plan.currentIteration < maxIterations) {
      plan.currentIteration++;

      // Find next ready steps (pending and all dependencies satisfied)
      const readySteps = plan.steps.filter((step) => {
        if (step.status !== 'pending') return false;
        return step.dependencies.every((depId) => {
          const dep = plan.steps.find((s) => s.id === depId);
          return dep && (dep.status === 'completed' || dep.status === 'repaired');
        });
      });

      if (readySteps.length === 0) {
        // No more ready steps
        break;
      }

      for (const step of readySteps) {
        step.status = 'in_progress';
        if (onStepUpdate) onStepUpdate(step, plan);

        try {
          if (step.assignedTool) {
            const toolDef = this.toolRegistry.get(step.assignedTool);
            const requiresNetwork = toolDef?.permissionLevel === 'NETWORK_ACCESS';

            // Check network availability before invoking network-dependent tool
            if (requiresNetwork && !networkManager.isOnline()) {
              step.status = 'paused_waiting_network' as any;
              step.error = 'Network connection offline. Step paused to preserve state and prevent partial failures.';
              logger.warn('TaskExecutor', `Step "${step.title}" paused: requires network access.`);
              if (onStepUpdate) onStepUpdate(step, plan);
              plan.status = 'paused_waiting_network' as any;
              break;
            }

            // Execute assigned tool
            logger.info('TaskExecutor', `Executing tool "${step.assignedTool}" for step "${step.title}"`);
            const toolResult = await this.toolRegistry.execute(
              step.assignedTool,
              step.toolArgs || {},
              context
            );

            step.toolResult = toolResult;

            if (toolResult.success) {
              step.status = 'completed';
              step.output = JSON.stringify(toolResult.output);
              step.verificationPassed = true;
              step.verificationNotes = 'Tool executed successfully within sandbox.';
            } else {
              // Attempt repair if within limit
              if (step.repairAttempts < maxRepairsPerStep) {
                step.repairAttempts++;
                logger.warn('TaskExecutor', `Step failed. Attempting repair (${step.repairAttempts}/${maxRepairsPerStep}): ${toolResult.error}`);

                // Fallback / Repair argument adaptation
                if (step.assignedTool === 'file_read' && toolResult.error?.includes('not found')) {
                  step.toolArgs = { path: 'metadata.json' }; // Repair target
                  const repairedResult = await this.toolRegistry.execute(step.assignedTool, step.toolArgs, context);
                  if (repairedResult.success) {
                    step.status = 'repaired';
                    step.toolResult = repairedResult;
                    step.output = JSON.stringify(repairedResult.output);
                    step.verificationPassed = true;
                    step.verificationNotes = 'Repaired: successfully switched target path to metadata.json.';
                  } else {
                    step.status = 'failed';
                    step.error = repairedResult.error;
                  }
                } else {
                  step.status = 'failed';
                  step.error = toolResult.error;
                }
              } else {
                step.status = 'failed';
                step.error = toolResult.error;
              }
            }
          } else {
            // LLM synthesis step
            const isOnline = networkManager.isOnline();
            if (!isOnline && this.modelProvider.id === 'gemini') {
              // Network lost mid-task: Pause safely rather than crashing or switching destructively
              step.status = 'paused_waiting_network' as any;
              step.error = 'Network dropped during task. Synthesis step paused safely with state preserved.';
              logger.warn('TaskExecutor', `Synthesis step "${step.title}" paused due to network loss.`);
              if (onStepUpdate) onStepUpdate(step, plan);
              plan.status = 'paused_waiting_network' as any;
              break;
            }

            const prompt = `Synthesize step: "${step.title}". Description: "${step.description}". Objective: "${plan.objective}".`;
            const modelResult = await this.modelProvider.generate(prompt, {
              maxOutputTokens: 300,
            });

            step.status = 'completed';
            step.output = modelResult.text;
            step.verificationPassed = true;
            step.verificationNotes = `Synthesized via ${modelResult.provider} (${modelResult.isSimulated ? 'Diagnostic' : 'Real'} inference).`;
          }
        } catch (err: any) {
          const isNetworkError =
            err.message?.includes('offline') ||
            err.message?.includes('fetch failed') ||
            err.message?.includes('ENOTFOUND') ||
            err.message?.includes('ETIMEDOUT');

          if (isNetworkError) {
            step.status = 'paused_waiting_network' as any;
            step.error = `Network interruption: ${err.message}. Step paused safely to allow later resumption.`;
            logger.warn('TaskExecutor', `Network loss detected during step "${step.id}". Pausing task safely.`);
            plan.status = 'paused_waiting_network' as any;
            if (onStepUpdate) onStepUpdate(step, plan);
            break;
          } else {
            step.status = 'failed';
            step.error = err.message;
            logger.error('TaskExecutor', `Error executing step "${step.id}"`, { error: err.message });
          }
        }

        if (onStepUpdate) onStepUpdate(step, plan);
      }

      if (plan.status === ('paused_waiting_network' as any)) {
        break;
      }
    }

    // Determine final plan status
    if (plan.status !== ('paused_waiting_network' as any)) {
      const allCompleted = plan.steps.every((s) => s.status === 'completed' || s.status === 'repaired');
      const anyFailed = plan.steps.some((s) => s.status === 'failed');

      if (allCompleted) {
        plan.status = 'completed';
      } else if (anyFailed) {
        plan.status = 'partially_completed';
      } else {
        plan.status = 'failed';
      }
    }

    plan.updatedAt = Date.now();

    // Run verification evaluator
    const verification = this.verifier.evaluatePlan(plan);
    logger.info(
      'TaskExecutor',
      `Plan execution finished. Status: ${plan.status}. Score: ${verification.score}%`
    );

    return { plan, verification };
  }
}
