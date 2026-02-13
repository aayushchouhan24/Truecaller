import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  JWT_TOKEN: 'jwt_token',
  USER: 'user',
  RECENT_LOOKUPS: 'recent_lookups',
};

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

  // Clear all
  async clearAll(): Promise<void> {
    await AsyncStorage.clear();
  },
};
