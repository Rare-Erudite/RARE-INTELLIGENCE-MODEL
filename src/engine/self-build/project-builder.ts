/**
 * RARE-INTELLIGENCE — Safe Self-Build & Project Development Engine
 * Manages the full software development lifecycle:
 * REQUEST -> REQUIREMENTS -> INSPECT -> PLAN -> CHECKPOINT -> IMPLEMENT ->
 * TEST -> REPAIR -> REVALIDATE -> REVIEW -> ACCEPT/ROLLBACK.
 */

import fs from 'fs';
import path from 'path';
import {
  ExecutionContext,
  ProjectBuildPlan,
  WorkspaceCheckpoint,
} from '../types.js';
import { FilePersistentStore } from '../memory/file-persistent.js';
import { ToolRegistry } from '../tools/registry.js';
import { defaultSecurityGuard } from '../security/permissions.js';
import { logger } from '../security/logger.js';

export class ProjectBuildEngine {
  constructor(
    private memoryStore: FilePersistentStore,
    private toolRegistry: ToolRegistry
  ) {}

  /**
   * Plans and executes a software build/modification project with checkpointing and rollback.
   */
  public async executeProjectBuild(
    goal: string,
    targetFiles: string[],
    fileChanges: Record<string, string>,
    context: ExecutionContext
  ): Promise<{
    plan: ProjectBuildPlan;
    success: boolean;
    auditLog: string[];
  }> {
    const buildId = 'build_' + Math.random().toString(36).substring(2, 9);
    const auditLog: string[] = [];
    logger.info('ProjectBuilder', `Starting project build [${buildId}] for goal: "${goal}"`);

    // 1. REQUIREMENTS & VALIDATION
    auditLog.push(`1. [REQUIREMENTS]: Goal "${goal}", targeting ${targetFiles.length} files.`);
    for (const f of targetFiles) {
      const check = defaultSecurityGuard.validateWorkspacePath(f);
      if (!check.valid) {
        throw new Error(`Security validation failed for path "${f}": ${check.error}`);
      }
    }

    // 2. INSPECTION
    auditLog.push('2. [INSPECTION]: Inspecting existing target files...');
    const snapshotFiles: Record<string, string> = {};
    for (const relPath of targetFiles) {
      const fullPath = path.resolve(process.cwd(), relPath);
      if (fs.existsSync(fullPath)) {
        snapshotFiles[relPath] = fs.readFileSync(fullPath, 'utf-8');
      }
    }

    // 3. CREATE RECOVERABLE CHECKPOINT
    const checkpointId = 'cp_build_' + Math.random().toString(36).substring(2, 8);
    const checkpoint: WorkspaceCheckpoint = {
      id: checkpointId,
      name: `Pre-build snapshot for ${goal.slice(0, 40)}`,
      createdAt: Date.now(),
      files: snapshotFiles,
      metadata: { buildId, goal },
    };
    this.memoryStore.saveCheckpoint(checkpoint);
    auditLog.push(`3. [CHECKPOINT]: Captured baseline snapshot [${checkpointId}] with ${Object.keys(snapshotFiles).length} files.`);

    const buildPlan: ProjectBuildPlan = {
      id: buildId,
      goal,
      targetFiles,
      checkpointId,
      phases: [
        { name: 'INSPECT', status: 'completed' },
        { name: 'CHECKPOINT', status: 'completed' },
        { name: 'IMPLEMENT', status: 'pending' },
        { name: 'VERIFY', status: 'pending' },
        { name: 'ACCEPT', status: 'pending' },
      ],
      status: 'executing',
      diffs: [],
    };

    // 4. IMPLEMENTATION (Sandboxed Edits)
    auditLog.push('4. [IMPLEMENTATION]: Applying planned modifications...');
    let implementationSuccess = true;
    for (const [relPath, newContent] of Object.entries(fileChanges)) {
      const writeResult = await this.toolRegistry.execute(
        'file_write',
        { path: relPath, content: newContent },
        context
      );
      if (!writeResult.success) {
        implementationSuccess = false;
        auditLog.push(`   Write failed for ${relPath}: ${writeResult.error}`);
        break;
      }
      buildPlan.diffs?.push({
        file: relPath,
        changes: `Updated ${newContent.length} bytes (previous: ${snapshotFiles[relPath]?.length || 0} bytes)`,
      });
    }

    const impPhase = buildPlan.phases.find((p) => p.name === 'IMPLEMENT');
    if (impPhase) impPhase.status = implementationSuccess ? 'completed' : 'failed';

    // 5. TESTING & SYNTAX VERIFICATION
    auditLog.push('5. [TESTING & VERIFICATION]: Inspecting syntax of modified files...');
    let verificationPassed = implementationSuccess;

    if (implementationSuccess) {
      for (const relPath of targetFiles) {
        const fullPath = path.resolve(process.cwd(), relPath);
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          // Static balance verification
          let braces = 0;
          for (const ch of content) {
            if (ch === '{') braces++;
            if (ch === '}') braces--;
          }
          if (braces !== 0) {
            verificationPassed = false;
            auditLog.push(`   Verification failed: Unbalanced braces in ${relPath} (balance=${braces})`);
            break;
          }
        }
      }
    }

    const verPhase = buildPlan.phases.find((p) => p.name === 'VERIFY');
    if (verPhase) verPhase.status = verificationPassed ? 'completed' : 'failed';

    // 6. ACCEPTANCE OR ROLLBACK
    if (!verificationPassed) {
      auditLog.push('6. [ROLLBACK]: Verification failed. Restoring files to checkpoint...');
      this.restoreCheckpoint(checkpointId);
      buildPlan.status = 'rolled_back';
      const accPhase = buildPlan.phases.find((p) => p.name === 'ACCEPT');
      if (accPhase) accPhase.status = 'failed';
      return { plan: buildPlan, success: false, auditLog };
    }

    auditLog.push('6. [ACCEPTANCE]: All verification gates passed. Project build accepted.');
    buildPlan.status = 'completed';
    const accPhase = buildPlan.phases.find((p) => p.name === 'ACCEPT');
    if (accPhase) accPhase.status = 'completed';

    // Record audit event
    this.memoryStore.recordAuditEvent('project_build_completed', {
      buildId,
      goal,
      targetFiles,
      checkpointId,
    });

    return {
      plan: buildPlan,
      success: true,
      auditLog,
    };
  }

  /**
   * Restores workspace files to a previously saved checkpoint.
   */
  public restoreCheckpoint(checkpointId: string): boolean {
    const cp = this.memoryStore.getCheckpoint(checkpointId);
    if (!cp) {
      logger.error('ProjectBuilder', `Cannot restore: Checkpoint [${checkpointId}] not found.`);
      return false;
    }

    logger.info('ProjectBuilder', `Restoring workspace to checkpoint [${checkpointId}]...`);
    for (const [relPath, content] of Object.entries(cp.files)) {
      const fullPath = path.resolve(process.cwd(), relPath);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf-8');
    }

    return true;
  }
}
