/**
 * RARE-INTELLIGENCE — Memory Store Interface
 */

import { MemoryItem } from '../types.js';

export interface IMemoryStore {
  readonly storageType: 'file-backed-persistent' | 'in-memory-volatile';
  readonly isPersistent: boolean;

  get(key: string): Promise<MemoryItem | null>;
  set(item: Omit<MemoryItem, 'id' | 'createdAt' | 'updatedAt' | 'isPersistent'>): Promise<MemoryItem>;
  delete(key: string): Promise<boolean>;
  list(category?: MemoryItem['category']): Promise<MemoryItem[]>;
  search(query: string): Promise<MemoryItem[]>;
  clear(): Promise<void>;
  flush?(): Promise<void>;
}
