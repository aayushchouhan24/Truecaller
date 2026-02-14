import React, { useState, useEffect } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  StatusBar, ActivityIndicator, TextInput, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { smsService } from '../src/services/smsReader';

/* ── helpers ─────────────────────────────────────────── */
const AVATAR_COLORS = ['#1B5E20','#004D40','#01579B','#4A148C','#880E4F','#E65100','#33691E','#006064','#1A237E','#3E2723'];
const getColor = (n: string) => { let h = 0; for (let i = 0; i < n.length; i++) h = n.charCodeAt(i) + ((h << 5) - h); return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]; };

function fmtDate(ms: number | string) {
  const d = new Date(typeof ms === 'string' ? ms : ms);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

interface ConvoMsg {
  id: string;
  body: string;
  date: string;
  isSent: boolean;
}

export default function SmsConversationScreen() {
  const { sender } = useLocalSearchParams<{ sender: string }>();
  const [messages, setMessages] = useState<ConvoMsg[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');

  useEffect(() => {
    if (!sender) return;
    (async () => {
      try {
        // Get inbox messages from this sender
        const inbox = await smsService.getMessages(500);
        const fromSender = inbox
          .filter(m => m.address === sender)
          .map(m => ({ id: m.id, body: m.body, date: m.dateStr, isSent: false }));

        // Get sent messages to this sender
        const sent = await smsService.getMessages(200, 'sent');
        const toSender = sent
          .filter(m => m.address === sender)
          .map(m => ({ id: 's-' + m.id, body: m.body, date: m.dateStr, isSent: true }));

        const all = [...fromSender, ...toSender].sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
        );
        setMessages(all);
      } catch (err) {
        console.error('Load convo:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [sender]);

  if (!sender) return null;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0A" />

      {/* ── Header ──────────────────────────── */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <View style={[s.avatar, { backgroundColor: getColor(sender) }]}>
          <Text style={s.avatarT}>{sender.slice(0, 2).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.senderName} numberOfLines={1}>{sender}</Text>
          <Text style={s.senderSub}>{messages.length} messages</Text>
        </View>
        <TouchableOpacity onPress={() => {
          const phone = sender;
          if (/^\+?\d{7,}$/.test(phone.replace(/[\s\-()]/g, ''))) {
            router.push({ pathname: '/number-detail', params: { phone, name: '' } });
          }
        }}>
          <Ionicons name="call-outline" size={22} color="#8E8E93" />
        </TouchableOpacity>
      </View>

      {/* ── Messages ──────────────────────────── */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {loading ? (
          <View style={s.center}><ActivityIndicator size="large" color="#2196F3" /></View>
        ) : (
          <FlatList
            data={messages}
            keyExtractor={m => m.id}
            contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 12, paddingBottom: 8 }}
            renderItem={({ item }) => (
              <View style={[s.bubble, item.isSent ? s.bubbleSent : s.bubbleReceived]}>
                <Text style={[s.bubbleText, item.isSent && { color: '#FFF' }]}>{item.body}</Text>
                <Text style={[s.bubbleTime, item.isSent && { color: 'rgba(255,255,255,0.6)' }]}>{fmtDate(item.date)}</Text>
              </View>
            )}
            ListEmptyComponent={
              <View style={s.center}>
                <Ionicons name="chatbubble-outline" size={56} color="#2C2C2E" />
                <Text style={s.emptyT}>No messages</Text>
              </View>
            }
          />
        )}

        {/* ── Reply Input ──────────────────────── */}
        <View style={s.replyBar}>
          <TextInput
            style={s.replyInput}
            placeholder="Type a message..."
            placeholderTextColor="#6B6B6B"
            value={replyText}
            onChangeText={setReplyText}
            multiline
          />
          <TouchableOpacity
            style={[s.sendBtn, !replyText.trim() && { opacity: 0.4 }]}
            disabled={!replyText.trim()}
            onPress={() => {
              Alert.alert('SMS', 'Sending SMS requires setting this app as default SMS app.');
              setReplyText('');
            }}>
            <Ionicons name="send" size={20} color="#FFF" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0A0A0A' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80, gap: 6 },
  emptyT: { color: '#5A5A5E', fontSize: 16, fontWeight: '500', marginTop: 8 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: '#1C1C1E', borderBottomWidth: 0.5, borderBottomColor: '#2C2C2E',
  },
  avatar: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  avatarT: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  senderName: { color: '#FFF', fontSize: 17, fontWeight: '600' },
  senderSub: { color: '#6B6B6B', fontSize: 12, marginTop: 1 },

  bubble: { maxWidth: '80%', marginBottom: 10, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 18 },
  bubbleSent: { alignSelf: 'flex-end', backgroundColor: '#2196F3', borderBottomRightRadius: 4 },
  bubbleReceived: { alignSelf: 'flex-start', backgroundColor: '#2C2C2E', borderBottomLeftRadius: 4 },
  bubbleText: { color: '#E0E0E0', fontSize: 15, lineHeight: 22 },
  bubbleTime: { color: '#6B6B6B', fontSize: 11, marginTop: 6, alignSelf: 'flex-end' },

  replyBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: '#1C1C1E', borderTopWidth: 0.5, borderTopColor: '#2C2C2E',
  },
  replyInput: {
    flex: 1, backgroundColor: '#2C2C2E', borderRadius: 22,
    paddingHorizontal: 18, paddingVertical: 12, color: '#FFF',
    fontSize: 15, maxHeight: 120,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#2196F3', justifyContent: 'center', alignItems: 'center',
  },
});
