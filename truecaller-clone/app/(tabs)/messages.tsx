import React, { useState, useCallback, memo } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  StatusBar, ActivityIndicator, Alert, RefreshControl, Modal, Linking, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { smsService } from '../../src/services/smsReader';
import { useAuthStore } from '../../src/store/authStore';
import { callBlockingService } from '../../src/services/callBlocking';

/* ── helpers ─────────────────────────────────────────── */
const getColor = (n: string) => {
  const COLORS = ['#1B5E20','#004D40','#01579B','#4A148C','#880E4F','#E65100','#33691E','#006064','#1A237E','#3E2723'];
  let h = 0; for (let i = 0; i < n.length; i++) h = n.charCodeAt(i) + ((h << 5) - h);
  return COLORS[Math.abs(h) % COLORS.length];
};

function fmtDate(ms: number | string) {
  const d = new Date(typeof ms === 'string' ? ms : ms);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/* ── unified message ───────────────────────────────── */
interface MsgItem {
  id: string;
  sender: string;
  body: string;
  date: string;
  isRead: boolean;
  category: string;
  isSpam: boolean;
  source: 'device' | 'api';
}

/* ── Memoized row ──────────────────────────────────── */
// eslint-disable-next-line react/display-name
const MsgRow = memo(({ item, onPress, onLongPress }: {
  item: MsgItem; onPress: () => void; onLongPress: () => void;
}) => {
  const isService = !item.sender.startsWith('+') && !/^\d{10,}$/.test(item.sender);
  return (
    <TouchableOpacity style={s.row} onPress={onPress} onLongPress={onLongPress} activeOpacity={0.7}>
      {/* Avatar */}
      <View style={[s.avatar, { backgroundColor: item.isSpam ? '#B71C1C' : isService ? '#1B5E20' : getColor(item.sender) }]}>
        {item.isSpam ? (
          <Ionicons name="warning" size={20} color="#FFF" />
        ) : isService ? (
          <Ionicons name="grid" size={18} color="#4CAF50" />
        ) : (
          <Text style={s.avatarT}>{item.sender.slice(0, 2).toUpperCase()}</Text>
        )}
      </View>

      {/* Content */}
      <View style={s.info}>
        <View style={s.topRow}>
          <Text style={[s.sender, item.isSpam && { color: '#F44336' }, !item.isRead && { color: '#FFF', fontWeight: '700' }]} numberOfLines={1}>
            {item.sender.toUpperCase()}
          </Text>
          <Text style={[s.time, !item.isRead && { color: '#2196F3' }]}>{fmtDate(item.date)}</Text>
        </View>
        <View style={s.bodyRow}>
          <Text style={[s.body, !item.isRead && { color: '#CCC' }]} numberOfLines={2}>{item.body}</Text>
          {!item.isRead && (
            <View style={s.unreadBadge}>
              <Text style={s.unreadBadgeT}>1</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
});

/* ═══════════════════════════════════════════════════════
   MESSAGES SCREEN
   ═══════════════════════════════════════════════════════ */
export default function MessagesScreen() {
  const user = useAuthStore(st => st.user);
  const [msgs, setMsgs] = useState<MsgItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [permDenied, setPermDenied] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [blockListVisible, setBlockListVisible] = useState(false);
  const [blockedNumbers, setBlockedNumbers] = useState<{ phoneNumber: string; reason: string }[]>([]);
  const [msgFilter, setMsgFilter] = useState<'all' | 'unread'>('all');

  const fetchData = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      let items: MsgItem[] = [];

      if (!smsService.isAvailable) {
        setPermDenied(true);
        setMsgs([]);
        return;
      }

      // Ensure permission is granted
      const hasPerm = await smsService.checkPermission();
      if (!hasPerm) {
        const granted = await smsService.requestPermission();
        if (!granted) {
          setPermDenied(true);
          setMsgs([]);
          return;
        }
      }
      setPermDenied(false);

      const deviceMsgs = await smsService.getMessages(300);
      items = deviceMsgs.map(m => ({
        id: m.id,
        sender: m.address,
        body: m.body,
        date: m.dateStr,
        isRead: m.read,
        category: m.category,
        isSpam: m.category === 'SPAM',
        source: 'device' as const,
      }));
      setMsgs(items);
    } catch (err: any) {
      console.error('Messages fetch:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));
  const onRefresh = () => { setRefreshing(true); fetchData(true); };

  const handleDelete = useCallback((item: MsgItem) => {
    Alert.alert('Delete', `Delete this message from ${item.sender}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        setMsgs(prev => prev.filter(m => m.id !== item.id));
      }},
    ]);
  }, []);

  const handleRead = useCallback(async (item: MsgItem) => {
    router.push({ pathname: '/sms-conversation', params: { sender: item.sender } });
  }, []);

  const getInitials = (n: string) => {
    if (!n) return '?';
    return n.slice(0, 2).toUpperCase();
  };

  /* ── 3-dot menu options ────────────────────── */
  const menuOptions = [
    { icon: 'mark-chat-read' as const, label: 'Mark all as read', onPress: () => {
      setMenuVisible(false);
      setMsgs(prev => prev.map(m => ({ ...m, isRead: true })));
      Alert.alert('Done', 'All messages marked as read');
    }},
    { icon: 'cleaning-services' as const, label: 'Inbox Cleaner', onPress: () => {
      setMenuVisible(false);
      const spamCount = msgs.filter(m => m.isSpam).length;
      const promoCount = msgs.filter(m => !m.sender.startsWith('+') && !/^\d{10,}$/.test(m.sender)).length;
      Alert.alert('Inbox Cleaner', `Found:\n• ${spamCount} spam messages\n• ${promoCount} promotional messages\n\nClean them up?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clean', style: 'destructive', onPress: () => {
          setMsgs(prev => prev.filter(m => !m.isSpam));
          Alert.alert('Cleaned', `Removed ${spamCount} spam messages`);
        }},
      ]);
    }},
    { icon: 'star-outline' as const, label: msgFilter === 'unread' ? '✓ Unread messages' : 'Unread messages', onPress: () => {
      setMenuVisible(false);
      setMsgFilter(prev => prev === 'unread' ? 'all' : 'unread');
    }},
    { icon: 'archive' as const, label: 'Archived conversations', onPress: () => {
      setMenuVisible(false);
      Alert.alert('Archived', 'No archived conversations yet.\n\nLong-press a conversation to archive it.');
    }},
    { icon: 'lock' as const, label: 'Passcode lock', onPress: () => {
      setMenuVisible(false);
      Alert.alert('Passcode Lock', 'Protect your messages with a passcode?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Set Up', onPress: () => router.push('/settings') },
      ]);
    }},
    { icon: 'block' as const, label: 'My block list', onPress: async () => {
      setMenuVisible(false);
      try {
        const blocked = await callBlockingService.getBlockedNumbers();
        setBlockedNumbers(blocked);
      } catch {}
      setBlockListVisible(true);
    }},
    { icon: 'settings' as const, label: 'Settings', onPress: () => { setMenuVisible(false); router.push('/settings'); }},
    { icon: 'sms' as const, label: 'Change default SMS app', onPress: () => { setMenuVisible(false); Linking.openSettings(); }},
  ];

  const displayMsgs = msgFilter === 'unread' ? msgs.filter(m => !m.isRead) : msgs;

  const handleUnblock = async (phoneNumber: string) => {
    await callBlockingService.unblockNumber(phoneNumber);
    const updated = await callBlockingService.getBlockedNumbers();
    setBlockedNumbers(updated);
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0A" />

      {/* ── Search Bar ──────────────────────── */}
      <View style={s.searchBarRow}>
        <TouchableOpacity style={s.searchBar} onPress={() => router.push('/search')} activeOpacity={0.8}>
          <TouchableOpacity onPress={() => router.push('/profile')} activeOpacity={0.7}>
            <View style={[s.searchAvatar, { backgroundColor: user?.name ? getColor(user.name) : '#2196F3' }]}>
              <Text style={s.searchAvatarT}>{user?.name ? getInitials(user.name) : '?'}</Text>
            </View>
          </TouchableOpacity>
          <Text style={s.searchPlaceholder}>Search messages</Text>
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

      {/* ── Filter Chip ────────────────────── */}
      {msgFilter !== 'all' && (
        <View style={s.filterChipRow}>
          <View style={s.filterChip}>
            <Text style={s.filterChipText}>Unread only</Text>
            <TouchableOpacity onPress={() => setMsgFilter('all')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={16} color="#8E8E93" />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color="#2196F3" /></View>
      ) : (
        <FlatList
          data={displayMsgs}
          keyExtractor={m => m.id}
          contentContainerStyle={{ paddingBottom: 140 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2196F3" colors={['#2196F3']} />}
          renderItem={({ item }) => (
            <MsgRow item={item}
              onPress={() => handleRead(item)}
              onLongPress={() => handleDelete(item)} />
          )}
          ListEmptyComponent={
            <View style={s.center}>
              <Ionicons name={permDenied ? "lock-closed-outline" : "chatbubble-outline"} size={56} color="#2C2C2E" />
              <Text style={s.emptyT}>{permDenied ? 'SMS permission required' : 'No messages'}</Text>
              <Text style={s.emptySubT}>
                {permDenied
                  ? 'Grant SMS permission to view your messages'
                  : 'Your SMS messages will appear here'}
              </Text>
              {permDenied && (
                <TouchableOpacity
                  style={{ marginTop: 16, backgroundColor: '#2196F3', borderRadius: 20, paddingHorizontal: 24, paddingVertical: 10 }}
                  onPress={() => fetchData()}>
                  <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 14 }}>Grant Permission</Text>
                </TouchableOpacity>
              )}
            </View>
          }
          ItemSeparatorComponent={() => <View style={s.sep} />}
          getItemLayout={(_, i) => ({ length: 78, offset: 78 * i, index: i })}
          initialNumToRender={15}
          maxToRenderPerBatch={20}
          windowSize={10}
          removeClippedSubviews
        />
      )}

      {/* ── Compose FAB ─────────────────────── */}
      <TouchableOpacity style={s.fab} activeOpacity={0.8}>
        <Ionicons name="chatbubble" size={22} color="#FFF" />
      </TouchableOpacity>

      {/* ── Block List Modal ────────────────── */}
      <Modal visible={blockListVisible} transparent animationType="slide" onRequestClose={() => setBlockListVisible(false)}>
        <View style={s.blockOverlay}>
          <View style={s.blockBox}>
            <View style={s.blockHeader}>
              <Text style={s.blockTitle}>Blocked Numbers</Text>
              <TouchableOpacity onPress={() => setBlockListVisible(false)}>
                <Ionicons name="close" size={24} color="#8E8E93" />
              </TouchableOpacity>
            </View>
            {blockedNumbers.length === 0 ? (
              <View style={s.blockEmpty}>
                <Ionicons name="checkmark-circle-outline" size={48} color="#4CAF50" />
                <Text style={s.blockEmptyT}>No blocked numbers</Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 400 }}>
                {blockedNumbers.map((b, i) => (
                  <View key={i} style={s.blockRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.blockPhone}>{b.phoneNumber}</Text>
                      {b.reason ? <Text style={s.blockReason}>{b.reason}</Text> : null}
                    </View>
                    <TouchableOpacity onPress={() => handleUnblock(b.phoneNumber)} style={s.unblockBtn}>
                      <Text style={s.unblockBtnT}>Unblock</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
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
    paddingVertical: 6, minWidth: 240, elevation: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8,
  },
  menuOption: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  menuOptionText: { color: '#E0E0E0', fontSize: 15, fontWeight: '500' },

  /* message row */
  row: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 16, gap: 14, alignItems: 'flex-start' },
  avatar: { width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', marginTop: 2 },
  avatarT: { color: '#FFF', fontSize: 18, fontWeight: '700' },
  info: { flex: 1 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  sender: { color: '#B0B0B0', fontSize: 15, fontWeight: '600', flex: 1, letterSpacing: 0.3 },
  time: { color: '#5A5A5E', fontSize: 12, marginLeft: 8 },
  bodyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  body: { color: '#6B6B6B', fontSize: 14, lineHeight: 20, flex: 1 },
  unreadBadge: {
    backgroundColor: '#2196F3', borderRadius: 11,
    minWidth: 22, height: 22,
    justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 6, marginTop: 2,
  },
  unreadBadgeT: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  sep: { height: 0.5, backgroundColor: '#1C1C1E', marginLeft: 76 },

  /* compose FAB */
  fab: {
    position: 'absolute', bottom: 76, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#4CAF50', justifyContent: 'center', alignItems: 'center',
    elevation: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3, shadowRadius: 6,
  },

  /* filter chip */
  filterChipRow: { paddingHorizontal: 16, paddingBottom: 8, flexDirection: 'row' },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#1C3A5F', borderRadius: 16,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  filterChipText: { color: '#90CAF9', fontSize: 12, fontWeight: '600' },

  /* block list modal */
  blockOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  blockBox: {
    backgroundColor: '#1C1C1E', borderRadius: 16,
    padding: 24, width: '100%', maxWidth: 360, maxHeight: '70%',
  },
  blockHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  blockTitle: { color: '#FFF', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  blockEmpty: { alignItems: 'center', paddingVertical: 32 },
  blockEmptyT: { color: '#8E8E93', fontSize: 14, marginTop: 12 },
  blockRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: '#1C1C1E',
  },
  blockPhone: { color: '#FFF', fontSize: 15 },
  blockReason: { color: '#6B6B6B', fontSize: 12, marginTop: 2 },
  unblockBtn: { backgroundColor: '#2C2C2E', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6 },
  unblockBtnT: { color: '#F44336', fontSize: 13, fontWeight: '600' },
});
