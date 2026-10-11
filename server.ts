/**
 * RARE-INTELLIGENCE — Server Entrypoint
 * Full-stack Express server with Vite middleware integration.
 * Centralized typed error handling, resilience, and versioned v1 REST API for RARE-THE-SIXTH.
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { engine } from './src/engine/engine.js';
import { EngineTestSuiteRunner } from './src/engine/tests/engine-test-suite.js';
import { STANDARD_BENCHMARK_TASKS } from './src/engine/continuous-improvement/benchmark-suite.js';
import { AppError } from './src/engine/errors/app-error.js';
import { logger } from './src/engine/security/logger.js';
import { DeviceHardwareEvaluator } from './src/engine/providers/device-evaluator.js';
import { LocalModelManager } from './src/engine/providers/local-runtime.js';
import { authManager } from './src/engine/security/auth.js';
import { defaultSecurityGuard } from './src/engine/security/permissions.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);

app.use(express.json({ limit: '2mb' }));

// Request Timeout Middleware (35s maximum execution bound)
app.use((req, res, next) => {
  res.setTimeout(35000, () => {
    logger.warn('Server', `Request timed out for ${req.method} ${req.path}`);
    if (!res.headersSent) {
      res.status(504).json({
        success: false,
        error: {
          code: 'TIMEOUT_OR_CANCELLED',
          message: 'Request execution timed out after 35 seconds.',
          correlationId: (req as any).correlationId || 'req_timeout',
          statusCode: 504,
          timestamp: Date.now(),
          isTransient: true,
        },
      });
    }
  });
  next();
});

// Correlation ID & Request Tracking Middleware
app.use((req, res, next) => {
  const correlationId = (req.headers['x-correlation-id'] as string) || 'req_' + Math.random().toString(36).substring(2, 9);
  (req as any).correlationId = correlationId;
  res.setHeader('X-Correlation-Id', correlationId);

  const start = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api/')) {
      logger.info('HTTP', `[${correlationId}] ${req.method} ${req.path} - ${res.statusCode} (${Date.now() - start}ms)`);
    }
  });
  next();
});

// ==========================================
// RARE-INTELLIGENCE API v1 ENDPOINTS
// ==========================================

const apiRouter = express.Router();

// Apply global authentication resolution and rate limiting across API endpoints
apiRouter.use(authManager.authenticateMiddleware());
apiRouter.use(authManager.rateLimitMiddleware(120));

/**
 * 1. Health & Engine Telemetry (Public)
 */
apiRouter.get('/health', async (_req, res, next) => {
  try {
    const health = await engine.getHealth();
    res.json({ success: true, health });
  } catch (err) {
    next(err);
  }
});

apiRouter.get('/engine/health', async (_req, res, next) => {
  try {
    const health = await engine.getHealth();
    res.json({ success: true, health });
  } catch (err) {
    next(err);
  }
});

