import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, Platform, PermissionsAndroid } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Tabs } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { smsService } from '../../src/services/smsReader';
import { callLogsService } from '../../src/services/callLogs';
import { spamApi } from '../../src/services/api';
import { callBlockingService } from '../../src/services/callBlocking';

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <View style={st.badge}>
      <Text style={st.badgeText}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, Platform.OS === 'android' ? 8 : 0);
  const [msgBadge, setMsgBadge] = useState(0);
  const [spamBadge, setSpamBadge] = useState(0);
  const [missedBadge, setMissedBadge] = useState(0);

  /* ── Request all permissions on first launch ───── */
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    (async () => {
      try {
        const perms: any[] = [
          PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
          PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
          PermissionsAndroid.PERMISSIONS.READ_SMS,
          PermissionsAndroid.PERMISSIONS.SEND_SMS,
          PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
          PermissionsAndroid.PERMISSIONS.CALL_PHONE,
          PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
        ];
        // POST_NOTIFICATIONS only available on API 33+
        if ((PermissionsAndroid.PERMISSIONS as any).POST_NOTIFICATIONS) {
          perms.push((PermissionsAndroid.PERMISSIONS as any).POST_NOTIFICATIONS);
        }
        await PermissionsAndroid.requestMultiple(perms);
      } catch {
        // ignore
      }
    })();
  }, []);

  const refreshBadges = useCallback(async () => {
    try {
      // Messages badge
      if (smsService.isAvailable) {
        const count = await smsService.getUnreadCount();
        setMsgBadge(count);
      }

      // Spam badge — use local blocked count (device-specific)
      const blocked = await callBlockingService.getBlockedCount();
      setSpamBadge(blocked);

      // Missed calls badge
      if (callLogsService.isAvailable) {
        const missed = await callLogsService.getMissedCallsCount();
        setMissedBadge(missed);
      }
    } catch {
      // ignore
    }
  }, []);

  useFocusEffect(useCallback(() => { refreshBadges(); }, [refreshBadges]));

  // Auto refresh every 30s
  useEffect(() => {
    const interval = setInterval(refreshBadges, 30000);
    return () => clearInterval(interval);
  }, [refreshBadges]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: '#111', borderTopColor: '#1C1C1E', borderTopWidth: 0.5, height: 56 + bottomPad, paddingBottom: 4 + bottomPad },
        tabBarActiveTintColor: '#2196F3',
        tabBarInactiveTintColor: '#6B6B6B',
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Calls',
          tabBarIcon: ({ color, size }) => (
            <View>
              <Ionicons name="call" size={size} color={color} />
              {missedBadge > 0 && <Badge count={missedBadge} />}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Messages',
          tabBarIcon: ({ color, size }) => (
            <View>
              <Ionicons name="chatbubble" size={size} color={color} />
              {msgBadge > 0 && <Badge count={msgBadge} />}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="scams"
        options={{
          title: 'Scams',
          tabBarIcon: ({ color, size }) => (
            <View>
              <Ionicons name="shield" size={size} color={color} />
              {spamBadge > 0 && <Badge count={spamBadge} />}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="premium"
        options={{
          title: 'Premium',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="crown" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="assistant"
        options={{
          title: 'Assistant',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="robot" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const st = StyleSheet.create({
  badge: { position: 'absolute', top: -4, right: -10, backgroundColor: '#F44336', borderRadius: 10, minWidth: 18, height: 18, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 },
  badgeText: { color: '#FFF', fontSize: 10, fontWeight: '800' },
});
