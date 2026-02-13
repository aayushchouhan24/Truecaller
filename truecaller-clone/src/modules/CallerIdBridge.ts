import { NativeModules, Platform } from 'react-native';

const { CallerIdModule } = NativeModules;

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
};
