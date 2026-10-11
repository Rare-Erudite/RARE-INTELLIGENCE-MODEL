/**
 * RARE-INTELLIGENCE — Provider Circuit Breaker
 * Protects against repeatedly calling a failing provider and respects zero-budget quotas.
 */

import { logger } from '../security/logger.js';
import { AppError } from './app-error.js';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold?: number; // Failures before opening
  resetTimeoutMs?: number;   // Time in open before attempting half-open
  name?: string;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private successCountInHalfOpen = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly name: string;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30000;
    this.name = options.name ?? 'default-breaker';
  }

  public getState(): CircuitState {
    if (this.state === 'OPEN') {
      const now = Date.now();
      if (now - this.lastFailureTime > this.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
        this.successCountInHalfOpen = 0;
        logger.info('CircuitBreaker', `Circuit [${this.name}] transitioned from OPEN to HALF_OPEN.`);
      }
    }
    return this.state;
  }

  public async execute<T>(action: () => Promise<T>): Promise<T> {
    const currentState = this.getState();

    if (currentState === 'OPEN') {
      const remaining = Math.max(0, this.resetTimeoutMs - (Date.now() - this.lastFailureTime));
      throw new AppError({
        code: 'CIRCUIT_BREAKER_OPEN',
        message: `Provider circuit [${this.name}] is OPEN due to repeated failures. Retry available in ${Math.round(remaining / 1000)}s.`,
        statusCode: 503,
        isTransient: true,
      });
    }

    try {
      const result = await action();
      this.recordSuccess();
      return result;
    } catch (err: any) {
      this.recordFailure(err);
      throw err;
    }
  }

  public recordSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.successCountInHalfOpen++;
      if (this.successCountInHalfOpen >= 2) {
        this.state = 'CLOSED';
        this.failureCount = 0;
        logger.info('CircuitBreaker', `Circuit [${this.name}] recovered and CLOSED.`);
      }
    } else {
      this.failureCount = 0;
    }
  }

  public recordFailure(err?: any): void {
    this.lastFailureTime = Date.now();
    this.failureCount++;

    if (this.state === 'CLOSED' && this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      logger.warn('CircuitBreaker', `Circuit [${this.name}] tripped to OPEN after ${this.failureCount} failures: ${err?.message || 'Unknown error'}`);
    } else if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      logger.warn('CircuitBreaker', `Circuit [${this.name}] failed in HALF_OPEN state, returning to OPEN.`);
    }
  }

  public reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCountInHalfOpen = 0;
    this.lastFailureTime = 0;
    logger.info('CircuitBreaker', `Circuit [${this.name}] manually reset to CLOSED.`);
  }

  public getStats() {
    return {
      name: this.name,
      state: this.getState(),
      failureCount: this.failureCount,
      failureThreshold: this.failureThreshold,
      lastFailureTime: this.lastFailureTime,
      resetTimeoutMs: this.resetTimeoutMs,
    };
  }
}
