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

    // Batch upsert user contacts using createMany + raw update for speed
    const BATCH_SIZE = 500;
    for (let i = 0; i < normalized.length; i += BATCH_SIZE) {
      const batch = normalized.slice(i, i + BATCH_SIZE);

      // Use createMany for new contacts (fast)
      await this.prisma.userContact.createMany({
        data: batch.map((c) => ({
          userId,
          phoneNumber: c.phoneNumber,
          name: c.name,
        })),
        skipDuplicates: true,
      });

      // Update names for existing contacts in smaller sub-batches
      const UPDATE_SIZE = 50;
      for (let j = 0; j < batch.length; j += UPDATE_SIZE) {
        const updateBatch = batch.slice(j, j + UPDATE_SIZE);
        await this.prisma.$transaction(
          updateBatch.map((c) =>
            this.prisma.userContact.updateMany({
              where: { userId, phoneNumber: c.phoneNumber },
              data: { name: c.name },
            }),
          ),
        );
      }

      synced += batch.length;
    }

    // Process name contributions AND resolve names in background
    const allPhones = normalized.map((c) => c.phoneNumber);

    setImmediate(async () => {
      try {
        // Step 1: Add name contributions in bulk
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

        // Step 2: Also resolve names for any remaining unresolved identities
        // This catches numbers that already had identities but no resolvedName
        const resolved = await this.identityService.bulkResolveNamesFromContacts(allPhones);
        if (resolved > 0) {
          this.logger.log(`User ${userId}: resolved ${resolved} additional names from contacts`);
        }
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
