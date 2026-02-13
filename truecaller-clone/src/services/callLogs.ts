/**
 * REAL Call Log Service — reads actual device call history on Android.
 * Requires: react-native-call-log  (development build — NOT Expo Go)
 */
import { PermissionsAndroid, Platform } from 'react-native';

let CallLog: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('react-native-call-log');
  // Module exports the class directly (module.exports = CallLogs)
  // Verify it has the `load` static method
  if (mod && typeof mod.load === 'function') {
    CallLog = mod;
  } else if (mod?.default && typeof mod.default.load === 'function') {
    CallLog = mod.default;
  }
} catch {
  // Not available — native module not linked
}

export interface DeviceCallLog {
  phoneNumber: string;
  name: string | null;
  timestamp: string;       // ISO
  duration: number;        // seconds
  type: 'INCOMING' | 'OUTGOING' | 'MISSED' | 'BLOCKED';
  rawType: number;
  dateTime: string;
}

class CallLogsService {
  private _hasPermission = false;

  get isAvailable(): boolean {
    return CallLog !== null;
  }

  /* ── permissions ────────────────────────────────── */

  async requestPermission(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    try {
      const res = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
        PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
      ]);
      this._hasPermission =
        res[PermissionsAndroid.PERMISSIONS.READ_CALL_LOG] === PermissionsAndroid.RESULTS.GRANTED &&
        res[PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE] === PermissionsAndroid.RESULTS.GRANTED;
      return this._hasPermission;
    } catch {
      return false;
    }
  }

  async checkPermission(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    try {
      this._hasPermission = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
      );
      return this._hasPermission;
    } catch {
      return false;
    }
  }

  /* ── read call logs ────────────────────────────── */

  async getCallLogs(limit = 200): Promise<DeviceCallLog[]> {
    if (!this.isAvailable || Platform.OS !== 'android') return [];
    if (!this._hasPermission) {
      const ok = await this.requestPermission();
      if (!ok) return [];
    }
    try {
      const logs = await CallLog.load(limit, {});
      return (logs || []).map((l: any) => this.mapLog(l));
    } catch (e) {
      console.error('[CallLogs] getCallLogs:', e);
      return [];
    }
  }

  async getCallLogsSince(sinceMs: number, limit = 500): Promise<DeviceCallLog[]> {
    if (!this.isAvailable || Platform.OS !== 'android') return [];
    if (!this._hasPermission) {
      const ok = await this.requestPermission();
      if (!ok) return [];
    }
    try {
      const logs = await CallLog.load(limit, { minTimestamp: sinceMs });
      return (logs || []).map((l: any) => this.mapLog(l));
    } catch (e) {
      console.error('[CallLogs] getCallLogsSince:', e);
      return [];
    }
  }

  async getRecentCallers(limit = 20): Promise<DeviceCallLog[]> {
    const logs = await this.getCallLogs(300);
    const seen = new Set<string>();
    const unique: DeviceCallLog[] = [];
    for (const log of logs) {
      if (log.phoneNumber && !seen.has(log.phoneNumber)) {
        seen.add(log.phoneNumber);
        unique.push(log);
        if (unique.length >= limit) break;
      }
    }
    return unique;
  }

  async getMissedCallsCount(): Promise<number> {
    const logs = await this.getCallLogs(100);
    return logs.filter(l => l.type === 'MISSED').length;
  }

  /* ── helpers ────────────────────────────────────── */

  private mapLog(log: any): DeviceCallLog {
    return {
      phoneNumber: this.normalizePhone(log.phoneNumber || ''),
      name: log.name || null,
      timestamp: new Date(parseInt(log.timestamp, 10) || Date.now()).toISOString(),
      duration: parseInt(log.duration, 10) || 0,
      type: this.mapType(log.type),
      rawType: parseInt(log.type, 10) || 0,
      dateTime: log.dateTime || '',
    };
  }

  private mapType(t: string | number): DeviceCallLog['type'] {
    switch (String(t)) {
      case '1': return 'INCOMING';
      case '2': return 'OUTGOING';
      case '3': return 'MISSED';
      case '5': case '6': return 'BLOCKED';
      default: return 'INCOMING';
    }
  }

  private normalizePhone(phone: string): string {
    let c = phone.replace(/[\s\-()]/g, '');
    if (/^\d{10}$/.test(c)) c = '+91' + c;
    else if (c.startsWith('91') && c.length === 12) c = '+' + c;
    else if (!c.startsWith('+') && c.length > 5) c = '+' + c;
    return c;
  }
}

export const callLogsService = new CallLogsService();
