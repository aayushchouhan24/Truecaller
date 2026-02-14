/**
 * Identity Controller
 *
 * Exposes the Identity Intelligence Engine over HTTP.
 *
 * Endpoints:
 *   GET  /identity/resolve/:phoneNumber  — Run the full pipeline for a number.
 *   POST /identity/refresh-stats         — Recompute global token statistics.
 */

import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { IdentityIntelligenceService } from './identity-intelligence.service';
import { RedisService } from '../../redis/redis.service';

@Controller('identity')
@UseGuards(JwtAuthGuard)
export class IdentityController {
  constructor(
    private readonly intelligenceService: IdentityIntelligenceService,
    private readonly redisService: RedisService,
  ) {}

  @Get('resolve/:phoneNumber')
  async resolve(@Param('phoneNumber') phoneNumber: string) {
    const profile =
      await this.intelligenceService.resolveIdentityProfile(phoneNumber);
    return { success: true, data: profile };
  }

  @Post('refresh-stats')
  async refreshStats() {
    const result = await this.intelligenceService.refreshGlobalStats();
    return { success: true, data: result };
  }

  @Post('migrate-all')
  async migrateAll() {
    const result = await this.intelligenceService.migrateAll();
    return { success: true, data: result };
  }

  @Post('reload-names')
  async reloadNames() {
    await this.intelligenceService.loadNameReferences();
    return { success: true, message: 'Name references reloaded from DB' };
  }

  @Post('flush-cache')
  async flushCache() {
    await this.redisService.flushAll();
    return { success: true, message: 'All Redis cache cleared' };
  }
}
