import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  StatusBar, ScrollView, Alert, Modal, TextInput, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons, MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { useAuthStore } from '../src/store/authStore';
import { callBlockingService } from '../src/services/callBlocking';
import { usersApi } from '../src/services/api';

/* ── helpers ─────────────────────────────────────────── */
const getInitials = (n: string | null) => {
  if (!n) return '?';
  const p = n.trim().split(/\s+/);
  return p.length > 1 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : n.slice(0, 2).toUpperCase();
};

function fmtPhone(p: string) {
  if (p.length === 10) return `${p.slice(0, 5)} ${p.slice(5)}`;
  if (p.startsWith('+91') && p.length === 13) return `0${p.slice(3, 8)} ${p.slice(8)}`;
  return p;
}

/* ── Menu Item ───────────────────────────────────────── */
function MenuItem({ icon, iconLib, label, badge, onPress, color }: {
  icon: string; iconLib: 'ion' | 'mci' | 'mi'; label: string; badge?: string; onPress?: () => void; color?: string;
}) {
  return (
    <TouchableOpacity style={s.menuItem} onPress={onPress} activeOpacity={0.7}>
      <View style={s.menuIconWrap}>
        {iconLib === 'ion' ? <Ionicons name={icon as any} size={22} color={color || '#FFF'} />
        : iconLib === 'mci' ? <MaterialCommunityIcons name={icon as any} size={22} color={color || '#FFF'} />
        : <MaterialIcons name={icon as any} size={22} color={color || '#FFF'} />}
      </View>
      <Text style={[s.menuLabel, color ? { color } : null]}>{label}</Text>
      {badge && <View style={s.menuBadge}><Text style={s.menuBadgeT}>{badge}</Text></View>}
      <Ionicons name="chevron-forward" size={18} color="#3A3A3C" />
    </TouchableOpacity>
  );
}

/* ═══════════════════════════════════════════════════════
   PROFILE SCREEN
   ═══════════════════════════════════════════════════════ */
