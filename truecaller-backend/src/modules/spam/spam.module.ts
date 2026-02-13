import { Module } from '@nestjs/common';
import { SpamService } from './spam.service';
import { SpamController } from './spam.controller';

@Module({
  controllers: [SpamController],
  providers: [SpamService],
  exports: [SpamService],
})
export class SpamModule {}
