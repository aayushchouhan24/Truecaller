import React, { useState, useEffect, useCallback, memo } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  StatusBar, ActivityIndicator, TextInput, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { contactsService, type DeviceContact } from '../src/services/contacts';

/* ── helpers ─────────────────────────────────────────── */
const AVATAR_COLORS = ['#1B5E20','#004D40','#01579B','#4A148C','#880E4F','#E65100','#33691E','#006064','#1A237E','#3E2723'];
const getColor = (n: string) => { let h = 0; for (let i = 0; i < n.length; i++) h = n.charCodeAt(i) + ((h << 5) - h); return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]; };
const getInitials = (n: string) => { if (!n) return '?'; const p = n.trim().split(/\s+/); return p.length > 1 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : n.slice(0, 2).toUpperCase(); };

/* ── Memoized row ──────────────────────────────────── */
// eslint-disable-next-line react/display-name
const ContactItem = memo(({ item, onPress }: { item: DeviceContact; onPress: () => void }) => (
  <TouchableOpacity style={s.row} onPress={onPress} activeOpacity={0.7}>
    <View style={[s.avatar, { backgroundColor: getColor(item.name) }]}>
      {item.thumbnail
        ? <Image source={{ uri: item.thumbnail }} style={s.avatarImg} />
        : <Text style={s.avatarT}>{getInitials(item.name)}</Text>}
    </View>
    <View style={s.info}>
      <Text style={s.name} numberOfLines={1}>{item.name}</Text>
      {item.phoneNumbers[0] && <Text style={s.phone}>{item.phoneNumbers[0]}</Text>}
    </View>
  </TouchableOpacity>
));

export default function ContactPickerScreen() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const mode = params.mode || 'sms'; // 'sms' or 'call'
  const [contacts, setContacts] = useState<DeviceContact[]>([]);
  const [filtered, setFiltered] = useState<DeviceContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const dc = await contactsService.getDeviceContacts();
        setContacts(dc);
        setFiltered(dc);
      } catch {
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSearch = useCallback((text: string) => {
    setQuery(text);
    if (!text.trim()) {
      setFiltered(contacts);
      return;
    }
    const q = text.toLowerCase();
    setFiltered(
      contacts.filter(
        c => c.name.toLowerCase().includes(q) ||
          c.phoneNumbers.some(p => p.replace(/[\s\-()]/g, '').includes(text))
      )
    );
  }, [contacts]);

  const handleSelect = useCallback((contact: DeviceContact) => {
    const phone = contact.phoneNumbers[0];
    if (!phone) return;
    // Navigate to SMS conversation with selected contact
    router.replace({ pathname: '/sms-conversation', params: { sender: phone } });
  }, []);

  const handleDialNumber = useCallback(() => {
    if (query.length >= 4 && /^[\d+\s\-()]+$/.test(query)) {
      router.replace({ pathname: '/sms-conversation', params: { sender: query.replace(/[\s\-()]/g, '') } });
    }
  }, [query]);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0A" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={s.title}>New message</Text>
      </View>

      {/* Search */}
      <View style={s.searchRow}>
        <View style={s.searchBar}>
          <Ionicons name="search" size={18} color="#6B6B6B" />
          <TextInput
            style={s.searchInput}
            placeholder="Search name or number"
            placeholderTextColor="#5A5A5E"
            value={query}
            onChangeText={handleSearch}
            autoFocus
            returnKeyType="done"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => handleSearch('')}>
              <Ionicons name="close-circle" size={18} color="#5A5A5E" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Dial number hint */}
      {query.length >= 4 && /^[\d+\s\-()]+$/.test(query) && (
        <TouchableOpacity style={s.dialHint} onPress={handleDialNumber}>
          <View style={[s.avatar, { backgroundColor: '#01579B' }]}>
            <Ionicons name="chatbubble" size={18} color="#FFF" />
          </View>
          <View style={s.info}>
            <Text style={s.name}>Send to {query}</Text>
            <Text style={s.phone}>Compose new message</Text>
          </View>
        </TouchableOpacity>
      )}

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color="#2196F3" /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={c => c.id}
          contentContainerStyle={{ paddingBottom: 40 }}
          renderItem={({ item }) => (
            <ContactItem item={item} onPress={() => handleSelect(item)} />
          )}
          ListEmptyComponent={
            <View style={s.center}>
              <Ionicons name="people-outline" size={56} color="#2C2C2E" />
              <Text style={s.emptyT}>No contacts found</Text>
            </View>
          }
          initialNumToRender={20}
          maxToRenderPerBatch={30}
          windowSize={10}
          getItemLayout={(_, i) => ({ length: 68, offset: 68 * i, index: i })}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0A0A0A' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 100, gap: 6 },
  emptyT: { color: '#5A5A5E', fontSize: 16, fontWeight: '500', marginTop: 8 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  backBtn: { padding: 4 },
  title: { color: '#FFF', fontSize: 20, fontWeight: '700' },

  searchRow: { paddingHorizontal: 14, paddingBottom: 8 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#1C1C1E', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  searchInput: { flex: 1, color: '#FFF', fontSize: 16, padding: 0 },

  dialHint: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
    paddingVertical: 14, gap: 14, borderBottomWidth: 0.5, borderBottomColor: '#1C1C1E',
  },

  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14, gap: 14,
  },
  avatar: { width: 46, height: 46, borderRadius: 23, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  avatarT: { color: '#FFF', fontSize: 17, fontWeight: '700' },
  avatarImg: { width: 46, height: 46, borderRadius: 23 },
  info: { flex: 1 },
  name: { color: '#FFF', fontSize: 15, fontWeight: '600', marginBottom: 2 },
  phone: { color: '#6B6B6B', fontSize: 13 },
});
