/**
 * Caller ID Service — identifies incoming callers on Android.
 *
 * Optimistic rendering pipeline:
 *   1. Check in-memory cache → return immediately
 *   2. Check persistent local cache (AsyncStorage) → return immediately
 *   3. Fire API request silently in background
 *   4. Update caches if API returned new/changed data
 *
 * This ensures the caller ID popup shows INSTANTLY for any
 * previously seen number, with zero network latency.
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
  source: 'contacts' | 'database' | 'community' | 'cache' | 'unknown';
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
      await Linking.openSettings();
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

  /* ── caller identification (optimistic pipeline) ── */

  async identifyCaller(phoneNumber: string): Promise<CallerInfo> {
    // ── 1. In-memory cache (instant) ──────────────────────────────
    const memCached = this._cache.get(phoneNumber);
    if (memCached) {
      // Fire background refresh (non-blocking)
      this.backgroundRefresh(phoneNumber);
      return memCached;
    }

    // ── 2. Persistent local cache (fast — ~5ms) ──────────────────
    const localCached = await storageService.getCachedProfile(phoneNumber);
    if (localCached) {
      const info: CallerInfo = {
        phoneNumber,
        name: localCached.name ?? null,
        isSpam: localCached.isLikelySpam ?? false,
        spamScore: localCached.spamScore ?? 0,
        confidence: localCached.confidence ?? 0,
        source: 'cache',
      };
      this._cache.set(phoneNumber, info);
      // Fire background refresh (non-blocking)
      this.backgroundRefresh(phoneNumber);
      return info;
    }

    // ── 3. Network fetch (blocking — first-time only) ─────────────
    return this.fetchAndCache(phoneNumber);
  }

  /**
   * Silently fetch from API and update caches if data changed.
   */
  private backgroundRefresh(phoneNumber: string): void {
    this.fetchAndCache(phoneNumber).catch(() => {
      // Ignore — we already have cached data
    });
  }

  private async fetchAndCache(phoneNumber: string): Promise<CallerInfo> {
    try {
      const res = await numbersApi.lookup(phoneNumber);
      const data = res.data;

      let name = data.name;
      if (!name || name === 'null' || name === 'undefined') {
        name = null;
      }

      const info: CallerInfo = {
        phoneNumber,
        name,
        isSpam: data.isLikelySpam ?? false,
        spamScore: data.spamScore ?? 0,
        confidence: data.confidence ?? 0,
        source: name ? 'database' : 'unknown',
      };

      // Update both caches
      this._cache.set(phoneNumber, info);
      await storageService.setCachedProfile(phoneNumber, data);

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
        const token = await storageService.getToken();
        const baseUrl = API_BASE_URL;
        if (!token) {
          console.warn('CallerID: No token available, service may not identify numbers');
        }
        await CallerIdModule.startService(baseUrl, token || '');
      }
      this._enabled = true;
      return true;
    } catch {
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
