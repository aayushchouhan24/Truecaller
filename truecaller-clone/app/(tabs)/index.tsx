/* eslint-disable react/display-name */
import React, { useState, useCallback, useMemo, memo, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, ScrollView,
  StatusBar, ActivityIndicator, Alert, Linking, RefreshControl,
  SectionList, Dimensions, Modal, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { callLogsService } from '../../src/services/callLogs';
import { contactsService, type DeviceContact } from '../../src/services/contacts';
import { numbersApi } from '../../src/services/api';
import { callBlockingService } from '../../src/services/callBlocking';
import { callerIdBridge } from '../../src/modules/CallerIdBridge';
import { useAuthStore } from '../../src/store/authStore';
import type { CallType } from '../../src/types';

const { width: SCREEN_W } = Dimensions.get('window');

/* ── helpers ─────────────────────────────────────────── */
const AVATAR_COLORS = ['#1B5E20', '#004D40', '#01579B', '#4A148C', '#880E4F', '#E65100', '#33691E', '#006064', '#1A237E', '#3E2723'];
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
  if (diffDays < 7) return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/* ── types ────────────────────────────────────────────── */
type SubView = 'recent' | 'contacts' | 'favorites';

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
  thumbnail?: string;
}

interface GroupedCall extends CallItem {
  count: number;
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
  item: GroupedCall; onPress: () => void; onCall: () => void; onLongPress: () => void;
}) => (
  <TouchableOpacity style={s.callRow} onPress={onPress} onLongPress={onLongPress} activeOpacity={0.7}>
    <View style={[s.avatar, { backgroundColor: item.isSpam ? '#B71C1C' : getColor(item.name) }]}>
      {item.isSpam
        ? <Ionicons name="warning" size={20} color="#FFF" />
        : item.thumbnail
          ? <Image source={{ uri: item.thumbnail }} style={s.avatarImg} />
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
        <Text style={s.callTime}>{fmtTime(item.timestamp)}{item.count > 1 ? ` · (${item.count})` : ''}</Text>
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
          {item.thumbnail
            ? <Image source={{ uri: item.thumbnail }} style={s.recentAvatarImg} />
            : <Text style={s.recentAvatarT}>{getInitials(item.name)}</Text>}
        </View>
        <View style={s.timeBadge}>
          <Text style={s.timeBadgeT}>{timeAgo(item.timestamp)}</Text>
        </View>
      </View>
      <Text style={s.recentName} numberOfLines={1}>{firstName.length > 10 ? firstName.slice(0, 9) + '…' : firstName}</Text>
      <View style={s.recentSubRow}>
        <Ionicons name="call" size={10} color="#5A5A5E" />
        <Text style={s.recentSub}>Mobile</Text>
      </View>
    </TouchableOpacity>
  );
});

const ContactRow = memo(({ item, onPress, onCall }: { item: DeviceContact; onPress: () => void; onCall: () => void }) => (
  <TouchableOpacity style={s.callRow} onPress={onPress} activeOpacity={0.7}>
    <View style={[s.avatar, { backgroundColor: getColor(item.name) }]}>
      {item.thumbnail
        ? <Image source={{ uri: item.thumbnail }} style={s.avatarImg} />
        : <Text style={s.avatarT}>{getInitials(item.name)}</Text>}
    </View>
    <View style={s.callInfo}>
      <Text style={s.callName} numberOfLines={1}>{item.name}</Text>
      {item.phoneNumbers[0] && <Text style={s.contactPhone}>{item.phoneNumbers[0]}</Text>}
    </View>
    <TouchableOpacity onPress={onCall} style={s.phoneBtn}>
      <Ionicons name="call-outline" size={20} color="#8E8E93" />
    </TouchableOpacity>
  </TouchableOpacity>
));

/* ── DIAL PAD (Truecaller style) ──────────────────── */
const DIAL_KEYS = [
  { digit: '1', letters: '' }, { digit: '2', letters: 'ABC' }, { digit: '3', letters: 'DEF' },
  { digit: '4', letters: 'GHI' }, { digit: '5', letters: 'JKL' }, { digit: '6', letters: 'MNO' },
  { digit: '7', letters: 'PQRS' }, { digit: '8', letters: 'TUV' }, { digit: '9', letters: 'WXYZ' },
  { digit: '*', letters: '' }, { digit: '0', letters: '+' }, { digit: '#', letters: '' },
];