export default function ProfileScreen() {
  const { user, setUser } = useAuthStore();
  const [blockedCount, setBlockedCount] = useState(0);
  const [stats, setStats] = useState({ profileViews: 0, searchedBy: 0, spamReported: 0, searchesMade: 0 });
  const [viewers, setViewers] = useState<any[]>([]);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editName, setEditName] = useState(user?.name || '');
  const [saving, setSaving] = useState(false);
  const completionPercent = 65;

  const handleSaveName = async () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed.length < 2) {
      Alert.alert('Error', 'Name must be at least 2 characters');
      return;
    }
    setSaving(true);
    try {
      await usersApi.updateName(trimmed);
      if (user) setUser({ ...user, name: trimmed });
      setEditModalVisible(false);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to update name');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    (async () => {
      setBlockedCount(await callBlockingService.getBlockedCount());
      try {
        const res = await usersApi.getStats();
        setStats(res.data);
      } catch {}
      try {
        const res = await usersApi.getWhoViewedMe(1);
        setViewers(res.data.data || []);
      } catch {}
    })();
  }, []);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0A" />

      {/* ── Header ──────────────────────────── */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerBtn}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{user?.name || 'Profile'}</Text>
        <TouchableOpacity onPress={() => router.push('/settings')} style={s.headerBtn}>
          <Ionicons name="settings-outline" size={22} color="#FFF" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        {/* ── Phone Number ──────────────────── */}
        <Text style={s.phoneNumber}>{user?.phoneNumber ? fmtPhone(user.phoneNumber) : ''}</Text>

        {/* ── Avatar with Progress Ring ─────── */}
        <View style={s.avatarSection}>
          <View style={s.avatarRingWrap}>
            <View style={s.avatarCircle}>
              <Text style={s.avatarT}>{getInitials(user?.name || null)}</Text>
            </View>
            <View style={s.percentBadge}>
              <Text style={s.percentBadgeT}>{completionPercent}%</Text>
            </View>
          </View>
          <TouchableOpacity>
            <Text style={s.genderLink}>Add gender to get 10%</Text>
          </TouchableOpacity>
        </View>

        {/* ── Action Buttons ────────────────── */}
        <View style={s.actionRow}>
          <TouchableOpacity style={s.actionBtnFilled} onPress={() => { setEditName(user?.name || ''); setEditModalVisible(true); }}>
            <Ionicons name="pencil" size={16} color="#FFF" />
            <Text style={s.actionBtnFilledT}>Edit profile</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.actionBtnOutline}>
            <Ionicons name="checkmark-circle-outline" size={16} color="#2196F3" />
            <Text style={s.actionBtnOutlineT}>Get verified</Text>
          </TouchableOpacity>
        </View>

        {/* ── Menu Items ────────────────────── */}
        <View style={s.menuSection}>
          <MenuItem icon="ban" iconLib="ion" label="Manage blocking"
            badge={blockedCount > 0 ? `${blockedCount}` : undefined}
            onPress={() => Alert.alert('Blocked Numbers', `${blockedCount} numbers blocked`)} />
          <MenuItem icon="crown" iconLib="mci" label="Upgrade to Premium" color="#FFB300"
            onPress={() => router.push('/(tabs)/premium')} />
          <MenuItem icon="eye-outline" iconLib="ion" label="Who viewed my profile"
            badge={stats.profileViews > 0 ? `${stats.profileViews}` : undefined}
            onPress={() => {
              if (viewers.length > 0) {
                const list = viewers.slice(0, 10).map((v: any) => `• ${v.viewer?.name || 'Unknown'} (${v.viewer?.phoneNumber || ''})`).join('\n');
                Alert.alert('Who Viewed My Profile', list);
              } else {
                Alert.alert('Who Viewed My Profile', 'No profile views yet');
              }
            }} />
          <MenuItem icon="search" iconLib="ion" label="Who searched for me"
            badge={stats.searchedBy > 0 ? `${stats.searchedBy}` : undefined}
            onPress={async () => {
              try {
                const res = await usersApi.getWhoSearchedMe(1);
                const items = res.data.data || [];
                if (items.length > 0) {
                  const list = items.slice(0, 10).map((s: any) => `• ${s.user?.name || 'Unknown'} (${s.user?.phoneNumber || ''})`).join('\n');
                  Alert.alert('Who Searched For Me', list);
                } else {
                  Alert.alert('Who Searched For Me', 'No one has searched for you yet');
                }
              } catch {
                Alert.alert('Who Searched For Me', 'Could not load data');
              }
            }} />
          <MenuItem icon="people-outline" iconLib="ion" label="Contact requests" />
          <MenuItem icon="shield-checkmark-outline" iconLib="ion" label="Fraud insurance" />
        </View>

        {/* ── Stats Section ─────────────────── */}
        <View style={s.statsSection}>
          <Text style={s.statsTitle}>Your Truecaller stats</Text>
          <View style={s.statsGrid}>
            <View style={s.statCard}>
              <Text style={s.statNum}>{stats.spamReported}</Text>
              <Text style={s.statLabel}>Spam identified</Text>
            </View>
            <View style={s.statCard}>
              <Text style={s.statNum}>{blockedCount}</Text>
              <Text style={s.statLabel}>Numbers blocked</Text>
            </View>
            <View style={s.statCard}>
              <Text style={s.statNum}>{stats.searchesMade}</Text>
              <Text style={s.statLabel}>Searches made</Text>
            </View>
            <View style={s.statCard}>
              <Text style={s.statNum}>{stats.profileViews}</Text>
              <Text style={s.statLabel}>Profile views</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* ── Edit Profile Modal ──────────── */}
      <Modal visible={editModalVisible} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>Edit Name</Text>
            <TextInput
              style={s.modalInput}
              value={editName}
              onChangeText={setEditName}
              placeholder="Enter your name"
              placeholderTextColor="#6B6B6B"
              autoFocus
              maxLength={50}
              autoCapitalize="words"
            />
            <View style={s.modalBtnRow}>
              <TouchableOpacity style={s.modalCancelBtn} onPress={() => setEditModalVisible(false)}>
                <Text style={s.modalCancelT}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalSaveBtn, saving && { opacity: 0.5 }]}
                onPress={handleSaveName}
                disabled={saving}
              >
                {saving ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={s.modalSaveT}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    paddingHorizontal: 4, paddingVertical: 8, gap: 4,
  },
  headerBtn: { padding: 10 },
  headerTitle: { flex: 1, color: '#FFF', fontSize: 20, fontWeight: '700', textAlign: 'center' },

  /* phone */
  phoneNumber: { color: '#8E8E93', fontSize: 14, textAlign: 'center', marginTop: 2 },

  /* avatar section */
  avatarSection: { alignItems: 'center', marginTop: 20, marginBottom: 16 },
  avatarRingWrap: {
    width: 130, height: 130, justifyContent: 'center', alignItems: 'center', marginBottom: 10,
    borderWidth: 4, borderColor: '#2196F3', borderRadius: 65,
  },
  avatarCircle: {
    width: 110, height: 110, borderRadius: 55,
    backgroundColor: '#1C1C1E', justifyContent: 'center', alignItems: 'center',
  },
  avatarT: { color: '#FFF', fontSize: 38, fontWeight: '700' },
  percentBadge: {
    position: 'absolute', bottom: 2, right: 10,
    backgroundColor: '#2196F3', borderRadius: 12,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 2, borderColor: '#0A0A0A',
  },
  percentBadgeT: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  genderLink: { color: '#2196F3', fontSize: 13, fontWeight: '500' },

  /* action buttons */
  actionRow: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginBottom: 24, paddingHorizontal: 24 },
  actionBtnFilled: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#2196F3', borderRadius: 24,
    paddingHorizontal: 24, paddingVertical: 12,
    flex: 1, justifyContent: 'center',
  },
  actionBtnFilledT: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  actionBtnOutline: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1.5, borderColor: '#2196F3', borderRadius: 24,
    paddingHorizontal: 24, paddingVertical: 12,
    flex: 1, justifyContent: 'center',
  },
  actionBtnOutlineT: { color: '#2196F3', fontSize: 14, fontWeight: '700' },

  /* menu */
  menuSection: { paddingHorizontal: 16 },
  menuItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 16, borderBottomWidth: 0.5, borderBottomColor: '#1C1C1E',
    gap: 14,
  },
  menuIconWrap: { width: 28, alignItems: 'center' },
  menuLabel: { flex: 1, color: '#FFF', fontSize: 15, fontWeight: '500' },
  menuBadge: {
    backgroundColor: '#F44336', borderRadius: 10,
    minWidth: 20, height: 20,
    justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 6, marginRight: 4,
  },
  menuBadgeT: { color: '#FFF', fontSize: 10, fontWeight: '800' },

  /* stats */
  statsSection: { marginTop: 24, paddingHorizontal: 16 },
  statsTitle: { color: '#8E8E93', fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: {
    backgroundColor: '#1C1C1E', borderRadius: 14,
    padding: 16, width: '48%', alignItems: 'center',
  },
  statNum: { color: '#FFF', fontSize: 24, fontWeight: '800', marginBottom: 4 },
  statLabel: { color: '#6B6B6B', fontSize: 12, textAlign: 'center' },

  /* modal */
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  modalBox: {
    backgroundColor: '#1C1C1E', borderRadius: 16,
    padding: 24, width: '100%', maxWidth: 360,
  },
  modalTitle: { color: '#FFF', fontSize: 18, fontWeight: '700', marginBottom: 16, textAlign: 'center' },
  modalInput: {
    backgroundColor: '#0A0A0A', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 16, color: '#FFF',
    borderWidth: 1, borderColor: '#333', marginBottom: 20,
  },
  modalBtnRow: { flexDirection: 'row', gap: 12 },
  modalCancelBtn: {
    flex: 1, borderRadius: 24, borderWidth: 1.5, borderColor: '#555',
    paddingVertical: 12, alignItems: 'center',
  },
  modalCancelT: { color: '#999', fontSize: 15, fontWeight: '600' },
  modalSaveBtn: {
    flex: 1, borderRadius: 24, backgroundColor: '#2196F3',
    paddingVertical: 12, alignItems: 'center',
  },
  modalSaveT: { color: '#FFF', fontSize: 15, fontWeight: '700' },
});
