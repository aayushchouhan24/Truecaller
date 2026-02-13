import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  StatusBar, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

const ASSISTANT_FEATURES = [
  { icon: 'call', title: 'Call Screening', desc: 'AI answers unknown calls and asks the caller to identify themselves before connecting', color: '#2196F3' },
  { icon: 'mic', title: 'Voice Assistant', desc: 'Let the assistant handle calls when you are busy. Callers can leave a voice message', color: '#9C27B0' },
  { icon: 'calendar', title: 'Smart Reminders', desc: 'Get intelligent reminders to call back missed contacts based on your patterns', color: '#FF9800' },
  { icon: 'chatbubble-ellipses', title: 'Auto Reply SMS', desc: 'Automatically reply to missed calls with a customizable text message', color: '#4CAF50' },
  { icon: 'time', title: 'Busy Hours', desc: 'Set quiet hours when the assistant handles all incoming calls for you', color: '#E91E63' },
  { icon: 'language', title: 'Multi-language', desc: 'Assistant speaks in multiple languages including Hindi, English, and more', color: '#00BCD4' },
];

const QUICK_ACTIONS = [
  { icon: 'volume-mute', label: 'Busy Mode', active: false },
  { icon: 'recording', label: 'Record Calls', active: true },
  { icon: 'chatbox-ellipses', label: 'Auto Reply', active: false },
  { icon: 'shield-checkmark', label: 'Screen Calls', active: true },
];

export default function AssistantScreen() {
  return (
    <SafeAreaView style={st.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0A" />
      <ScrollView contentContainerStyle={st.scroll}>
        {/* Header */}
        <View style={st.header}>
          <View style={st.logoCircle}>
            <MaterialCommunityIcons name="equalizer" size={36} color="#2196F3" />
          </View>
          <Text style={st.title}>AI Assistant</Text>
          <Text style={st.subtitle}>Your personal call assistant powered by AI</Text>
        </View>

        {/* Status */}
        <View style={st.statusCard}>
          <View style={st.statusDot} />
          <Text style={st.statusT}>Assistant is active</Text>
          <TouchableOpacity style={st.configBtn}>
            <Text style={st.configBtnT}>Configure</Text>
          </TouchableOpacity>
        </View>

        {/* Quick Actions */}
        <Text style={st.sectionTitle}>Quick Actions</Text>
        <View style={st.actionsRow}>
          {QUICK_ACTIONS.map((a, i) => (
            <TouchableOpacity key={i} style={[st.actionCard, a.active && st.actionActive]} activeOpacity={0.7}>
              <Ionicons name={a.icon as any} size={22} color={a.active ? '#2196F3' : '#5A5A5E'} />
              <Text style={[st.actionLabel, a.active && { color: '#2196F3' }]}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Recent Activity */}
        <Text style={st.sectionTitle}>Recent Activity</Text>
        <View style={st.activityCard}>
          {[
            { caller: '+919876543210', action: 'Call screened', time: '2 min ago', icon: 'shield-checkmark' },
            { caller: 'Spam Caller', action: 'Blocked automatically', time: '15 min ago', icon: 'ban' },
            { caller: '+917654321098', action: 'Auto-replied with SMS', time: '1 hour ago', icon: 'chatbubble' },
          ].map((a, i) => (
            <View key={i} style={st.activityRow}>
              <View style={st.activityIcon}>
                <Ionicons name={a.icon as any} size={16} color="#2196F3" />
              </View>
              <View style={st.activityInfo}>
                <Text style={st.activityCaller}>{a.caller}</Text>
                <Text style={st.activityAction}>{a.action}</Text>
              </View>
              <Text style={st.activityTime}>{a.time}</Text>
            </View>
          ))}
        </View>

        {/* Features */}
        <Text style={st.sectionTitle}>Capabilities</Text>
        {ASSISTANT_FEATURES.map((f, i) => (
          <View key={i} style={st.featureRow}>
            <View style={[st.featureIcon, { backgroundColor: `${f.color}18` }]}>
              <Ionicons name={f.icon as any} size={22} color={f.color} />
            </View>
            <View style={st.featureInfo}>
              <Text style={st.featureTitle}>{f.title}</Text>
              <Text style={st.featureDesc}>{f.desc}</Text>
            </View>
          </View>
        ))}

        {/* Greeting Message */}
        <View style={st.greetingCard}>
          <Text style={st.greetingTitle}>Custom Greeting</Text>
          <Text style={st.greetingMsg}>{`"Hi, this is the Truecaller assistant. The person you are trying to reach is currently unavailable. Please state your name and reason for calling."`}</Text>
          <TouchableOpacity style={st.editBtn}>
            <Ionicons name="create-outline" size={16} color="#2196F3" />
            <Text style={st.editBtnT}>Edit Greeting</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0A0A0A' },
  scroll: { paddingBottom: 32 },

  header: { alignItems: 'center', paddingTop: 24, paddingBottom: 8, gap: 8 },
  logoCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(33,150,243,0.12)', justifyContent: 'center', alignItems: 'center' },
  title: { color: '#FFF', fontSize: 24, fontWeight: '800' },
  subtitle: { color: '#8E8E93', fontSize: 14, textAlign: 'center' },

  /* status */
  statusCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#0D2D16',
    marginHorizontal: 16, borderRadius: 14, padding: 14, marginTop: 16, gap: 10,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#4CAF50' },
  statusT: { flex: 1, color: '#4CAF50', fontSize: 14, fontWeight: '600' },
  configBtn: { backgroundColor: 'rgba(76,175,80,0.15)', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6 },
  configBtnT: { color: '#4CAF50', fontSize: 12, fontWeight: '600' },

  sectionTitle: { color: '#8E8E93', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 16, marginTop: 20, marginBottom: 10 },

  /* quick actions */
  actionsRow: { flexDirection: 'row', paddingHorizontal: 12, gap: 8 },
  actionCard: { flex: 1, backgroundColor: '#1A1A1A', borderRadius: 12, paddingVertical: 14, alignItems: 'center', gap: 6 },
  actionActive: { borderWidth: 1, borderColor: 'rgba(33,150,243,0.3)' },
  actionLabel: { color: '#8E8E93', fontSize: 10, fontWeight: '500', textAlign: 'center' },

  /* activity */
  activityCard: { backgroundColor: '#1A1A1A', marginHorizontal: 16, borderRadius: 14, padding: 4 },
  activityRow: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  activityIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(33,150,243,0.12)', justifyContent: 'center', alignItems: 'center' },
  activityInfo: { flex: 1 },
  activityCaller: { color: '#FFF', fontSize: 13, fontWeight: '500' },
  activityAction: { color: '#8E8E93', fontSize: 11 },
  activityTime: { color: '#5A5A5E', fontSize: 11 },

  /* features */
  featureRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  featureIcon: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  featureInfo: { flex: 1 },
  featureTitle: { color: '#FFF', fontSize: 15, fontWeight: '600', marginBottom: 2 },
  featureDesc: { color: '#8E8E93', fontSize: 12, lineHeight: 16 },

  /* greeting */
  greetingCard: { backgroundColor: '#1A1A1A', marginHorizontal: 16, borderRadius: 14, padding: 16, marginTop: 8 },
  greetingTitle: { color: '#FFF', fontSize: 15, fontWeight: '600', marginBottom: 8 },
  greetingMsg: { color: '#8E8E93', fontSize: 13, lineHeight: 18, fontStyle: 'italic', marginBottom: 12 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  editBtnT: { color: '#2196F3', fontSize: 13, fontWeight: '600' },
});
