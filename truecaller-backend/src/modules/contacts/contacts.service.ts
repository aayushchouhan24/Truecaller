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

    // Normalize all phone numbers upfront
    const normalized = contacts.map((c) => ({
      phoneNumber: this.identityService.normalizePhone(c.phoneNumber),
      name: c.name,
    }));

    // Batch upsert user contacts using a transaction
    const BATCH_SIZE = 200;
    for (let i = 0; i < normalized.length; i += BATCH_SIZE) {
      const batch = normalized.slice(i, i + BATCH_SIZE);

      await this.prisma.$transaction(
        batch.map((c) =>
          this.prisma.userContact.upsert({
            where: {
              userId_phoneNumber: {
                userId,
                phoneNumber: c.phoneNumber,
              },
            },
            create: {
              userId,
              phoneNumber: c.phoneNumber,
              name: c.name,
            },
            update: {
              name: c.name,
            },
          }),
        ),
      );
      synced += batch.length;
    }

    // Add name contributions in bulk in background (don't block the response)
    setImmediate(async () => {
      try {
        const result = await this.identityService.addNameContributionsBatch(
          normalized.map((c) => ({ phoneNumber: c.phoneNumber, name: c.name })),
          userId,
          'CONTACT_UPLOAD',
          deviceFingerprint,
        );
        contributed = result.created;
        this.logger.log(
          `User ${userId}: batch contributions done — ${result.created} created, ` +
          `${result.skipped} skipped, ${result.junk} junk`,
        );
      } catch (error) {
        this.logger.error(`User ${userId}: batch contribution failed`, error);
      }
    });

    this.logger.log(`User ${userId} synced ${synced} contacts (contributions processing in background)`);

    return {
      success: true,
      synced,
      contributed: 0, // will be processed async
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
