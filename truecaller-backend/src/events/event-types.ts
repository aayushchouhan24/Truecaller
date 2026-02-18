/**
 * Event Bus — BullMQ-backed domain event system.
 *
 * All writes (contact sync, spam report, name contribution, profile edit)
 * emit events that workers consume to rebuild number_profiles.
 *
 * The API process NEVER runs identity/spam computation.
 * Workers subscribe to these events and do all heavy lifting.
 */

// ── Event type constants ──────────────────────────────────────────

export const EventTypes = {
  /** User synced their address book */
  CONTACT_SYNC: 'contact-sync',
  /** A spam report was filed or removed */
  SPAM_REPORT: 'spam-report',
  /** A name contribution was added (manual or contact-upload) */
  NAME_CONTRIBUTION: 'name-contribution',
  /** A user set/edited their own verified name */
  PROFILE_EDIT: 'profile-edit',
  /** Batch rebuild — triggered by admin or migration */
  BATCH_REBUILD: 'batch-rebuild',
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

// ── Event payloads ────────────────────────────────────────────────

export interface ContactSyncEvent {
  userId: string;
  phoneNumbers: string[]; // normalised phone numbers that were synced
  timestamp: number;
}

export interface SpamReportEvent {
  userId: string;
  phoneNumber: string;
  action: 'REPORTED' | 'REMOVED';
  reason?: string;
  reportId?: string;
  timestamp: number;
}

export interface NameContributionEvent {
  userId: string;
  phoneNumber: string;
  contributionId: string;
  name: string;
  sourceType: string;
  timestamp: number;
}

export interface ProfileEditEvent {
  userId: string;
  phoneNumber: string;
  verifiedName: string;
  timestamp: number;
}

export interface BatchRebuildEvent {
  phoneNumbers: string[];
  triggeredBy: string; // userId or 'system'
  timestamp: number;
}

export type DomainEvent =
  | { type: typeof EventTypes.CONTACT_SYNC; data: ContactSyncEvent }
  | { type: typeof EventTypes.SPAM_REPORT; data: SpamReportEvent }
  | { type: typeof EventTypes.NAME_CONTRIBUTION; data: NameContributionEvent }
  | { type: typeof EventTypes.PROFILE_EDIT; data: ProfileEditEvent }
  | { type: typeof EventTypes.BATCH_REBUILD; data: BatchRebuildEvent };
