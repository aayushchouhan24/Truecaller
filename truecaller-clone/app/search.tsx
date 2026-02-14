import React, { useState, useCallback, useEffect } from 'react';
import {
    View, Text, TextInput, FlatList, StyleSheet, TouchableOpacity,
    StatusBar, ActivityIndicator, Keyboard, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { contactsApi, numbersApi } from '../src/services/api';
import { contactsService } from '../src/services/contacts';
import { storageService } from '../src/services/storage';
import type { UserContact } from '../src/types';

/* ── helpers ─────────────────────────────────────────── */

const AVATAR_COLORS = ['#E91E63', '#9C27B0', '#673AB7', '#3F51B5', '#2196F3', '#009688', '#4CAF50', '#FF9800', '#795548', '#607D8B'];

function getColor(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
    const parts = name.trim().split(/\s+/);
    return parts.length > 1
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : name.slice(0, 2).toUpperCase();
}

function isPhoneNumber(q: string): boolean {
    return /^\+?[0-9\s-]{7,}$/.test(q.trim());
}

/* ── screen ──────────────────────────────────────────── */

export default function SearchScreen() {
    const params = useLocalSearchParams<{ q?: string }>();
    const [query, setQuery] = useState(params.q || '');
    const [contacts, setContacts] = useState<UserContact[]>([]);
    const [searchHistory, setSearchHistory] = useState<{ query: string; phoneNumber?: string; resultName?: string }[]>([]);
    const [lookingUp, setLookingUp] = useState(false);

    // Handle incoming q param from dialpad
    useEffect(() => {
        if (params.q) setQuery(params.q);
    }, [params.q]);

    // Load contacts & search history on mount
    useFocusEffect(
        useCallback(() => {
            const load = async () => {
                try {
                    // Try native contacts first
                    if (contactsService.isAvailable) {
                        const deviceContacts = await contactsService.getDeviceContacts();
                        const mapped: UserContact[] = deviceContacts
                            .filter(c => c.phoneNumbers && c.phoneNumbers.length > 0)
                            .map(c => ({
                                id: c.id || Math.random().toString(),
                                phoneNumber: c.phoneNumbers[0] || '',
                                name: c.name || 'Unknown',
                                userId: '',
                                createdAt: new Date().toISOString(),
                                updatedAt: new Date().toISOString(),
                            }));
                        setContacts(mapped);
                    } else {
                        const contactsRes = await contactsApi.getAll();
                        setContacts(contactsRes.data);
                    }
                    // Load recent lookups from local storage
                    const recent = await storageService.getRecentLookups();
                    setSearchHistory(recent.map((r: any) => ({
                        query: r.phoneNumber || r.name || '',
                        phoneNumber: r.phoneNumber,
                        resultName: r.name,
                    })));
                } catch (err: any) {
                    console.error('Failed to load search data:', err.message);
                }
            };
            load();
        }, [])
    );

    // Filter contacts by query
    const filtered = query.trim()
        ? contacts.filter(c =>
            c.name.toLowerCase().includes(query.toLowerCase()) ||
            c.phoneNumber.includes(query)
        )
        : [];

    const handleLookup = async (phoneNumber: string) => {
        Keyboard.dismiss();
        setLookingUp(true);
        try {
            const res = await numbersApi.lookup(phoneNumber);
            // Save to local recent lookups
            await storageService.addRecentLookup({
                phoneNumber,
                name: res.data.name || undefined,
            });
            router.push({
                pathname: '/number-detail',
                params: { phone: phoneNumber, name: res.data.name || '' },
            });
        } catch (err: any) {
            Alert.alert('Not Found', err.message);
        } finally {
            setLookingUp(false);
        }
    };

    const handleContactPress = async (contact: UserContact) => {
        router.push({
            pathname: '/number-detail',
            params: { phone: contact.phoneNumber, name: contact.name },
        });
    };

    const handleHistoryPress = (item: { query: string; phoneNumber?: string; resultName?: string }) => {
        if (item.phoneNumber) {
            router.push({
                pathname: '/number-detail',
                params: { phone: item.phoneNumber, name: item.resultName || '' },
            });
        } else {
            setQuery(item.query);
        }
    };

    const handleClearHistory = async () => {
        await storageService.clearRecentLookups();
        setSearchHistory([]);
    };

    const showResults = query.trim().length > 0;
    const phoneSearch = isPhoneNumber(query);

    return (
        <SafeAreaView style={st.safe}>
            <StatusBar barStyle="light-content" backgroundColor="#0A0A0A" />

            {/* Search Bar */}
            <View style={st.searchRow}>
                <TouchableOpacity onPress={() => router.back()} style={st.backBtn}>
                    <Ionicons name="arrow-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <TextInput
                    style={st.input}
                    placeholder="Search name or phone number"
                    placeholderTextColor="#5A5A5E"
                    value={query}
                    onChangeText={setQuery}
                    autoFocus
                    selectionColor="#2196F3"
                    returnKeyType="search"
                    onSubmitEditing={() => {
                        if (phoneSearch) handleLookup(query.trim());
                    }}
                />
                {query.length > 0 && (
                    <TouchableOpacity onPress={() => setQuery('')} style={st.clearBtn}>
                        <Ionicons name="close-circle" size={20} color="#5A5A5E" />
                    </TouchableOpacity>
                )}
            </View>

            {lookingUp && (
                <View style={st.lookupBar}>
                    <ActivityIndicator size="small" color="#2196F3" />
                    <Text style={st.lookupText}>Looking up number...</Text>
                </View>
            )}

            {showResults ? (
                <FlatList
                    data={filtered}
                    keyExtractor={i => i.id}
                    renderItem={({ item }) => (
                        <TouchableOpacity style={st.row} onPress={() => handleContactPress(item)} activeOpacity={0.7}>
                            <View style={[st.avatar, { backgroundColor: getColor(item.name) }]}>
                                <Text style={st.avatarT}>{getInitials(item.name)}</Text>
                            </View>
                            <View style={st.info}>
                                <Text style={st.name}>{item.name}</Text>
                                <Text style={st.phone}>{item.phoneNumber}</Text>
                            </View>
                            <Ionicons name="call-outline" size={18} color="#2196F3" />
                        </TouchableOpacity>
                    )}
                    ListHeaderComponent={
                        phoneSearch ? (
                            <TouchableOpacity style={st.lookupRow} onPress={() => handleLookup(query.trim())} activeOpacity={0.7}>
                                <View style={st.lookupIcon}>
                                    <Ionicons name="search" size={20} color="#2196F3" />
                                </View>
                                <View style={st.info}>
                                    <Text style={st.lookupTitle}>{'Search \'' + query.trim() + '\' on Truecaller'}</Text>
                                    <Text style={st.lookupSub}>Find caller identity</Text>
                                </View>
                                <Ionicons name="chevron-forward" size={18} color="#5A5A5E" />
                            </TouchableOpacity>
                        ) : null
                    }
                    ListEmptyComponent={
                        !phoneSearch ? (
                            <View style={st.empty}>
                                <Ionicons name="search-outline" size={40} color="#5A5A5E" />
                                <Text style={st.emptyT}>{'No contacts found for "' + query + '"'}</Text>
                                <Text style={st.emptyS}>Try searching with a phone number</Text>
                            </View>
                        ) : null
                    }
                    ItemSeparatorComponent={() => <View style={st.sep} />}
                    keyboardShouldPersistTaps="handled"
                />
            ) : (
                <FlatList
                    data={searchHistory}
                    keyExtractor={i => i.id}
                    renderItem={({ item }) => (
                        <TouchableOpacity style={st.row} onPress={() => handleHistoryPress(item)} activeOpacity={0.7}>
                            <View style={st.historyIcon}>
                                <Ionicons name="time-outline" size={20} color="#5A5A5E" />
                            </View>
                            <View style={st.info}>
                                <Text style={st.name}>{item.resultName || item.query}</Text>
                                {item.phoneNumber && <Text style={st.phone}>{item.phoneNumber}</Text>}
                            </View>
                            <Ionicons name="close" size={16} color="#3A3A3C" />
                        </TouchableOpacity>
                    )}
                    ListHeaderComponent={
                        searchHistory.length > 0 ? (
                            <View style={st.historyHeader}>
                                <Text style={st.historyTitle}>Recent Searches</Text>
                                <TouchableOpacity onPress={handleClearHistory}>
                                    <Text style={st.clearAll}>Clear all</Text>
                                </TouchableOpacity>
                            </View>
                        ) : null
                    }
                    ListEmptyComponent={
                        <View style={st.empty}>
                            <Ionicons name="search-outline" size={48} color="#5A5A5E" />
                            <Text style={st.emptyT}>Search for people & numbers</Text>
                            <Text style={st.emptyS}>Find caller identity by phone number</Text>
                        </View>
                    }
                    ItemSeparatorComponent={() => <View style={st.sep} />}
                    keyboardShouldPersistTaps="handled"
                />
            )}
        </SafeAreaView>
    );
}

/* ── styles ──────────────────────────────────────────── */

const st = StyleSheet.create({
    safe: { flex: 1, backgroundColor: '#0A0A0A' },

    /* search bar */
    searchRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 8, backgroundColor: '#1A1A1A', marginHorizontal: 12, marginTop: 8, borderRadius: 28 },
    backBtn: { padding: 4 },
    input: { flex: 1, color: '#FFF', fontSize: 16, paddingVertical: 6 },
    clearBtn: { padding: 4 },

    /* lookup bar */
    lookupBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, gap: 8 },
    lookupText: { color: '#2196F3', fontSize: 14 },

    /* lookup row */
    lookupRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 16, gap: 12, backgroundColor: '#0D2137', marginHorizontal: 16, marginVertical: 8, borderRadius: 12 },
    lookupIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(33,150,243,0.15)', justifyContent: 'center', alignItems: 'center' },
    lookupTitle: { color: '#2196F3', fontSize: 15, fontWeight: '600' },
    lookupSub: { color: '#8E8E93', fontSize: 12, marginTop: 2 },

    /* history */
    historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
    historyTitle: { color: '#8E8E93', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
    clearAll: { color: '#2196F3', fontSize: 13, fontWeight: '600' },
    historyIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1A1A1A', justifyContent: 'center', alignItems: 'center' },

    /* list */
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
    avatar: { width: 42, height: 42, borderRadius: 21, justifyContent: 'center', alignItems: 'center' },
    avatarT: { color: '#FFF', fontSize: 15, fontWeight: '700' },
    info: { flex: 1 },
    name: { color: '#FFF', fontSize: 15, fontWeight: '500', marginBottom: 2 },
    phone: { color: '#5A5A5E', fontSize: 12 },

    sep: { height: 0.5, backgroundColor: '#1C1C1E', marginLeft: 72 },

    /* empty */
    empty: { alignItems: 'center', paddingTop: 80, gap: 12 },
    emptyT: { color: '#5A5A5E', fontSize: 15 },
    emptyS: { color: '#3A3A3C', fontSize: 13 },
});
