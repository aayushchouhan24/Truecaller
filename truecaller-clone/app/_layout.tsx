import { useEffect } from 'react';
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform, Alert, Linking } from 'react-native';
import 'react-native-reanimated';

import { useAuthStore } from '../src/store/authStore';
import { callerIdBridge } from '../src/modules/CallerIdBridge';
import { API_BASE_URL } from '../src/constants/config';

const TruecallerDark = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: '#2196F3',
    background: '#0A0A0A',
    card: '#111111',
    text: '#FFFFFF',
    border: '#2C2C2E',
    notification: '#F44336',
  },
};

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const { hydrate, isAuthenticated, isLoading, token } = useAuthStore();

  useEffect(() => {
    hydrate();
  }, []);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isLoading, isAuthenticated]);

  // Auto-start Caller ID overlay service when authenticated
  useEffect(() => {
    if (!isAuthenticated || !token || Platform.OS !== 'android') return;

    const initCallerId = async () => {
      try {
        const canDraw = await callerIdBridge.canDrawOverlays();
        if (!canDraw) {
          Alert.alert(
            'Caller ID Overlay',
            'Truecaller needs permission to show caller ID over other apps. Grant "Display over other apps" permission.',
            [
              { text: 'Later', style: 'cancel' },
              { text: 'Grant', onPress: () => callerIdBridge.requestOverlayPermission() },
            ],
          );
          return;
        }
        await callerIdBridge.startService(API_BASE_URL, token);
      } catch (e) {
        console.warn('Caller ID init failed:', e);
      }
    };

    initCallerId();
  }, [isAuthenticated, token]);

  return (
    <ThemeProvider value={TruecallerDark}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0A0A0A' },
          headerTintColor: '#FFFFFF',
          contentStyle: { backgroundColor: '#0A0A0A' },
        }}
      >
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="search" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="number-detail" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="settings" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="profile" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <StatusBar style="light" />
    </ThemeProvider>
  );
}
