import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EventBusService } from './event-bus.service';

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: 'profile-events' })],
  providers: [EventBusService],
  exports: [EventBusService],
})
export class EventBusModule {}
