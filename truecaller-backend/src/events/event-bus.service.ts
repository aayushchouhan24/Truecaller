/**
 * Event Bus Service — thin wrapper over BullMQ queue.
 *
 * API services emit events; workers consume them.
 * Single queue `profile-events` with named jobs for routing.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  EventTypes,
  type ContactSyncEvent,
  type SpamReportEvent,
  type NameContributionEvent,
  type ProfileEditEvent,
  type BatchRebuildEvent,
} from './event-types';

const DEFAULT_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 3000 },
  removeOnComplete: true,
  removeOnFail: 100,
};

@Injectable()
export class EventBusService {
  private readonly logger = new Logger(EventBusService.name);

  constructor(
    @InjectQueue('profile-events') private readonly queue: Queue,
  ) {}

  async emitContactSync(data: ContactSyncEvent): Promise<void> {
    await this.queue.add(EventTypes.CONTACT_SYNC, data, {
      ...DEFAULT_OPTS,
      delay: 1000, // slight delay so DB writes finish
    });
    this.logger.debug(`Emitted ${EventTypes.CONTACT_SYNC} for ${data.phoneNumbers.length} numbers`);
  }

  async emitSpamReport(data: SpamReportEvent): Promise<void> {
    await this.queue.add(EventTypes.SPAM_REPORT, data, DEFAULT_OPTS);
    this.logger.debug(`Emitted ${EventTypes.SPAM_REPORT} for ${data.phoneNumber}`);
  }

  async emitNameContribution(data: NameContributionEvent): Promise<void> {
    await this.queue.add(EventTypes.NAME_CONTRIBUTION, data, DEFAULT_OPTS);
    this.logger.debug(`Emitted ${EventTypes.NAME_CONTRIBUTION} for ${data.phoneNumber}`);
  }

  async emitProfileEdit(data: ProfileEditEvent): Promise<void> {
    await this.queue.add(EventTypes.PROFILE_EDIT, data, {
      ...DEFAULT_OPTS,
      priority: 1, // high priority — user-initiated
    });
    this.logger.debug(`Emitted ${EventTypes.PROFILE_EDIT} for ${data.phoneNumber}`);
  }

  async emitBatchRebuild(data: BatchRebuildEvent): Promise<void> {
    // Split into chunks of 100 to avoid oversized jobs
    const CHUNK = 100;
    for (let i = 0; i < data.phoneNumbers.length; i += CHUNK) {
      const chunk = data.phoneNumbers.slice(i, i + CHUNK);
      await this.queue.add(EventTypes.BATCH_REBUILD, {
        ...data,
        phoneNumbers: chunk,
      }, {
        ...DEFAULT_OPTS,
        delay: 2000,
      });
    }
    this.logger.debug(`Emitted ${EventTypes.BATCH_REBUILD} for ${data.phoneNumbers.length} numbers`);
  }
}
