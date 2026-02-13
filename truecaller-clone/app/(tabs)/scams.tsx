import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  StatusBar, ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { spamApi, numbersApi } from '../../src/services/api';
import { callBlockingService } from '../../src/services/callBlocking';
import type { SpamNumber, SpamStats } from '../../src/types';

function dangerLevel(score: number): { label: string; color: string; bg: string } {
  if (score >= 80) return { label: 'HIGH', color: '#F44336', bg: 'rgba(244,67,54,0.15)' };
  if (score >= 50) return { label: 'MED', color: '#FF9800', bg: 'rgba(255,152,0,0.15)' };
  return { label: 'LOW', color: '#FFC107', bg: 'rgba(255,193,7,0.15)' };
}

export default function ScamsScreen() {
  const [spamNumbers, setSpamNumbers] = useState<SpamNumber[]>([]);
  const [stats, setStats] = useState<SpamStats>({ totalReports: 0, flaggedNumbers: 0, blockedNumbers: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [blockedCount, setBlockedCount] = useState(0);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const [numbersRes, statsRes, blocked] = await Promise.all([
        spamApi.getNumbers(50),
        spamApi.getStats(),
        callBlockingService.getBlockedCount(),
      ]);
      setSpamNumbers(numbersRes.data || []);
      setStats(statsRes.data || { totalReports: 0, flaggedNumbers: 0, blockedNumbers: 0 });
      setBlockedCount(blocked);
    } catch (err: any) {
      console.error('Scams fetch error:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));
  const onRefresh = () => { setRefreshing(true); fetchData(true); };

  const handleBlock = async (phoneNumber: string) => {
    await callBlockingService.blockNumber(phoneNumber, 'Blocked from spam list');
    Alert.alert('Blocked', `${phoneNumber} has been blocked on this device`);
    fetchData(true);
  };

  const handleAutoBlock = async () => {
    Alert.alert(
      'Auto-Block High-Risk Numbers',
      'This will block all numbers with a spam score above 80. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Block All', style: 'destructive', onPress: async () => {
          const count = await callBlockingService.autoBlockSpamNumbers(80);
          Alert.alert('Done', `Blocked ${count} spam numbers`);
          fetchData(true);
        }},
      ],
    );
  };

  const handleLookup = async (phoneNumber: string) => {
    try {
      const res = await numbersApi.lookup(phoneNumber);
      router.push({ pathname: '/number-detail', params: { phone: phoneNumber, name: res.data.bestName || '' } });
    } catch {
      router.push({ pathname: '/number-detail', params: { phone: phoneNumber, name: '' } });
    }
  };

  return (
    <SafeAreaView style={st.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0A" />

      <View style={st.header}>
        <Text style={st.headerTitle}>Spam Protection</Text>
        <TouchableOpacity onPress={handleAutoBlock} style={st.headerBtn}>
          <MaterialCommunityIcons name="shield-lock" size={22} color="#F44336" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={st.center}><ActivityIndicator size="large" color="#2196F3" /></View>
      ) : (
        <FlatList
          data={spamNumbers}
          keyExtractor={n => n.phoneNumber}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2196F3" colors={['#2196F3']} />}
          ListHeaderComponent={
            <View>
              {/* Protection Card */}
              <View style={st.protCard}>
                <View style={st.protIcon}>
                  <Ionicons name="shield-checkmark" size={32} color="#4CAF50" />
                </View>
                <Text style={st.protTitle}>Spam Protection Active</Text>
                <Text style={st.protSub}>
                  {blockedCount > 0
                    ? `${blockedCount} numbers blocked on this device`
                    : 'Your calls and messages are being monitored'}
                </Text>
              </View>

              {/* Stats Row */}
              <View style={st.statsRow}>
                <View style={st.stat}>
                  <Text style={st.statNum}>{stats.totalReports}</Text>
                  <Text style={st.statLabel}>Reports</Text>
                </View>
                <View style={st.statDiv} />
                <View style={st.stat}>
                  <Text style={st.statNum}>{stats.flaggedNumbers}</Text>
                  <Text style={st.statLabel}>Flagged</Text>
                </View>
                <View style={st.statDiv} />
                <View style={st.stat}>
                  <Text style={[st.statNum, { color: '#F44336' }]}>{blockedCount}</Text>
                  <Text style={st.statLabel}>Blocked</Text>
                </View>
              </View>

              <Text style={st.sectionTitle}>Known Spam Numbers</Text>
            </View>
          }
          renderItem={({ item }) => {
            const dl = dangerLevel(item.score);
            const isBlocked = callBlockingService.isBlocked(item.phoneNumber);
            return (
              <TouchableOpacity style={st.row} onPress={() => handleLookup(item.phoneNumber)} activeOpacity={0.7}>
                <View style={[st.avatar, { backgroundColor: dl.bg }]}>
                  <Ionicons name="warning" size={20} color={dl.color} />
                </View>
                <View style={st.info}>
                  <View style={st.nameRow}>
                    <Text style={[st.name, { color: dl.color }]}>{item.phoneNumber}</Text>
                    {isBlocked && (
                      <View style={st.blockedBadge}><Text style={st.blockedText}>BLOCKED</Text></View>
                    )}
                  </View>
                  <View style={st.metaRow}>
                    <View style={[st.dangerBadge, { backgroundColor: dl.bg }]}>
                      <Text style={[st.dangerText, { color: dl.color }]}>{dl.label}</Text>
                    </View>
                    <Text style={st.sub}>Score: {item.score}</Text>
                  </View>
                </View>
                {!isBlocked && (
                  <TouchableOpacity onPress={() => handleBlock(item.phoneNumber)} style={st.blockBtn}>
                    <Ionicons name="ban" size={18} color="#F44336" />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={st.center}>
              <Ionicons name="shield-outline" size={48} color="#5A5A5E" />
              <Text style={st.emptyT}>No spam numbers detected</Text>
            </View>
          }
          ItemSeparatorComponent={() => <View style={st.sep} />}
        />
      )}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0A0A0A' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, paddingTop: 60 },
  emptyT: { color: '#5A5A5E', fontSize: 15 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  headerTitle: { fontSize: 24, fontWeight: '700', color: '#FFF' },
  headerBtn: { padding: 8 },

  protCard: { backgroundColor: '#0D2B1A', marginHorizontal: 16, marginTop: 8, borderRadius: 16, padding: 20, alignItems: 'center' },
  protIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(76,175,80,0.15)', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  protTitle: { color: '#4CAF50', fontSize: 18, fontWeight: '700', marginBottom: 4 },
  protSub: { color: '#8E8E93', fontSize: 13, textAlign: 'center' },

  statsRow: { flexDirection: 'row', backgroundColor: '#1A1A1A', marginHorizontal: 16, marginTop: 12, borderRadius: 14, paddingVertical: 16, marginBottom: 16 },
  stat: { flex: 1, alignItems: 'center' },
  statNum: { color: '#FFF', fontSize: 22, fontWeight: '800' },
  statLabel: { color: '#5A5A5E', fontSize: 11, marginTop: 2 },
  statDiv: { width: 1, backgroundColor: '#2C2C2E' },

  sectionTitle: { color: '#8E8E93', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 16, paddingBottom: 8 },

  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  info: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 15, fontWeight: '600' },
  blockedBadge: { backgroundColor: 'rgba(244,67,54,0.15)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  blockedText: { color: '#F44336', fontSize: 9, fontWeight: '800' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  dangerBadge: { borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2 },
  dangerText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  sub: { color: '#5A5A5E', fontSize: 12 },
  blockBtn: { padding: 10, backgroundColor: 'rgba(244,67,54,0.1)', borderRadius: 20 },
  sep: { height: 0.5, backgroundColor: '#1C1C1E', marginLeft: 72 },
});
