import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, StatusBar,
  ScrollView, Alert, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { permissionsManager, type PermissionStatus } from '../src/services/permissions';
import { contactsService } from '../src/services/contacts';
import { useAuthStore } from '../src/store/authStore';

/* ── helpers ─────────────────────────────────────────── */
const getInitials = (n: string | null) => {
  if (!n) return '?';
  const p = n.trim().split(/\s+/);
  return p.length > 1 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : n.slice(0, 2).toUpperCase();
};

/* ── menu item ───────────────────────────────────────── */
function SettingsItem({ icon, iconLib, label, onPress, showDivider = true }: {
  icon: string; iconLib: 'ion' | 'mci'; label: string; onPress?: () => void; showDivider?: boolean;
}) {
  return (
    <TouchableOpacity style={[si.item, showDivider && si.itemBorder]} onPress={onPress} activeOpacity={0.7}>
      <View style={si.iconWrap}>
        {iconLib === 'ion'
          ? <Ionicons name={icon as any} size={22} color="#FFF" />
          : <MaterialCommunityIcons name={icon as any} size={22} color="#FFF" />}
      </View>
      <Text style={si.label}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color="#3A3A3C" />
    </TouchableOpacity>
  );
}

const si = {
  item: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingVertical: 16, paddingHorizontal: 16, gap: 14 },
  itemBorder: { borderBottomWidth: 0.5, borderBottomColor: '#1C1C1E' },
  iconWrap: { width: 28, alignItems: 'center' as const },
  label: { flex: 1, color: '#FFF', fontSize: 15, fontWeight: '500' as const },
};

/* ═══════════════════════════════════════════════════════
   SETTINGS SCREEN
   ═══════════════════════════════════════════════════════ */
