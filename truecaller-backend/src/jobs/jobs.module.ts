import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NumbersProcessor } from './numbers.processor';

@Module({
  imports: [BullModule.registerQueue({ name: 'numbers' })],
  providers: [NumbersProcessor],
})
export class JobsModule {}
