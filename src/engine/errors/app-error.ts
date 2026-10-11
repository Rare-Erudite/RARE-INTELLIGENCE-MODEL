/**
 * RARE-INTELLIGENCE — Centralized AppError
 * Typed errors with safe client messages, HTTP status codes, and correlation tracking.
 */

import { ErrorCode, ApiErrorResponse } from '../types.js';

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly isTransient: boolean;
  public readonly correlationId: string;
  public readonly details?: Record<string, unknown>;

  constructor(params: {
    code: ErrorCode;
    message: string;
    statusCode?: number;
    isTransient?: boolean;
    correlationId?: string;
    details?: Record<string, unknown>;
  }) {
    super(params.message);
    this.name = 'AppError';
    this.code = params.code;
    this.statusCode = params.statusCode ?? AppError.mapDefaultStatus(params.code);
    this.isTransient = params.isTransient ?? AppError.isDefaultTransient(params.code);
    this.correlationId = params.correlationId ?? 'req_' + Math.random().toString(36).substring(2, 9);
    this.details = params.details;

    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toResponse(isAuthorizedAdmin = false): ApiErrorResponse {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        correlationId: this.correlationId,
        statusCode: this.statusCode,
        timestamp: Date.now(),
        isTransient: this.isTransient,
        details: isAuthorizedAdmin ? this.details : undefined,
      },
    };
  }

  private static mapDefaultStatus(code: ErrorCode): number {
    switch (code) {
      case 'INVALID_REQUEST':
      case 'VALIDATION_FAILED':
        return 400;
      case 'UNAUTHORIZED':
        return 401;
      case 'FORBIDDEN':
      case 'PATH_TRAVERSAL_BLOCKED':
        return 403;
      case 'NOT_FOUND':
      case 'MODEL_NOT_FOUND':
        return 404;
      case 'RATE_LIMIT_EXHAUSTED':
        return 429;
      case 'TIMEOUT_OR_CANCELLED':
        return 408;
      case 'PROVIDER_UNAVAILABLE':
      case 'NO_AI_PROVIDER_READY':
      case 'NETWORK_OFFLINE':
      case 'NETWORK_FAILURE':
      case 'CIRCUIT_BREAKER_OPEN':
      case 'SERVICE_UNAVAILABLE':
        return 503;
      case 'STORAGE_PERSISTENCE_FAILED':
      case 'TOOL_EXECUTION_FAILED':
      case 'PLANNING_OR_EXECUTION_FAILED':
      case 'VERIFICATION_FAILED':
      case 'REPAIR_FAILED':
      case 'INVALID_MODEL_RESPONSE':
      case 'INVALID_API_CREDENTIALS':
      case 'INTERNAL_SERVER_ERROR':
      default:
        return 500;
    }
  }

  private static isDefaultTransient(code: ErrorCode): boolean {
    switch (code) {
      case 'NETWORK_FAILURE':
      case 'RATE_LIMIT_EXHAUSTED':
      case 'TIMEOUT_OR_CANCELLED':
      case 'SERVICE_UNAVAILABLE':
        return true;
      default:
        return false;
    }
  }
}
