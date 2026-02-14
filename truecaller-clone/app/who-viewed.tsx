import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  StatusBar, FlatList, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { usersApi } from '../src/services/api';

interface Viewer {
  id: string;
  viewer: { name: string | null; phoneNumber: string };
  viewedAt: string;
}

function getInitials(n: string | null) {
  if (!n) return '?';
  const p = n.trim().split(/\s+/);
  return p.length > 1 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : n.slice(0, 2).toUpperCase();
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(d).toLocaleDateString();
}

export default function WhoViewedScreen() {
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const fetchViewers = useCallback(async (p: number, reset = false) => {
    try {
      const res = await usersApi.getWhoViewedMe(p);
      const items: Viewer[] = res.data?.data || [];
      setViewers(prev => reset ? items : [...prev, ...items]);
      setHasMore(items.length >= 20);
    } catch {}
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchViewers(1, true);
      setLoading(false);
    })();
  }, [fetchViewers]);

  const onRefresh = async () => {
    setRefreshing(true);
    setPage(1);
    await fetchViewers(1, true);
    setRefreshing(false);
  };

  const onEndReached = async () => {
    if (!hasMore || loading) return;
    const next = page + 1;
    setPage(next);
    await fetchViewers(next);
  };

  const renderItem = ({ item }: { item: Viewer }) => (
    <TouchableOpacity
      style={s.row}
      activeOpacity={0.7}
      onPress={() => {
        if (item.viewer?.phoneNumber) {
          router.push({ pathname: '/number-detail', params: { phoneNumber: item.viewer.phoneNumber } });
        }
      }}
    >
      <View style={s.avatar}>
        <Text style={s.avatarT}>{getInitials(item.viewer?.name)}</Text>
      </View>
      <View style={s.rowInfo}>
        <Text style={s.rowName} numberOfLines={1}>{item.viewer?.name || 'Unknown'}</Text>
        <Text style={s.rowPhone}>{item.viewer?.phoneNumber || ''}</Text>
      </View>
      <Text style={s.rowTime}>{item.viewedAt ? timeAgo(item.viewedAt) : ''}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0A" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerBtn}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Who viewed my profile</Text>
        <View style={s.headerBtn} />
      </View>

      {/* Info banner */}
      <View style={s.banner}>
        <Ionicons name="eye-outline" size={20} color="#2196F3" />
        <Text style={s.bannerText}>See who has viewed your Truecaller profile. This is a Premium feature.</Text>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color="#2196F3" />
        </View>
      ) : viewers.length === 0 ? (
        <View style={s.center}>
          <Ionicons name="eye-off-outline" size={64} color="#3A3A3C" />
          <Text style={s.emptyTitle}>No profile views yet</Text>
          <Text style={s.emptySub}>When someone views your profile, they{"'"}ll appear here.</Text>
        </View>
      ) : (
        <FlatList
          data={viewers}
          keyExtractor={(item, i) => item.id || `v-${i}`}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2196F3" />}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.3}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0A0A0A' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 4, paddingVertical: 8,
  },
  headerBtn: { padding: 10, width: 44 },
  headerTitle: { flex: 1, color: '#FFF', fontSize: 18, fontWeight: '700', textAlign: 'center' },

  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#0D1B2A', borderRadius: 12,
    marginHorizontal: 16, marginBottom: 8, padding: 14,
  },
  bannerText: { flex: 1, color: '#90CAF9', fontSize: 13 },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyTitle: { color: '#FFF', fontSize: 18, fontWeight: '700', marginTop: 16 },
  emptySub: { color: '#8E8E93', fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },

  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 0.5, borderBottomColor: '#1C1C1E',
  },
  avatar: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: '#1C3A5F', justifyContent: 'center', alignItems: 'center',
  },
  avatarT: { color: '#90CAF9', fontSize: 16, fontWeight: '700' },
  rowInfo: { flex: 1, marginLeft: 14 },
  rowName: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  rowPhone: { color: '#8E8E93', fontSize: 13, marginTop: 2 },
  rowTime: { color: '#6B6B6B', fontSize: 12 },
});
