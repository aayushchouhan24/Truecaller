/**
 * Multi-Layer Profile Cache
 *
 * 3-layer read-through cache for NumberProfile lookups:
 *   L1 → In-memory LRU (≤10 000 entries, 5 min TTL)  — p50 < 1 ms
 *   L2 → Redis         (24 h TTL)                     — p50 < 5 ms
 *   L3 → PostgreSQL    (single indexed read)           — p50 < 15 ms
 *
 * Invalidation:
 *   Worker calls `invalidate(phone)` after writing to number_profiles.
 *   Both L1 and L2 are deleted; next lookup refills from L3.
 *
 * Zero compute on read — the value stored is the final serialised response.
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { NumberProfile } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';

// ── LRU node for doubly-linked list ───────────────────────────────

interface LRUNode<V> {
  key: string;
  value: V;
  expiresAt: number;
  prev: LRUNode<V> | null;
  next: LRUNode<V> | null;
}

// ── Serialisable profile shape (matches NumberProfile model) ──────

export interface CachedProfile {
  phoneNumber: string;
  resolvedName: string | null;
  description: string | null;
  confidence: number;
  spamScore: number;
  spamCategory: string | null;
  category: string | null;
  tags: string[];
  relationshipHint: string | null;
  sourceCount: number;
  isVerified: boolean;
}

// ── Constants ─────────────────────────────────────────────────────

const L1_MAX_SIZE = 10_000;
const L1_TTL_MS = 5 * 60 * 1000;       // 5 minutes
const L2_TTL_SEC = 86_400;              // 24 hours
const NULL_TTL_SEC = 300;               // 5 min for "not found" sentinel
const REDIS_PREFIX = 'profile:';

@Injectable()
export class ProfileCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(ProfileCacheService.name);

  // ── L1: In-memory LRU ───────────────────────────────────────────
  private map = new Map<string, LRUNode<CachedProfile | null>>();
  private head: LRUNode<CachedProfile | null> | null = null;
  private tail: LRUNode<CachedProfile | null> | null = null;
  private evictionTimer: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    // Periodic L1 eviction of expired entries (every 30 s)
    this.evictionTimer = setInterval(() => this.evictExpired(), 30_000);
  }

  onModuleDestroy() {
    clearInterval(this.evictionTimer);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Get a profile through all 3 layers. Returns null if the number
   * has never been seen. Callers should treat null as "unknown number".
   */
  async get(phoneNumber: string): Promise<CachedProfile | null> {
    // ── L1 ──
    const l1 = this.l1Get(phoneNumber);
    if (l1 !== undefined) {
      return l1; // may be null (negative cache)
    }

    // ── L2 ──
    const l2Raw = await this.redis.get(`${REDIS_PREFIX}${phoneNumber}`);
    if (l2Raw !== null) {
      const parsed: CachedProfile | null = JSON.parse(l2Raw);
      this.l1Set(phoneNumber, parsed);
      return parsed;
    }

    // ── L3 ──
    const row: NumberProfile | null = await this.prisma.numberProfile.findUnique({
      where: { phoneNumber },
    });

    if (!row) {
      // Negative cache — avoid repeated DB misses
      await this.redis.set(
        `${REDIS_PREFIX}${phoneNumber}`,
        'null',
        NULL_TTL_SEC,
      );
      this.l1Set(phoneNumber, null);
      return null;
    }

    const profile: CachedProfile = {
      phoneNumber: row.phoneNumber,
      resolvedName: row.resolvedName,
      description: row.description,
      confidence: row.confidence,
      spamScore: row.spamScore,
      spamCategory: row.spamCategory,
      category: row.category,
      tags: row.tags,
      relationshipHint: row.relationshipHint,
      sourceCount: row.sourceCount,
      isVerified: row.isVerified,
    };

    // Back-fill L1 + L2
    await this.redis.set(
      `${REDIS_PREFIX}${phoneNumber}`,
      JSON.stringify(profile),
      L2_TTL_SEC,
    );
    this.l1Set(phoneNumber, profile);

    return profile;
  }

  /**
   * Invalidate a phone number across all cache layers.
   * Called by the worker after writing to number_profiles.
   */
  async invalidate(phoneNumber: string): Promise<void> {
    this.l1Delete(phoneNumber);
    await this.redis.del(`${REDIS_PREFIX}${phoneNumber}`);
  }

  /**
   * Batch invalidation.
   */
  async invalidateMany(phoneNumbers: string[]): Promise<void> {
    for (const p of phoneNumbers) {
      this.l1Delete(p);
    }
    await Promise.all(
      phoneNumbers.map((p) => this.redis.del(`${REDIS_PREFIX}${p}`)),
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // L1 LRU Implementation
  // ═══════════════════════════════════════════════════════════════════

  /** Returns `undefined` if key is absent or expired. */
  private l1Get(key: string): CachedProfile | null | undefined {
    const node = this.map.get(key);
    if (!node) return undefined;
    if (Date.now() > node.expiresAt) {
      this.l1Delete(key);
      return undefined;
    }
    this.moveToHead(node);
    return node.value;
  }

  private l1Set(key: string, value: CachedProfile | null): void {
    const existing = this.map.get(key);
    if (existing) {
      existing.value = value;
      existing.expiresAt = Date.now() + L1_TTL_MS;
      this.moveToHead(existing);
      return;
    }

    const node: LRUNode<CachedProfile | null> = {
      key,
      value,
      expiresAt: Date.now() + L1_TTL_MS,
      prev: null,
      next: null,
    };
    this.map.set(key, node);
    this.addToHead(node);

    if (this.map.size > L1_MAX_SIZE) {
      this.evictTail();
    }
  }

  private l1Delete(key: string): void {
    const node = this.map.get(key);
    if (!node) return;
    this.removeNode(node);
    this.map.delete(key);
  }

  // ── Doubly-linked list helpers (O(1) operations) ────────────────

  private addToHead(node: LRUNode<any>): void {
    node.prev = null;
    node.next = this.head;
    if (this.head) this.head.prev = node;
    this.head = node;
    if (!this.tail) this.tail = node;
  }

  private removeNode(node: LRUNode<any>): void {
    if (node.prev) node.prev.next = node.next;
    else this.head = node.next;
    if (node.next) node.next.prev = node.prev;
    else this.tail = node.prev;
    node.prev = null;
    node.next = null;
  }

  private moveToHead(node: LRUNode<any>): void {
    if (this.head === node) return;
    this.removeNode(node);
    this.addToHead(node);
  }

  private evictTail(): void {
    if (!this.tail) return;
    const key = this.tail.key;
    this.removeNode(this.tail);
    this.map.delete(key);
  }

  private evictExpired(): void {
    const now = Date.now();
    let node = this.tail;
    while (node && now > node.expiresAt) {
      const prev = node.prev;
      this.map.delete(node.key);
      this.removeNode(node);
      node = prev;
    }
  }
}
