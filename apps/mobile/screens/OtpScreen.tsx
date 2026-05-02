import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthError, Session } from '@supabase/supabase-js';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useOtpFlow } from '../context/OtpFlowContext';
import { supabase } from '../lib/supabase';
import type { AuthStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Otp'>;

function mapAuthError(error: AuthError): string {
  const raw = (error.message ?? '').toLowerCase();
  if (raw.includes('expired') || raw.includes('invalid')) {
    return 'Kod geçersiz veya süresi dolmuş.';
  }
  if (raw.includes('too many requests')) {
    return 'Çok fazla deneme. Bir süre sonra tekrar dene.';
  }
  return error.message || 'İşlem başarısız.';
}

const CELL_COUNT = 6;

async function waitForAuthenticatedSession(
  maxAttempts = 50,
  delayMs = 100,
): Promise<Session | null> {
  for (let i = 0; i < maxAttempts; i += 1) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.id) {
      return session;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

export default function OtpScreen({ route }: Props) {
  const { email } = route.params;
  const otpFlow = useOtpFlow();
  const [digits, setDigits] = useState<string[]>(() => Array(CELL_COUNT).fill(''));
  const [error, setError] = useState<string | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [sessionSyncing, setSessionSyncing] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(60);
  const refs = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    const id = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const canResend = secondsLeft === 0;

  const applyDigits = useCallback((raw: string) => {
    const nums = raw.replace(/\D/g, '').slice(0, CELL_COUNT).split('');
    const next = Array(CELL_COUNT)
      .fill('')
      .map((_, i) => nums[i] ?? '');
    setDigits(next);
    setError(null);
    const lastIdx = Math.min(nums.filter(Boolean).length, CELL_COUNT) - 1;
    const focusIdx = lastIdx < 0 ? 0 : Math.min(lastIdx, CELL_COUNT - 1);
    setTimeout(() => refs.current[focusIdx]?.focus(), 50);
  }, []);

  const handleChange = (index: number, text: string) => {
    const only = text.replace(/\D/g, '');
    if (only.length > 1) {
      applyDigits(only);
      return;
    }
    setError(null);
    setDigits((prev) => {
      const next = [...prev];
      next[index] = only.length === 1 ? only : '';
      return next;
    });
    if (only.length === 1 && index < CELL_COUNT - 1) {
      setTimeout(() => refs.current[index + 1]?.focus(), 0);
    }
  };

  const handleKeyPress = (index: number, key: string) => {
    if (key !== 'Backspace') return;
    setDigits((prev) => {
      if (prev[index]) return prev;
      if (index === 0) return prev;
      const next = [...prev];
      next[index - 1] = '';
      setTimeout(() => refs.current[index - 1]?.focus(), 0);
      return next;
    });
  };

  const handlePasteFromClipboard = async () => {
    const str = await Clipboard.getStringAsync();
    if (str) applyDigits(str);
  };

  async function onCompleteAfterSession() {
    if (otpFlow?.onOtpSessionReady) {
      await otpFlow.onOtpSessionReady();
    }
  }

  async function handleVerify() {
    setError(null);
    const token = digits.join('');
    if (token.length !== CELL_COUNT) {
      setError('6 haneli kodu gir.');
      return;
    }
    setVerifyLoading(true);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token,
        type: 'signup',
      });
      if (verifyError) {
        setError(mapAuthError(verifyError));
        return;
      }
    } finally {
      setVerifyLoading(false);
    }

    setSessionSyncing(true);
    try {
      const nextSession = await waitForAuthenticatedSession();
      if (!nextSession?.user?.id) {
        setError('Oturum henüz hazır değil. Birkaç saniye sonra tekrar dene.');
        return;
      }
      await onCompleteAfterSession();
    } finally {
      setSessionSyncing(false);
    }
  }

  async function handleResend() {
    if (!canResend) return;
    setError(null);
    setResendLoading(true);
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email,
      });
      if (resendError) {
        setError(mapAuthError(resendError));
        return;
      }
      setDigits(Array(CELL_COUNT).fill(''));
      setSecondsLeft(60);
      refs.current[0]?.focus();
    } finally {
      setResendLoading(false);
    }
  }

  const blocking = verifyLoading || sessionSyncing;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.hint}>E-posta adresinize 6 haneli kod gönderildi</Text>
        <Text style={styles.email}>{email}</Text>
        <View style={styles.row}>
          {digits.map((d, i) => (
            <TextInput
              key={i}
              ref={(el) => {
                refs.current[i] = el;
              }}
              style={styles.cell}
              value={d}
              onChangeText={(t) => handleChange(i, t)}
              onKeyPress={({ nativeEvent }) => handleKeyPress(i, nativeEvent.key)}
              keyboardType="number-pad"
              maxLength={6}
              selectTextOnFocus
              editable={!blocking}
            />
          ))}
        </View>
        <Pressable style={styles.pasteBtn} onPress={handlePasteFromClipboard} disabled={blocking}>
          <Text style={styles.pasteText}>Panodan yapıştır</Text>
        </Pressable>
        {error ? <Text style={styles.err}>{error}</Text> : null}
        {sessionSyncing ? (
          <View style={styles.syncBox}>
            <ActivityIndicator color="#fff" size="small" />
            <Text style={styles.syncText}>Oturum açılıyor…</Text>
          </View>
        ) : null}
        <Pressable
          style={[styles.primary, blocking && styles.disabled]}
          onPress={handleVerify}
          disabled={blocking}
        >
          {verifyLoading || sessionSyncing ? (
            <ActivityIndicator color="#0a0a0a" />
          ) : (
            <Text style={styles.primaryText}>Doğrula</Text>
          )}
        </Pressable>
        <Pressable
          style={[styles.resend, (!canResend || resendLoading) && styles.resendDisabled]}
          onPress={handleResend}
          disabled={!canResend || resendLoading || blocking}
        >
          {resendLoading ? (
            <ActivityIndicator color="#8ab4ff" />
          ) : (
            <Text style={styles.resendText}>
              {canResend ? 'Tekrar Gönder' : `Tekrar Gönder (${secondsLeft}s)`}
            </Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
  },
  inner: {
    paddingHorizontal: 20,
  },
  hint: {
    color: '#ffffff',
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: 8,
  },
  email: {
    color: '#a3a3a3',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 28,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 12,
  },
  cell: {
    width: 48,
    height: 56,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#333',
    backgroundColor: '#1a1a1a',
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  pasteBtn: {
    alignSelf: 'center',
    paddingVertical: 8,
    marginBottom: 16,
  },
  pasteText: {
    color: '#8ab4ff',
    fontSize: 14,
    fontWeight: '600',
  },
  err: {
    color: '#ff8a80',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 12,
  },
  syncBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 12,
  },
  syncText: {
    color: '#ccc',
    fontSize: 14,
  },
  primary: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryText: {
    color: '#0a0a0a',
    fontSize: 16,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.7,
  },
  resend: {
    marginTop: 20,
    alignItems: 'center',
    paddingVertical: 10,
  },
  resendDisabled: {
    opacity: 0.45,
  },
  resendText: {
    color: '#8ab4ff',
    fontSize: 15,
    fontWeight: '600',
  },
});
