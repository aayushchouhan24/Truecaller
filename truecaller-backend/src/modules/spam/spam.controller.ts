import { Controller, Get, Query } from '@nestjs/common';
import { SpamService } from './spam.service';

@Controller('spam')
export class SpamController {
  constructor(private readonly spamService: SpamService) {}

  @Get('numbers')
  getTopSpamNumbers(@Query('limit') limit?: string) {
    return this.spamService.getTopSpamNumbers(limit ? parseInt(limit, 10) : 20);
  }

  @Get('stats')
  getSpamStats() {
    return this.spamService.getSpamStats();
  }

  @Get('reports')
  getReportsForNumber(@Query('phoneNumber') phoneNumber: string) {
    return this.spamService.getReportsForNumber(phoneNumber);
  }
}
