/**
 * RARE-INTELLIGENCE — Structured Diagnostic Logger
 * Automatically sanitizes secrets before printing or recording logs.
 */

import { defaultSecurityGuard } from './permissions.js';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  module: string;
  message: string;
  meta?: Record<string, any>;
}

export class DiagnosticLogger {
  private inMemoryLogs: LogEntry[] = [];
  private maxLogs = 500;

  constructor(private prefix: string = 'RARE-ENGINE') {}

  private record(level: LogLevel, module: string, message: string, meta?: Record<string, any>) {
    const sanitizedMsg = defaultSecurityGuard.sanitizeSecrets(message);
    const sanitizedMeta = meta ? defaultSecurityGuard.sanitizeObject(meta) : undefined;

    const entry: LogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: Date.now(),
      level,
      module,
      message: sanitizedMsg,
      meta: sanitizedMeta,
    };

    this.inMemoryLogs.push(entry);
    if (this.inMemoryLogs.length > this.maxLogs) {
      this.inMemoryLogs.shift();
    }

    const timeStr = new Date(entry.timestamp).toISOString();
    const metaStr = sanitizedMeta ? ` ${JSON.stringify(sanitizedMeta)}` : '';
    console.log(`[${timeStr}] [${this.prefix}] [${level}] [${module}]: ${sanitizedMsg}${metaStr}`);
  }

  public debug(module: string, message: string, meta?: Record<string, any>) {
    this.record('DEBUG', module, message, meta);
  }

  public info(module: string, message: string, meta?: Record<string, any>) {
    this.record('INFO', module, message, meta);
  }

  public warn(module: string, message: string, meta?: Record<string, any>) {
    this.record('WARN', module, message, meta);
  }

  public error(module: string, message: string, meta?: Record<string, any>) {
    this.record('ERROR', module, message, meta);
  }

  public getRecentLogs(limit = 100): LogEntry[] {
    return [...this.inMemoryLogs].slice(-limit);
  }

  public clearLogs() {
    this.inMemoryLogs = [];
  }
}

export const logger = new DiagnosticLogger();
