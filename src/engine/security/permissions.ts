/**
 * RARE-INTELLIGENCE — Permissions & Security Sandbox
 * Enforces path containment, destructive action protection, and secret redaction.
 */

import path from 'path';
import { ToolPermissionLevel } from '../types.js';

export class SecurityGuard {
  private allowedWorkspaceRoot: string;
  private disallowedRelativePatterns = [
    '..',
    '.env',
    'id_rsa',
    'id_ed25519',
    '.git/config',
    'node_modules',
  ];

  constructor(workspaceRoot: string = process.cwd()) {
    this.allowedWorkspaceRoot = path.resolve(workspaceRoot);
  }

  /**
   * Resolves and verifies that a relative or absolute path is strictly
   * contained within the workspace root and does not access forbidden files.
   */
  public validateWorkspacePath(targetPath: string): { valid: boolean; resolvedPath: string; error?: string } {
    if (!targetPath || typeof targetPath !== 'string') {
      return { valid: false, resolvedPath: '', error: 'Path must be a non-empty string.' };
    }

    // Reject obvious traversal characters
    if (targetPath.includes('\0')) {
      return { valid: false, resolvedPath: '', error: 'Null byte injection detected in path.' };
    }

    const resolved = path.resolve(this.allowedWorkspaceRoot, targetPath.trim());

    // Containment check: must start with allowedWorkspaceRoot
    const rel = path.relative(this.allowedWorkspaceRoot, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return {
        valid: false,
        resolvedPath: resolved,
        error: `Path traversal violation: "${targetPath}" resolves outside workspace root.`,
      };
    }

    // Check sensitive file patterns
    const normalized = targetPath.toLowerCase().replace(/\\/g, '/');
    for (const forbidden of this.disallowedRelativePatterns) {
      if (normalized.includes(forbidden.toLowerCase())) {
        return {
          valid: false,
          resolvedPath: resolved,
          error: `Access violation: access to "${forbidden}" is strictly prohibited.`,
        };
      }
    }

    return { valid: true, resolvedPath: resolved };
  }

  /**
   * Verifies that the caller has granted sufficient permission for the requested tool tier.
   */
  public verifyPermission(
    required: ToolPermissionLevel,
    granted: ToolPermissionLevel[]
  ): { granted: boolean; error?: string } {
    // Permission hierarchy or explicit grant
    if (granted.includes(required)) {
      return { granted: true };
    }

    // SYSTEM_COMMAND grants all
    if (granted.includes('SYSTEM_COMMAND') && required !== 'SYSTEM_COMMAND') {
      return { granted: true };
    }

    return {
      granted: false,
      error: `Permission Denied: Operation requires '${required}' permission. Granted permissions: [${granted.join(', ')}]`,
    };
  }

  /**
   * Sanitizes text to remove API keys, bearer tokens, and secrets from logs and responses.
   */
  public sanitizeSecrets(text: string): string {
    if (!text || typeof text !== 'string') return text;

    return text
      // Redact standard Google API keys (AIza...)
      .replace(/AIza[0-9A-Za-z-_]{16,}/g, '[REDACTED_API_KEY]')
      // Redact generic bearer tokens
      .replace(/Bearer\s+[A-Za-z0-9-._~+/]+=*/gi, 'Bearer [REDACTED_TOKEN]')
      // Redact GEMINI_API_KEY patterns
      .replace(/(GEMINI_API_KEY\s*=\s*['"]?)[^'"\s]+(['"]?)/gi, '$1[REDACTED_KEY]$2')
      // Redact potential secret query params
      .replace(/([?&]key=)[^&]+/gi, '$1[REDACTED]')
      .replace(/([?&]api_key=)[^&]+/gi, '$1[REDACTED]');
  }

  /**
   * Recursively sanitizes objects / dictionaries for safe logging.
   */
  public sanitizeObject<T>(obj: T): T {
    if (!obj || typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitizeObject(item)) as unknown as T;
    }

    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      const lower = key.toLowerCase();
      if (lower.includes('key') || lower.includes('secret') || lower.includes('token') || lower.includes('auth') || lower.includes('password')) {
        sanitized[key] = '[REDACTED_SECRET]';
      } else if (typeof value === 'string') {
        sanitized[key] = this.sanitizeSecrets(value);
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeObject(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized as T;
  }
}

export const defaultSecurityGuard = new SecurityGuard();
