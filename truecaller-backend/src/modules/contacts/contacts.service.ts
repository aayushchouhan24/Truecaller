import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { IdentityService } from '../identity/identity.service';
import { SyncContactsDto } from './dto/sync-contacts.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

// ── Relationship keywords → tags mind-map ──────────────────────────────
// Maps contact name keywords to relationship tags so we build a "mind map"
// of who a number belongs to across all users.
const RELATIONSHIP_MAP: Record<string, { tag: string; role: string }> = {
  // Family
  papa: { tag: 'family', role: 'father' },
  dad: { tag: 'family', role: 'father' },
  father: { tag: 'family', role: 'father' },
  abbu: { tag: 'family', role: 'father' },
  abba: { tag: 'family', role: 'father' },
  pitaji: { tag: 'family', role: 'father' },
  babuji: { tag: 'family', role: 'father' },
  mummy: { tag: 'family', role: 'mother' },
  mom: { tag: 'family', role: 'mother' },
  mother: { tag: 'family', role: 'mother' },
  maa: { tag: 'family', role: 'mother' },
  ammi: { tag: 'family', role: 'mother' },
  amma: { tag: 'family', role: 'mother' },
  bhai: { tag: 'family', role: 'brother' },
  bhaiya: { tag: 'family', role: 'brother' },
  brother: { tag: 'family', role: 'brother' },
  bro: { tag: 'family', role: 'brother' },
  didi: { tag: 'family', role: 'sister' },
  sister: { tag: 'family', role: 'sister' },
  sis: { tag: 'family', role: 'sister' },
  behan: { tag: 'family', role: 'sister' },
  behen: { tag: 'family', role: 'sister' },
  chacha: { tag: 'family', role: 'uncle' },
  mama: { tag: 'family', role: 'uncle' },
  uncle: { tag: 'family', role: 'uncle' },
  tau: { tag: 'family', role: 'uncle' },
  tauji: { tag: 'family', role: 'uncle' },
  fufa: { tag: 'family', role: 'uncle' },
  chachi: { tag: 'family', role: 'aunt' },
  mami: { tag: 'family', role: 'aunt' },
  aunty: { tag: 'family', role: 'aunt' },
  aunt: { tag: 'family', role: 'aunt' },
  bua: { tag: 'family', role: 'aunt' },
  mausi: { tag: 'family', role: 'aunt' },
  dada: { tag: 'family', role: 'grandfather' },
  nana: { tag: 'family', role: 'grandfather' },
  dadi: { tag: 'family', role: 'grandmother' },
  nani: { tag: 'family', role: 'grandmother' },
  bhabhi: { tag: 'family', role: 'sister-in-law' },
  jija: { tag: 'family', role: 'brother-in-law' },
  devar: { tag: 'family', role: 'brother-in-law' },
  beta: { tag: 'family', role: 'child' },
  beti: { tag: 'family', role: 'child' },
  husband: { tag: 'family', role: 'spouse' },
  wife: { tag: 'family', role: 'spouse' },
  hubby: { tag: 'family', role: 'spouse' },
  wifey: { tag: 'family', role: 'spouse' },
  jaan: { tag: 'family', role: 'spouse' },
  // Work
  boss: { tag: 'work', role: 'boss' },
  sir: { tag: 'work', role: 'boss' },
  madam: { tag: 'work', role: 'boss' },
  manager: { tag: 'work', role: 'manager' },
  colleague: { tag: 'work', role: 'colleague' },
  // Services
  driver: { tag: 'service', role: 'driver' },
  maid: { tag: 'service', role: 'domestic-help' },
  cook: { tag: 'service', role: 'cook' },
  plumber: { tag: 'service', role: 'plumber' },
  electrician: { tag: 'service', role: 'electrician' },
  carpenter: { tag: 'service', role: 'carpenter' },
  mechanic: { tag: 'service', role: 'mechanic' },
  doctor: { tag: 'service', role: 'doctor' },
  // Education
  teacher: { tag: 'education', role: 'teacher' },
  tutor: { tag: 'education', role: 'tutor' },
  professor: { tag: 'education', role: 'professor' },
  coaching: { tag: 'education', role: 'tutor' },
  // Friends
  friend: { tag: 'social', role: 'friend' },
  yaar: { tag: 'social', role: 'friend' },
  dost: { tag: 'social', role: 'friend' },
  roommate: { tag: 'social', role: 'roommate' },
};

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
    private identityService: IdentityService,
    @InjectQueue('numbers') private readonly numbersQueue: Queue,
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

    // ── Extract relationship mind-map & update identity tags ──
    const relationshipUpdates = this.extractRelationships(normalized);
    if (relationshipUpdates.size > 0) {
      await this.applyRelationshipTags(relationshipUpdates);
      this.logger.log(
        `User ${userId}: extracted ${relationshipUpdates.size} relationship tags from contacts`,
      );
    }

    // Process name contributions (fast — no AI)
    const allPhones = normalized.map((c) => c.phoneNumber);

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

      // Step 2: Quick resolve for unresolved names (no AI, just frequency-based)
      const resolved = await this.identityService.bulkResolveNamesFromContacts(allPhones);
      if (resolved > 0) {
        this.logger.log(`User ${userId}: resolved ${resolved} additional names from contacts`);
      }
    } catch (error) {
      this.logger.error(`User ${userId}: batch contribution failed`, error);
    }

    // ── Step 3: Queue BACKGROUND AI resolution for all synced numbers ──
    // This runs the full intelligence pipeline (tokenize → classify → cluster → AI resolve)
    // asynchronously so it doesn't block the sync response.
    const uniquePhones = [...new Set(allPhones)];
    try {
      await this.numbersQueue.add(
        'batch-resolve-identities',
        { phoneNumbers: uniquePhones, userId },
        {
          delay: 2000, // slight delay so DB writes finish
          attempts: 2,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: 50,
        },
      );
      this.logger.log(
        `User ${userId}: queued background AI resolution for ${uniquePhones.length} numbers`,
      );
    } catch (err) {
      this.logger.warn(`Failed to queue batch resolution: ${err}`);
    }

    // ── Step 4: Invalidate lookup caches for all synced numbers ──
    // so next lookup picks up freshly computed names
    const CACHE_BATCH = 100;
    for (let i = 0; i < uniquePhones.length; i += CACHE_BATCH) {
      const batch = uniquePhones.slice(i, i + CACHE_BATCH);
      await Promise.all(
        batch.map((phone) => this.redisService.del(`lookup:${phone}`)),
      );
    }

    this.logger.log(`User ${userId} synced ${synced} contacts, contributed ${contributed} names`);

    return {
      success: true,
      synced,
      contributed,
      total: contacts.length,
    };
  }

  /**
   * Extract relationship tags from contact names.
   * Builds a "mind map" — e.g. if someone saves a number as "Papa Sharma",
   * we know the number belongs to someone in a "father" role → tag as "family".
   */
  private extractRelationships(
    contacts: { phoneNumber: string; name: string }[],
  ): Map<string, { tags: Set<string>; roles: Set<string> }> {
    const result = new Map<string, { tags: Set<string>; roles: Set<string> }>();

    for (const contact of contacts) {
      const tokens = contact.name.toLowerCase().split(/[\s,.\-_]+/);
      for (const token of tokens) {
        const rel = RELATIONSHIP_MAP[token];
        if (rel) {
          const existing = result.get(contact.phoneNumber) || {
            tags: new Set<string>(),
            roles: new Set<string>(),
          };
          existing.tags.add(rel.tag);
          existing.roles.add(rel.role);
          result.set(contact.phoneNumber, existing);
        }
      }
    }

    return result;
  }

  /**
   * Apply extracted relationship tags to NumberIdentity rows.
   * Merges new tags with existing ones (doesn't overwrite).
   */
  private async applyRelationshipTags(
    tagMap: Map<string, { tags: Set<string>; roles: Set<string> }>,
  ): Promise<void> {
    const BATCH = 50;
    const entries = [...tagMap.entries()];

    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH);
      await Promise.all(
        batch.map(async ([phoneNumber, { tags, roles }]) => {
          try {
            // Fetch existing identity
            const identity = await this.prisma.numberIdentity.findUnique({
              where: { phoneNumber },
              select: { id: true, tags: true, probableRole: true },
            });

            if (!identity) return;

            // Merge tags (don't duplicate)
            const existingTags = new Set(identity.tags || []);
            for (const tag of tags) existingTags.add(tag);

            // Set probableRole if not already set (first relationship wins)
            const newRole = identity.probableRole || [...roles][0] || null;

            await this.prisma.numberIdentity.update({
              where: { id: identity.id },
              data: {
                tags: [...existingTags],
                probableRole: newRole,
              },
            });
          } catch {
            // silently skip on conflict
          }
        }),
      );
    }
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
