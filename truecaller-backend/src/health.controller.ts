import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './database/prisma.service';
import { OllamaService } from './modules/ollama/ollama.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ollamaService: OllamaService,
  ) {}

  @Get()
  async check() {
    let database = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }

    const ai = this.ollamaService.getStatus();

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database,
      ai: {
        enabled: ai.enabled,
        ready: ai.ready,
        model: ai.model,
      },
    };
  }
}
