import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { SyncContactsDto } from './dto/sync-contacts.dto';

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(private prisma: PrismaService) {}

  async syncContacts(userId: number, dto: SyncContactsDto) {
    const { contacts } = dto;
    let created = 0;
    let updated = 0;

    for (const contact of contacts) {
      try {
        // Store user's contact and also create/update name signal for global lookup
        await this.prisma.userContact.upsert({
          where: {
            userId_phoneNumber: {
              userId: String(userId),
              phoneNumber: contact.phoneNumber,
            },
          },
          create: {
            userId: String(userId),
            phoneNumber: contact.phoneNumber,
            name: contact.name,
          },
          update: {
            name: contact.name,
          },
        });

        // Also create/update NumberIdentity and NameSignal for global lookup
        let identity = await this.prisma.numberIdentity.findFirst({
          where: { phoneNumber: contact.phoneNumber },
        });

        if (!identity) {
          identity = await this.prisma.numberIdentity.create({
            data: { phoneNumber: contact.phoneNumber },
          });
        }

        // Check if name signal exists for this name
        const existingSignal = await this.prisma.nameSignal.findFirst({
          where: {
            identityId: identity.id,
            name: contact.name,
          },
        });

        if (!existingSignal) {
          await this.prisma.nameSignal.create({
            data: {
              identityId: identity.id,
              name: contact.name,
              sourceType: 'USER_UPLOAD',
              weight: 0.8, // Contacts have high weight but not as high as verified
            },
          });
        }

        created++;
      } catch (error) {
        this.logger.error(`Failed to sync contact ${contact.phoneNumber}:`, error);
        continue;
      }
    }

    this.logger.log(`User ${userId} synced ${created} contacts`);

    return {
      success: true,
      synced: created,
      total: contacts.length,
    };
  }

  async getUserContacts(userId: number) {
    const contacts = await this.prisma.userContact.findMany({
      where: {
        userId: String(userId),
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    return contacts.map((contact: any) => ({
      phoneNumber: contact.phoneNumber,
      name: contact.name,
      syncedAt: contact.updatedAt,
    }));
  }
}
