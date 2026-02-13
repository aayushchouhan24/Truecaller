import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { SyncContactsDto } from './dto/sync-contacts.dto';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';

@Controller('contacts')
@UseGuards(JwtAuthGuard)
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Post('sync')
  async syncContacts(
    @CurrentUser('id') userId: number,
    @Body() dto: SyncContactsDto,
  ) {
    const result = await this.contactsService.syncContacts(userId, dto);
    return {
      success: true,
      data: result,
      message: `Successfully synced ${result.synced} contacts`,
    };
  }

  @Get()
  async getContacts(@CurrentUser('id') userId: number) {
    const contacts = await this.contactsService.getUserContacts(userId);
    return {
      success: true,
      data: contacts,
    };
  }
}
