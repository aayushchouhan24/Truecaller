import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NumbersController } from './numbers.controller';
import { NumbersService } from './numbers.service';
import { IdentityModule } from '../identity/identity.module';
import { SpamModule } from '../spam/spam.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'numbers' }),
    IdentityModule,
    SpamModule,
  ],
  controllers: [NumbersController],
  providers: [NumbersService],
  exports: [NumbersService],
})
export class NumbersModule {}
