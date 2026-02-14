export interface User {
  id: string;
  phoneNumber: string;
  name: string | null;
}

export interface AuthResponse {
  needsName: any;
  accessToken: string;
  user: User;
}

export interface LookupResult {
  phoneNumber: string;
  name: string | null;
  confidence: number;
  sourceCount: number;
  isVerified: boolean;
  spamScore: number;
  isLikelySpam: boolean;
  spamCategory?: string;
  numberCategory?: string;
  tags: string[];
  probableRole: string | null;
  description: string | null;
  hasUserReportedSpam: boolean;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  timestamp: string;
}

export interface AddNamePayload {
  phoneNumber: string;
  name: string;
  sourceType?: 'CONTACT_UPLOAD' | 'MANUAL' | 'SELF_DECLARED';
  deviceFingerprint?: string;
}

export interface ReportSpamPayload {
  phoneNumber: string;
  reason?: string;
}

// ── Call History ──────────────────────────────────────
export type CallType = 'INCOMING' | 'OUTGOING' | 'MISSED' | 'BLOCKED';

export interface CallHistory {
  id: string;
  userId: string;
  phoneNumber: string;
  name: string | null;
  type: CallType;
  duration: number;
  sim: number;
  isSpam: boolean;
  spamLabel: string | null;
  createdAt: string;
}

// ── Messages ─────────────────────────────────────────
export type MessageCategory = 'PERSONAL' | 'TRANSACTIONAL' | 'PROMOTIONAL' | 'SPAM' | 'OTP';

export interface Message {
  id: string;
  userId: string;
  sender: string;
  body: string;
  category: MessageCategory;
  isRead: boolean;
  isSpam: boolean;
  createdAt: string;
}

// ── Search History ───────────────────────────────────
export interface SearchHistoryItem {
  id: string;
  userId: string;
  query: string;
  phoneNumber: string | null;
  resultName: string | null;
  createdAt: string;
}

// ── Favorites ────────────────────────────────────────
export interface Favorite {
  id: string;
  userId: string;
  phoneNumber: string;
  name: string;
  createdAt: string;
}

// ── Contacts ─────────────────────────────────────────
export interface UserContact {
  id: string;
  userId: string;
  phoneNumber: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// ── Spam ─────────────────────────────────────────────
export interface SpamNumber {
  phoneNumber: string;
  score: number;
  updatedAt: string;
}

export interface SpamStats {
  totalReports: number;
  flaggedNumbers: number;
  blockedNumbers: number;
}

export interface SpamReport {
  id: string;
  reporterId: string;
  phoneNumber: string;
  reason: string | null;
  createdAt: string;
}
