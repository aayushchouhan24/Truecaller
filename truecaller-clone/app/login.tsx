import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getAuth, signInWithPhoneNumber, getIdToken } from '@react-native-firebase/auth';
import type { FirebaseAuthTypes } from '@react-native-firebase/auth';
import { getApp } from '@react-native-firebase/app';
import { authApi } from '../src/services/api';
import { useAuthStore } from '../src/store/authStore';
import { COLORS } from '../src/constants/config';

type Step = 'phone' | 'otp' | 'name';

export default function LoginScreen() {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [step, setStep] = useState<Step>('phone');
  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const confirmationRef = useRef<FirebaseAuthTypes.ConfirmationResult | null>(null);
  const setAuthFn = useAuthStore((s) => s.setAuth);

  // Countdown timer for resend
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const getFullPhone = () => {
    let trimmed = phoneNumber.trim().replace(/\s+/g, '');
    // Strip leading +91 if user typed it (since UI already shows +91 prefix)
    if (trimmed.startsWith('+91')) trimmed = trimmed.slice(3);
    if (trimmed.startsWith('91') && trimmed.length > 10) trimmed = trimmed.slice(2);
    return '+91' + trimmed;
  };

  /** Step 1 — Send OTP via Firebase */
  const handleSendOTP = async () => {
    const phone = getFullPhone();
    const phoneRegex = /^\+?[1-9]\d{6,14}$/;
    if (!phoneRegex.test(phone)) {
      Alert.alert('Invalid Number', 'Enter a valid phone number');
      return;
    }
    setIsLoading(true);
    try {
      const firebaseAuth = getAuth(getApp());
      const confirmation = await signInWithPhoneNumber(firebaseAuth, phone);
      confirmationRef.current = confirmation;
      setStep('otp');
      setCountdown(30);
    } catch (error: any) {
      const msg = error?.message || 'Could not send OTP';
      if (msg.includes('too-many-requests')) {
        Alert.alert('Too Many Attempts', 'Please wait a while before trying again.');
      } else {
        Alert.alert('OTP Failed', msg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  /** Step 2 — Verify OTP & login with backend */
  const handleVerifyOTP = async () => {
    if (otp.length < 6) {
      Alert.alert('Invalid OTP', 'Please enter the 6-digit code');
      return;
    }
    if (!confirmationRef.current) {
      Alert.alert('Error', 'Session expired. Please request a new OTP.');
      setStep('phone');
      return;
    }
    setIsLoading(true);
    try {
      await confirmationRef.current.confirm(otp);

      // Get Firebase ID token (modular API)
      const firebaseAuth = getAuth(getApp());
      const firebaseUser = firebaseAuth.currentUser;
      if (!firebaseUser) throw new Error('Firebase auth failed');
      const idToken = await getIdToken(firebaseUser);

      // Send to our backend
      const response = await authApi.loginWithFirebase(idToken);
      const data = response.data;

      if (data.needsName) {
        setStep('name');
        return;
      }

      const { accessToken, user } = data;
      await setAuthFn(accessToken, user);
      syncContactsBackground();
      router.replace('/(tabs)');
    } catch (error: any) {
      const msg = error?.message || 'Verification failed';
      if (msg.includes('invalid-verification-code')) {
        Alert.alert('Wrong OTP', 'The code you entered is incorrect.');
      } else {
        Alert.alert('Verification Failed', msg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  /** Step 3 — New user submits name */
  const handleSignup = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length < 2) {
      Alert.alert('Name Required', 'Please enter at least 2 characters');
      return;
    }
    setIsLoading(true);
    try {
      const firebaseAuth = getAuth(getApp());
      const firebaseUser = firebaseAuth.currentUser;
      if (!firebaseUser) throw new Error('Session expired');
      const idToken = await getIdToken(firebaseUser);

      const response = await authApi.loginWithFirebase(idToken, trimmedName);
      const data = response.data;
      const { accessToken, user } = data;
      await setAuthFn(accessToken, user);
      syncContactsBackground();
      router.replace('/(tabs)');
    } catch (error: any) {
      Alert.alert('Signup Failed', error.message || 'Could not create account');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOTP = async () => {
    if (countdown > 0) return;
    setIsLoading(true);
    try {
      const firebaseAuth = getAuth(getApp());
      const confirmation = await signInWithPhoneNumber(firebaseAuth, getFullPhone());
      confirmationRef.current = confirmation;
      setCountdown(30);
      Alert.alert('OTP Sent', 'A new code has been sent to your phone');
    } catch {
      Alert.alert('Error', 'Could not resend OTP');
    } finally {
      setIsLoading(false);
    }
  };

  const syncContactsBackground = () => {
    setTimeout(async () => {
      try {
        const { contactsService } = await import('../src/services/contacts');
        await contactsService.syncContactsToServer();
      } catch { }
    }, 2000);
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Top Section */}
        <View style={styles.topSection}>
          <View style={styles.logoContainer}>
            <View style={styles.logoIcon}>
              <Ionicons name="call" size={40} color="#FFF" />
            </View>
          </View>
          <Text style={styles.brandName}>truecaller</Text>
          <Text style={styles.tagline}>
            See who{"'"}s calling. Block spam.{'\n'}Search any number.
          </Text>
        </View>

        {/* Bottom Section */}
        <View style={styles.bottomSection}>

          {/* ─── STEP 1: Phone ─────────────────── */}
          {step === 'phone' && (
            <>
              <Text style={styles.inputLabel}>Enter your phone number</Text>
              <View style={styles.inputRow}>
                <View style={styles.countryCode}>
                  <Text style={styles.countryFlag}>🇮🇳</Text>
                  <Text style={styles.countryText}>+91</Text>
                </View>
                <TextInput
                  style={styles.phoneInput}
                  value={phoneNumber}
                  onChangeText={setPhoneNumber}
                  placeholder="Phone number"
                  placeholderTextColor={COLORS.textTertiary}
                  keyboardType="phone-pad"
                  returnKeyType="done"
                  editable={!isLoading}
                  maxLength={15}
                  autoFocus
                />
              </View>

              <TouchableOpacity
                style={[styles.continueBtn, (!phoneNumber.trim() || isLoading) && styles.btnDisabled]}
                onPress={handleSendOTP}
                disabled={!phoneNumber.trim() || isLoading}
                activeOpacity={0.8}
              >
                {isLoading ? (
                  <ActivityIndicator color={COLORS.white} size="small" />
                ) : (
                  <Text style={styles.continueBtnText}>Send OTP</Text>
                )}
              </TouchableOpacity>
            </>
          )}

          {/* ─── STEP 2: OTP ───────────────────── */}
          {step === 'otp' && (
            <>
              <Text style={styles.inputLabel}>Enter verification code</Text>
              <Text style={styles.otpSubLabel}>
                We sent a 6-digit code to {getFullPhone()}
              </Text>

              <View style={styles.otpInputWrap}>
                <TextInput
                  style={styles.otpInput}
                  value={otp}
                  onChangeText={(t) => setOtp(t.replace(/[^0-9]/g, ''))}
                  placeholder="● ● ● ● ● ●"
                  placeholderTextColor={COLORS.textTertiary}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                  editable={!isLoading}
                />
              </View>

              <TouchableOpacity
                style={[styles.continueBtn, (otp.length < 6 || isLoading) && styles.btnDisabled]}
                onPress={handleVerifyOTP}
                disabled={otp.length < 6 || isLoading}
                activeOpacity={0.8}
              >
                {isLoading ? (
                  <ActivityIndicator color={COLORS.white} size="small" />
                ) : (
                  <Text style={styles.continueBtnText}>Verify</Text>
                )}
              </TouchableOpacity>

              <View style={styles.otpFooter}>
                <TouchableOpacity
                  onPress={handleResendOTP}
                  disabled={countdown > 0 || isLoading}
                >
                  <Text style={[styles.resendText, countdown > 0 && { color: COLORS.textTertiary }]}>
                    {countdown > 0 ? `Resend in ${countdown}s` : 'Resend OTP'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => { setStep('phone'); setOtp(''); }}>
                  <Text style={styles.backLinkText}>← Change number</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* ─── STEP 3: Name (new users) ──────── */}
          {step === 'name' && (
            <>
              <Text style={styles.inputLabel}>What&apos;s your name?</Text>
              <Text style={styles.nameSubLabel}>This helps others identify you on Truecaller</Text>

              <View style={styles.nameInputWrap}>
                <TextInput
                  style={styles.nameInput}
                  value={name}
                  onChangeText={setName}
                  placeholder="Enter your full name"
                  placeholderTextColor={COLORS.textTertiary}
                  returnKeyType="done"
                  editable={!isLoading}
                  maxLength={50}
                  autoFocus
                  autoCapitalize="words"
                />
              </View>

              <TouchableOpacity
                style={[styles.continueBtn, (!name.trim() || name.trim().length < 2 || isLoading) && styles.btnDisabled]}
                onPress={handleSignup}
                disabled={isLoading || !name.trim() || name.trim().length < 2}
                activeOpacity={0.8}
              >
                {isLoading ? (
                  <ActivityIndicator color={COLORS.white} size="small" />
                ) : (
                  <Text style={styles.continueBtnText}>Get Started</Text>
                )}
              </TouchableOpacity>
            </>
          )}

          <Text style={styles.disclaimer}>
            By continuing, you agree to our Terms of Service and Privacy Policy
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  keyboardView: {
    flex: 1,
  },
  topSection: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  logoContainer: {
    marginBottom: 20,
  },
  logoIcon: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  brandName: {
    fontSize: 36,
    fontWeight: '800',
    color: COLORS.primary,
    letterSpacing: -1,
    marginBottom: 12,
  },
  tagline: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  bottomSection: {
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 32,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 12,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  countryCode: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  countryFlag: {
    fontSize: 20,
  },
  countryText: {
    fontSize: 16,
    color: COLORS.text,
    fontWeight: '600',
  },
  phoneInput: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
    fontWeight: '500',
    letterSpacing: 1,
  },
  continueBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 28,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  btnDisabled: {
    opacity: 0.4,
  },
  continueBtnText: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  /* OTP step */
  otpSubLabel: {
    fontSize: 13,
    color: COLORS.textTertiary,
    marginBottom: 20,
  },
  otpInputWrap: {
    marginBottom: 16,
  },
  otpInput: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 24,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
    fontWeight: '700',
    letterSpacing: 12,
    textAlign: 'center',
  },
  otpFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  resendText: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  /* Name step */
  nameSubLabel: {
    fontSize: 13,
    color: COLORS.textTertiary,
    marginBottom: 16,
  },
  nameInputWrap: {
    marginBottom: 16,
  },
  nameInput: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
    fontWeight: '500',
  },
  backLinkText: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: '500',
  },
  disclaimer: {
    fontSize: 12,
    color: COLORS.textTertiary,
    textAlign: 'center',
    lineHeight: 18,
  },
});
