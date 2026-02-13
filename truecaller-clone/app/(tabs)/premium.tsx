import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  StatusBar, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

const FEATURES = [
  { icon: 'shield-checkmark', lib: 'ion', title: 'Advanced Caller ID', desc: 'See who calls before you answer with detailed caller information', color: '#2196F3' },
  { icon: 'ban', lib: 'ion', title: 'Spam Blocking', desc: 'Automatically block known spam and scam callers', color: '#F44336' },
  { icon: 'recording', lib: 'ion', title: 'Call Recording', desc: 'Record important calls and save them securely', color: '#FF9800' },
  { icon: 'people', lib: 'ion', title: 'Who Viewed My Profile', desc: 'See who has looked up your number', color: '#9C27B0' },
  { icon: 'chatbubble-ellipses', lib: 'ion', title: 'SMS Filter', desc: 'Filter spam SMS and keep your inbox clean', color: '#4CAF50' },
  { icon: 'diamond', lib: 'ion', title: 'Gold Caller ID', desc: 'Stand out with a premium gold badge on your profile', color: '#FFD600' },
  { icon: 'eye-off', lib: 'ion', title: 'Incognito Mode', desc: 'Search numbers without the other person knowing', color: '#607D8B' },
  { icon: 'notifications-off', lib: 'ion', title: 'No Ads', desc: 'Enjoy a completely ad-free experience', color: '#00BCD4' },
];

export default function PremiumScreen() {
  return (
    <SafeAreaView style={st.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0A" />
      <ScrollView contentContainerStyle={st.scroll}>
        {/* Header */}
        <View style={st.header}>
          <MaterialCommunityIcons name="crown" size={40} color="#FFD600" />
          <Text style={st.title}>Truecaller Premium</Text>
          <Text style={st.subtitle}>Unlock the full power of Truecaller</Text>
        </View>

        {/* Price Card */}
        <View style={st.priceCard}>
          <View style={st.priceRow}>
            <Text style={st.priceOld}>Rs. 529/yr</Text>
            <Text style={st.price}>Rs. 149<Text style={st.pricePer}>/month</Text></Text>
          </View>
          <TouchableOpacity style={st.upgradeBtn} activeOpacity={0.8}>
            <MaterialCommunityIcons name="crown" size={18} color="#0A0A0A" />
            <Text style={st.upgradeBtnT}>Upgrade to Premium</Text>
          </TouchableOpacity>
          <Text style={st.trial}>7-day free trial included</Text>
        </View>

        {/* Features */}
        <Text style={st.sectionTitle}>Premium Features</Text>
        {FEATURES.map((f, i) => (
          <View key={i} style={st.featureRow}>
            <View style={[st.featureIcon, { backgroundColor: `${f.color}15` }]}>
              <Ionicons name={f.icon as any} size={22} color={f.color} />
            </View>
            <View style={st.featureInfo}>
              <Text style={st.featureTitle}>{f.title}</Text>
              <Text style={st.featureDesc}>{f.desc}</Text>
            </View>
            <Ionicons name="checkmark-circle" size={22} color="#4CAF50" />
          </View>
        ))}

        {/* Compare Plans */}
        <View style={st.compareCard}>
          <Text style={st.compareTitle}>Compare Plans</Text>
          {[
            { label: 'Caller ID', free: true, premium: true },
            { label: 'Spam blocking', free: true, premium: true },
            { label: 'Call recording', free: false, premium: true },
            { label: 'Who viewed profile', free: false, premium: true },
            { label: 'Incognito mode', free: false, premium: true },
            { label: 'Ad-free experience', free: false, premium: true },
            { label: 'Gold badge', free: false, premium: true },
          ].map((p, i) => (
            <View key={i} style={st.compareRow}>
              <Text style={st.compareLabel}>{p.label}</Text>
              <Ionicons name={p.free ? 'checkmark-circle' : 'close-circle'} size={18} color={p.free ? '#4CAF50' : '#5A5A5E'} />
              <Ionicons name="checkmark-circle" size={18} color="#FFD600" />
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0A0A0A' },
  scroll: { paddingBottom: 32 },

  header: { alignItems: 'center', paddingTop: 24, paddingBottom: 8, gap: 8 },
  title: { color: '#FFD600', fontSize: 26, fontWeight: '800' },
  subtitle: { color: '#8E8E93', fontSize: 14 },

  priceCard: {
    backgroundColor: '#1A1A1A', marginHorizontal: 16, borderRadius: 16,
    padding: 20, marginTop: 16, marginBottom: 20, alignItems: 'center',
    borderWidth: 1, borderColor: '#FFD60030',
  },
  priceRow: { alignItems: 'center', marginBottom: 16 },
  priceOld: { color: '#5A5A5E', fontSize: 14, textDecorationLine: 'line-through', marginBottom: 4 },
  price: { color: '#FFF', fontSize: 32, fontWeight: '800' },
  pricePer: { fontSize: 14, fontWeight: '400', color: '#8E8E93' },
  upgradeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFD600', borderRadius: 28, paddingVertical: 14, paddingHorizontal: 32,
    marginBottom: 10,
  },
  upgradeBtnT: { color: '#0A0A0A', fontSize: 16, fontWeight: '700' },
  trial: { color: '#8E8E93', fontSize: 12 },

  sectionTitle: { color: '#8E8E93', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 16, marginBottom: 8 },

  featureRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  featureIcon: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  featureInfo: { flex: 1 },
  featureTitle: { color: '#FFF', fontSize: 15, fontWeight: '600', marginBottom: 2 },
  featureDesc: { color: '#8E8E93', fontSize: 12, lineHeight: 16 },

  compareCard: { backgroundColor: '#1A1A1A', marginHorizontal: 16, borderRadius: 14, padding: 16, marginTop: 20 },
  compareTitle: { color: '#FFF', fontSize: 16, fontWeight: '700', marginBottom: 14 },
  compareRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 16 },
  compareLabel: { flex: 1, color: '#8E8E93', fontSize: 13 },
});
