import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  JWT_TOKEN: 'jwt_token',
  USER: 'user',
  RECENT_LOOKUPS: 'recent_lookups',
  PROFILE_CACHE: 'profile_cache',
};

// Max entries in the persistent profile cache
const PROFILE_CACHE_MAX = 2000;

export const storageService = {
  // Token
  async getToken(): Promise<string | null> {
    return await AsyncStorage.getItem(KEYS.JWT_TOKEN);
  },

  async setToken(token: string): Promise<void> {
    await AsyncStorage.setItem(KEYS.JWT_TOKEN, token);
  },

  async removeToken(): Promise<void> {
    await AsyncStorage.removeItem(KEYS.JWT_TOKEN);
  },

  // User
  async getUser(): Promise<any | null> {
    const raw = await AsyncStorage.getItem(KEYS.USER);
    return raw ? JSON.parse(raw) : null;
  },

  async setUser(user: any): Promise<void> {
    await AsyncStorage.setItem(KEYS.USER, JSON.stringify(user));
  },

  async removeUser(): Promise<void> {
    await AsyncStorage.removeItem(KEYS.USER);
  },

  // Recent lookups
  async getRecentLookups(): Promise<any[]> {
    const raw = await AsyncStorage.getItem(KEYS.RECENT_LOOKUPS);
    return raw ? JSON.parse(raw) : [];
  },

  async addRecentLookup(lookup: any): Promise<void> {
    const lookups = await this.getRecentLookups();
    // Remove duplicate if exists
    const filtered = lookups.filter(
      (l: any) => l.phoneNumber !== lookup.phoneNumber,
    );
    // Add to front, keep max 20
    filtered.unshift({ ...lookup, timestamp: Date.now() });
    await AsyncStorage.setItem(KEYS.RECENT_LOOKUPS, JSON.stringify(filtered.slice(0, 20)));
  },

  async clearRecentLookups(): Promise<void> {
    await AsyncStorage.removeItem(KEYS.RECENT_LOOKUPS);
  },

  // ── Persistent Profile Cache ────────────────────────────────────
  // Local cache for lookup results. Used for instant caller ID display.
  // Key: phone number, Value: cached lookup result + timestamp.

  async getCachedProfile(phoneNumber: string): Promise<any | null> {
    try {
      const raw = await AsyncStorage.getItem(KEYS.PROFILE_CACHE);
      if (!raw) return null;
      const cache: Record<string, any> = JSON.parse(raw);
      return cache[phoneNumber] ?? null;
    } catch {
      return null;
    }
  },

  async setCachedProfile(phoneNumber: string, profile: any): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(KEYS.PROFILE_CACHE);
      const cache: Record<string, any> = raw ? JSON.parse(raw) : {};

      cache[phoneNumber] = { ...profile, _cachedAt: Date.now() };

      // Evict oldest entries if over limit
      const keys = Object.keys(cache);
      if (keys.length > PROFILE_CACHE_MAX) {
        const sorted = keys.sort(
          (a, b) => (cache[a]._cachedAt ?? 0) - (cache[b]._cachedAt ?? 0),
        );
        const toRemove = sorted.slice(0, keys.length - PROFILE_CACHE_MAX);
        for (const k of toRemove) delete cache[k];
      }

      await AsyncStorage.setItem(KEYS.PROFILE_CACHE, JSON.stringify(cache));
    } catch {
      // Ignore — non-critical
    }
  },

  async clearProfileCache(): Promise<void> {
    await AsyncStorage.removeItem(KEYS.PROFILE_CACHE);
  },

  // Clear all
  async clearAll(): Promise<void> {
    await AsyncStorage.clear();
  },
};
