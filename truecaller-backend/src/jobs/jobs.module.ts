import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NumbersProcessor } from './numbers.processor';
import { IdentityModule } from '../modules/identity/identity.module';

@Module({
  imports: [BullModule.registerQueue({ name: 'numbers' }), IdentityModule],
  providers: [NumbersProcessor],
})
export class JobsModule {}
