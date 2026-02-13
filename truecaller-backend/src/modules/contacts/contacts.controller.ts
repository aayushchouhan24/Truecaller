import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { SyncContactsDto } from './dto/sync-contacts.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('contacts')
@UseGuards(JwtAuthGuard)
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Post('sync')
  async syncContacts(
    @CurrentUser('id') userId: string,
    @Body() dto: SyncContactsDto,
  ) {
    const result = await this.contactsService.syncContacts(userId, dto);
    return {
      success: true,
      data: result,
      message: `Synced ${result.synced} contacts, ${result.contributed} name contributions`,
    };
  }

  @Get()
  async getContacts(@CurrentUser('id') userId: string) {
    const contacts = await this.contactsService.getUserContacts(userId);
    return {
      success: true,
      data: contacts,
    };
  }
}
