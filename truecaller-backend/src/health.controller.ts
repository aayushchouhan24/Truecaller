import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';

@Controller()
export class HealthController {
  @Public()
  @Get('health')
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get()
  root() {
    return {
      service: 'Truecaller Backend API',
      status: 'running',
      timestamp: new Date().toISOString(),
    };
  }
}
