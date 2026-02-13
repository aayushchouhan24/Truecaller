/**
 * Call Blocking Service — blocks spam calls on the device.
 * Uses the block list stored locally + spam data from the API.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, PermissionsAndroid, Linking } from 'react-native';
import { spamApi } from './api';

const BLOCKED_NUMBERS_KEY = '@blocked_numbers';

export interface BlockedNumber {
  phoneNumber: string;
  reason: string;
  blockedAt: string;
}

class CallBlockingService {
  private blockedNumbers: Set<string> = new Set();
  private _initialized = false;

  /* ── init ───────────────────────────────────────── */

  async init(): Promise<void> {
    if (this._initialized) return;
    try {
      const raw = await AsyncStorage.getItem(BLOCKED_NUMBERS_KEY);
      if (raw) {
        const arr: BlockedNumber[] = JSON.parse(raw);
        arr.forEach((b) => this.blockedNumbers.add(b.phoneNumber));
      }
    } catch {
      // ignore
    }
    this._initialized = true;
  }

  /* ── permissions ────────────────────────────────── */

  async requestPermission(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    try {
      const res = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
        PermissionsAndroid.PERMISSIONS.CALL_PHONE,
      ]);
      return res[PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE] === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    }
  }

  /* ── block / unblock ────────────────────────────── */

  async blockNumber(phoneNumber: string, reason = 'Blocked by user'): Promise<void> {
    await this.init();
    this.blockedNumbers.add(phoneNumber);
    await this.persistBlockedNumbers(phoneNumber, reason);
  }

  async unblockNumber(phoneNumber: string): Promise<void> {
    await this.init();
    this.blockedNumbers.delete(phoneNumber);
    await this.removeFromStorage(phoneNumber);
  }

  isBlocked(phoneNumber: string): boolean {
    return this.blockedNumbers.has(phoneNumber);
  }

  async getBlockedNumbers(): Promise<BlockedNumber[]> {
    try {
      const raw = await AsyncStorage.getItem(BLOCKED_NUMBERS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  async getBlockedCount(): Promise<number> {
    const list = await this.getBlockedNumbers();
    return list.length;
  }

  /* ── auto-block from spam database ──────────────── */

  async autoBlockSpamNumbers(minScore = 80): Promise<number> {
    try {
      const res = await spamApi.getNumbers(100);
      const spamNumbers = res.data.filter((n) => n.score >= minScore);
      let blocked = 0;

      for (const spam of spamNumbers) {
        if (!this.isBlocked(spam.phoneNumber)) {
          await this.blockNumber(spam.phoneNumber, `Auto-blocked: spam score ${spam.score}`);
          blocked++;
        }
      }

      return blocked;
    } catch {
      return 0;
    }
  }

  /* ── open system call blocking settings ─────────── */

  async openBlockingSettings(): Promise<void> {
    if (Platform.OS === 'android') {
      try {
        await Linking.openURL('tel:');
      } catch {
        await Linking.openSettings();
      }
    }
  }

  /* ── storage ────────────────────────────────────── */

  private async persistBlockedNumbers(phoneNumber: string, reason: string): Promise<void> {
    try {
      const existing = await this.getBlockedNumbers();
      const filtered = existing.filter((b) => b.phoneNumber !== phoneNumber);
      filtered.push({
        phoneNumber,
        reason,
        blockedAt: new Date().toISOString(),
      });
      await AsyncStorage.setItem(BLOCKED_NUMBERS_KEY, JSON.stringify(filtered));
    } catch {
      // ignore
    }
  }

  private async removeFromStorage(phoneNumber: string): Promise<void> {
    try {
      const existing = await this.getBlockedNumbers();
      const filtered = existing.filter((b) => b.phoneNumber !== phoneNumber);
      await AsyncStorage.setItem(BLOCKED_NUMBERS_KEY, JSON.stringify(filtered));
    } catch {
      // ignore
    }
  }
}

export const callBlockingService = new CallBlockingService();