apiRouter.get('/engine/status', async (_req, res, next) => {
  try {
    const health = await engine.getHealth();
    res.json({
      engine: 'RARE-INTELLIGENCE',
      version: health.version,
      targetIntegration: 'RARE-THE-SIXTH',
      uptimeSeconds: health.uptimeSeconds,
      activeProvider: health.activeProvider,
      budgetPolicy: 'Strict $0.00 Non-Negotiable Free Tier',
      zeroCostEnforced: true,
      persistentStorage: health.memoryStorageType,
      circuitBreaker: engine.providerCircuitBreaker.getStats(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 2. Model Providers
 */
apiRouter.get('/providers', authManager.requireRole(['client', 'developer']), async (_req, res, next) => {
  try {
    const providers = await engine.providers.getAvailableProvidersInfo();
    const active = engine.providers.getActiveProvider();
    res.json({
      activeProvider: active.id,
      providers,
    });
  } catch (err) {
    next(err);
  }
});

apiRouter.post('/providers/switch', authManager.requireRole(['developer']), (req, res, next) => {
  try {
    const { providerId } = req.body;
    if (!providerId) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        message: 'Field "providerId" is required.',
        statusCode: 400,
      });
    }
    engine.providers.setActiveProvider(providerId);
    res.json({
      success: true,
      activeProvider: providerId,
      message: `Active provider successfully changed to ${providerId}`,
    });
  } catch (err) {
    next(err);
  }
});

apiRouter.post('/providers/test', authManager.requireRole(['developer']), async (req, res, next) => {
  try {
    const { providerId } = req.body;
    const provider = providerId ? engine.providers.getProvider(providerId) : engine.providers.getActiveProvider();
    const probe = await provider.checkAvailability(true);
    res.json({ success: true, probe });
  } catch (err) {
    next(err);
  }
});

apiRouter.post('/providers/load-local', authManager.requireRole(['client', 'developer']), async (_req, res, next) => {
  try {
    const localProvider = engine.providers.getProvider('local-transformers') as any;
    if (!localProvider) {
      throw new AppError({
        code: 'NOT_FOUND',
        message: 'Local transformers provider not registered in engine.',
        statusCode: 404,
      });
    }

    const loaded = await localProvider.loadModel();
    // Automatically switch active provider to local-transformers if successful
    engine.providers.setActiveProvider('local-transformers');

    res.json({
      success: true,
      loaded,
      manifest: localProvider.manifest,
      activeProvider: 'local-transformers',
      message: `Local open-weight model "${localProvider.manifest.name}" successfully loaded into memory and active for neural inference.`,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 3. Chat & Conversational Context
 */
apiRouter.post('/chat', authManager.requireRole(['client', 'developer']), async (req, res, next) => {
  try {
    const { messages, options, conversationId, message } = req.body;

    // A. Conversation-linked chat execution
    if (conversationId) {
      let conv = engine.getConversation(conversationId);
      if (!conv) {
        conv = {
          id: conversationId,
          title: message ? String(message).substring(0, 30) + (String(message).length > 30 ? '...' : '') : 'New Conversation',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [],
          metadata: {},
        };
      }

      const userText = message || (Array.isArray(messages) && messages[messages.length - 1]?.content) || '';
      if (!String(userText).trim()) {
        throw new AppError({
          code: 'VALIDATION_FAILED',
          message: 'Message content is required.',
          statusCode: 400,
        });
      }

      conv.messages.push({
        role: 'user',
        content: String(userText).trim(),
        timestamp: Date.now(),
      });

      const result = await engine.chat(conv.messages, options);

      conv.messages.push({
        role: 'model',
        content: result.text,
        timestamp: Date.now(),
        metadata: {
          provider: result.provider,
          model: result.model,
          latencyMs: result.latencyMs,
          isSimulated: result.isSimulated,
        },
      });

      conv.updatedAt = Date.now();
      engine.saveConversation(conv);

      return res.json({
        success: true,
        conversationId: conv.id,
        conversation: conv,
        result,
      });
    }

    // B. Direct messages array or single message
    let payloadMessages = messages;
    if (!payloadMessages && message) {
      payloadMessages = [{ role: 'user', content: String(message).trim() }];
    }

    if (!payloadMessages || !Array.isArray(payloadMessages) || payloadMessages.length === 0) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        message: 'Request body must include "messages" array or "message" string.',
        statusCode: 400,
      });
    }

    const result = await engine.chat(payloadMessages, options);
    res.json({ success: true, result });
  } catch (err) {
    next(err);
  }
});

/**
 * 4. Task Planning & Autonomous Execution
 */
apiRouter.post('/tasks/plan', authManager.requireRole(['client', 'developer']), (req, res, next) => {
  try {
    const { objective, constraints } = req.body;
    if (!objective) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        message: 'Field "objective" is required.',
        statusCode: 400,
      });
    }
    const plan = engine.decomposer.decomposeObjective(objective, constraints || []);
    res.json({ success: true, plan });
  } catch (err) {
    next(err);
  }
});

apiRouter.post('/tasks/execute', authManager.requireRole(['client', 'developer']), async (req, res, next) => {
  try {
    const { objective, constraints, context } = req.body;
    if (!objective) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        message: 'Field "objective" is required.',
        statusCode: 400,
      });
    }

    const result = await engine.executeTask(objective, context, constraints);
    res.json({
      success: true,
      plan: result.plan,
      verification: result.verification,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 5. Registered Tools Catalog & Execution Sandbox
 */
apiRouter.get('/tools', authManager.requireRole(['client', 'developer']), (_req, res) => {
  const tools = engine.tools.getAll().map((t) => ({
    name: t.name,
    description: t.description,
    permissionLevel: t.permissionLevel,
    parametersSchema: t.parametersSchema,
  }));
  res.json({ tools });
});

apiRouter.post('/tools/execute', authManager.requireRole(['developer']), async (req, res, next) => {
  try {
    const { name, args, dryRun } = req.body;
    if (!name) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        message: 'Tool "name" is required.',
        statusCode: 400,
      });
    }

    const result = await engine.tools.execute(
      name,
      args || {},
      {
        workspaceRoot: process.cwd(),
        permissionGrant: ['READ_ONLY', 'WORKSPACE_WRITE', 'NETWORK_ACCESS'],
        dryRun: !!dryRun,
      }
    );
    res.json({ result });
  } catch (err) {
    next(err);
  }
});

/**
 * 6. Durable Multi-Collection Storage
 */
apiRouter.get('/memory', authManager.requireRole(['client', 'developer']), async (req, res, next) => {
  try {
    const category = req.query.category as any;
    const items = await engine.memory.list(category);
    res.json({
      storageType: engine.memory.storageType,
      isPersistent: engine.memory.isPersistent,
      count: items.length,
      items,
    });
  } catch (err) {
    next(err);
  }
});

apiRouter.post('/memory', authManager.requireRole(['client', 'developer']), async (req, res, next) => {
  try {
    const { key, content, category, tags, source } = req.body;
    if (!key || !content) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        message: 'Fields "key" and "content" are required.',
        statusCode: 400,
      });
    }
    const stored = await engine.memory.set({
      key,
      content,
      category: category || 'project_fact',
      tags: tags || [],
      source: source || 'user_input',
    });
    res.json({ success: true, item: stored });
  } catch (err) {
    next(err);
  }
});

