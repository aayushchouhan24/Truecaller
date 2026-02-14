import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';

import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import redisConfig from './config/redis.config';
import jwtConfig from './config/jwt.config';
import ollamaConfig from './config/ollama.config';

import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { IdentityModule } from './modules/identity/identity.module';
import { NumbersModule } from './modules/numbers/numbers.module';
import { SpamModule } from './modules/spam/spam.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { FavoritesModule } from './modules/favorites/favorites.module';
import { JobsModule } from './jobs/jobs.module';
import { FirebaseModule } from './modules/firebase/firebase.module';
import { OllamaModule } from './modules/ollama/ollama.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, redisConfig, jwtConfig, ollamaConfig],
    }),

    // Rate Limiting
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.get<number>('app.throttleTtl', 60000),
            limit: config.get<number>('app.throttleLimit', 60),
          },
        ],
      }),
    }),

    // BullMQ
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL');
        if (redisUrl) {
          const url = new URL(redisUrl);
          return {
            connection: {
              host: url.hostname,
              port: parseInt(url.port, 10),
              username: url.username || undefined,
              password: url.password || undefined,
              tls: redisUrl.startsWith('rediss://') ? {} : undefined,
              maxRetriesPerRequest: null,
            },
          };
        }
        return {
          connection: {
            host: config.get<string>('redis.host', 'localhost'),
            port: config.get<number>('redis.port', 6379),
            maxRetriesPerRequest: null,
          },
        };
      },
    }),

    // Core modules
    DatabaseModule,
    RedisModule,
    FirebaseModule,
    OllamaModule,

    // Feature modules
    AuthModule,
    UsersModule,
    IdentityModule,
    NumbersModule,
    SpamModule,
    ContactsModule,
    FavoritesModule,
    JobsModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule { }
