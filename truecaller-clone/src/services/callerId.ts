/**
 * Caller ID Service — identifies incoming callers on Android.
 * Uses phone state listener + overlay to show caller info.
 * In a dev build with SYSTEM_ALERT_WINDOW permission, this shows
 * a popup over the incoming call screen.
 */
import { Platform, PermissionsAndroid, AppState, NativeModules, Linking } from 'react-native';
import { numbersApi } from './api';
import { storageService } from './storage';
import { API_BASE_URL } from '../constants/config';

const { CallerIdModule } = NativeModules;

export interface CallerInfo {
  phoneNumber: string;
  name: string | null;
  isSpam: boolean;
  spamScore: number;
  confidence: number;
  source: 'contacts' | 'database' | 'community' | 'unknown';
}

class CallerIdService {
  private _enabled = false;
  private _overlayPermission = false;
  private _cache = new Map<string, CallerInfo>();

  get isEnabled(): boolean {
    return this._enabled;
  }

  /* ── permissions ────────────────────────────────── */

  async requestPhoneStatePermission(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    try {
      const res = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
        PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
        PermissionsAndroid.PERMISSIONS.READ_PHONE_NUMBERS,
      ]);
      return res[PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE] === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    }
  }

  async requestOverlayPermission(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    try {
      // SYSTEM_ALERT_WINDOW (draw over other apps) requires special intent
      await Linking.openSettings();
      // User manually enables it — we check on return
      return new Promise<boolean>((resolve) => {
        const sub = AppState.addEventListener('change', (state) => {
          if (state === 'active') {
            sub.remove();
            this.checkOverlayPermission().then(resolve);
          }
        });
      });
    } catch {
      return false;
    }
  }

  async checkOverlayPermission(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    try {
      if (CallerIdModule?.checkOverlayPermission) {
        this._overlayPermission = await CallerIdModule.checkOverlayPermission();
      }
      return this._overlayPermission;
    } catch {
      return false;
    }
  }

  /* ── caller identification ──────────────────────── */

  async identifyCaller(phoneNumber: string): Promise<CallerInfo> {
    // Check cache first
    if (this._cache.has(phoneNumber)) {
      return this._cache.get(phoneNumber)!;
    }

    try {
      const res = await numbersApi.lookup(phoneNumber);
      const data = res.data;
      
      // Handle null, undefined, or "null" string properly
      let name = data.name;
      if (!name || name === 'null' || name === 'undefined') {
        name = null;
      }
      
      const info: CallerInfo = {
        phoneNumber,
        name: name,
        isSpam: data.isLikelySpam ?? false,
        spamScore: data.spamScore ?? 0,
        confidence: data.confidence ?? 0,
        source: name ? 'database' : 'unknown',
      };

      // Cache for this session
      this._cache.set(phoneNumber, info);
      return info;
    } catch (error) {
      console.error('Failed to identify caller:', error);
      return {
        phoneNumber,
        name: null,
        isSpam: false,
        spamScore: 0,
        confidence: 0,
        source: 'unknown',
      };
    }
  }

  /* ── enable / disable ──────────────────────────── */

  async enable(): Promise<boolean> {
    const phoneOk = await this.requestPhoneStatePermission();
    if (!phoneOk) return false;

    try {
      if (CallerIdModule?.startService) {
        // Pass API URL and stored JWT token to the native overlay service
        const token = await storageService.getToken();
        const baseUrl = API_BASE_URL; // already includes /api
        // Refresh token before starting — native service stores it for HTTP calls
        if (!token) {
          console.warn('CallerID: No token available, service may not identify numbers');
        }
        await CallerIdModule.startService(baseUrl, token || '');
      }
      this._enabled = true;
      return true;
    } catch {
      // Native module not available — will work via app foreground only
      this._enabled = true;
      return true;
    }
  }

  async disable(): Promise<void> {
    try {
      if (CallerIdModule?.stopService) {
        await CallerIdModule.stopService();
      }
    } catch {
      // ignore
    }
    this._enabled = false;
  }

  clearCache(): void {
    this._cache.clear();
  }
}

export const callerIdService = new CallerIdService();
