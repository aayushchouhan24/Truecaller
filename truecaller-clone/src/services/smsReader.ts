/**
 * REAL SMS Reader — reads actual device SMS inbox on Android.
 * Requires: react-native-get-sms-android  (dev build only)
 */
import { PermissionsAndroid, Platform } from 'react-native';

let SmsAndroid: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  SmsAndroid = require('react-native-get-sms-android');
} catch {
  // Not available — native module not linked
}

export interface DeviceSms {
  id: string;
  address: string;    // sender phone number
  body: string;
  date: number;       // Unix ms
  dateStr: string;    // ISO
  read: boolean;
  type: 'inbox' | 'sent' | 'draft';
  category: 'PERSONAL' | 'TRANSACTIONAL' | 'PROMOTIONAL' | 'SPAM' | 'OTP';
}

class SmsService {
  private _hasPermission = false;

  get isAvailable(): boolean {
    return SmsAndroid !== null && Platform.OS === 'android';
  }

  /* ── permissions ────────────────────────────────── */

  async requestPermission(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    try {
      const res = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.READ_SMS,
        PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
      ]);
      this._hasPermission =
        res[PermissionsAndroid.PERMISSIONS.READ_SMS] === PermissionsAndroid.RESULTS.GRANTED;
      return this._hasPermission;
    } catch {
      return false;
    }
  }

  async checkPermission(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    try {
      this._hasPermission = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.READ_SMS,
      );
      return this._hasPermission;
    } catch {
      return false;
    }
  }

  /* ── read SMS inbox ────────────────────────────── */

  async getMessages(limit = 200, box: 'inbox' | 'sent' = 'inbox'): Promise<DeviceSms[]> {
    if (!this.isAvailable) return [];
    if (!this._hasPermission) {
      const ok = await this.requestPermission();
      if (!ok) return [];
    }

    return new Promise((resolve) => {
      const filter = {
        box,
        maxCount: limit,
      };

      SmsAndroid.list(
        JSON.stringify(filter),
        (fail: string) => {
          console.error('[SmsService] list fail:', fail);
          resolve([]);
        },
        (_count: number, smsList: string) => {
          try {
            const arr = JSON.parse(smsList);
            const messages: DeviceSms[] = arr.map((sms: any) => ({
              id: String(sms._id),
              address: sms.address || '',
              body: sms.body || '',
              date: sms.date || Date.now(),
              dateStr: new Date(sms.date || Date.now()).toISOString(),
              read: sms.read === '1' || sms.read === 1,
              type: box,
              category: this.classifySms(sms.address || '', sms.body || ''),
            }));
            resolve(messages);
          } catch {
            resolve([]);
          }
        },
      );
    });
  }

  /* ── unread count ──────────────────────────────── */

  async getUnreadCount(): Promise<number> {
    if (!this.isAvailable) return 0;
    if (!this._hasPermission) {
      const ok = await this.requestPermission();
      if (!ok) return 0;
    }

    return new Promise((resolve) => {
      const filter = { box: 'inbox', read: 0, maxCount: 9999 };
      SmsAndroid.list(
        JSON.stringify(filter),
        () => resolve(0),
        (count: number) => resolve(count),
      );
    });
  }

  /* ── search SMS ────────────────────────────────── */

  async searchMessages(query: string): Promise<DeviceSms[]> {
    const all = await this.getMessages(500);
    const q = query.toLowerCase();
    return all.filter(
      (m) =>
        m.body.toLowerCase().includes(q) ||
        m.address.includes(query),
    );
  }

  /* ── classify SMS auto-category ────────────────── */

  private classifySms(sender: string, body: string): DeviceSms['category'] {
    const lowerBody = body.toLowerCase();
    const lowerSender = sender.toLowerCase();

    // OTP detection
    if (
      /\b(otp|one.?time|verification.?code|verify)\b/i.test(body) ||
      /\b\d{4,6}\b/.test(body) && /\b(code|otp|pin)\b/i.test(body)
    ) {
      return 'OTP';
    }

    // Spam detection
    const spamWords = ['win', 'free', 'congratulations', 'lottery', 'prize', 'click here', 'claim now', 'offer expires', 'act now', 'limited time'];
    if (spamWords.some((w) => lowerBody.includes(w))) {
      return 'SPAM';
    }

    // Transactional (banks, payments, deliveries)
    const txnPatterns = ['credited', 'debited', 'transaction', 'a/c', 'account', 'balance', 'payment', 'upi', 'neft', 'imps', 'delivered', 'shipped', 'booked', 'confirmed'];
    if (txnPatterns.some((p) => lowerBody.includes(p))) {
      return 'TRANSACTIONAL';
    }

    // Promotional
    const promoPatterns = ['offer', 'discount', 'sale', 'cashback', 'coupon', 'deal', 'off on', '% off', 'subscribe', 'download'];
    if (promoPatterns.some((p) => lowerBody.includes(p))) {
      return 'PROMOTIONAL';
    }

    // Sender-based classification
    // Short-codes and alpha-numeric senders are usually not personal
    if (/^[A-Z]{2}-[A-Z]+$/i.test(sender) || /^\d{5,6}$/.test(sender) || lowerSender.includes('bank') || lowerSender.includes('hdfc') || lowerSender.includes('sbi') || lowerSender.includes('icici')) {
      return 'TRANSACTIONAL';
    }

    return 'PERSONAL';
  }
}

export const smsService = new SmsService();
