import React, { useState, useCallback, memo } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  StatusBar, ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { smsService } from '../../src/services/smsReader';
import { messagesApi } from '../../src/services/api';
import { useAuthStore } from '../../src/store/authStore';

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

  const fetchData = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      let items: MsgItem[] = [];

      if (smsService.isAvailable) {
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
      } else {
        try {
          const res = await messagesApi.getAll();
          items = (res.data || []).map(m => ({
            id: m.id,
            sender: m.sender,
            body: m.body,
            date: m.createdAt,
            isRead: m.isRead,
            category: m.category,
            isSpam: m.isSpam,
            source: 'api' as const,
          }));
        } catch {}
      }
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
    if (item.source === 'api') {
      Alert.alert('Delete?', item.sender, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          try { await messagesApi.delete(item.id); fetchData(true); } catch {}
        }},
      ]);
    }
  }, [fetchData]);

  const handleRead = useCallback(async (item: MsgItem) => {
    if (item.source === 'api' && !item.isRead) {
      try { await messagesApi.markRead(item.id); } catch {}
    }
  }, []);

  const getInitials = (n: string) => {
    if (!n) return '?';
    return n.slice(0, 2).toUpperCase();
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0A" />

      {/* ── Search Bar ──────────────────────── */}
      <TouchableOpacity style={s.searchBar} onPress={() => router.push('/search')} activeOpacity={0.8}>
        <View style={[s.searchAvatar, { backgroundColor: user?.name ? getColor(user.name) : '#2196F3' }]}>
          <Text style={s.searchAvatarT}>{user?.name ? getInitials(user.name) : '?'}</Text>
        </View>
        <Text style={s.searchPlaceholder}>Search messages</Text>
        <View style={s.searchDot} />
      </TouchableOpacity>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color="#2196F3" /></View>
      ) : (
        <FlatList
          data={msgs}
          keyExtractor={m => m.id}
          contentContainerStyle={{ paddingBottom: 80 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2196F3" colors={['#2196F3']} />}
          renderItem={({ item }) => (
            <MsgRow item={item}
              onPress={() => handleRead(item)}
              onLongPress={() => handleDelete(item)} />
          )}
          ListEmptyComponent={
            <View style={s.center}>
              <Ionicons name="chatbubble-outline" size={56} color="#2C2C2E" />
              <Text style={s.emptyT}>No messages</Text>
              <Text style={s.emptySubT}>Your SMS messages will appear here</Text>
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

  /* message row */
  row: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 14, gap: 14, alignItems: 'flex-start' },
  avatar: { width: 46, height: 46, borderRadius: 23, justifyContent: 'center', alignItems: 'center', marginTop: 2 },
  avatarT: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  info: { flex: 1 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  sender: { color: '#B0B0B0', fontSize: 14, fontWeight: '600', flex: 1, letterSpacing: 0.5 },
  time: { color: '#5A5A5E', fontSize: 11, marginLeft: 8 },
  bodyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  body: { color: '#6B6B6B', fontSize: 13, lineHeight: 18, flex: 1 },
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
    position: 'absolute', bottom: 20, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#4CAF50', justifyContent: 'center', alignItems: 'center',
    elevation: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3, shadowRadius: 6,
  },
});
