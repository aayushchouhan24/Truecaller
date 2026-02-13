import { Module } from '@nestjs/common';
import { CallHistoryController } from './call-history.controller';
import { CallHistoryService } from './call-history.service';
import { SpamModule } from '../spam/spam.module';

@Module({
  imports: [SpamModule],
  controllers: [CallHistoryController],
  providers: [CallHistoryService],
  exports: [CallHistoryService],
})
export class CallHistoryModule {}
