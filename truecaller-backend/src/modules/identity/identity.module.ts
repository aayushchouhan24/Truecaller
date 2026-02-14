import { Module } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { IdentityIntelligenceService } from './identity-intelligence.service';
import { IdentityController } from './identity.controller';

@Module({
  controllers: [IdentityController],
  providers: [IdentityService, IdentityIntelligenceService],
  exports: [IdentityService, IdentityIntelligenceService],
})
export class IdentityModule {}
