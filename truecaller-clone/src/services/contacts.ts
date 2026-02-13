/**
 * REAL Contacts Service — reads device contacts via expo-contacts (dev build).
 * Falls back gracefully in Expo Go.
 */
import { Platform, PermissionsAndroid } from 'react-native';
import * as ExpoContacts from 'expo-contacts';
import api from './api';

export interface DeviceContact {
  id: string;
  name: string;
  phoneNumbers: string[];
  thumbnail?: string;
}

class ContactsService {
  private _hasPermission = false;

  get isAvailable(): boolean {
    return ExpoContacts != null;
  }

  /* ── permissions ────────────────────────────────── */

  async requestPermission(): Promise<boolean> {
    try {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
          {
            title: 'Contacts Permission',
            message: 'Truecaller needs access to your contacts for caller ID and spam detection.',
            buttonPositive: 'Allow',
          },
        );
        this._hasPermission = granted === PermissionsAndroid.RESULTS.GRANTED;
      } else {
        const { status } = await ExpoContacts.requestPermissionsAsync();
        this._hasPermission = status === 'granted';
      }
      return this._hasPermission;
    } catch {
      return false;
    }
  }

  async checkPermission(): Promise<boolean> {
    try {
      if (Platform.OS === 'android') {
        this._hasPermission = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
        );
      } else {
        const { status } = await ExpoContacts.getPermissionsAsync();
        this._hasPermission = status === 'granted';
      }
      return this._hasPermission;
    } catch {
      return false;
    }
  }

  /* ── read device contacts ──────────────────────── */

  async getDeviceContacts(): Promise<DeviceContact[]> {
    if (!this._hasPermission) {
      const ok = await this.requestPermission();
      if (!ok) return [];
    }

    try {
      const { data } = await ExpoContacts.getContactsAsync({
        fields: [
          ExpoContacts.Fields.Name,
          ExpoContacts.Fields.PhoneNumbers,
          ExpoContacts.Fields.ImageAvailable,
          ExpoContacts.Fields.Image,
        ],
        sort: ExpoContacts.SortTypes.FirstName,
      });

      return data
        .filter((c) => c.phoneNumbers && c.phoneNumbers.length > 0)
        .map((c) => ({
          id: c.id!,
          name: c.name || 'Unknown',
          phoneNumbers: c.phoneNumbers!.map((p) => p.number || '').filter(Boolean),
          thumbnail: c.imageAvailable && c.image ? c.image.uri : undefined,
        }));
    } catch (err) {
      console.error('[Contacts] getDeviceContacts:', err);
      return [];
    }
  }

  /* ── search local contacts ─────────────────────── */

  async searchContacts(query: string): Promise<DeviceContact[]> {
    const contacts = await this.getDeviceContacts();
    const q = query.toLowerCase();
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phoneNumbers.some((p) => p.includes(query)),
    );
  }

  /* ── sync contacts to backend ──────────────────── */

  async syncContactsToServer(): Promise<{ success: boolean; synced: number }> {
    try {
      const contacts = await this.getDeviceContacts();
      if (contacts.length === 0) return { success: false, synced: 0 };

      const formatted = contacts.flatMap((c) =>
        c.phoneNumbers.map((phone) => ({
          phoneNumber: this.normalizePhone(phone),
          name: c.name,
        })),
      );

      // Send in batches of 100
      let synced = 0;
      for (let i = 0; i < formatted.length; i += 100) {
        const batch = formatted.slice(i, i + 100);
        try {
          await api.post('/contacts/sync', { contacts: batch });
          synced += batch.length;
        } catch (e) {
          console.error('[Contacts] sync batch error:', e);
        }
      }

      return { success: true, synced };
    } catch {
      return { success: false, synced: 0 };
    }
  }

  /* ── contacts count ────────────────────────────── */

  async getContactsCount(): Promise<number> {
    try {
      const contacts = await this.getDeviceContacts();
      return contacts.length;
    } catch {
      return 0;
    }
  }

  /* ── helpers ────────────────────────────────────── */

  private normalizePhone(phone: string): string {
    let c = phone.replace(/[\s\-()]/g, '');
    if (/^\d{10}$/.test(c)) c = '+91' + c;
    else if (c.startsWith('91') && c.length === 12) c = '+' + c;
    else if (!c.startsWith('+') && c.length > 5) c = '+' + c;
    return c;
  }
}

export const contactsService = new ContactsService();
