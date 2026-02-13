import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  StatusBar, Platform, Alert, ActivityIndicator, Linking,
  Share, Modal, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
// colors inlined for Truecaller-accurate styling
import { numbersApi, favoritesApi } from '../src/services/api';
import { storageService } from '../src/services/storage';
import { callBlockingService } from '../src/services/callBlocking';

const AVATAR_COLORS = ['#E91E63', '#9C27B0', '#673AB7', '#3F51B5', '#2196F3', '#009688', '#4CAF50', '#FF9800', '#795548', '#607D8B'];

function getAvatarColor(name: string | null): string {
  if (!name) return '#607D8B';
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length > 1
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

export default function NumberDetailScreen() {
  const params = useLocalSearchParams<{ phone?: string; name?: string }>();
  const phone = params.phone || '';
  const passedName = params.name || '';

  const [name, setName] = useState(passedName);
  const [loading, setLoading] = useState(false);
  const [spamScore, setSpamScore] = useState(0);
  const [confidence, setConfidence] = useState(0);
  const [isSpam, setIsSpam] = useState(false);
  const [carrier] = useState('');
  const [location] = useState('');
  const [nameModalVisible, setNameModalVisible] = useState(false);
  const [suggestedName, setSuggestedName] = useState('');
  const [submittingName, setSubmittingName] = useState(false);

  useEffect(() => {
    if (phone) lookupNumber();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  const lookupNumber = async () => {
    setLoading(true);
    try {
      const res = await numbersApi.lookup(phone);
      const d = res.data;
      if (d.name) setName(d.name);
      setSpamScore(d.spamScore);
      setConfidence(d.confidence);
      setIsSpam(d.isLikelySpam);
      await storageService.addRecentLookup(d);
    } catch {
      // Use passed name, no API data
    } finally {
      setLoading(false);
    }
  };

  const handleCall = () => Linking.openURL(`tel:${phone}`);
  const handleWhatsApp = () => Linking.openURL(`https://wa.me/${phone.replace('+', '')}`);
  const handleSMS = () => Linking.openURL(`sms:${phone}`);

  const handleSaveContact = () => {
    // Open device "Add Contact" screen with phone number pre-filled
    const displayName = name && name !== 'Unknown' ? name : '';
    const uri = Platform.OS === 'android'
      ? `content://com.android.contacts/contacts`
      : `tel:${phone}`;
    // Use intent to add a new contact
    Linking.openURL(
      `https://contacts.google.com/new?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(displayName)}`
    ).catch(() => {
      // Fallback: try tel: intent
      Linking.openURL(`tel:${phone}`).catch(() => {
        Alert.alert('Save Contact', `Add ${phone} to your contacts manually.`);
      });
    });
  };

  const handleShareContact = async () => {
    try {
      const displayName = name || 'Unknown Number';
      await Share.share({
        message: `${displayName}\n${phone}`,
        title: 'Share Contact',
      });
    } catch {
      // User cancelled or share failed
    }
  };

  const handleBlock = () => {
    Alert.alert('Block Number', `Block ${phone}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: async () => {
          try {
            await callBlockingService.blockNumber(phone, 'Blocked by user');
            Alert.alert('Blocked', 'Number has been blocked');
          } catch {
            Alert.alert('Error', 'Failed to block number');
          }
        },
      },
    ]);
  };

  const handleReportSpam = async () => {
    Alert.alert('Report Spam', `Report ${phone} as spam?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Report',
        style: 'destructive',
        onPress: async () => {
          try {
            await numbersApi.reportSpam({ phoneNumber: phone, reason: 'Reported by user' });
            Alert.alert('Reported', 'Spam report submitted');
            lookupNumber();
          } catch (e: any) {
            Alert.alert('Error', e.message);
          }
        },
      },
    ]);
  };

  const handleAddName = () => {
    setSuggestedName('');
    setNameModalVisible(true);
  };

  const submitSuggestedName = async () => {
    const trimmed = suggestedName.trim();
    if (!trimmed) return;
    setSubmittingName(true);
    try {
      await numbersApi.addName({ phoneNumber: phone, name: trimmed, sourceType: 'MANUAL' });
      Alert.alert('Submitted', 'Name suggestion submitted');
      setNameModalVisible(false);
      lookupNumber();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSubmittingName(false);
    }
  };

  const handleSaveFavorite = async () => {
    try {
      await favoritesApi.add(phone, name || 'Unknown');
      Alert.alert('Saved', 'Added to favorites');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save');
    }
  };

  const displayName = name || 'Unknown Number';
  const avatarColor = isSpam ? '#F44336' : getAvatarColor(name || null);

  return (
    <SafeAreaView style={st.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0A" />

      {/* Top Bar */}
      <View style={st.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={st.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <TouchableOpacity style={st.topAction}>
          <Ionicons name="ellipsis-vertical" size={20} color="#8E8E93" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={st.scroll}>
        {loading && (
          <View style={st.loadingRow}>
            <ActivityIndicator size="small" color="#2196F3" />
            <Text style={st.loadingT}>Looking up...</Text>
          </View>
        )}

        {/* Profile Card */}
        <View style={st.profileCard}>
          <View style={[st.avatar, { backgroundColor: avatarColor }]}>
            <Text style={st.avatarT}>{getInitials(name || null)}</Text>
          </View>
          <Text style={[st.name, isSpam && { color: '#F44336' }]}>{displayName}</Text>
          {isSpam && (
            <View style={st.spamBanner}>
              <Ionicons name="warning" size={14} color="#F44336" />
              <Text style={st.spamBannerT}>Likely Spam</Text>
            </View>
          )}
          <TouchableOpacity style={st.changeBtn} onPress={handleAddName}>
            <Text style={st.changeBtnT}>CHANGE</Text>
          </TouchableOpacity>
          <TouchableOpacity style={st.viewProfileBtn} onPress={() => router.push({ pathname: '/search', params: { q: phone } })}>
            <Text style={st.viewProfileT}>View profile</Text>
          </TouchableOpacity>
        </View>

        {/* Phone Info */}
        <View style={st.infoCard}>
          <View style={st.infoRow}>
            <Ionicons name="call" size={18} color="#8E8E93" />
            <Text style={st.infoText}>{phone}</Text>
          </View>
          {carrier !== '' && (
            <View style={st.infoRow}>
              <MaterialCommunityIcons name="sim" size={18} color="#8E8E93" />
              <Text style={st.infoText}>{carrier}</Text>
            </View>
          )}
          {location !== '' && (
            <View style={st.infoRow}>
              <Ionicons name="location" size={18} color="#8E8E93" />
              <Text style={st.infoText}>{location}</Text>
            </View>
          )}
          <View style={st.infoRow}>
            <Ionicons name="shield-checkmark" size={18} color={isSpam ? '#F44336' : '#4CAF50'} />
            <Text style={[st.infoText, { color: isSpam ? '#F44336' : '#4CAF50' }]}>
              {isSpam ? `Spam Score: ${spamScore}` : `Safe - Confidence: ${confidence}%`}
            </Text>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={st.actions}>
          <TouchableOpacity style={st.actionBtn} onPress={handleCall}>
            <View style={[st.actionCircle, { backgroundColor: 'rgba(76,175,80,0.15)' }]}>
              <Ionicons name="call" size={22} color="#4CAF50" />
            </View>
            <Text style={st.actionLabel}>CALL</Text>
          </TouchableOpacity>

          <TouchableOpacity style={st.actionBtn} onPress={handleWhatsApp}>
            <View style={[st.actionCircle, { backgroundColor: 'rgba(76,175,80,0.15)' }]}>
              <MaterialCommunityIcons name="whatsapp" size={24} color="#25D366" />
            </View>
            <Text style={st.actionLabel}>WHATSAPP</Text>
          </TouchableOpacity>

          <TouchableOpacity style={st.actionBtn} onPress={handleSMS}>
            <View style={[st.actionCircle, { backgroundColor: 'rgba(33,150,243,0.15)' }]}>
              <Ionicons name="chatbubble" size={20} color="#2196F3" />
            </View>
            <Text style={st.actionLabel}>SMS</Text>
          </TouchableOpacity>

          <TouchableOpacity style={st.actionBtn} onPress={handleSaveContact}>
            <View style={[st.actionCircle, { backgroundColor: 'rgba(33,150,243,0.15)' }]}>
              <Ionicons name="person-add" size={20} color="#2196F3" />
            </View>
            <Text style={st.actionLabel}>SAVE</Text>
          </TouchableOpacity>

          <TouchableOpacity style={st.actionBtn} onPress={handleBlock}>
            <View style={[st.actionCircle, { backgroundColor: 'rgba(244,67,54,0.15)' }]}>
              <Ionicons name="ban" size={20} color="#F44336" />
            </View>
            <Text style={st.actionLabel}>BLOCK</Text>
          </TouchableOpacity>
        </View>

        {/* More Actions */}
        <View style={st.moreCard}>
          <TouchableOpacity style={st.moreRow} onPress={handleReportSpam}>
            <Ionicons name="warning" size={20} color="#FF9800" />
            <Text style={st.moreText}>Report as spam</Text>
            <Ionicons name="chevron-forward" size={18} color="#5A5A5E" />
          </TouchableOpacity>
          <View style={st.moreSep} />
          <TouchableOpacity style={st.moreRow} onPress={handleAddName}>
            <Ionicons name="create" size={20} color="#2196F3" />
            <Text style={st.moreText}>Suggest a name</Text>
            <Ionicons name="chevron-forward" size={18} color="#5A5A5E" />
          </TouchableOpacity>
          <View style={st.moreSep} />
          <TouchableOpacity style={st.moreRow} onPress={handleShareContact}>
            <Ionicons name="share-social" size={20} color="#8E8E93" />
            <Text style={st.moreText}>Share contact</Text>
            <Ionicons name="chevron-forward" size={18} color="#5A5A5E" />
          </TouchableOpacity>
        </View>

        {/* Confidence Card */}
        {confidence > 0 && (
          <View style={st.confCard}>
            <Text style={st.confTitle}>Identification Confidence</Text>
            <View style={st.confBar}>
              <View style={[st.confFill, { width: `${confidence}%`, backgroundColor: confidence > 70 ? '#4CAF50' : confidence > 40 ? '#FF9800' : '#F44336' }]} />
            </View>
            <Text style={st.confVal}>{confidence}%</Text>
          </View>
        )}
      </ScrollView>

      {/* ── Suggest Name Modal ── */}
      <Modal visible={nameModalVisible} transparent animationType="slide">
        <View style={st.modalOverlay}>
          <View style={st.modalBox}>
            <Text style={st.modalTitle}>Suggest a Name</Text>
            <Text style={st.modalSubtitle}>Add a name for {phone}</Text>
            <TextInput
              style={st.modalInput}
              value={suggestedName}
              onChangeText={setSuggestedName}
              placeholder="Enter name"
              placeholderTextColor="#6B6B6B"
              autoFocus
              maxLength={50}
              autoCapitalize="words"
            />
            <View style={st.modalBtnRow}>
              <TouchableOpacity style={st.modalCancelBtn} onPress={() => setNameModalVisible(false)}>
                <Text style={st.modalCancelT}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[st.modalSaveBtn, submittingName && { opacity: 0.5 }]}
                onPress={submitSuggestedName}
                disabled={submittingName}
              >
                {submittingName ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={st.modalSaveT}>Submit</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0A0A0A' },
  scroll: { paddingBottom: 32 },

  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 8 },
  backBtn: { padding: 8 },
  topAction: { padding: 8 },

  loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 8 },
  loadingT: { color: '#8E8E93', fontSize: 13 },

  /* profile card */
  profileCard: { alignItems: 'center', paddingVertical: 16 },
  avatar: { width: 80, height: 80, borderRadius: 40, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  avatarT: { color: '#FFF', fontSize: 28, fontWeight: '700' },
  name: { color: '#FFF', fontSize: 24, fontWeight: '700', marginBottom: 4 },
  spamBanner: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(244,67,54,0.12)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8 },
  spamBannerT: { color: '#F44336', fontSize: 12, fontWeight: '600' },
  changeBtn: { marginBottom: 10 },
  changeBtnT: { color: '#2196F3', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  viewProfileBtn: { backgroundColor: '#2196F3', borderRadius: 24, paddingHorizontal: 28, paddingVertical: 10 },
  viewProfileT: { color: '#FFF', fontSize: 14, fontWeight: '600' },

  /* info card */
  infoCard: { backgroundColor: '#1A1A1A', marginHorizontal: 16, borderRadius: 14, padding: 14, marginTop: 12, gap: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  infoText: { color: '#FFF', fontSize: 14 },

  /* actions */
  actions: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 8, paddingVertical: 20 },
  actionBtn: { alignItems: 'center', gap: 6 },
  actionCircle: { width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center' },
  actionLabel: { color: '#8E8E93', fontSize: 10, fontWeight: '600', letterSpacing: 0.3 },

  /* more actions */
  moreCard: { backgroundColor: '#1A1A1A', marginHorizontal: 16, borderRadius: 14, overflow: 'hidden' },
  moreRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 14 },
  moreText: { flex: 1, color: '#FFF', fontSize: 14 },
  moreSep: { height: 0.5, backgroundColor: '#2C2C2E', marginLeft: 50 },

  /* confidence */
  confCard: { backgroundColor: '#1A1A1A', marginHorizontal: 16, borderRadius: 14, padding: 16, marginTop: 12 },
  confTitle: { color: '#8E8E93', fontSize: 12, fontWeight: '600', marginBottom: 10 },
  confBar: { height: 6, backgroundColor: '#2C2C2E', borderRadius: 3, overflow: 'hidden', marginBottom: 6 },
  confFill: { height: '100%', borderRadius: 3 },
  confVal: { color: '#FFF', fontSize: 14, fontWeight: '600', textAlign: 'right' },

  /* modal */
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  modalBox: {
    backgroundColor: '#1C1C1E', borderRadius: 16,
    padding: 24, width: '100%', maxWidth: 360,
  },
  modalTitle: { color: '#FFF', fontSize: 18, fontWeight: '700', marginBottom: 4, textAlign: 'center' },
  modalSubtitle: { color: '#8E8E93', fontSize: 13, textAlign: 'center', marginBottom: 16 },
  modalInput: {
    backgroundColor: '#0A0A0A', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 16, color: '#FFF',
    borderWidth: 1, borderColor: '#333', marginBottom: 20,
  },
  modalBtnRow: { flexDirection: 'row' as const, gap: 12 },
  modalCancelBtn: {
    flex: 1, borderRadius: 24, borderWidth: 1.5, borderColor: '#555',
    paddingVertical: 12, alignItems: 'center' as const,
  },
  modalCancelT: { color: '#999', fontSize: 15, fontWeight: '600' as const },
  modalSaveBtn: {
    flex: 1, borderRadius: 24, backgroundColor: '#2196F3',
    paddingVertical: 12, alignItems: 'center' as const,
  },
  modalSaveT: { color: '#FFF', fontSize: 15, fontWeight: '700' as const },
});
