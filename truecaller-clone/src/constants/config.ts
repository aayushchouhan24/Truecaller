// In dev mode the root dev.ps1 sets EXPO_PUBLIC_API_BASE_URL to the devtunnel URL.
// In production builds the env var is absent so the prod ALB URL is used.
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  'http://truecaller-backend-alb-704066168.eu-central-1.elb.amazonaws.com/api';

export const SPAM_THRESHOLD = 5;

export const COLORS = {
  // Core
  primary: '#2196F3',
  primaryDark: '#1565C0',
  primaryLight: '#1A3A5C',

  // Status
  danger: '#F44336',
  dangerDark: '#3D1515',
  dangerLight: '#5C2020',
  warning: '#FF9800',
  warningDark: '#3D2E15',
  success: '#4CAF50',
  successDark: '#1B3D1C',

  // Dark Theme (matches Truecaller)
  background: '#0A0A0A',
  surface: '#1A1A1A',
  surfaceLight: '#242424',
  card: '#1E1E1E',
  elevated: '#2A2A2A',

  // Text
  text: '#FFFFFF',
  textSecondary: '#8E8E93',
  textTertiary: '#5A5A5E',

  // Borders
  border: '#2C2C2E',
  borderLight: '#3A3A3C',
  separator: '#1C1C1E',

  // Fixed
  white: '#FFFFFF',
  black: '#000000',

  // Tab bar
  tabBar: '#111111',
  tabActive: '#2196F3',
  tabInactive: '#6B6B6B',

  // Caller ID blue (Truecaller signature)
  callerBlueBg: '#1565C0',
  callerBlueLight: '#1E88E5',

  // Online status
  onlineGreen: '#4CAF50',
  missedRed: '#F44336',
  outgoingGreen: '#66BB6A',
  incomingGreen: '#4CAF50',
};