apiRouter.delete('/memory/:key', authManager.requireRole(['client', 'developer']), async (req, res, next) => {
  try {
    const success = await engine.memory.delete(req.params.key);
    res.json({ success });
  } catch (err) {
    next(err);
  }
});

apiRouter.get('/storage/stats', authManager.requireRole(['client', 'developer']), (_req, res) => {
  res.json({ stats: engine.durableStore.getStats() });
});

apiRouter.post('/storage/backup', authManager.requireRole(['developer']), (_req, res) => {
  const backupPath = engine.durableStore.createBackup();
  res.json({ success: !!backupPath, backupPath });
});

apiRouter.post('/storage/verify-restart', authManager.requireRole(['developer']), async (_req, res, next) => {
  try {
    const result = await engine.durableStore.verifyRestartDurability();
    res.json({ success: true, result });
  } catch (err) {
    next(err);
  }
});

/**
 * 7. Self-Diagnostics Subsystem (Developer Privileged)
 */
apiRouter.get('/diagnostics/run', authManager.requireRole(['developer']), async (_req, res, next) => {
  try {
    const report = await engine.runDiagnostics();
    res.json({ success: true, report });
  } catch (err) {
    next(err);
  }
});

apiRouter.get('/diagnostics/reports', authManager.requireRole(['developer']), (_req, res) => {
  const reports = engine.durableStore.getDiagnosticReports(20);
  res.json({ reports });
});

/**
 * 8. Autonomous Self-Repair Subsystem (Developer Privileged)
 */
apiRouter.post('/repair/run', authManager.requireRole(['developer']), async (req, res, next) => {
  try {
    const { findingId } = req.body;
    const outcomes = await engine.runAutonomousRepair(findingId);
    res.json({ success: true, outcomes });
  } catch (err) {
    next(err);
  }
});

apiRouter.get('/repair/history', authManager.requireRole(['developer']), (_req, res) => {
  const history = engine.durableStore.getRepairResults(20);
  res.json({ history });
});

apiRouter.post('/repair/test-harmless-fault', authManager.requireRole(['developer']), async (_req, res, next) => {
  try {
    const testOutcome = await engine.repair.testHarmlessFaultSelfRepair();
    res.json({ success: true, testOutcome });
  } catch (err) {
    next(err);
  }
});

