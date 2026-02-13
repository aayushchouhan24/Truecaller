/**
 * Permissions manager — central place to request & check all app permissions.
 * Wraps react-native-permissions and Android-specific permission flows.
 */
import { Platform, PermissionsAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PERMISSIONS_ASKED_KEY = '@permissions_asked';

export type PermissionType =
  | 'contacts'
  | 'callLog'
  | 'sms'
  | 'phone'
  | 'notifications'
  | 'overlay';

export interface PermissionStatus {
  contacts: boolean;
  callLog: boolean;
  sms: boolean;
  phone: boolean;
  notifications: boolean;
}

class PermissionsManager {
  /* ── check all ──────────────────────────────────── */

  async checkAll(): Promise<PermissionStatus> {
    if (Platform.OS !== 'android') {
      return { contacts: false, callLog: false, sms: false, phone: false, notifications: false };
    }
    try {
      const [contacts, callLog, sms, phone, notifications] = await Promise.all([
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_CONTACTS),
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_CALL_LOG),
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS),
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE),
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => false),
      ]);
      return { contacts, callLog, sms, phone, notifications };
    } catch {
      return { contacts: false, callLog: false, sms: false, phone: false, notifications: false };
    }
  }

  /* ── request all critical permissions ───────────── */

  async requestAll(): Promise<PermissionStatus> {
    if (Platform.OS !== 'android') {
      return { contacts: false, callLog: false, sms: false, phone: false, notifications: false };
    }

    try {
      const perms: (typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS][] = [
        PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
        PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
        PermissionsAndroid.PERMISSIONS.READ_SMS,
        PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
        PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
        PermissionsAndroid.PERMISSIONS.CALL_PHONE,
      ];

      // POST_NOTIFICATIONS is API 33+
      try {
        perms.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      } catch {
        // not available on older Android
      }

      const results = await PermissionsAndroid.requestMultiple(perms);
      const G = PermissionsAndroid.RESULTS.GRANTED;

      const status: PermissionStatus = {
        contacts: results[PermissionsAndroid.PERMISSIONS.READ_CONTACTS] === G,
        callLog: results[PermissionsAndroid.PERMISSIONS.READ_CALL_LOG] === G,
        sms: results[PermissionsAndroid.PERMISSIONS.READ_SMS] === G,
        phone: results[PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE] === G,
        notifications: results[PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS] === G,
      };

      await AsyncStorage.setItem(PERMISSIONS_ASKED_KEY, 'true');
      return status;
    } catch {
      return { contacts: false, callLog: false, sms: false, phone: false, notifications: false };
    }
  }

  /* ── request individual ─────────────────────────── */

  async requestContacts(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    try {
      const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_CONTACTS);
      return res === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    }
  }

  async requestCallLog(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    try {
      const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_CALL_LOG);
      return res === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    }
  }

  async requestSms(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    try {
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.READ_SMS,
        PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
      ]);
      return results[PermissionsAndroid.PERMISSIONS.READ_SMS] === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    }
  }

  /* ── first launch check ─────────────────────────── */

  async hasAskedBefore(): Promise<boolean> {
    const val = await AsyncStorage.getItem(PERMISSIONS_ASKED_KEY);
    return val === 'true';
  }
}

export const permissionsManager = new PermissionsManager();
