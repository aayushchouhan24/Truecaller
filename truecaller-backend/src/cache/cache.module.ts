import { Global, Module } from '@nestjs/common';
import { ProfileCacheService } from './profile-cache.service';

@Global()
@Module({
  providers: [ProfileCacheService],
  exports: [ProfileCacheService],
})
export class CacheModule {}
