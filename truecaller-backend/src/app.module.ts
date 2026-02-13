import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';

import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import redisConfig from './config/redis.config';
import jwtConfig from './config/jwt.config';

import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { IdentityModule } from './modules/identity/identity.module';
import { NumbersModule } from './modules/numbers/numbers.module';
import { SpamModule } from './modules/spam/spam.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { CallHistoryModule } from './modules/call-history/call-history.module';
import { MessagesModule } from './modules/messages/messages.module';
import { SearchHistoryModule } from './modules/search-history/search-history.module';
import { FavoritesModule } from './modules/favorites/favorites.module';
import { JobsModule } from './jobs/jobs.module';
import { FirebaseModule } from './modules/firebase/firebase.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, redisConfig, jwtConfig],
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
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host', 'localhost'),
          port: config.get<number>('redis.port', 6379),
        },
      }),
    }),

    // Core modules
    DatabaseModule,
    RedisModule,
    FirebaseModule,

    // Feature modules
    AuthModule,
    UsersModule,
    IdentityModule,
    NumbersModule,
    SpamModule,
    ContactsModule,
    CallHistoryModule,
    MessagesModule,
    SearchHistoryModule,
    FavoritesModule,
    JobsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