/**
 * 9. Safe Self-Build & Checkpoints (Developer Privileged)
 */
apiRouter.post('/build/execute', authManager.requireRole(['developer']), async (req, res, next) => {
  try {
    const { goal, targetFiles, fileChanges } = req.body;
    if (!goal || !targetFiles || !fileChanges) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        message: 'Fields "goal", "targetFiles", and "fileChanges" are required.',
        statusCode: 400,
      });
    }

    const result = await engine.selfBuild.executeProjectBuild(
      goal,
      targetFiles,
      fileChanges,
      {
        workspaceRoot: process.cwd(),
        permissionGrant: ['READ_ONLY', 'WORKSPACE_WRITE'],
      }
    );
    res.json({ success: result.success, result });
  } catch (err) {
    next(err);
  }
});

apiRouter.get('/build/checkpoints', authManager.requireRole(['developer']), (_req, res) => {
  const checkpoints = engine.durableStore.listCheckpoints();
  res.json({ checkpoints });
});

apiRouter.post('/build/checkpoints/:id/restore', authManager.requireRole(['developer']), (req, res, next) => {
  try {
    const success = engine.selfBuild.restoreCheckpoint(req.params.id);
    if (!success) {
      throw new AppError({
        code: 'NOT_FOUND',
        message: `Checkpoint "${req.params.id}" not found.`,
        statusCode: 404,
      });
    }
    res.json({ success: true, message: `Restored checkpoint ${req.params.id}` });
  } catch (err) {
    next(err);
  }
});

/**
 * 10. Future Assistant Foundation (RARE-THE-SIXTH)
 */
apiRouter.post('/assistant/token-budget', authManager.requireRole(['client', 'developer']), (req, res, next) => {
  try {
    const { messages, maxLimit } = req.body;
    if (!messages || !Array.isArray(messages)) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        message: 'Array of "messages" is required.',
        statusCode: 400,
      });
    }
    const budget = engine.assistant.estimateTokenBudget(messages, maxLimit);
    res.json({ success: true, budget });
  } catch (err) {
    next(err);
  }
});

apiRouter.post('/assistant/research', authManager.requireRole(['client', 'developer']), (req, res, next) => {
  try {
    const { topic, notes } = req.body;
    if (!topic) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        message: 'Field "topic" is required.',
        statusCode: 400,
      });
    }
    const research = engine.assistant.conductGroundedResearch(topic, notes || []);
    res.json({ success: true, research });
  } catch (err) {
    next(err);
  }
});

apiRouter.post('/assistant/document-parse', authManager.requireRole(['client', 'developer']), (req, res, next) => {
  try {
    const { filename, content } = req.body;
    if (!filename || !content) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        message: 'Fields "filename" and "content" are required.',
        statusCode: 400,
      });
    }
    const parsed = engine.assistant.parseDocumentContent(filename, content);
    res.json({ success: true, parsed });
  } catch (err) {
    next(err);
  }
});

apiRouter.post('/assistant/safe-url-read', authManager.requireRole(['client', 'developer']), async (req, res, next) => {
  try {
    const { url } = req.body;
    if (!url) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        message: 'Field "url" is required.',
        statusCode: 400,
      });
    }
    const outcome = await engine.assistant.fetchSafeUrlContent(url);
    res.json({ success: outcome.success, outcome });
  } catch (err) {
    next(err);
  }
});

apiRouter.get('/assistant/multimodal-capabilities', authManager.requireRole(['client', 'developer']), (_req, res) => {
  res.json({ capabilities: engine.assistant.getMultimodalCapabilities() });
});

/**
 * 11. Circuit Breaker Controls
 */
apiRouter.get('/circuit-breaker/stats', authManager.requireRole(['client', 'developer']), (_req, res) => {
  res.json({ stats: engine.providerCircuitBreaker.getStats() });
});

apiRouter.post('/circuit-breaker/reset', authManager.requireRole(['developer']), (_req, res) => {
  engine.providerCircuitBreaker.reset();
  res.json({ success: true, message: 'Provider circuit breaker reset to CLOSED.' });
});

/**
 * 12. Network & Offline State Management
 */
