import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ProfileWorker } from './numbers.processor';
import { IdentityModule } from '../modules/identity/identity.module';
import { SpamModule } from '../modules/spam/spam.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'profile-events' }),
    IdentityModule,
    SpamModule,
  ],
  providers: [ProfileWorker],
})
export class JobsModule {}
