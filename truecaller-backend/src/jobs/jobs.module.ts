import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NumbersProcessor } from './numbers.processor';
import { IdentityModule } from '../modules/identity/identity.module';
import { SpamModule } from '../modules/spam/spam.module';

@Module({
  imports: [BullModule.registerQueue({ name: 'numbers' }), IdentityModule, SpamModule],
  providers: [NumbersProcessor],
})
export class JobsModule {}