apiRouter.get('/network/status', authManager.requireRole(['client', 'developer']), (_req, res) => {
  res.json({
    isOnline: engine.networkManager.isOnline(),
    state: engine.networkManager.getState(),
    simulatedOffline: engine.networkManager.isSimulatedOffline(),
  });
});

apiRouter.post('/network/simulate-offline', authManager.requireRole(['developer']), (req, res) => {
  const { enabled } = req.body;
  engine.networkManager.setSimulatedOffline(!!enabled);
  res.json({
    success: true,
    simulatedOffline: engine.networkManager.isSimulatedOffline(),
    state: engine.networkManager.getState(),
  });
});

apiRouter.post('/network/probe', authManager.requireRole(['developer']), async (_req, res, next) => {
  try {
    const isOnline = await engine.networkManager.probeConnectivity();
    res.json({ success: true, isOnline });
  } catch (err) {
    next(err);
  }
});

/**
 * 13. Local Runtime, Hardware & Model Management
 */
apiRouter.get('/runtime/local', authManager.requireRole(['client', 'developer']), async (_req, res, next) => {
  try {
    const ollama = engine.providers.getProvider('ollama') as any;
    const runtimeInfo = await ollama.getLocalRuntimeInfo();
    res.json({ success: true, runtime: runtimeInfo });
  } catch (err) {
    next(err);
  }
});

apiRouter.get('/runtime/hardware', authManager.requireRole(['client', 'developer']), (_req, res) => {
  res.json({
    success: true,
    hardware: DeviceHardwareEvaluator.inspectHostResources(),
    profiles: DeviceHardwareEvaluator.getTargetDeviceProfiles(),
    activeOverride: DeviceHardwareEvaluator.getTargetProfileOverride(),
  });
});

apiRouter.post('/runtime/hardware/profile', authManager.requireRole(['developer']), (req, res) => {
  const { profile } = req.body;
  DeviceHardwareEvaluator.setTargetProfileOverride(profile || null);
  res.json({
    success: true,
    activeOverride: DeviceHardwareEvaluator.getTargetProfileOverride(),
    hardware: DeviceHardwareEvaluator.inspectHostResources(),
  });
});

apiRouter.get('/runtime/models/catalog', authManager.requireRole(['client', 'developer']), (_req, res) => {
  res.json({
    success: true,
    catalog: DeviceHardwareEvaluator.getKnownModelCatalog(),
    hardware: DeviceHardwareEvaluator.inspectHostResources(),
  });
});

apiRouter.get('/runtime/models/installed', authManager.requireRole(['client', 'developer']), async (_req, res, next) => {
  try {
    const installed = await engine.localModelManager.getInstalledModels();
    res.json({ success: true, installed });
  } catch (err) {
    next(err);
  }
});

apiRouter.get('/runtime/models/setup/status', authManager.requireRole(['client', 'developer']), (_req, res) => {
  res.json({
    success: true,
    setupProgress: engine.localModelManager.getActiveSetupProgress(),
  });
});

apiRouter.post('/runtime/models/setup', authManager.requireRole(['developer']), async (req, res, next) => {
  try {
    const { modelName } = req.body;
    if (!modelName) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        message: 'Field "modelName" is required.',
        statusCode: 400,
      });
    }
    const progress = await engine.localModelManager.initiateModelSetup(modelName);
    res.json({ success: true, progress });
  } catch (err) {
    next(err);
  }
});

apiRouter.post('/runtime/models/setup/cancel', authManager.requireRole(['developer']), (_req, res) => {
  const cancelled = engine.localModelManager.cancelModelSetup();
  res.json({ success: true, cancelled });
});

apiRouter.post('/providers/resolve', authManager.requireRole(['developer']), async (req, res, next) => {
  try {
    const decision = await engine.providers.resolveProviderForTask(req.body);
    res.json({ success: true, decision });
  } catch (err) {
    next(err);
  }
});

/**
 * 13.5. Durable Conversations Persistence
 */
apiRouter.get('/conversations', authManager.requireRole(['client', 'developer']), (_req, res) => {
  res.json({
    success: true,
    conversations: engine.listConversations(),
  });
});

