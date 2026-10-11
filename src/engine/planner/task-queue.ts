/**
 * RARE-INTELLIGENCE — Persistent Offline Task Queue & Resumable Execution
 * Manages durable task scheduling, offline pause/resume semantics, and idempotency control.
 */

import {
  ExecutionContext,
  PersistentQueuedTask,
  TaskNetworkDependency,
  TaskPlan,
} from '../types.js';
import { FilePersistentStore } from '../memory/file-persistent.js';
import { TaskDecomposer } from './decomposer.js';
import { TaskExecutor } from './executor.js';
import { ToolRegistry } from '../tools/registry.js';
import { IModelProvider } from '../providers/base.js';
import { NetworkTransitionManager } from '../network/connection-manager.js';
import { logger } from '../security/logger.js';

export class PersistentTaskQueue {
  private inFlightTasks: Map<string, AbortController> = new Map();

  constructor(
    private memoryStore: FilePersistentStore,
    private decomposer: TaskDecomposer,
    private toolRegistry: ToolRegistry,
    private networkManager: NetworkTransitionManager
  ) {
    // Listen for network connectivity returns to auto-resume eligible tasks
    this.networkManager.onStateChange((state) => {
      if (state === 'ONLINE') {
        logger.info('PersistentTaskQueue', 'Network connectivity restored. Re-evaluating paused tasks...');
        this.resumeEligibleTasks();
      }
    });
  }

  public enqueueTask(
    objective: string,
    networkDependency: TaskNetworkDependency = 'local_only',
    constraints: string[] = []
  ): PersistentQueuedTask {
    const taskId = 'task_' + Math.random().toString(36).substring(2, 9);
    const plan = this.decomposer.decomposeObjective(objective, constraints);

    const queuedTask: PersistentQueuedTask = {
      taskId,
      objective,
      networkDependency,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      resumable: true,
      executedStepIds: [],
      executionAttempts: 0,
      idempotencyToken: 'idem_' + Math.random().toString(36).substring(2, 9),
      plan,
    };

    this.saveQueuedTask(queuedTask);
    logger.info('PersistentTaskQueue', `Enqueued task [${taskId}] ("${objective}") with dependency [${networkDependency}].`);
    return queuedTask;
  }

  public getTask(taskId: string): PersistentQueuedTask | null {
    const raw = this.memoryStore.getTask(taskId);
    if (!raw) return null;

    // Check if task is stored in task queue format
    return (raw as any) as PersistentQueuedTask;
  }

  public listTasks(): PersistentQueuedTask[] {
    return this.memoryStore.listTasks() as unknown as PersistentQueuedTask[];
  }

  public getQueueStats() {
    const all = this.listTasks();
    return {
      total: all.length,
      pending: all.filter((t) => t.status === 'pending').length,
      running: all.filter((t) => t.status === 'running').length,
      paused: all.filter((t) => t.status === 'paused_waiting_network').length,
      completed: all.filter((t) => t.status === 'completed').length,
      failed: all.filter((t) => t.status === 'failed').length,
    };
  }

  public async executeTaskById(
    taskId: string,
    activeProvider: IModelProvider,
    context?: Partial<ExecutionContext>
  ): Promise<PersistentQueuedTask> {
    const task = this.getTask(taskId);
    if (!task) {
      throw new Error(`Task [${taskId}] not found in persistent queue.`);
    }

    // 1. Check network eligibility
    const isOnline = this.networkManager.isOnline();
    if (task.networkDependency === 'online_required' && !isOnline) {
      task.status = 'paused_waiting_network';
      task.updatedAt = Date.now();
      task.error = 'Task paused: Requires external network connection, but engine is currently OFFLINE.';
      this.saveQueuedTask(task);
      logger.warn('PersistentTaskQueue', `Task [${taskId}] paused: network is offline.`);
      return task;
    }

    // 2. Setup abort controller & execution context
    const abortController = new AbortController();
    this.inFlightTasks.set(taskId, abortController);

    task.status = 'running';
    task.executionAttempts++;
    task.updatedAt = Date.now();
    this.saveQueuedTask(task);

    const execContext: ExecutionContext = {
      workspaceRoot: process.cwd(),
      permissionGrant: ['READ_ONLY', 'WORKSPACE_WRITE', 'NETWORK_ACCESS'],
      abortSignal: abortController.signal,
      taskId,
      ...context,
    };

    try {
      const planToExecute: TaskPlan = task.plan || this.decomposer.decomposeObjective(task.objective);
      const executor = new TaskExecutor(this.toolRegistry, activeProvider);

      const result = await executor.executePlan(
        planToExecute,
        execContext,
        (step, updatedPlan) => {
          // Idempotency and incremental progress tracking
          if (step.status === 'completed' && !task.executedStepIds.includes(step.id)) {
            task.executedStepIds.push(step.id);
          }
          task.plan = updatedPlan;
          task.updatedAt = Date.now();
          this.saveQueuedTask(task);
        }
      );

      task.plan = result.plan;
      task.status = result.plan.status === 'completed' ? 'completed' : 'failed';
      task.updatedAt = Date.now();
    } catch (err: any) {
      task.status = 'failed';
      task.error = err.message;
      task.updatedAt = Date.now();
      logger.error('PersistentTaskQueue', `Execution failed for task [${taskId}]: ${err.message}`);
    } finally {
      this.inFlightTasks.delete(taskId);
      this.saveQueuedTask(task);
    }

    return task;
  }

  public pauseTask(taskId: string, reason = 'Paused by operator'): PersistentQueuedTask {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task [${taskId}] not found.`);

    const controller = this.inFlightTasks.get(taskId);
    if (controller) {
      controller.abort();
      this.inFlightTasks.delete(taskId);
    }

    task.status = 'paused_waiting_network';
    task.error = reason;
    task.updatedAt = Date.now();
    this.saveQueuedTask(task);
    logger.info('PersistentTaskQueue', `Task [${taskId}] paused: ${reason}`);
    return task;
  }

  public resumeEligibleTasks(): void {
    const paused = this.listTasks().filter((t) => t.status === 'paused_waiting_network' && t.resumable);
    logger.info('PersistentTaskQueue', `Found ${paused.length} paused tasks eligible for resumption.`);
    // Marks eligible tasks back to pending for worker pick-up while preserving executed steps
    for (const t of paused) {
      t.status = 'pending';
      t.error = undefined;
      t.updatedAt = Date.now();
      if (t.plan?.steps) {
        for (const step of t.plan.steps) {
          if ((step.status as string) === 'paused_waiting_network') {
            step.status = 'pending';
            step.error = undefined;
          }
        }
      }
      this.saveQueuedTask(t);
    }
  }

  private saveQueuedTask(task: PersistentQueuedTask): void {
    (task as any).id = task.taskId;
    this.memoryStore.saveTask((task as any) as TaskPlan);
  }
}
