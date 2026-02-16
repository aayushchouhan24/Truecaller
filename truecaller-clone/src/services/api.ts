import axios from 'axios';
import { API_BASE_URL } from '../constants/config';
import { storageService } from './storage';
import type {
  ApiResponse,
  AuthResponse,
  LookupResult,
  AddNamePayload,
  ReportSpamPayload,
  CallType,
  Favorite,
  UserContact,
  SpamNumber,
  SpamStats,
  SpamReport,
} from '../types';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor — attach JWT
api.interceptors.request.use(async (config) => {
  const token = await storageService.getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor — unwrap data & handle 401
api.interceptors.response.use(
  (response) => response.data,
  async (error) => {
    const message = error.response?.data?.message || error.message || 'Network error';
    const formattedMsg = Array.isArray(message) ? message[0] : message;

    // If 401 on a non-auth endpoint, clear auth (session expired)
    if (error.response?.status === 401) {
      const url = error.config?.url || '';
      if (!url.includes('/auth/')) {
        await storageService.removeToken();
        await storageService.removeUser();
      }
      return Promise.reject(new Error(formattedMsg));
    }
    return Promise.reject(new Error(formattedMsg));
  },
);

export const authApi = {
  login: (phoneNumber: string, name?: string) =>
    api.post('/auth/login', name ? { phoneNumber, name } : { phoneNumber }) as Promise<ApiResponse<AuthResponse>>,

  loginWithFirebase: (firebaseToken: string, name?: string) =>
    api.post('/auth/firebase-login', name ? { firebaseToken, name } : { firebaseToken }) as Promise<ApiResponse<any>>,
};

export const numbersApi = {
  lookup: async (phoneNumber: string): Promise<ApiResponse<LookupResult>> => {
    const res = await api.post('/numbers/lookup', { phoneNumber }) as ApiResponse<LookupResult>;

    // If backend returned null name, retry once after a short delay
    // (the first call may trigger background name resolution on the server)
    if (res.data && (!res.data.name || res.data.name === 'null')) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const retry = await api.post('/numbers/lookup', { phoneNumber }) as ApiResponse<LookupResult>;
      // Only use retry result if it actually has a name
      if (retry.data?.name && retry.data.name !== 'null') {
        return retry;
      }
    }

    return res;
  },

  addName: (payload: AddNamePayload) =>
    api.post('/numbers/add-name', payload) as Promise<ApiResponse<{ message: string; contributionId: string }>>,

  reportSpam: (payload: ReportSpamPayload) =>
    api.post('/numbers/report-spam', payload) as Promise<ApiResponse<{ message: string; reportId: string }>>,

  removeSpam: (phoneNumber: string) =>
    api.post('/numbers/remove-spam', { phoneNumber }) as Promise<ApiResponse<{ removed: boolean; message: string }>>,
};

export const favoritesApi = {
  getAll: () =>
    api.get('/favorites') as Promise<ApiResponse<Favorite[]>>,

  add: (phoneNumber: string, name: string) =>
    api.post('/favorites', { phoneNumber, name }) as Promise<ApiResponse<Favorite>>,

  remove: (phoneNumber: string) =>
    api.delete('/favorites', { data: { phoneNumber } }) as Promise<ApiResponse<null>>,
};

export const contactsApi = {
  getAll: () =>
    api.get('/contacts') as Promise<ApiResponse<UserContact[]>>,

  sync: (contacts: { phoneNumber: string; name: string }[]) =>
    api.post('/contacts/sync', { contacts }) as Promise<ApiResponse<{ synced: number }>>,
};

export const spamApi = {
  getNumbers: (limit?: number) =>
    api.get('/spam/numbers', { params: limit ? { limit } : {} }) as Promise<ApiResponse<SpamNumber[]>>,

  getStats: () =>
    api.get('/spam/stats') as Promise<ApiResponse<SpamStats>>,

  getReports: (phoneNumber: string) =>
    api.get('/spam/reports', { params: { phoneNumber } }) as Promise<ApiResponse<SpamReport[]>>,
};

export const usersApi = {
  getMe: () =>
    api.get('/users/me') as Promise<ApiResponse<any>>,

  updateName: (name: string) =>
    api.patch('/users/me', { name }) as Promise<ApiResponse<any>>,

  getStats: () =>
    api.get('/users/stats') as Promise<ApiResponse<any>>,

  getSpamReports: () =>
    api.get('/users/spam-reports') as Promise<ApiResponse<{ phoneNumber: string; reason: string | null; createdAt: string; count: number }[]>>,

  // Placeholder methods — backend doesn't track profile views or search-by yet
  getWhoViewedMe: (_page: number) =>
    Promise.resolve({ data: { data: [], total: 0 } }) as Promise<any>,

  getWhoSearchedMe: (_page: number) =>
    Promise.resolve({ data: { data: [], total: 0 } }) as Promise<any>,
};

export default api;
