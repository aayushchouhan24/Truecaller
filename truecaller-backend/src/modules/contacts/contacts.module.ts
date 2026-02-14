import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [
    IdentityModule,
    BullModule.registerQueue({ name: 'numbers' }),
  ],
  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
