/**
 * RARE-INTELLIGENCE — Safe Bounded Retry Logic
 * Exponential backoff with jitter; strictly refuses to retry non-transient failures.
 */

import { AppError } from './app-error.js';
import { logger } from '../security/logger.js';

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  operationName?: string;
}

export async function executeWithRetry<T>(
  action: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 2;
  const initialDelayMs = options.initialDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 4000;
  const backoffFactor = options.backoffFactor ?? 2;
  const opName = options.operationName ?? 'anonymous-op';

  let attempt = 0;

  while (true) {
    attempt++;
    try {
      return await action(attempt);
    } catch (err: any) {
      // Check if error is explicitly non-transient
      const isTransient = err instanceof AppError ? err.isTransient : isLikelyTransient(err);

      if (!isTransient || attempt > maxRetries) {
        if (attempt > 1) {
          logger.warn('Retry', `Operation [${opName}] failed permanently after ${attempt} attempts: ${err.message}`);
        }
        throw err;
      }

      // Compute exponential backoff with random jitter (0 - 30%)
      const baseDelay = Math.min(maxDelayMs, initialDelayMs * Math.pow(backoffFactor, attempt - 1));
      const jitter = Math.random() * 0.3 * baseDelay;
      const delay = Math.round(baseDelay + jitter);

      logger.info('Retry', `Transient failure in [${opName}] (attempt ${attempt}/${maxRetries}): ${err.message}. Retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

function isLikelyTransient(err: any): boolean {
  const msg = (err?.message || '').toLowerCase();
  return (
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('429') ||
    msg.includes('503') ||
    msg.includes('resource_exhausted')
  );
}
