import axios from 'axios';
import { API_BASE_URL } from '../constants/config';
import { storageService } from './storage';
import type {
  ApiResponse,
  AuthResponse,
  LookupResult,
  AddNamePayload,
  ReportSpamPayload,
  CallHistory,
  CallType,
  Message,
  MessageCategory,
  SearchHistoryItem,
  Favorite,
  UserContact,
  SpamNumber,
  SpamStats,
  SpamReport,
} from '../types';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
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
    // If 401, clear auth and silently reject (root layout will redirect to login)
    if (error.response?.status === 401) {
      await storageService.removeToken();
      await storageService.removeUser();
      return Promise.reject(new Error('Unauthorized'));
    }
    const message =
      error.response?.data?.message || error.message || 'Network error';
    return Promise.reject(new Error(Array.isArray(message) ? message[0] : message));
  },
);

export const authApi = {
  login: (phoneNumber: string, name?: string) =>
    api.post('/auth/login', name ? { phoneNumber, name } : { phoneNumber }) as Promise<ApiResponse<AuthResponse>>,

  loginWithFirebase: (firebaseToken: string, name?: string) =>
    api.post('/auth/firebase-login', name ? { firebaseToken, name } : { firebaseToken }) as Promise<ApiResponse<any>>,
};

export const numbersApi = {
  lookup: (phoneNumber: string) =>
    api.post('/numbers/lookup', { phoneNumber }) as Promise<ApiResponse<LookupResult>>,

  addName: (payload: AddNamePayload) =>
    api.post('/numbers/add-name', payload) as Promise<ApiResponse<{ message: string; signalId: string }>>,

  reportSpam: (payload: ReportSpamPayload) =>
    api.post('/numbers/report-spam', payload) as Promise<ApiResponse<{ message: string; reportId: string }>>,
};

export const callHistoryApi = {
  getAll: (type?: CallType) =>
    api.get('/call-history', { params: type ? { type: type.toLowerCase() } : {} }) as Promise<ApiResponse<CallHistory[]>>,

  getRecentContacts: () =>
    api.get('/call-history/recent-contacts') as Promise<ApiResponse<CallHistory[]>>,

  create: (data: { phoneNumber: string; name?: string; type: CallType; duration?: number; sim?: number }) =>
    api.post('/call-history', data) as Promise<ApiResponse<CallHistory>>,

  deleteOne: (id: string) =>
    api.delete(`/call-history/${id}`) as Promise<ApiResponse<null>>,

  deleteAll: () =>
    api.delete('/call-history') as Promise<ApiResponse<null>>,
};

export const messagesApi = {
  getAll: (category?: MessageCategory) =>
    api.get('/messages', { params: category ? { category: category.toLowerCase() } : {} }) as Promise<ApiResponse<Message[]>>,

  getUnreadCount: () =>
    api.get('/messages/unread-count') as Promise<ApiResponse<number>>,

  markRead: (id: string) =>
    api.patch(`/messages/${id}/read`) as Promise<ApiResponse<Message>>,

  markAllRead: () =>
    api.patch('/messages/read-all') as Promise<ApiResponse<null>>,

  delete: (id: string) =>
    api.delete(`/messages/${id}`) as Promise<ApiResponse<null>>,
};

export const searchHistoryApi = {
  getAll: () =>
    api.get('/search-history') as Promise<ApiResponse<SearchHistoryItem[]>>,

  create: (data: { query: string; phoneNumber?: string; resultName?: string }) =>
    api.post('/search-history', data) as Promise<ApiResponse<SearchHistoryItem>>,

  clear: () =>
    api.delete('/search-history') as Promise<ApiResponse<null>>,
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

  recordProfileView: (phoneNumber: string) =>
    api.post('/users/profile-view-by-phone', { phoneNumber }) as Promise<ApiResponse<any>>,

  getWhoViewedMe: (page = 1) =>
    api.get('/users/who-viewed-me', { params: { page } }) as Promise<ApiResponse<any>>,

  getWhoSearchedMe: (page = 1) =>
    api.get('/users/who-searched-me', { params: { page } }) as Promise<ApiResponse<any>>,

  getStats: () =>
    api.get('/users/stats') as Promise<ApiResponse<any>>,
};

export default api;
