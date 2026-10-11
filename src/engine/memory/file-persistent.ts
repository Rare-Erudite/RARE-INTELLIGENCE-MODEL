/**
 * RARE-INTELLIGENCE — Durable Multi-Collection Persistent Storage Engine
 * High-reliability file-backed storage with atomic writes, SHA-256 integrity checksums,
 * rotating backups, automatic corruption recovery, retention management, and schema migrations.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { IMemoryStore } from './base.js';
import {
  ConversationSession,
  DiagnosticReport,
  MemoryItem,
  SelfRepairResult,
  TaskPlan,
  WorkspaceCheckpoint,
} from '../types.js';
import { DeviceHardwareEvaluator } from '../providers/device-evaluator.js';
import { logger } from '../security/logger.js';

export interface StorageMetadata {
  schemaVersion: number;
  engineVersion: string;
  checksum: string;
  updatedAt: number;
  lastBackupAt: number;
  filesystemDurability: 'persistent_filesystem' | 'ephemeral_sandbox';
  itemCounts: Record<string, number>;
}

export interface PersistentDataPayload {
  metadata: StorageMetadata;
  memories: Record<string, MemoryItem>;
  conversations: Record<string, ConversationSession>;
  tasks: Record<string, TaskPlan>;
  diagnostics: Record<string, DiagnosticReport>;
  repairs: Record<string, SelfRepairResult>;
  checkpoints: Record<string, WorkspaceCheckpoint>;
  providerConfig: Record<string, any>;
  auditEvents: Array<{ id: string; timestamp: number; type: string; payload: any }>;
}

export class FilePersistentStore implements IMemoryStore {
  public readonly storageType = 'file-backed-persistent';
  public readonly isPersistent = true;
  private readonly dataDir: string;
  private readonly backupsDir: string;
  private readonly primaryFilePath: string;
  private payload: PersistentDataPayload;
  private writeLock = false;

  constructor(storageDir?: string) {
    this.dataDir = storageDir || path.resolve(process.cwd(), 'data');
    this.backupsDir = path.join(this.dataDir, 'backups');
    this.primaryFilePath = path.join(this.dataDir, 'rare_intelligence_memory.json');

    this.ensureDirectories();
    this.payload = this.getEmptyPayload();
    this.loadFromDisk();
  }

  private ensureDirectories() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    if (!fs.existsSync(this.backupsDir)) {
      fs.mkdirSync(this.backupsDir, { recursive: true });
    }
  }

  private getEmptyPayload(): PersistentDataPayload {
    const hw = DeviceHardwareEvaluator.inspectHostResources();
    return {
      metadata: {
        schemaVersion: 2,
        engineVersion: '1.0.0-rc1',
        checksum: '',
        updatedAt: Date.now(),
        lastBackupAt: Date.now(),
        filesystemDurability: hw.storageDurability,
        itemCounts: {},
      },
      memories: {},
      conversations: {},
      tasks: {},
      diagnostics: {},
      repairs: {},
      checkpoints: {},
      providerConfig: {
        preferredProvider: 'gemini',
        localModel: 'llama3.2:1b',
        autoResumeTasks: true,
      },
      auditEvents: [],
    };
  }

  private computeChecksum(dataString: string): string {
    return crypto.createHash('sha256').update(dataString).digest('hex');
  }

  private loadFromDisk() {
    try {
      if (fs.existsSync(this.primaryFilePath)) {
        const raw = fs.readFileSync(this.primaryFilePath, 'utf-8');
        let parsed: any;
        try {
          parsed = JSON.parse(raw);
        } catch (jsonErr: any) {
          logger.error(
            'FilePersistentStore',
            `Primary data file corrupted: ${jsonErr.message}. Attempting safe recovery from backup.`
          );
          const recovered = this.attemptRestoreFromBackup();
          if (!recovered) {
            // Quarantine corrupted file so data is preserved for forensics
            const quarantinePath = path.join(
              this.dataDir,
              `rare_intelligence_memory.corrupt.${Date.now()}.json`
            );
            try {
              fs.copyFileSync(this.primaryFilePath, quarantinePath);
              logger.warn(
                'FilePersistentStore',
                `Quarantined corrupted database to: ${path.basename(quarantinePath)}. Starting in documented safe degraded state.`
              );
            } catch {}
            this.payload = this.getEmptyPayload();
            this.seedInitialKnowledge();
            this.flushToDisk();
          }
          return;
        }

        // Migrate legacy array format if detected
        if (Array.isArray(parsed)) {
          logger.info('FilePersistentStore', 'Migrating legacy memory array to multi-collection payload format.');
          this.payload = this.getEmptyPayload();
          for (const item of parsed) {
            this.payload.memories[item.key] = { ...item, isPersistent: true };
          }
          this.flushToDisk();
          return;
        }

        // Schema migrations and verification
        if (parsed && parsed.metadata && parsed.memories) {
          this.payload = {
            ...this.getEmptyPayload(),
            ...parsed,
            metadata: {
              ...this.getEmptyPayload().metadata,
              ...parsed.metadata,
              schemaVersion: 2,
            },
            conversations: parsed.conversations || {},
            providerConfig: parsed.providerConfig || this.getEmptyPayload().providerConfig,
          };
          logger.info(
            'FilePersistentStore',
            `Successfully loaded persistent storage: ${Object.keys(this.payload.memories).length} memories, ${Object.keys(this.payload.tasks).length} tasks, ${Object.keys(this.payload.conversations).length} conversations.`
          );
        } else {
          logger.warn('FilePersistentStore', 'Unexpected storage payload format. Seeding defaults.');
          this.seedInitialKnowledge();
          this.flushToDisk();
        }
      } else {
        logger.info('FilePersistentStore', 'No existing storage file found. Initializing foundational memory store.');
        this.seedInitialKnowledge();
        this.flushToDisk();
      }
    } catch (err: any) {
      logger.error('FilePersistentStore', `Error loading storage: ${err.message}. Initializing defaults.`);
      this.payload = this.getEmptyPayload();
      this.seedInitialKnowledge();
    }
  }

  private attemptRestoreFromBackup(): boolean {
    try {
      if (!fs.existsSync(this.backupsDir)) return false;
      const backupFiles = fs
        .readdirSync(this.backupsDir)
        .filter((f) => f.startsWith('backup_') && f.endsWith('.json'))
        .sort()
        .reverse();

      for (const backupFile of backupFiles) {
        const fullPath = path.join(this.backupsDir, backupFile);
        try {
          const raw = fs.readFileSync(fullPath, 'utf-8');
          const parsed = JSON.parse(raw);
          if (parsed && parsed.memories) {
            this.payload = {
              ...this.getEmptyPayload(),
              ...parsed,
              conversations: parsed.conversations || {},
            };
            this.flushToDisk();
            logger.info('FilePersistentStore', `Successfully recovered store from backup: ${backupFile}`);
            return true;
          }
        } catch {
          // try next backup
        }
      }
    } catch (err: any) {
      logger.error('FilePersistentStore', `Backup restore failed: ${err.message}`);
    }
    return false;
  }

  public createBackup(): string | null {
    try {
      this.ensureDirectories();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(this.backupsDir, `backup_${timestamp}.json`);
      const dataStr = JSON.stringify(this.payload, null, 2);
      fs.writeFileSync(backupPath, dataStr, 'utf-8');

      // Rotate: keep max 5 newest backups
      const files = fs
        .readdirSync(this.backupsDir)
        .filter((f) => f.startsWith('backup_'))
        .sort();

      while (files.length > 5) {
        const oldest = files.shift();
        if (oldest) fs.unlinkSync(path.join(this.backupsDir, oldest));
      }

      this.payload.metadata.lastBackupAt = Date.now();
      logger.info('FilePersistentStore', `Created rotating backup: ${path.basename(backupPath)}`);
      return backupPath;
    } catch (err: any) {
      logger.error('FilePersistentStore', `Failed to create backup: ${err.message}`);
      return null;
    }
  }

  private flushToDisk() {
    if (this.writeLock) return;
    this.writeLock = true;

    try {
      this.ensureDirectories();
      this.enforceRetentionLimits();

      this.payload.metadata.updatedAt = Date.now();
      this.payload.metadata.itemCounts = {
        memories: Object.keys(this.payload.memories).length,
        conversations: Object.keys(this.payload.conversations).length,
        tasks: Object.keys(this.payload.tasks).length,
        diagnostics: Object.keys(this.payload.diagnostics).length,
        repairs: Object.keys(this.payload.repairs).length,
        checkpoints: Object.keys(this.payload.checkpoints).length,
        auditEvents: this.payload.auditEvents.length,
      };

      const raw = JSON.stringify(this.payload, null, 2);
      this.payload.metadata.checksum = this.computeChecksum(raw);

      // Atomic write: write to temp file then rename
      const tempPath = `${this.primaryFilePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(this.payload, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.primaryFilePath);

      // Periodically trigger backup if more than 30 mins elapsed
      if (Date.now() - (this.payload.metadata.lastBackupAt || 0) > 1800000) {
        this.createBackup();
      }
    } catch (err: any) {
      logger.error('FilePersistentStore', `Atomic disk flush failed: ${err.message}`);
    } finally {
      this.writeLock = false;
    }
  }

  private enforceRetentionLimits() {
    // Retention limits
    const maxAuditEvents = 200;
    if (this.payload.auditEvents.length > maxAuditEvents) {
      this.payload.auditEvents = this.payload.auditEvents.slice(-maxAuditEvents);
    }

    const maxDiagnostics = 50;
    const diagKeys = Object.keys(this.payload.diagnostics);
    if (diagKeys.length > maxDiagnostics) {
      const sorted = diagKeys.sort(
        (a, b) => this.payload.diagnostics[a].timestamp - this.payload.diagnostics[b].timestamp
      );
      for (const k of sorted.slice(0, diagKeys.length - maxDiagnostics)) {
        delete this.payload.diagnostics[k];
      }
    }

    const maxCheckpoints = 30;
    const checkpointKeys = Object.keys(this.payload.checkpoints);
    if (checkpointKeys.length > maxCheckpoints) {
      const sorted = checkpointKeys.sort(
        (a, b) => this.payload.checkpoints[a].createdAt - this.payload.checkpoints[b].createdAt
      );
      for (const k of sorted.slice(0, checkpointKeys.length - maxCheckpoints)) {
        delete this.payload.checkpoints[k];
      }
    }
  }

  private seedInitialKnowledge() {
    const seedItems = [
      {
        key: 'engine_core_directive',
        content:
          'RARE-INTELLIGENCE powers RARE-THE-SIXTH. Zero-budget policy enforced. Bounded execution loops only. Truthful reporting required.',
        category: 'project_fact' as const,
        tags: ['directive', 'architecture', 'budget'],
        source: 'engine_checkpoint' as const,
      },
      {
        key: 'continuous_improvement_protocol',
        content:
          'Capabilities must be benchmarked across reasoning, coding, math, and research before adopting version upgrades. Maintain rollbacks.',
        category: 'project_fact' as const,
        tags: ['upgrade', 'benchmarking', 'safeguards'],
        source: 'engine_checkpoint' as const,
      },
      {
        key: 'offline_first_policy',
        content:
          'Engine must operate network-independently. Never freeze on startup due to missing internet. Support real local models and deterministic tool execution.',
        category: 'project_fact' as const,
        tags: ['offline', 'resilience', 'local_inference'],
        source: 'engine_checkpoint' as const,
      },
    ];

    const now = Date.now();
    for (const item of seedItems) {
      this.payload.memories[item.key] = {
        ...item,
        id: 'seed_' + Math.random().toString(36).substring(2, 9),
        createdAt: now,
        updatedAt: now,
        isPersistent: true,
      };
    }
  }

  // ==========================================
  // IMemoryStore Standard Methods
  // ==========================================
  public async get(key: string): Promise<MemoryItem | null> {
    return this.payload.memories[key] || null;
  }

  public async set(
    item: Omit<MemoryItem, 'id' | 'createdAt' | 'updatedAt' | 'isPersistent'>
  ): Promise<MemoryItem> {
    const existing = this.payload.memories[item.key];
    const now = Date.now();

    const stored: MemoryItem = {
      ...item,
      id: existing?.id || 'mem_' + Math.random().toString(36).substring(2, 9),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      isPersistent: true,
    };

    this.payload.memories[item.key] = stored;
    this.flushToDisk();
    return stored;
  }

  public async delete(key: string): Promise<boolean> {
    if (this.payload.memories[key]) {
      delete this.payload.memories[key];
      this.flushToDisk();
      return true;
    }
    return false;
  }

  public async list(category?: MemoryItem['category']): Promise<MemoryItem[]> {
    const all = Object.values(this.payload.memories);
    if (!category) return all;
    return all.filter((i) => i.category === category);
  }

  public async search(query: string): Promise<MemoryItem[]> {
    const q = query.toLowerCase();
    return Object.values(this.payload.memories).filter(
      (i) =>
        i.key.toLowerCase().includes(q) ||
        i.content.toLowerCase().includes(q) ||
        i.tags.some((t) => t.toLowerCase().includes(q))
    );
  }

  public async clear(): Promise<void> {
    this.payload.memories = {};
    this.flushToDisk();
  }

  public async flush(): Promise<void> {
    this.flushToDisk();
  }

  // ==========================================
  // Multi-Collection Methods
  // ==========================================
  public saveTask(planOrTask: any): void {
    const id = planOrTask.id || planOrTask.taskId;
    if (id) {
      this.payload.tasks[id] = planOrTask;
      this.flushToDisk();
    }
  }

  public getTask(id: string): TaskPlan | null {
    return this.payload.tasks[id] || null;
  }

  public listTasks(): TaskPlan[] {
    return Object.values(this.payload.tasks).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // Conversations Collection
  public saveConversation(session: ConversationSession): void {
    this.payload.conversations[session.id] = session;
    this.flushToDisk();
  }

  public getConversation(id: string): ConversationSession | null {
    return this.payload.conversations[id] || null;
  }

  public listConversations(): ConversationSession[] {
    return Object.values(this.payload.conversations).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public deleteConversation(id: string): boolean {
    if (this.payload.conversations[id]) {
      delete this.payload.conversations[id];
      this.flushToDisk();
      return true;
    }
    return false;
  }

  // Diagnostic Reports Collection
  public saveDiagnosticReport(report: DiagnosticReport): void {
    this.payload.diagnostics[report.runId] = report;
    this.flushToDisk();
  }

  public getDiagnosticReports(limit = 20): DiagnosticReport[] {
    return Object.values(this.payload.diagnostics)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  // Self Repair Collection
  public saveRepairResult(result: SelfRepairResult): void {
    this.payload.repairs[result.repairId] = result;
    this.flushToDisk();
  }

  public getRepairResults(limit = 20): SelfRepairResult[] {
    return Object.values(this.payload.repairs)
      .sort((a, b) => (b.actionsTaken[0]?.timestamp || 0) - (a.actionsTaken[0]?.timestamp || 0))
      .slice(0, limit);
  }

  // Checkpoints Collection
  public saveCheckpoint(checkpoint: WorkspaceCheckpoint): void {
    this.payload.checkpoints[checkpoint.id] = checkpoint;
    this.flushToDisk();
  }

  public getCheckpoint(id: string): WorkspaceCheckpoint | null {
    return this.payload.checkpoints[id] || null;
  }

  public listCheckpoints(): WorkspaceCheckpoint[] {
    return Object.values(this.payload.checkpoints).sort((a, b) => b.createdAt - a.createdAt);
  }

  public deleteCheckpoint(id: string): boolean {
    if (this.payload.checkpoints[id]) {
      delete this.payload.checkpoints[id];
      this.flushToDisk();
      return true;
    }
    return false;
  }

  // Provider and Engine Config Persistence
  public saveProviderConfig(config: Record<string, any>): void {
    this.payload.providerConfig = {
      ...this.payload.providerConfig,
      ...config,
    };
    this.flushToDisk();
  }

  public getProviderConfig(): Record<string, any> {
    return this.payload.providerConfig;
  }

  public recordAuditEvent(type: string, payload: any): void {
    this.payload.auditEvents.push({
      id: 'audit_' + Math.random().toString(36).substring(2, 9),
      timestamp: Date.now(),
      type,
      payload,
    });
    this.flushToDisk();
  }

  public getStats() {
    return {
      storageType: this.storageType,
      isPersistent: this.isPersistent,
      primaryFilePath: this.primaryFilePath,
      filesystemDurability: this.payload.metadata.filesystemDurability,
      schemaVersion: this.payload.metadata.schemaVersion,
      counts: {
        memories: Object.keys(this.payload.memories).length,
        conversations: Object.keys(this.payload.conversations).length,
        tasks: Object.keys(this.payload.tasks).length,
        diagnostics: Object.keys(this.payload.diagnostics).length,
        repairs: Object.keys(this.payload.repairs).length,
        checkpoints: Object.keys(this.payload.checkpoints).length,
        auditEvents: this.payload.auditEvents.length,
      },
      updatedAt: this.payload.metadata.updatedAt,
      lastBackupAt: this.payload.metadata.lastBackupAt,
      checksum: this.payload.metadata.checksum,
    };
  }

  /**
   * Automated verification test that proves records survive restart/flush.
   */
  public async verifyRestartDurability(): Promise<{
    survived: boolean;
    testKey: string;
    details: string;
    durationMs: number;
  }> {
    const start = Date.now();
    const testKey = `restart_test_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const testContent = `Durability verification token ${Date.now()}`;

    // 1. Write unique record
    await this.set({
      key: testKey,
      content: testContent,
      category: 'project_fact',
      tags: ['durability_test'],
      source: 'diagnostic_system',
    });

    // 2. Wipe in-memory structure and simulate cold process restart
    this.payload.memories = {};
    this.loadFromDisk();

    // 3. Read back from freshly loaded file
    const recovered = await this.get(testKey);
    const survived = recovered !== null && recovered.content === testContent;

    // 4. Clean up test record
    if (survived) {
      await this.delete(testKey);
    }

    return {
      survived,
      testKey,
      details: survived
        ? 'Record flushed to disk, in-memory cache wiped, reloaded from disk, content matched.'
        : 'Record did not survive in-memory cache wipe reload.',
      durationMs: Date.now() - start,
    };
  }
}