const DialKey = memo(({ digit, letters, onPress }: { digit: string; letters: string; onPress: () => void }) => (
  <TouchableOpacity style={s.dialKey} onPress={onPress} activeOpacity={0.5}>
    <View style={s.dialKeyInner}>
      <Text style={s.dialDigit}>{digit}</Text>
      {letters ? <Text style={s.dialLetters}>{letters}</Text> : null}
    </View>
  </TouchableOpacity>
));

/* ── device favorite type ────────────────────────────── */
interface DeviceFavorite {
  id: string;
  name: string;
  phoneNumber: string;
  thumbnail?: string;
}

/* ═══════════════════════════════════════════════════════
   MAIN CALLS SCREEN
   ═══════════════════════════════════════════════════════ */
export default function CallsScreen() {
  const user = useAuthStore(st => st.user);
  const [subView, setSubView] = useState<SubView>('recent');
  const [dialpadOpen, setDialpadOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [calls, setCalls] = useState<CallItem[]>([]);
  const [recentContacts, setRecentContacts] = useState<CallItem[]>([]);
  const [deviceFavorites, setDeviceFavorites] = useState<DeviceFavorite[]>([]);
  const [contacts, setContacts] = useState<DeviceContact[]>([]);
  const [dialNumber, setDialNumber] = useState('');
  const [dialLookupName, setDialLookupName] = useState<string | null>(null);
  const [dialLookingUp, setDialLookingUp] = useState(false);
  const [dialMatchedContacts, setDialMatchedContacts] = useState<DeviceContact[]>([]);
  const [menuVisible, setMenuVisible] = useState(false);
  const [callFilter, setCallFilter] = useState<'ALL' | 'OUTGOING' | 'INCOMING' | 'MISSED' | 'BLOCKED'>('ALL');

  /* ── dial number lookup ─────────────────────── */
  const dialLookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!dialNumber || dialNumber.length < 4) {
      setDialLookupName(null);
      setDialMatchedContacts([]);
      return;
    }

    // Search local contacts matching dialed digits
    const matched = contacts.filter(c =>
      c.phoneNumbers.some(p => p.replace(/[\s\-()]/g, '').includes(dialNumber))
    ).slice(0, 3);
    setDialMatchedContacts(matched);

    if (matched.length > 0) {
      setDialLookupName(matched[0].name);
    } else {
      setDialLookupName(null);
    }

    // Debounced API lookup for numbers >= 7 digits
    if (dialNumber.length >= 7) {
      if (dialLookupTimer.current) clearTimeout(dialLookupTimer.current);
      dialLookupTimer.current = setTimeout(async () => {
        try {
          setDialLookingUp(true);
          const res = await numbersApi.lookup(dialNumber);
          // Handle null, undefined, or "null" string
          const name = res.data?.name;
          if (name && name !== 'null' && name !== 'undefined') {
            setDialLookupName(name);
          }
        } catch { } finally {
          setDialLookingUp(false);
        }
      }, 800);
    }

    return () => {
      if (dialLookupTimer.current) clearTimeout(dialLookupTimer.current);
    };
  }, [dialNumber, contacts]);

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

      // Most frequently contacted (top 4) for header bubbles
      const freqMap = new Map<string, { count: number; item: CallItem }>();
      for (const c of callItems) {
        const fk = c.phoneNumber.replace(/[\s\-()]/g, '').slice(-10);
        const ex = freqMap.get(fk);
        if (ex) { ex.count++; } else { freqMap.set(fk, { count: 1, item: c }); }
      }
      const topFrequent = [...freqMap.values()].sort((a, b) => b.count - a.count).slice(0, 4).map(v => v.item);
      setRecentContacts(topFrequent);

      // Device contacts + build favorites from most-called
      if (contactsService.isAvailable) {
        try {
          const dc = await contactsService.getDeviceContacts();
          setContacts(dc);

          // Build a phone→thumbnail map for fast lookup
          const thumbMap = new Map<string, string>();
          for (const c of dc) {
            if (c.thumbnail) {
              for (const p of c.phoneNumbers) {
                thumbMap.set(p.replace(/[\s\-()]/g, '').slice(-10), c.thumbnail);
              }
            }
          }

          // Enrich call items with thumbnails from contacts
          const enriched = callItems.map(ci => {
            const key = ci.phoneNumber.replace(/[\s\-()]/g, '').slice(-10);
            return { ...ci, thumbnail: thumbMap.get(key) };
          });
          setCalls(enriched);

          // Rebuild top-4 frequent with thumbnails
          const freqMapR = new Map<string, { count: number; item: CallItem }>();
          for (const c of enriched) {
            const fk = c.phoneNumber.replace(/[\s\-()]/g, '').slice(-10);
            const ex = freqMapR.get(fk);
            if (ex) { ex.count++; } else { freqMapR.set(fk, { count: 1, item: c }); }
          }
          const topFreqR = [...freqMapR.values()].sort((a, b) => b.count - a.count).slice(0, 4).map(v => v.item);
          setRecentContacts(topFreqR);

          // Build "favorites" from device-starred contacts
          try {
            const starred = await callerIdBridge.getStarredContacts();
            const favs: DeviceFavorite[] = starred.map(s => ({
              id: s.id,
              name: s.name,
              phoneNumber: s.phoneNumbers[0] || '',
              thumbnail: s.thumbnail || undefined,
            })).filter(f => f.phoneNumber);
            setDeviceFavorites(favs);
          } catch {
            // Fallback: use most-called contacts if starred fetch fails
            const callCountMap = new Map<string, { count: number; name: string; phone: string }>();
            for (const c of callItems) {
              const key = c.phoneNumber.replace(/[\s\-()]/g, '').slice(-10);
              const existing = callCountMap.get(key);
              if (existing) existing.count++;
              else callCountMap.set(key, { count: 1, name: c.name || c.phoneNumber, phone: c.phoneNumber });
            }
            const topCalled = [...callCountMap.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 12);
            const favs: DeviceFavorite[] = [];
            for (const [key, val] of topCalled) {
              const contact = dc.find(c => c.phoneNumbers.some(p => p.replace(/[\s\-()]/g, '').slice(-10) === key));
              if (contact) {
                favs.push({ id: contact.id, name: contact.name, phoneNumber: contact.phoneNumbers[0], thumbnail: contact.thumbnail });
              }
            }
            setDeviceFavorites(favs);
          }
        } catch { }
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
  const handleCall = useCallback((phone: string) => {
    callerIdBridge.placeCall(phone);
  }, []);

  const handlePressCall = useCallback((c: CallItem) => {
    router.push({ pathname: '/number-detail', params: { phone: c.phoneNumber, name: c.name || '' } });
  }, []);

  const handleLongPress = useCallback((item: CallItem) => {
    Alert.alert(item.name || item.phoneNumber, '', [
      { text: 'Call', onPress: () => handleCall(item.phoneNumber) },
      {
        text: 'Block', style: 'destructive', onPress: async () => {
          await callBlockingService.blockNumber(item.phoneNumber, 'Blocked by user');
          Alert.alert('Blocked', `${item.phoneNumber} blocked`);
          fetchData(true);
        }
      },
      {
        text: 'Report Spam', style: 'destructive', onPress: async () => {
          try { await numbersApi.reportSpam({ phoneNumber: item.phoneNumber, reason: 'From call log' }); Alert.alert('Reported'); } catch { }
        }
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [handleCall, fetchData]);

  const handleDialSearch = useCallback(() => {
    if (dialNumber.length >= 4) {
      router.push({ pathname: '/search', params: { q: dialNumber } });
    }
  }, [dialNumber]);

  /* ── 3-dot menu options ────────────────────── */
  const setFilter = (f: typeof callFilter) => { 
    setMenuVisible(false); 
    setCallFilter(f); 
  };
  const menuOptions = [
    { icon: 'call-made' as const, label: callFilter === 'OUTGOING' ? '✓ Outgoing calls' : 'Outgoing calls', onPress: () => setFilter('OUTGOING') },
    { icon: 'call-received' as const, label: callFilter === 'INCOMING' ? '✓ Incoming calls' : 'Incoming calls', onPress: () => setFilter('INCOMING') },
    { icon: 'call-missed' as const, label: callFilter === 'MISSED' ? '✓ Missed calls' : 'Missed calls', onPress: () => setFilter('MISSED') },
    { icon: 'block' as const, label: callFilter === 'BLOCKED' ? '✓ Blocked calls' : 'Blocked calls', onPress: () => setFilter('BLOCKED') },
    { icon: 'delete' as const, label: 'Delete all calls', onPress: () => {
      setMenuVisible(false);
      Alert.alert('Delete All', 'Clear all call history from this view?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { setCalls([]); setRecentContacts([]); } },
      ]);
    }},
    { icon: 'sim-card' as const, label: 'Set default SIM', onPress: () => { setMenuVisible(false); Linking.openSettings(); } },
    { icon: 'settings' as const, label: 'Settings', onPress: () => { setMenuVisible(false); router.push('/settings'); } },
    { icon: 'phone' as const, label: 'Set as default phone app', onPress: () => { setMenuVisible(false); Linking.openSettings(); } },
  ];

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

  /* ── group CONSECUTIVE call logs (same number + same type) ── */
  const groupedCalls = useMemo<GroupedCall[]>(() => {
    const filtered = callFilter === 'ALL' ? calls
      : callFilter === 'BLOCKED' ? calls.filter(c => c.isSpam)
      : calls.filter(c => c.type === callFilter);
    const result: GroupedCall[] = [];
    for (const c of filtered) {
      const key = c.phoneNumber.replace(/[\s\-()]/g, '').slice(-10);
      const prev = result.length > 0 ? result[result.length - 1] : null;
      const prevKey = prev ? prev.phoneNumber.replace(/[\s\-()]/g, '').slice(-10) : null;
      if (prev && prevKey === key && prev.type === c.type) {
        prev.count++;
      } else {
        result.push({ ...c, count: 1 });
      }
    }
    return result;
  }, [calls, callFilter]);

  /* ── RENDER ────────────────────────────────── */
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0A" />

      {/* ── Search Bar + 3-dot menu ──────── */}
      <View style={s.searchBarRow}>
        <TouchableOpacity style={s.searchBar} onPress={() => router.push('/search')} activeOpacity={0.8}>
          <TouchableOpacity onPress={() => router.push('/profile')} activeOpacity={0.7}>
            <View style={[s.searchAvatar, { backgroundColor: user?.name ? getColor(user.name) : '#2196F3' }]}>
              <Text style={s.searchAvatarT}>{user?.name ? getInitials(user.name) : '?'}</Text>
            </View>
          </TouchableOpacity>
          <Text style={s.searchPlaceholder}>Search numbers, names & more</Text>
          <TouchableOpacity
            onPress={(e) => { e.stopPropagation?.(); setMenuVisible(true); }}
            style={s.menuDotBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialIcons name="more-vert" size={22} color="#E0E0E0" />
          </TouchableOpacity>
        </TouchableOpacity>
      </View>

      {/* ── 3-dot Menu Modal ────────────────── */}
      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <TouchableOpacity style={s.menuOverlay} activeOpacity={1} onPress={() => setMenuVisible(false)}>
          <View style={s.menuDropdown}>
            {menuOptions.map((opt, i) => (
              <TouchableOpacity key={i} style={s.menuOption} onPress={opt.onPress} activeOpacity={0.7}>
                <MaterialIcons name={opt.icon} size={20} color="#E0E0E0" />
                <Text style={s.menuOptionText}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Active Filter Chip ──────────────── */}
      {callFilter !== 'ALL' && (
        <View style={s.filterChipRow}>
          <View style={s.filterChip}>
            <Text style={s.filterChipText}>
              {callFilter === 'OUTGOING' ? 'Outgoing calls' : callFilter === 'INCOMING' ? 'Incoming calls' : callFilter === 'MISSED' ? 'Missed calls' : 'Blocked calls'}
            </Text>
            <TouchableOpacity onPress={() => { setCallFilter('ALL'); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={16} color="#8E8E93" />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Content ─────────────────────────── */}
      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color="#2196F3" /></View>
      ) : subView === 'recent' ? (
        /* ──────── RECENT CALLS ──────── */
        <FlatList
          key="recent-list"
          data={groupedCalls}
          keyExtractor={c => c.id}
          contentContainerStyle={{ paddingBottom: 140 }}
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
          key="contacts-list"
          sections={contactSections}
          keyExtractor={(c, i) => c.id + i}
          contentContainerStyle={{ paddingBottom: 140 }}
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
              onPress={() => router.push({ pathname: '/number-detail', params: { phone: item.phoneNumbers[0], name: item.name } })}
              onCall={() => handleCall(item.phoneNumbers[0])} />
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

      ) : (
        /* ──────── FAVORITES (device contacts) ──────── */
        <FlatList
          key="favorites-grid"
          data={deviceFavorites}
          keyExtractor={item => item.id.toString()}
          numColumns={3}
          contentContainerStyle={s.favGrid}
          columnWrapperStyle={s.row}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={s.favCard}
              activeOpacity={0.75}
              onPress={() => handleCall(item.phoneNumber)}
            >
              <View style={[s.favAvatar, { backgroundColor: getColor(item.name) }]}>
                {item.thumbnail
                  ? <Image source={{ uri: item.thumbnail }} style={s.favAvatarImg} />
                  : <Text style={s.favAvatarT}>{getInitials(item.name)}</Text>}
              </View>

              <Text numberOfLines={2} style={s.favName}>
                {item.name}
              </Text>
            </TouchableOpacity>
          )}
        />

      )}

      {/* ── Dialpad Bottom Sheet ──────────────── */}
      <Modal visible={dialpadOpen} transparent animationType="slide" onRequestClose={() => setDialpadOpen(false)}>
        <View style={s.dialOverlay}>
          <TouchableOpacity style={s.dialOverlayBg} activeOpacity={1} onPress={() => setDialpadOpen(false)} />
          <View style={s.dialSheet}>
            {/* Contact matches */}
            {dialMatchedContacts.length > 0 && (
              <ScrollView style={s.dialContactsSection} keyboardShouldPersistTaps="handled">
                <Text style={s.dialContactsLabel}>Contacts</Text>
                {dialMatchedContacts.map((c, i) => (
                  <TouchableOpacity key={c.id + i} style={s.dialContactRow}
                    onPress={() => { setDialpadOpen(false); router.push({ pathname: '/number-detail', params: { phone: c.phoneNumbers[0], name: c.name } }); }}
                    activeOpacity={0.7}>
                    <View style={[s.dialContactAvatar, { backgroundColor: getColor(c.name) }]}>
                      <Text style={s.dialContactAvatarT}>{getInitials(c.name)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.dialContactName}>{c.name}</Text>
                      <Text style={s.dialContactPhone}>{c.phoneNumbers[0]}</Text>
                    </View>
                    <TouchableOpacity onPress={() => { setDialpadOpen(false); handleCall(c.phoneNumbers[0]); }}>
                      <Ionicons name="call" size={20} color="#8E8E93" />
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={s.dialSearchRow} onPress={handleDialSearch}>
                  <Ionicons name="search" size={18} color="#2196F3" />
                  <Text style={s.dialSearchText}>SEARCH '{dialNumber}' IN TRUECALLER</Text>
                </TouchableOpacity>
              </ScrollView>
            )}

            {dialNumber.length >= 4 && dialMatchedContacts.length === 0 && (
              <View style={s.dialContactsSection}>
                <TouchableOpacity style={s.dialSearchRow} onPress={handleDialSearch}>
                  <Ionicons name="search" size={18} color="#2196F3" />
                  <Text style={s.dialSearchText}>SEARCH '{dialNumber}' IN TRUECALLER</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Dial pad area */}
            <View style={s.dialPadArea}>
              <View style={s.dialDisplayRow}>
                <TouchableOpacity style={s.dialAddContactBtn} onPress={() => {
                  if (dialNumber) { setDialpadOpen(false); handleCall(dialNumber); }
                }}>
                  <MaterialIcons name="person-add" size={24} color="#8E8E93" />
                </TouchableOpacity>
                <View style={s.dialNumberDisplay}>
                  <Text style={[s.dialDisplayText, !dialNumber && { color: '#3A3A3C' }]}>
                    {dialNumber || ''}
                  </Text>
                </View>
                {dialNumber.length > 0 && (
                  <TouchableOpacity style={s.dialBackspaceBtn}
                    onPress={() => setDialNumber(p => p.slice(0, -1))}
                    onLongPress={() => setDialNumber('')}>
                    <Ionicons name="backspace-outline" size={24} color="#8E8E93" />
                  </TouchableOpacity>
                )}
              </View>

              {dialLookupName && (
                <Text style={s.dialLookupName}>{dialLookupName}</Text>
              )}
              {dialLookingUp && <ActivityIndicator size="small" color="#2196F3" style={{ marginBottom: 4 }} />}

              <View style={s.dialPad}>
                {DIAL_KEYS.map(k => (
                  <DialKey key={k.digit} digit={k.digit} letters={k.letters}
                    onPress={() => setDialNumber(p => p + k.digit)} />
                ))}
              </View>

              <View style={s.simRow}>
                <TouchableOpacity style={s.simBtn} onPress={() => { if (dialNumber) { setDialpadOpen(false); handleCall(dialNumber); } }}>
                  <Ionicons name="call" size={18} color="#4CAF50" />
                  <Text style={s.simLabel}>SIM 1</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.simBtn} onPress={() => { if (dialNumber) { setDialpadOpen(false); handleCall(dialNumber); } }}>
                  <Ionicons name="call" size={18} color="#4CAF50" />
                  <Text style={s.simLabel}>SIM 2</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Floating Action Bar ─────────────── */}
      {!dialpadOpen && (
        <View style={s.fabRow}>
          <View style={s.fabPill}>
            {([
              { key: 'recent' as SubView, icon: 'time-outline' as const, activeIcon: 'time' as const },
              { key: 'contacts' as SubView, icon: 'person-outline' as const, activeIcon: 'person' as const },
              { key: 'favorites' as SubView, icon: 'heart-outline' as const, activeIcon: 'heart' as const },
            ]).map(b => (
              <TouchableOpacity
                key={b.key}
                style={[s.fabBtn, subView === b.key && s.fabBtnActive]}
                onPress={() => setSubView(b.key)}
                activeOpacity={0.7}>
                <Ionicons name={subView === b.key ? b.activeIcon : b.icon} size={22} color={'#8E8E93'}
                />
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={s.fabDialBtn}
            onPress={() => setDialpadOpen(true)}
            activeOpacity={0.7}>
            <Ionicons name="keypad" size={24} color="#FFF" />
          </TouchableOpacity>
        </View>
      )}
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
  searchBarRow: { paddingHorizontal: 14, paddingVertical: 8 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1C1C1E',
    borderRadius: 28, paddingHorizontal: 8, paddingVertical: 8, gap: 10,
  },
  searchAvatar: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  searchAvatarT: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  searchPlaceholder: { flex: 1, color: '#6B6B6B', fontSize: 16 },
  menuDotBtn: { padding: 8 },

  /* 3-dot menu */
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  menuDropdown: {
    position: 'absolute', top: 56, right: 16,
    backgroundColor: '#2C2C2E', borderRadius: 12,
    paddingVertical: 6, minWidth: 220, elevation: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8,
  },
  menuOption: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  menuOptionText: { color: '#E0E0E0', fontSize: 15, fontWeight: '500' },

  /* filter chip */
  filterChipRow: { paddingHorizontal: 16, paddingBottom: 8, flexDirection: 'row' },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#1C3A5F', borderRadius: 16,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  filterChipText: { color: '#90CAF9', fontSize: 12, fontWeight: '600' },

  /* recent bubbles */
  recentScroll: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 14, gap: 20 },
  recentBubble: { alignItems: 'center', width: 84 },
  recentAvatarWrap: { position: 'relative', marginBottom: 8 },
  recentAvatar: { width: 68, height: 68, borderRadius: 34, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  recentAvatarT: { color: '#FFF', fontSize: 24, fontWeight: '700' },
  recentAvatarImg: { width: 68, height: 68, borderRadius: 34 },
  timeBadge: {
    position: 'absolute', bottom: -2, left: -2,
    backgroundColor: '#1B5E20', borderRadius: 8,
    paddingHorizontal: 5, paddingVertical: 1,
    borderWidth: 2, borderColor: '#0A0A0A',
  },
  timeBadgeT: { color: '#4CAF50', fontSize: 9, fontWeight: '800' },
  recentName: { color: '#E0E0E0', fontSize: 13, textAlign: 'center', fontWeight: '500' },
  recentSubRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 },
  recentSub: { color: '#5A5A5E', fontSize: 11 },

  /* call rows */
  callRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 16, gap: 14 },
  avatar: { width: 52, height: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  avatarT: { color: '#FFF', fontSize: 20, fontWeight: '700' },
  avatarImg: { width: 52, height: 52, borderRadius: 26 },
  callInfo: { flex: 1 },
  callName: { color: '#FFF', fontSize: 16, fontWeight: '600', marginBottom: 4 },
  callMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  simBadge: {
    width: 16, height: 14, borderRadius: 2,
    borderWidth: 1, borderColor: '#5A5A5E',
    justifyContent: 'center', alignItems: 'center',
  },
  simText: { color: '#5A5A5E', fontSize: 8, fontWeight: '800' },
  callTime: { color: '#6B6B6B', fontSize: 13 },
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
  favGrid: { paddingTop: 12, paddingBottom: 140, paddingHorizontal: 10 },

  row: { justifyContent: "space-between", marginBottom: 18 },

  favCard: { width: "31%", alignItems: "center" },

  favAvatar: { width: 88, height: 88, borderRadius: 44, justifyContent: "center", alignItems: "center", marginBottom: 8, overflow: "hidden" },

  favAvatarImg: { width: "100%", height: "100%", borderRadius: 44 },

  favAvatarT: { color: "#fff", fontSize: 30, fontWeight: "700" },

  favName: { color: "#E6E6E6", fontSize: 12, textAlign: "center", fontWeight: "500", lineHeight: 15 },


  /* dialpad bottom sheet */
  dialOverlay: { flex: 1, justifyContent: 'flex-end' },
  dialOverlayBg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  dialSheet: { backgroundColor: '#1C1C1E', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, paddingBottom: 24 },
  dialPadArea: { paddingBottom: 0 },
  dialDisplayRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 20, gap: 8,
  },
  dialAddContactBtn: { padding: 8 },
  dialNumberDisplay: { flex: 1, alignItems: 'center' },
  dialDisplayText: { color: '#FFF', fontSize: 32, fontWeight: '300', letterSpacing: 2 },
  dialBackspaceBtn: { padding: 8 },
  dialLookupName: {
    color: '#8E8E93', fontSize: 13, textAlign: 'center',
    marginBottom: 8, fontWeight: '500',
  },
  dialPad: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 20 },
  dialKey: { width: '33.33%', alignItems: 'center', justifyContent: 'center', paddingVertical: 6 },
  dialKeyInner: {
    width: 100, height: 52, borderRadius: 14,
    backgroundColor: '#2C2C2E',
    justifyContent: 'center', alignItems: 'center',
  },
  dialDigit: { color: '#FFF', fontSize: 26, fontWeight: '400' },
  dialLetters: { color: '#8E8E93', fontSize: 9, fontWeight: '700', letterSpacing: 2, marginTop: 0 },
  simRow: { flexDirection: 'row', justifyContent: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 20 },
  simBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1B5E20', borderRadius: 28,
    paddingHorizontal: 20, paddingVertical: 14, gap: 10,
    flex: 1, justifyContent: 'center',
  },
  simLabel: { color: '#4CAF50', fontSize: 14, fontWeight: '700' },

  /* dial contact matches */
  dialContactsSection: { paddingTop: 4, paddingBottom: 4 },
  dialContactsLabel: { color: '#8E8E93', fontSize: 12, fontWeight: '600', paddingHorizontal: 16, paddingVertical: 6 },
  dialContactRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  dialContactAvatar: { width: 38, height: 38, borderRadius: 19, justifyContent: 'center', alignItems: 'center' },
  dialContactAvatarT: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  dialContactName: { color: '#FFF', fontSize: 14, fontWeight: '500' },
  dialContactPhone: { color: '#6B6B6B', fontSize: 12 },
  dialSearchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  dialSearchText: { color: '#2196F3', fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },

  /* floating action bar */
  fabRow: {
    position: 'absolute', bottom: 15, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12,
  },
  fabPill: {
    flexDirection: 'row', backgroundColor: '#2C2C2E',
    borderRadius: 15, paddingHorizontal: 6, paddingVertical: 4, gap: 2,
    elevation: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8,
  },
  fabDialBtn: {
    width: 56, height: 56, borderRadius: 15,
    backgroundColor: '#2196F3', justifyContent: 'center', alignItems: 'center',
    elevation: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8,
  },
  fabBtn: { width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center' },
  fabBtnActive: { backgroundColor: '#3d3d3d', borderRadius: 14 },

});
