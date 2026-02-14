import { NativeModules, Platform, PermissionsAndroid } from 'react-native';

const { CallerIdModule } = NativeModules;

export interface SimInfo {
  slotIndex: number;
  label: string;
  carrier: string;
}

export interface StarredContact {
  id: string;
  name: string;
  thumbnail: string | null;
  phoneNumbers: string[];
}

export const callerIdBridge = {
  /** Store API credentials and enable the caller ID overlay */
  startService: async (apiUrl: string, token: string): Promise<boolean> => {
    if (Platform.OS !== 'android' || !CallerIdModule) return false;
    return CallerIdModule.startService(apiUrl, token);
  },

  /** Disable the caller ID overlay */
  stopService: async (): Promise<boolean> => {
    if (Platform.OS !== 'android' || !CallerIdModule) return false;
    return CallerIdModule.stopService();
  },

  /** Check if caller ID is currently active */
  isActive: async (): Promise<boolean> => {
    if (Platform.OS !== 'android' || !CallerIdModule) return false;
    return CallerIdModule.isActive();
  },

  /** Check if the app has permission to draw overlays */
  canDrawOverlays: async (): Promise<boolean> => {
    if (Platform.OS !== 'android' || !CallerIdModule) return false;
    return CallerIdModule.canDrawOverlays();
  },

  /** Open system settings to grant overlay permission */
  requestOverlayPermission: async (): Promise<boolean> => {
    if (Platform.OS !== 'android' || !CallerIdModule) return false;
    return CallerIdModule.requestOverlayPermission();
  },

  /** Get current config for debugging */
  getConfig: async (): Promise<{active: boolean; apiUrl: string; hasToken: boolean} | null> => {
    if (Platform.OS !== 'android' || !CallerIdModule) return null;
    return CallerIdModule.getConfig();
  },

  /** Get available SIM cards info */
  getSimInfo: async (): Promise<SimInfo[]> => {
    if (Platform.OS !== 'android' || !CallerIdModule) return [];
    try {
      const result = await CallerIdModule.getSimInfo();
      return result ? Array.from(result) : [];
    } catch {
      return [];
    }
  },

  /** Place a call — Android shows native SIM picker automatically */
  placeCall: async (phoneNumber: string): Promise<boolean> => {
    if (Platform.OS !== 'android' || !CallerIdModule) return false;
    try {
      const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CALL_PHONE);
      if (!granted) {
        const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CALL_PHONE);
        if (res !== PermissionsAndroid.RESULTS.GRANTED) return false;
      }
      return CallerIdModule.placeCall(phoneNumber);
    } catch {
      return false;
    }
  },

  /** Get device-starred (favorite) contacts */
  getStarredContacts: async (): Promise<StarredContact[]> => {
    if (Platform.OS !== 'android' || !CallerIdModule) return [];
    try {
      const result = await CallerIdModule.getStarredContacts();
      return result ? Array.from(result) : [];
    } catch {
      return [];
    }
  },
};
