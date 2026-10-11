/**
 * RARE-INTELLIGENCE — API Authentication, RBAC Authorization & Rate Limiting
 * Enforces role-based access control (RBAC), token authentication, and throttling.
 * Protects privileged developer capabilities, self-repair, and filesystem modifications.
 */

import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/app-error.js';
import { logger } from './logger.js';

export type ApiRole = 'developer' | 'client' | 'public';

export interface AuthenticatedRequest extends Request {
  authRole?: ApiRole;
  clientId?: string;
}

export class AuthManager {
  private static instance: AuthManager;
  private clientApiKey: string;
  private developerApiKey: string;

  // Simple in-memory sliding window rate limiter
  private requestCounts: Map<string, { count: number; resetAt: number }> = new Map();
  private readonly rateLimitWindowMs = 60_000; // 1 minute window
  private readonly maxRequestsPerWindow = 120; // 120 req/min

  private constructor() {
    this.clientApiKey = process.env.RARE_API_KEY || 'rare_client_sec_token_0budget';
    this.developerApiKey = process.env.RARE_DEV_KEY || 'rare_dev_sec_token_0budget';
  }

  public static getInstance(): AuthManager {
    if (!AuthManager.instance) {
      AuthManager.instance = new AuthManager();
    }
    return AuthManager.instance;
  }

  public getClientKey(): string {
    return this.clientApiKey;
  }

  public getDeveloperKey(): string {
    return this.developerApiKey;
  }

  /**
   * Resolves authentication role from incoming request headers or same-origin session
   */
  public resolveRole(req: Request): { role: ApiRole; clientId: string } {
    const authHeader = req.headers['authorization'];
    const apiKeyHeader = (req.headers['x-api-key'] || req.headers['x-rare-key']) as string | undefined;

    let bearerToken: string | undefined;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      bearerToken = authHeader.substring(7).trim();
    }

    const providedKey = bearerToken || apiKeyHeader;

    // 1. Check Developer Key (Full privileges)
    if (providedKey && providedKey === this.developerApiKey) {
      return { role: 'developer', clientId: 'developer_admin' };
    }

    // 2. Check Client Key (RARE-THE-SIXTH mobile integration)
    if (providedKey && providedKey === this.clientApiKey) {
      return { role: 'client', clientId: 'rare_the_sixth_client' };
    }

    // If an explicit key was provided but was invalid, reject immediately as unauthenticated
    if (providedKey) {
      return { role: 'public', clientId: 'unauthenticated' };
    }

    // 3. Same-origin Browser Dashboard access (Local Development & AI Studio Preview)
    // Allows interactive web UI use on same origin while isolating external API callers
    const host = (req.headers['host'] || '').trim();
    const origin = ((req.headers['origin'] || req.headers['referer'] || '') as string).trim();
    const isSameOrigin =
      (host.length > 0 && origin.length > 0 && origin.includes(host)) ||
      req.headers['sec-fetch-site'] === 'same-origin' ||
      req.ip === '127.0.0.1' ||
      req.ip === '::1';

    if (isSameOrigin) {
      return { role: 'developer', clientId: 'dashboard_local_session' };
    }

    return { role: 'public', clientId: 'unauthenticated' };
  }

  /**
   * Middleware to authenticate incoming request
   */
  public authenticateMiddleware() {
    return (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
      const { role, clientId } = this.resolveRole(req);
      req.authRole = role;
      req.clientId = clientId;
      next();
    };
  }

  /**
   * Middleware to enforce required roles
   */
  public requireRole(allowedRoles: ApiRole[]) {
    return (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
      const currentRole = req.authRole || 'public';

      if (allowedRoles.includes(currentRole)) {
        return next();
      }

      if (currentRole === 'public') {
        return next(
          new AppError({
            code: 'UNAUTHORIZED',
            message: 'Authentication required. Provide valid Bearer token or X-API-Key header.',
            statusCode: 401,
          })
        );
      }

      logger.warn(
        'AuthManager',
        `Forbidden access attempt by role "${currentRole}" for privileged endpoint ${req.method} ${req.path}`
      );
      return next(
        new AppError({
          code: 'FORBIDDEN',
          message: `Access denied. Operation requires [${allowedRoles.join(', ')}] privileges. Current role: ${currentRole}`,
          statusCode: 403,
        })
      );
    };
  }

  /**
   * Lightweight in-memory rate limiter middleware
   */
  public rateLimitMiddleware(customMax = this.maxRequestsPerWindow) {
    return (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
      // Internal local dashboard sessions are not throttled
      if (req.clientId === 'dashboard_local_session') {
        return next();
      }

      const clientIdentifier = req.clientId || req.ip || 'anonymous';
      const now = Date.now();
      const record = this.requestCounts.get(clientIdentifier);

      if (!record || now > record.resetAt) {
        this.requestCounts.set(clientIdentifier, {
          count: 1,
          resetAt: now + this.rateLimitWindowMs,
        });
        return next();
      }

      record.count++;
      if (record.count > customMax) {
        logger.warn('AuthManager', `Rate limit exceeded for client [${clientIdentifier}]`);
        return next(
          new AppError({
            code: 'RATE_LIMIT_EXHAUSTED',
            message: `Rate limit of ${customMax} requests per minute exceeded. Please back off before retrying.`,
            statusCode: 429,
            isTransient: true,
          })
        );
      }

      next();
    };
  }
}

export const authManager = AuthManager.getInstance();
