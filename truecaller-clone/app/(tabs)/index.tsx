import React, { useState, useCallback, useMemo, memo, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, ScrollView,
  StatusBar, ActivityIndicator, Alert, Linking, RefreshControl,
  SectionList, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { callLogsService } from '../../src/services/callLogs';
import { contactsService, type DeviceContact } from '../../src/services/contacts';
import { favoritesApi, numbersApi } from '../../src/services/api';
import { callBlockingService } from '../../src/services/callBlocking';
import { useAuthStore } from '../../src/store/authStore';
import type { Favorite, CallType } from '../../src/types';

const { width: SCREEN_W } = Dimensions.get('window');

/* ── helpers ─────────────────────────────────────────── */
const AVATAR_COLORS = ['#1B5E20','#004D40','#01579B','#4A148C','#880E4F','#E65100','#33691E','#006064','#1A237E','#3E2723'];
const getColor = (n: string | null) => { if (!n) return '#455A64'; let h = 0; for (let i = 0; i < n.length; i++) h = n.charCodeAt(i) + ((h << 5) - h); return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]; };
const getInitials = (n: string | null) => { if (!n) return '?'; const p = n.trim().split(/\s+/); return p.length > 1 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : n.slice(0, 2).toUpperCase(); };

function timeAgo(ts: string) {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (diff < 1) return 'now';
  if (diff < 60) return `${diff}m`;
  const h = Math.floor(diff / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'Yesterday';
  return `${d}d`;
}

function fmtTime(ts: string) {
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/* ── types ────────────────────────────────────────────── */
type SubView = 'recent' | 'contacts' | 'favorites' | 'dialpad';

interface CallItem {
  id: string;
  phoneNumber: string;
  name: string | null;
  type: CallType;
  duration: number;
  timestamp: string;
  sim: number;
  isSpam: boolean;
  source: 'device' | 'api';
}

/* ── memoized sub-components ──────────────────────────── */
const DirIcon = memo(({ type }: { type: CallType }) => {
  switch (type) {
    case 'OUTGOING':
      return <MaterialIcons name="call-made" size={14} color="#4CAF50" />;
    case 'MISSED':
      return <MaterialIcons name="call-missed" size={14} color="#F44336" />;
    case 'BLOCKED':
      return <Ionicons name="close-circle" size={14} color="#F44336" />;
    default: // INCOMING
      return <MaterialIcons name="call-received" size={14} color="#2196F3" />;
  }
});

const CallRow = memo(({ item, onPress, onCall, onLongPress }: {
  item: CallItem; onPress: () => void; onCall: () => void; onLongPress: () => void;
}) => (
  <TouchableOpacity style={s.callRow} onPress={onPress} onLongPress={onLongPress} activeOpacity={0.7}>
    <View style={[s.avatar, { backgroundColor: item.isSpam ? '#B71C1C' : getColor(item.name) }]}>
      {item.isSpam
        ? <Ionicons name="warning" size={20} color="#FFF" />
        : <Text style={s.avatarT}>{getInitials(item.name)}</Text>}
    </View>
    <View style={s.callInfo}>
      <Text style={[s.callName, item.isSpam && { color: '#F44336' }, item.type === 'MISSED' && { color: '#F44336' }]} numberOfLines={1}>
        {item.name || item.phoneNumber}
      </Text>
      <View style={s.callMeta}>
        <DirIcon type={item.type} />
        {item.sim > 0 && (
          <View style={s.simBadge}>
            <Text style={s.simText}>{item.sim}</Text>
          </View>
        )}
        <Text style={s.callTime}>{fmtTime(item.timestamp)}</Text>
      </View>
    </View>
    <TouchableOpacity onPress={onCall} style={s.phoneBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
      <Ionicons name="call-outline" size={20} color="#8E8E93" />
    </TouchableOpacity>
  </TouchableOpacity>
));

const RecentBubble = memo(({ item, onPress }: { item: CallItem; onPress: () => void }) => {
  const firstName = (item.name || item.phoneNumber).split(' ')[0];
  return (
    <TouchableOpacity style={s.recentBubble} onPress={onPress} activeOpacity={0.7}>
      <View style={s.recentAvatarWrap}>
        <View style={[s.recentAvatar, { backgroundColor: getColor(item.name) }]}>
          <Text style={s.recentAvatarT}>{getInitials(item.name)}</Text>
        </View>
        <View style={s.timeBadge}>
          <Text style={s.timeBadgeT}>{timeAgo(item.timestamp)}</Text>
        </View>
      </View>
      <Text style={s.recentName} numberOfLines={1}>{firstName.length > 8 ? firstName.slice(0, 7) + '…' : firstName}</Text>
      <Text style={s.recentSub}>Mobile</Text>
    </TouchableOpacity>
  );
});

const ContactRow = memo(({ item, onPress }: { item: DeviceContact; onPress: () => void }) => (
  <TouchableOpacity style={s.callRow} onPress={onPress} activeOpacity={0.7}>
    <View style={[s.avatar, { backgroundColor: getColor(item.name) }]}>
      <Text style={s.avatarT}>{getInitials(item.name)}</Text>
    </View>
    <View style={s.callInfo}>
      <Text style={s.callName} numberOfLines={1}>{item.name}</Text>
      {item.phoneNumbers[0] && <Text style={s.contactPhone}>{item.phoneNumbers[0]}</Text>}
    </View>
    <TouchableOpacity onPress={() => Linking.openURL(`tel:${item.phoneNumbers[0]}`)} style={s.phoneBtn}>
      <Ionicons name="call-outline" size={20} color="#8E8E93" />
    </TouchableOpacity>
  </TouchableOpacity>
));

const FavCard = memo(({ item, onLongPress }: { item: Favorite; onLongPress: () => void }) => (
  <TouchableOpacity
    style={s.favCard}
    onPress={() => Linking.openURL(`tel:${item.phoneNumber}`)}
    onLongPress={onLongPress}
    activeOpacity={0.7}>
    <View style={[s.favAvatar, { backgroundColor: getColor(item.name) }]}>
      <Text style={s.favAvatarT}>{getInitials(item.name)}</Text>
    </View>
    <Text style={s.favName} numberOfLines={2}>{item.name}</Text>
  </TouchableOpacity>
));

/* ── DIAL PAD ──────────────────────────────────────── */
const DIAL_KEYS = [
  { digit: '1', letters: '' }, { digit: '2', letters: 'ABC' }, { digit: '3', letters: 'DEF' },
  { digit: '4', letters: 'GHI' }, { digit: '5', letters: 'JKL' }, { digit: '6', letters: 'MNO' },
  { digit: '7', letters: 'PQRS' }, { digit: '8', letters: 'TUV' }, { digit: '9', letters: 'WXYZ' },
  { digit: '*', letters: '' }, { digit: '0', letters: '+' }, { digit: '#', letters: '' },
];

const DialKey = memo(({ digit, letters, onPress }: { digit: string; letters: string; onPress: () => void }) => (
  <TouchableOpacity style={s.dialKey} onPress={onPress} activeOpacity={0.5}>
    <Text style={s.dialDigit}>{digit}</Text>
    {letters ? <Text style={s.dialLetters}>{letters}</Text> : null}
  </TouchableOpacity>
));

/* ═══════════════════════════════════════════════════════
   MAIN CALLS SCREEN
   ═══════════════════════════════════════════════════════ */
export default function CallsScreen() {
  const user = useAuthStore(st => st.user);
  const [subView, setSubView] = useState<SubView>('recent');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [calls, setCalls] = useState<CallItem[]>([]);
  const [recentContacts, setRecentContacts] = useState<CallItem[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [contacts, setContacts] = useState<DeviceContact[]>([]);
  const [dialNumber, setDialNumber] = useState('');

  /* ── fetch ──────────────────────────────────── */
  const fetchData = useCallback(async (isRefresh = false) => {
    try {
      if (!isRefresh) setLoading(true);

      let callItems: CallItem[] = [];
      if (callLogsService.isAvailable) {
        const deviceLogs = await callLogsService.getCallLogs(200);
        callItems = deviceLogs.map((l, i) => ({
          id: `d-${i}-${l.timestamp}`,
          phoneNumber: l.phoneNumber,
          name: l.name,
          type: l.type,
          duration: l.duration,
          timestamp: l.timestamp,
          sim: l.rawType === 7 ? 2 : 1,
          isSpam: callBlockingService.isBlocked(l.phoneNumber),
          source: 'device' as const,
        }));
      }
      setCalls(callItems);

      // Recent contacts (unique by phone, max 10)
      const seen = new Set<string>();
      const recent: CallItem[] = [];
      for (const c of callItems) {
        if (c.phoneNumber && !seen.has(c.phoneNumber)) {
          seen.add(c.phoneNumber);
          recent.push(c);
        }
        if (recent.length >= 10) break;
      }
      setRecentContacts(recent);

      // Favorites from API
      try {
        const fav = await favoritesApi.getAll();
        setFavorites(fav.data || []);
      } catch {}

      // Device contacts
      if (contactsService.isAvailable) {
        try {
          const dc = await contactsService.getDeviceContacts();
          setContacts(dc);
        } catch {}
      }
    } catch (e: any) {
      console.warn('Calls fetch:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const hasFetched = useRef(false);
  useEffect(() => {
    if (!hasFetched.current) {
      hasFetched.current = true;
      fetchData();
    }
  }, [fetchData]);
  const onRefresh = () => { setRefreshing(true); fetchData(true); };

  /* ── handlers ──────────────────────────────── */
  const handleCall = useCallback((phone: string) => Linking.openURL(`tel:${phone}`), []);

  const handlePressCall = useCallback((c: CallItem) => {
    router.push({ pathname: '/number-detail', params: { phone: c.phoneNumber, name: c.name || '' } });
  }, []);

  const handleLongPress = useCallback((item: CallItem) => {
    Alert.alert(item.name || item.phoneNumber, '', [
      { text: 'Call', onPress: () => handleCall(item.phoneNumber) },
      { text: 'Add to Favorites', onPress: async () => {
        try { await favoritesApi.add(item.phoneNumber, item.name || item.phoneNumber); fetchData(true); } catch {}
      }},
      { text: 'Block', style: 'destructive', onPress: async () => {
        await callBlockingService.blockNumber(item.phoneNumber, 'Blocked by user');
        Alert.alert('Blocked', `${item.phoneNumber} blocked`);
        fetchData(true);
      }},
      { text: 'Report Spam', style: 'destructive', onPress: async () => {
        try { await numbersApi.reportSpam({ phoneNumber: item.phoneNumber, reason: 'From call log' }); Alert.alert('Reported'); } catch {}
      }},
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [handleCall, fetchData]);

  const handleRemFav = useCallback(async (f: Favorite) => {
    Alert.alert('Remove Favorite?', f.name, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try { await favoritesApi.remove(f.phoneNumber); fetchData(true); } catch {}
      }},
    ]);
  }, [fetchData]);

  /* ── grouped contacts ──────────────────────── */
  const contactSections = useMemo(() => {
    const groups: Record<string, DeviceContact[]> = {};
    contacts.forEach(c => {
      const letter = c.name?.[0]?.toUpperCase() || '#';
      const key = /[A-Z]/.test(letter) ? letter : '#';
      (groups[key] ??= []).push(c);
    });
    return Object.keys(groups).sort().map(k => ({ title: k, data: groups[k] }));
  }, [contacts]);

  /* ── RENDER ────────────────────────────────── */
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0A" />

      {/* ── Search Bar ──────────────────────── */}
      <TouchableOpacity style={s.searchBar} onPress={() => router.push('/search')} activeOpacity={0.8}>
        <TouchableOpacity onPress={() => router.push('/profile')} activeOpacity={0.7}>
          <View style={[s.searchAvatar, { backgroundColor: user?.name ? getColor(user.name) : '#2196F3' }]}>
            <Text style={s.searchAvatarT}>{user?.name ? getInitials(user.name) : '?'}</Text>
          </View>
        </TouchableOpacity>
        <Text style={s.searchPlaceholder}>Search numbers, names & more</Text>
        <View style={s.searchDot} />
      </TouchableOpacity>

      {/* ── Content ─────────────────────────── */}
      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color="#2196F3" /></View>
      ) : subView === 'recent' ? (
        /* ──────── RECENT CALLS ──────── */
        <FlatList
          data={calls}
          keyExtractor={c => c.id}
          contentContainerStyle={{ paddingBottom: 80 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2196F3" colors={['#2196F3']} />}
          ListHeaderComponent={recentContacts.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.recentScroll}>
              {recentContacts.map(c => (
                <RecentBubble key={c.id} item={c} onPress={() => handlePressCall(c)} />
              ))}
            </ScrollView>
          ) : null}
          renderItem={({ item }) => (
            <CallRow item={item}
              onPress={() => handlePressCall(item)}
              onCall={() => handleCall(item.phoneNumber)}
              onLongPress={() => handleLongPress(item)} />
          )}
          ListEmptyComponent={
            <View style={s.center}>
              <Ionicons name="call-outline" size={56} color="#2C2C2E" />
              <Text style={s.emptyT}>No call history</Text>
              <Text style={s.emptySubT}>Your recent calls will appear here</Text>
            </View>
          }
          getItemLayout={(_, i) => ({ length: 68, offset: 68 * i, index: i })}
          initialNumToRender={15}
          maxToRenderPerBatch={20}
          windowSize={10}
          removeClippedSubviews
        />

      ) : subView === 'contacts' ? (
        /* ──────── CONTACTS ──────── */
        <SectionList
          sections={contactSections}
          keyExtractor={(c, i) => c.id + i}
          contentContainerStyle={{ paddingBottom: 80 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2196F3" colors={['#2196F3']} />}
          ListHeaderComponent={
            <View style={s.contactsHeader}>
              <Ionicons name="cloud-upload-outline" size={18} color="#8E8E93" />
              <Text style={s.contactsHeaderT}>Your contacts are backed up</Text>
            </View>
          }
          renderSectionHeader={({ section }) => (
            <Text style={s.sectionHeader}>{section.title}</Text>
          )}
          renderItem={({ item }) => (
            <ContactRow item={item}
              onPress={() => router.push({ pathname: '/number-detail', params: { phone: item.phoneNumbers[0], name: item.name } })} />
          )}
          ListEmptyComponent={
            <View style={s.center}>
              <Ionicons name="people-outline" size={56} color="#2C2C2E" />
              <Text style={s.emptyT}>No contacts</Text>
              <Text style={s.emptySubT}>Grant contacts permission in settings</Text>
            </View>
          }
          initialNumToRender={20}
          maxToRenderPerBatch={30}
          windowSize={10}
          stickySectionHeadersEnabled
        />

      ) : subView === 'favorites' ? (
        /* ──────── FAVORITES ──────── */
        <ScrollView contentContainerStyle={s.favGrid}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2196F3" colors={['#2196F3']} />}>
          {favorites.length === 0 ? (
            <View style={s.center}>
              <Ionicons name="heart-outline" size={56} color="#2C2C2E" />
              <Text style={s.emptyT}>No favorites yet</Text>
              <Text style={s.emptySubT}>Long press a call to add to favorites</Text>
            </View>
          ) : (
            <View style={s.favWrap}>
              {favorites.map(f => (
                <FavCard key={f.id} item={f} onLongPress={() => handleRemFav(f)} />
              ))}
            </View>
          )}
        </ScrollView>

      ) : (
        /* ──────── DIALPAD ──────── */
        <View style={s.dialContainer}>
          <View style={s.dialDisplay}>
            <Text style={[s.dialDisplayText, !dialNumber && { color: '#3A3A3C' }]}>
              {dialNumber || 'Enter number'}
            </Text>
            {dialNumber.length > 0 && (
              <TouchableOpacity onPress={() => setDialNumber(p => p.slice(0, -1))} onLongPress={() => setDialNumber('')}>
                <Ionicons name="backspace-outline" size={24} color="#8E8E93" />
              </TouchableOpacity>
            )}
          </View>
          <View style={s.dialPad}>
            {DIAL_KEYS.map(k => (
              <DialKey key={k.digit} digit={k.digit} letters={k.letters}
                onPress={() => setDialNumber(p => p + k.digit)} />
            ))}
          </View>
          <View style={s.simRow}>
            <TouchableOpacity style={s.simBtn} onPress={() => { if (dialNumber) Linking.openURL(`tel:${dialNumber}`); }}>
              <View style={s.simIcon}><Text style={s.simIconT}>1</Text></View>
              <Text style={s.simLabel}>SIM 1</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.simBtn} onPress={() => { if (dialNumber) Linking.openURL(`tel:${dialNumber}`); }}>
              <View style={s.simIcon}><Text style={s.simIconT}>2</Text></View>
              <Text style={s.simLabel}>eSIM 1</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Floating Action Bar ─────────────── */}
      <View style={s.fab}>
        {([
          { key: 'recent' as SubView, icon: 'time-outline' as const },
          { key: 'contacts' as SubView, icon: 'person-outline' as const },
          { key: 'favorites' as SubView, icon: 'heart-outline' as const },
          { key: 'dialpad' as SubView, icon: 'keypad' as const },
        ]).map(b => (
          <TouchableOpacity
            key={b.key}
            style={[s.fabBtn, subView === b.key && s.fabBtnActive]}
            onPress={() => setSubView(b.key)}
            activeOpacity={0.7}>
            <Ionicons name={b.icon} size={22}
              color={subView === b.key ? '#2196F3' : '#8E8E93'} />
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

/* ── styles ─────────────────────────────────────────── */
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0A0A0A' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 100, gap: 6 },
  emptyT: { color: '#5A5A5E', fontSize: 16, fontWeight: '500', marginTop: 8 },
  emptySubT: { color: '#3A3A3C', fontSize: 13 },

  /* search bar */
  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1C1C1E', marginHorizontal: 14, marginVertical: 8,
    borderRadius: 28, paddingHorizontal: 6, paddingVertical: 6, gap: 10,
  },
  searchAvatar: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  searchAvatarT: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  searchPlaceholder: { flex: 1, color: '#6B6B6B', fontSize: 15 },
  searchDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#F44336', marginRight: 10 },

  /* recent bubbles */
  recentScroll: { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 12, gap: 16 },
  recentBubble: { alignItems: 'center', width: 68 },
  recentAvatarWrap: { position: 'relative', marginBottom: 6 },
  recentAvatar: { width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center' },
  recentAvatarT: { color: '#FFF', fontSize: 20, fontWeight: '700' },
  timeBadge: {
    position: 'absolute', bottom: -2, left: -2,
    backgroundColor: '#1B5E20', borderRadius: 8,
    paddingHorizontal: 5, paddingVertical: 1,
    borderWidth: 2, borderColor: '#0A0A0A',
  },
  timeBadgeT: { color: '#4CAF50', fontSize: 9, fontWeight: '800' },
  recentName: { color: '#E0E0E0', fontSize: 11, textAlign: 'center' },
  recentSub: { color: '#5A5A5E', fontSize: 10 },

  /* call rows */
  callRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 14 },
  avatar: { width: 46, height: 46, borderRadius: 23, justifyContent: 'center', alignItems: 'center' },
  avatarT: { color: '#FFF', fontSize: 18, fontWeight: '700' },
  callInfo: { flex: 1 },
  callName: { color: '#FFF', fontSize: 15, fontWeight: '500', marginBottom: 3 },
  callMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  simBadge: {
    width: 16, height: 14, borderRadius: 2,
    borderWidth: 1, borderColor: '#5A5A5E',
    justifyContent: 'center', alignItems: 'center',
  },
  simText: { color: '#5A5A5E', fontSize: 8, fontWeight: '800' },
  callTime: { color: '#6B6B6B', fontSize: 12 },
  phoneBtn: { padding: 8 },

  /* contacts */
  contactsHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#1A1A1A', marginBottom: 4,
  },
  contactsHeaderT: { color: '#8E8E93', fontSize: 13 },
  contactPhone: { color: '#6B6B6B', fontSize: 12, marginTop: 2 },
  sectionHeader: {
    color: '#8E8E93', fontSize: 13, fontWeight: '600',
    paddingHorizontal: 16, paddingVertical: 6,
    backgroundColor: '#0A0A0A',
  },

  /* favorites grid */
  favGrid: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 100 },
  favWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  favCard: { alignItems: 'center', width: (SCREEN_W - 32 - 24) / 3, marginBottom: 16 },
  favAvatar: { width: 90, height: 90, borderRadius: 45, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  favAvatarT: { color: '#FFF', fontSize: 32, fontWeight: '700' },
  favName: { color: '#E0E0E0', fontSize: 12, textAlign: 'center', fontWeight: '500' },

  /* dialpad */
  dialContainer: {
    flex: 1, justifyContent: 'flex-end', paddingBottom: 16,
    backgroundColor: '#1C1C1E', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    marginTop: 8,
  },
  dialDisplay: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 20, paddingHorizontal: 32, gap: 12,
  },
  dialDisplayText: { color: '#FFF', fontSize: 30, fontWeight: '300', letterSpacing: 2 },
  dialPad: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 24 },
  dialKey: { width: '33.33%', alignItems: 'center', justifyContent: 'center', paddingVertical: 16 },
  dialDigit: { color: '#FFF', fontSize: 32, fontWeight: '300' },
  dialLetters: { color: '#8E8E93', fontSize: 10, fontWeight: '700', letterSpacing: 2, marginTop: 2 },
  simRow: { flexDirection: 'row', justifyContent: 'center', gap: 16, paddingVertical: 12, paddingHorizontal: 24 },
  simBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1B5E20', borderRadius: 24,
    paddingHorizontal: 20, paddingVertical: 12, gap: 8,
    flex: 1, justifyContent: 'center',
  },
  simIcon: {
    width: 20, height: 20, borderRadius: 3,
    borderWidth: 1.5, borderColor: '#4CAF50',
    justifyContent: 'center', alignItems: 'center',
  },
  simIconT: { color: '#4CAF50', fontSize: 10, fontWeight: '800' },
  simLabel: { color: '#4CAF50', fontSize: 14, fontWeight: '700' },

  /* floating action bar */
  fab: {
    position: 'absolute', bottom: 12, alignSelf: 'center',
    flexDirection: 'row', backgroundColor: '#2C2C2E',
    borderRadius: 28, paddingHorizontal: 8, paddingVertical: 6, gap: 4,
    elevation: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8,
  },
  fabBtn: { width: 46, height: 46, borderRadius: 23, justifyContent: 'center', alignItems: 'center' },
  fabBtnActive: { backgroundColor: '#1A3A5C' },
});
