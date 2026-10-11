/**
 * RARE-INTELLIGENCE — Tool Registry & Execution Sandbox
 * Strictly validates schemas, enforces permission tiers, and tracks audit trails.
 */

import {
  ExecutionContext,
  ToolDefinition,
  ToolExecutionResult,
  ToolPermissionLevel,
} from '../types.js';
import { defaultSecurityGuard } from '../security/permissions.js';
import { logger } from '../security/logger.js';

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  public register(tool: ToolDefinition) {
    if (this.tools.has(tool.name)) {
      logger.warn('ToolRegistry', `Overwriting existing tool registration: "${tool.name}"`);
    }
    this.tools.set(tool.name, tool);
  }

  public get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  public getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  public getDeclarationsForModel() {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: `[Permission: ${tool.permissionLevel}] ${tool.description}`,
      parameters: tool.parametersSchema,
    }));
  }

  /**
   * Executes a registered tool safely with permission checks, timeout, and audit logging.
   */
  public async execute(
    toolName: string,
    args: Record<string, any>,
    context: ExecutionContext
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const tool = this.tools.get(toolName);

    if (!tool) {
      return {
        success: false,
        output: null,
        error: `Tool "${toolName}" is not registered in the system.`,
        durationMs: Date.now() - startTime,
        permissionUsed: 'READ_ONLY',
        auditRecord: {
          timestamp: startTime,
          sanitizedArgs: defaultSecurityGuard.sanitizeObject(args),
        },
      };
    }

    // 1. Permission check
    const permCheck = defaultSecurityGuard.verifyPermission(tool.permissionLevel, context.permissionGrant);
    if (!permCheck.granted) {
      logger.warn('ToolRegistry', `Unauthorized tool call blocked: "${toolName}"`, {
        required: tool.permissionLevel,
        granted: context.permissionGrant,
      });
      return {
        success: false,
        output: null,
        error: permCheck.error,
        durationMs: Date.now() - startTime,
        permissionUsed: tool.permissionLevel,
        auditRecord: {
          timestamp: startTime,
          sanitizedArgs: defaultSecurityGuard.sanitizeObject(args),
        },
      };
    }

    // 2. Schema required parameters validation
    const missing = tool.parametersSchema.required.filter((key) => args[key] === undefined || args[key] === null);
    if (missing.length > 0) {
      return {
        success: false,
        output: null,
        error: `Schema Validation Error: Missing required arguments: [${missing.join(', ')}]`,
        durationMs: Date.now() - startTime,
        permissionUsed: tool.permissionLevel,
        auditRecord: {
          timestamp: startTime,
          sanitizedArgs: defaultSecurityGuard.sanitizeObject(args),
        },
      };
    }

    // 3. Execution with timeout wrapper
    try {
      const timeoutMs = 25000;
      let timer: any;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Tool execution timed out after ${timeoutMs}ms`)), timeoutMs);
        if (typeof timer.unref === 'function') timer.unref();
      });

      const executionPromise = tool.execute(args, context);
      const result = await Promise.race([executionPromise, timeoutPromise]);
      clearTimeout(timer);

      logger.info('ToolRegistry', `Executed tool: "${toolName}"`, {
        success: result.success,
        durationMs: result.durationMs,
      });

      return result;
    } catch (err: any) {
      logger.error('ToolRegistry', `Error executing tool "${toolName}"`, { error: err.message });
      return {
        success: false,
        output: null,
        error: `Tool execution failed: ${err.message}`,
        durationMs: Date.now() - startTime,
        permissionUsed: tool.permissionLevel,
        auditRecord: {
          timestamp: startTime,
          sanitizedArgs: defaultSecurityGuard.sanitizeObject(args),
        },
      };
    }
  }
}
