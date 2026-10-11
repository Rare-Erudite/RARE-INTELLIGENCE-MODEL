/**
 * RARE-INTELLIGENCE — Volatile In-Memory Store
 * Explicitly warned: DATA WILL BE LOST ON PROCESS RESTART.
 */

import { IMemoryStore } from './base.js';
import { MemoryItem } from '../types.js';
import { logger } from '../security/logger.js';

export class InMemoryStore implements IMemoryStore {
  public readonly storageType = 'in-memory-volatile';
  public readonly isPersistent = false; // Strictly false
  private items: Map<string, MemoryItem> = new Map();

  constructor() {
    logger.warn(
      'InMemoryStore',
      'Using volatile in-memory store. DATA LOSS RISK: Memory will not survive process restart or redeployment.'
    );
  }

  public async get(key: string): Promise<MemoryItem | null> {
    return this.items.get(key) || null;
  }

  public async set(
    item: Omit<MemoryItem, 'id' | 'createdAt' | 'updatedAt' | 'isPersistent'>
  ): Promise<MemoryItem> {
    const existing = this.items.get(item.key);
    const now = Date.now();

    const stored: MemoryItem = {
      ...item,
      id: existing?.id || 'mem_' + Math.random().toString(36).substring(2, 9),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      isPersistent: false,
    };

    this.items.set(item.key, stored);
    return stored;
  }

  public async delete(key: string): Promise<boolean> {
    return this.items.delete(key);
  }

  public async list(category?: MemoryItem['category']): Promise<MemoryItem[]> {
    const all = Array.from(this.items.values());
    if (!category) return all;
    return all.filter((i) => i.category === category);
  }

  public async search(query: string): Promise<MemoryItem[]> {
    const q = query.toLowerCase();
    return Array.from(this.items.values()).filter(
      (i) =>
        i.key.toLowerCase().includes(q) ||
        i.content.toLowerCase().includes(q) ||
        i.tags.some((t) => t.toLowerCase().includes(q))
    );
  }

  public async clear(): Promise<void> {
    this.items.clear();
  }
}
