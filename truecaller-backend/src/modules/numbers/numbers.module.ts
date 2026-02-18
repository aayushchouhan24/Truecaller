import { Module } from '@nestjs/common';
import { NumbersController } from './numbers.controller';
import { NumbersService } from './numbers.service';
import { IdentityModule } from '../identity/identity.module';
import { SpamModule } from '../spam/spam.module';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [
    DatabaseModule,
    IdentityModule,
    SpamModule,
    // EventBusModule and CacheModule are @Global — no import needed
  ],
  controllers: [NumbersController],
  providers: [NumbersService],
  exports: [NumbersService],
})
export class NumbersModule {}