apiRouter.get('/conversations/:id', authManager.requireRole(['client', 'developer']), (req, res, next) => {
  try {
    const conversation = engine.getConversation(req.params.id);
    if (!conversation) {
      throw new AppError({
        code: 'NOT_FOUND',
        message: `Conversation session "${req.params.id}" not found.`,
        statusCode: 404,
      });
    }
    res.json({ success: true, conversation });
  } catch (err) {
    next(err);
  }
});

apiRouter.post('/conversations', authManager.requireRole(['client', 'developer']), (req, res, next) => {
  try {
    const { id, title, messages, metadata } = req.body || {};
    const generatedId = id || 'conv_' + Math.random().toString(36).substring(2, 9);
    const session = {
      id: generatedId,
      title: title || 'New Conversation',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: messages || [],
      metadata: metadata || {},
    };
    engine.saveConversation(session);
    res.json({
      success: true,
      id: session.id,
      conversationId: session.id,
      session,
      conversation: session,
    });
  } catch (err) {
    next(err);
  }
});

apiRouter.patch('/conversations/:id', authManager.requireRole(['client', 'developer']), (req, res, next) => {
  try {
    const conversation = engine.getConversation(req.params.id);
    if (!conversation) {
      throw new AppError({
        code: 'NOT_FOUND',
        message: `Conversation session "${req.params.id}" not found.`,
        statusCode: 404,
      });
    }
    const { title, metadata } = req.body || {};
    if (title !== undefined) conversation.title = String(title).trim();
    if (metadata !== undefined) conversation.metadata = { ...conversation.metadata, ...metadata };
    conversation.updatedAt = Date.now();
    engine.saveConversation(conversation);
    res.json({ success: true, conversation, session: conversation });
  } catch (err) {
    next(err);
  }
});

apiRouter.get('/conversations/:id/messages', authManager.requireRole(['client', 'developer']), (req, res, next) => {
  try {
    const conversation = engine.getConversation(req.params.id);
    if (!conversation) {
      throw new AppError({
        code: 'NOT_FOUND',
        message: `Conversation session "${req.params.id}" not found.`,
        statusCode: 404,
      });
    }
    res.json({ success: true, messages: conversation.messages });
  } catch (err) {
    next(err);
  }
});

apiRouter.post('/conversations/:id/messages', authManager.requireRole(['client', 'developer']), async (req, res, next) => {
  try {
    const conversationId = req.params.id;
    let conv = engine.getConversation(conversationId);
    if (!conv) {
      conv = {
        id: conversationId,
        title: req.body?.message ? String(req.body.message).substring(0, 30) : 'New Conversation',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
        metadata: {},
      };
    }

    const { message, content, options } = req.body || {};
    const userText = message || content;
    if (!userText || !String(userText).trim()) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        message: 'Message content is required ("message" or "content").',
        statusCode: 400,
      });
    }

    const userMessage = {
      role: 'user' as const,
      content: String(userText).trim(),
      timestamp: Date.now(),
    };
    conv.messages.push(userMessage);

    const result = await engine.chat(conv.messages, options);

    const modelMessage = {
      role: 'model' as const,
      content: result.text,
      timestamp: Date.now(),
      metadata: {
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        isSimulated: result.isSimulated,
      },
    };
    conv.messages.push(modelMessage);
    conv.updatedAt = Date.now();
    engine.saveConversation(conv);

    res.json({
      success: true,
      conversationId: conv.id,
      session: conv,
      conversation: conv,
      message: modelMessage,
      result,
    });
  } catch (err) {
    next(err);
  }
});

apiRouter.delete('/conversations/:id', authManager.requireRole(['client', 'developer']), (req, res) => {
  const deleted = engine.deleteConversation(req.params.id);
  res.json({ success: true, deleted });
});

/**
 * 14. Persistent Offline Task Queue
 */
apiRouter.post('/queue/enqueue', authManager.requireRole(['client', 'developer']), (req, res, next) => {
  try {
    const { objective, networkDependency, constraints } = req.body;
    if (!objective) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        message: 'Field "objective" is required.',
        statusCode: 400,
      });
    }
    const task = engine.enqueueTask(objective, networkDependency || 'local_only', constraints || []);
    res.json({ success: true, task });
  } catch (err) {
    next(err);
  }
});

