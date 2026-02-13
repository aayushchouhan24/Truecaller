import { create } from 'zustand';
import { storageService } from '../services/storage';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  setAuth: (token: string, user: User) => Promise<void>;
  setUser: (user: User) => Promise<void>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,

  setAuth: async (token: string, user: User) => {
    await storageService.setToken(token);
    await storageService.setUser(user);
    set({ token, user, isAuthenticated: true, isLoading: false });
  },

  setUser: async (user: User) => {
    await storageService.setUser(user);
    set({ user });
  },

  logout: async () => {
    await storageService.removeToken();
    await storageService.removeUser();
    await storageService.clearRecentLookups();
    set({ token: null, user: null, isAuthenticated: false, isLoading: false });
  },

  hydrate: async () => {
    const token = await storageService.getToken();
    const user = await storageService.getUser();
    if (token && user) {
      set({ token, user, isAuthenticated: true, isLoading: false });
    } else {
      set({ isLoading: false });
    }
  },

  setLoading: (loading: boolean) => set({ isLoading: loading }),
}));