export default function SettingsScreen() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const isOnboarding = params.mode === 'onboarding';
  const { user, logout } = useAuthStore();

  const [perms, setPerms] = useState<PermissionStatus>({
    contacts: false, callLog: false, sms: false, phone: false, notifications: false,
  });

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    const status = await permissionsManager.checkAll();
    setPerms(status);
  };

  const handleRequestAll = async () => {
    const status = await permissionsManager.requestAll();
    setPerms(status);

    if (status.contacts) {
      contactsService.syncContactsToServer().catch(() => {});
    }

    if (isOnboarding) {
      router.replace('/(tabs)');
    }
  };

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: async () => {
        await logout();
        router.replace('/login');
      }},
    ]);
  };

  const grantedCount = Object.values(perms).filter(Boolean).length;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0A" />

      {/* ── Header ──────────────────────────── */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerBtn}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Settings</Text>
        <TouchableOpacity style={s.headerBtn} onPress={() => router.push('/search')}>
          <Ionicons name="search" size={20} color="#FFF" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        {/* ── Warning Banner ────────────────── */}
        <TouchableOpacity style={s.warningBanner} onPress={() => Linking.openSettings()} activeOpacity={0.8}>
          <Ionicons name="warning" size={20} color="#FF9800" />
          <Text style={s.warningText}>Set Truecaller as your default caller ID app</Text>
          <Ionicons name="chevron-forward" size={16} color="#8E8E93" />
        </TouchableOpacity>

        {/* ── Profile Card ──────────────────── */}
        <TouchableOpacity style={s.profileCard} onPress={() => router.push('/profile')} activeOpacity={0.7}>
          <View style={s.profileAvatar}>
            <Text style={s.profileAvatarT}>{getInitials(user?.name || null)}</Text>
          </View>
          <View style={s.profileInfo}>
            <Text style={s.profileName}>{user?.name || 'User'}</Text>
            <Text style={s.profileSub}>Manage your profile</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#3A3A3C" />
        </TouchableOpacity>

        {/* ── Permissions Banner (onboarding) ── */}
        {(isOnboarding || grantedCount < 5) && (
          <TouchableOpacity style={s.permBanner} onPress={handleRequestAll} activeOpacity={0.7}>
            <View style={s.permBannerLeft}>
              <Ionicons name="shield-checkmark" size={20} color="#4CAF50" />
              <Text style={s.permBannerText}>Permissions ({grantedCount}/5 granted)</Text>
            </View>
            <Text style={s.permBannerAction}>Grant All</Text>
          </TouchableOpacity>
        )}

        {/* ── Menu Items ────────────────────── */}
        <View style={s.menuSection}>
          <SettingsItem icon="settings-outline" iconLib="ion" label="General"
            onPress={() => Linking.openSettings()} />
          <SettingsItem icon="shield-outline" iconLib="ion" label="Caller ID & Spam"
            onPress={() => Linking.openSettings()} />
          <SettingsItem icon="ban" iconLib="ion" label="Blocked numbers"
            onPress={() => router.push('/profile')} />
          <SettingsItem icon="notifications-outline" iconLib="ion" label="Notifications"
            onPress={() => Linking.openURL('app-settings:notifications')} />
          <SettingsItem icon="information-circle-outline" iconLib="ion" label="About"
            onPress={() => Alert.alert('Truecaller Clone', 'Version 1.0.0\nDevelopment Build')} showDivider={false} />
        </View>

        {/* ── Logout ────────────────────────── */}
        {!isOnboarding && (
          <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={20} color="#F44336" />
            <Text style={s.logoutText}>Log Out</Text>
          </TouchableOpacity>
        )}

        {/* ── Onboarding Continue ───────────── */}
        {isOnboarding && (
          <TouchableOpacity style={s.continueBtn} onPress={handleRequestAll}>
            <Text style={s.continueBtnText}>Grant Permissions & Continue</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ── styles ─────────────────────────────────────────── */
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0A0A0A' },
  scroll: { paddingBottom: 40 },

  /* header */
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 4, paddingVertical: 8,
  },
  headerBtn: { padding: 10 },
  headerTitle: { flex: 1, color: '#FFF', fontSize: 20, fontWeight: '700', marginLeft: 4 },

  /* warning banner */
  warningBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#2A1F00', marginHorizontal: 16, marginTop: 4, marginBottom: 12,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14,
  },
  warningText: { flex: 1, color: '#FFB300', fontSize: 13, fontWeight: '500' },

  /* profile card */
  profileCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1A1A1A', marginHorizontal: 16, marginBottom: 12,
    borderRadius: 14, padding: 16, gap: 14,
  },
  profileAvatar: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: '#2196F3', justifyContent: 'center', alignItems: 'center',
  },
  profileAvatarT: { color: '#FFF', fontSize: 20, fontWeight: '700' },
  profileInfo: { flex: 1 },
  profileName: { color: '#FFF', fontSize: 17, fontWeight: '700' },
  profileSub: { color: '#2196F3', fontSize: 13, marginTop: 2 },

  /* permissions banner */
  permBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#0D2B1A', marginHorizontal: 16, marginBottom: 12,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
  },
  permBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  permBannerText: { color: '#4CAF50', fontSize: 13, fontWeight: '500' },
  permBannerAction: { color: '#4CAF50', fontSize: 13, fontWeight: '700' },

  /* menu */
  menuSection: { marginHorizontal: 16, backgroundColor: '#1A1A1A', borderRadius: 14, overflow: 'hidden', marginBottom: 12 },

  /* logout */
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginHorizontal: 16, marginTop: 12,
    backgroundColor: 'rgba(244,67,54,0.1)', borderRadius: 14,
    paddingVertical: 16, gap: 8,
  },
  logoutText: { color: '#F44336', fontSize: 16, fontWeight: '600' },

  /* onboarding */
  continueBtn: {
    backgroundColor: '#2196F3', marginHorizontal: 16, marginTop: 24,
    borderRadius: 28, paddingVertical: 16, alignItems: 'center',
  },
  continueBtnText: { color: '#FFF', fontSize: 17, fontWeight: '700' },
});