apiRouter.get('/queue/tasks', authManager.requireRole(['client', 'developer']), (_req, res) => {
  res.json({
    stats: engine.taskQueue.getQueueStats(),
    tasks: engine.taskQueue.listTasks(),
  });
});

apiRouter.post('/queue/tasks/:id/execute', authManager.requireRole(['client', 'developer']), async (req, res, next) => {
  try {
    const task = await engine.taskQueue.executeTaskById(
      req.params.id,
      engine.providers.getActiveProvider()
    );
    res.json({ success: true, task });
  } catch (err) {
    next(err);
  }
});

apiRouter.post('/queue/tasks/:id/pause', authManager.requireRole(['client', 'developer']), (req, res, next) => {
  try {
    const task = engine.taskQueue.pauseTask(req.params.id, req.body.reason || 'Paused by operator');
    res.json({ success: true, task });
  } catch (err) {
    next(err);
  }
});

/**
 * 15. Benchmarks & Continuous Improvement
 */
apiRouter.get('/benchmarks', authManager.requireRole(['client', 'developer']), (_req, res) => {
  res.json({ tasks: STANDARD_BENCHMARK_TASKS });
});

apiRouter.post('/benchmarks/run', authManager.requireRole(['developer']), async (_req, res, next) => {
  try {
    const active = engine.providers.getActiveProvider();
    const suiteResult = await engine.benchmarks.runFullSuite(active);
    res.json({ success: true, suiteResult });
  } catch (err) {
    next(err);
  }
});

/**
 * 16. Upgrade Registry & Rollback
 */
apiRouter.get('/upgrades', authManager.requireRole(['client', 'developer']), (_req, res) => {
  res.json({
    activeCandidate: engine.upgrades.getActiveCandidate(),
    candidates: engine.upgrades.getCandidates(),
  });
});

apiRouter.post('/upgrades/adopt', authManager.requireRole(['developer']), (req, res, next) => {
  try {
    const { version, approvedBy } = req.body;
    const adopted = engine.upgrades.adoptUpgrade(version, approvedBy || 'Manual Operator');
    res.json({ success: true, adopted });
  } catch (err) {
    next(err);
  }
});

apiRouter.post('/upgrades/rollback', authManager.requireRole(['developer']), (req, res, next) => {
  try {
    const { reason } = req.body;
    const previous = engine.upgrades.rollback(reason || 'Operator requested rollback');
    res.json({ success: true, active: previous });
  } catch (err) {
    next(err);
  }
});

/**
 * 17. Automated Quality Gate Test Runner (Developer Privileged)
 */
apiRouter.post('/tests/run', authManager.requireRole(['developer']), async (_req, res, next) => {
  try {
    const summary = await EngineTestSuiteRunner.runAllTests();
    res.json({ success: true, summary });
  } catch (err) {
    next(err);
  }
});

/**
 * 18. System Diagnostics Logs (Developer Privileged)
 */
apiRouter.get('/diagnostics/logs', authManager.requireRole(['developer']), (_req, res) => {
  res.json({ logs: logger.getRecentLogs(100) });
});

// Mount API routers
app.use('/api/v1', apiRouter);
app.use('/api', apiRouter);

// ==========================================
// CENTRALIZED EXPRESS ERROR MIDDLEWARE
// ==========================================
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const correlationId = (req as any).correlationId || 'err_' + Math.random().toString(36).substring(2, 9);
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const code = isAppError ? err.code : 'INTERNAL_SERVER_ERROR';
  const rawMessage = isAppError ? err.message : 'An internal engine error occurred.';
  const safeMessage = defaultSecurityGuard.sanitizeSecrets(rawMessage);

  logger.error('HttpErrorHandler', `[${correlationId}] ${code} (${statusCode}): ${err.message}`);

  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message: safeMessage,
      correlationId,
      statusCode,
      timestamp: Date.now(),
      isTransient: isAppError ? err.isTransient : false,
    },
  });
});

// ==========================================
// VITE SPA INTEGRATION
// ==========================================
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    logger.info('Server', `RARE-INTELLIGENCE Server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
