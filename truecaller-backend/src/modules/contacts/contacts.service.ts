import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { IdentityService } from '../identity/identity.service';
import { SyncContactsDto } from './dto/sync-contacts.dto';

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    private prisma: PrismaService,
    private identityService: IdentityService,
  ) {}

  async syncContacts(userId: string, dto: SyncContactsDto, deviceFingerprint?: string) {
    const { contacts } = dto;
    let synced = 0;
    let contributed = 0;

    for (const contact of contacts) {
      try {
        const normalizedPhone = this.identityService.normalizePhone(contact.phoneNumber);

        // Store user's contact
        await this.prisma.userContact.upsert({
          where: {
            userId_phoneNumber: {
              userId,
              phoneNumber: normalizedPhone,
            },
          },
          create: {
            userId,
            phoneNumber: normalizedPhone,
            name: contact.name,
          },
          update: {
            name: contact.name,
          },
        });
        synced++;

        // Add name contribution to the global identity system
        const contribution = await this.identityService.addNameContribution(
          normalizedPhone,
          contact.name,
          userId,
          'CONTACT_UPLOAD',
          deviceFingerprint,
        );

        if (contribution) contributed++;
      } catch (error) {
        this.logger.error(`Failed to sync contact ${contact.phoneNumber}:`, error);
        continue;
      }
    }

    this.logger.log(`User ${userId} synced ${synced} contacts, ${contributed} name contributions added`);

    return {
      success: true,
      synced,
      contributed,
      total: contacts.length,
    };
  }

  async getUserContacts(userId: string) {
    const contacts = await this.prisma.userContact.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });

    return contacts.map((contact: any) => ({
      phoneNumber: contact.phoneNumber,
      name: contact.name,
      syncedAt: contact.updatedAt,
    }));
  }
}
