import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private client: Redis | null = null;
  private readonly logger = new Logger(RedisService.name);
  private connected = false;

  constructor(private configService: ConfigService) {
    try {
      const redisUrl = this.configService.get<string>('REDIS_URL');

      if (redisUrl) {
        this.client = new Redis(redisUrl, { maxRetriesPerRequest: 3, retryStrategy: (times) => (times > 3 ? null : Math.min(times * 500, 2000)) });
      } else {
        this.client = new Redis({
          host: this.configService.get<string>('redis.host', 'localhost'),
          port: this.configService.get<number>('redis.port', 6379),
          maxRetriesPerRequest: 3,
          retryStrategy: (times) => (times > 3 ? null : Math.min(times * 500, 2000)),
        });
      }

      this.client.on('connect', () => {
        this.connected = true;
        this.logger.log('Connected to Redis');
      });
      this.client.on('error', (err) => {
        this.connected = false;
        this.logger.warn('Redis unavailable - caching disabled');
      });
      this.client.on('close', () => {
        this.connected = false;
      });
    } catch {
      this.logger.warn('Redis not configured - caching disabled');
      this.client = null;
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.client || !this.connected) return null;
    try { return await this.client.get(key); } catch { return null; }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.client || !this.connected) return;
    try {
      if (ttlSeconds) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
    } catch { /* ignore */ }
  }

  async del(key: string): Promise<void> {
    if (!this.client || !this.connected) return;
    try { await this.client.del(key); } catch { /* ignore */ }
  }

  async invalidatePattern(pattern: string): Promise<void> {
    if (!this.client || !this.connected) return;
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } catch { /* ignore */ }
  }

  getClient(): Redis | null {
    return this.client;
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
      this.logger.log('Redis connection closed');
    }
  }
}
