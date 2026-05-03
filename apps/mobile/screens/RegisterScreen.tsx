import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthError } from '@supabase/supabase-js';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Wordmark } from '../components/Brand';
import { supabase } from '../lib/supabase';
import type { AuthStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

type Strength = 'weak' | 'medium' | 'strong';

function mapAuthError(error: AuthError): string {
  const raw = (error.message ?? '').toLowerCase();
  if (raw.includes('user already registered') || raw.includes('already been registered')) {
    return 'Bu e-posta ile zaten bir hesap var.';
  }
  if (raw.includes('password')) {
    return 'Şifre politikasına uymuyor. Kuralları kontrol et.';
  }
  if (raw.includes('invalid email')) {
    return 'Geçerli bir e-posta adresi gir.';
  }
  if (raw.includes('too many requests')) {
    return 'Çok fazla deneme yapıldı. Lütfen bir süre sonra tekrar dene.';
  }
  return error.message || 'Kayıt olunamadı. Tekrar dene.';
}

function checkPasswordRules(pw: string): {
  minLen: boolean;
  upper: boolean;
  digit: boolean;
  special: boolean;
} {
  return {
    minLen: pw.length >= 8,
    upper: /[A-ZÇĞİÖŞÜ]/.test(pw),
    digit: /[0-9]/.test(pw),
    special: /[^A-Za-z0-9ÇçĞğİıÖöŞşÜü]/.test(pw),
  };
}

function passwordStrength(pw: string): Strength {
  const r = checkPasswordRules(pw);
  const score = [r.minLen, r.upper, r.digit, r.special].filter(Boolean).length;
  if (score <= 2 || !r.minLen) return 'weak';
  if (score === 3) return 'medium';
  return 'strong';
}

export default function RegisterScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [kvkk, setKvkk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const rules = useMemo(() => checkPasswordRules(password), [password]);
  const strength = useMemo(() => passwordStrength(password), [password]);

  const strengthColors = {
    weak: '#e53935',
    medium: '#ffb300',
    strong: '#43a047',
  } as const;

  const barFill =
    strength === 'weak' ? 0.33 : strength === 'medium' ? 0.66 : 1;

  async function handleSignUp() {
    setError(null);
    const trimmed = email.trim();
    if (!trimmed) {
      setError('E-posta gerekli.');
      return;
    }
    if (!rules.minLen || !rules.upper || !rules.digit || !rules.special) {
      setError('Şifre tüm kuralları sağlamalı.');
      return;
    }
    if (password !== confirm) {
      setError('Şifreler eşleşmiyor.');
      return;
    }
    if (!kvkk) {
      setError('Devam etmek için KVKK metnini onaylamalısın.');
      return;
    }
    setLoading(true);
    try {
      const { data, error: signError } = await supabase.auth.signUp({
        email: trimmed,
        password,
      });
      if (signError) {
        setError(mapAuthError(signError));
        return;
      }
      if (data.session) {
        return;
      }
      if (data.user) {
        navigation.replace('Otp', { email: trimmed });
        return;
      }
      setError('Kayıt tamamlanamadı. Tekrar dene.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.inner}>
          <View style={styles.wordmarkWrap}>
            <Wordmark height={36} onDark showIcon />
          </View>
          <Text style={styles.heading}>Hesap oluştur</Text>
          <Text style={styles.label}>E-posta</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="ornek@email.com"
            placeholderTextColor="#888"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            editable={!loading}
          />
          <Text style={styles.label}>Şifre</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Güçlü bir şifre seç"
            placeholderTextColor="#888"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            editable={!loading}
          />
          <View style={styles.rules}>
            <Text style={[styles.rule, rules.minLen && styles.ruleOk]}>• En az 8 karakter</Text>
            <Text style={[styles.rule, rules.upper && styles.ruleOk]}>• En az 1 büyük harf</Text>
            <Text style={[styles.rule, rules.digit && styles.ruleOk]}>• En az 1 rakam</Text>
            <Text style={[styles.rule, rules.special && styles.ruleOk]}>• En az 1 özel karakter</Text>
          </View>
          {password.length > 0 ? (
            <View style={styles.strengthBlock}>
              <View style={styles.strengthLabels}>
                <Text style={styles.strengthCaption}>Şifre gücü</Text>
                <Text style={[styles.strengthLabel, { color: strengthColors[strength] }]}>
                  {strength === 'weak' ? 'Zayıf' : strength === 'medium' ? 'Orta' : 'Güçlü'}
                </Text>
              </View>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    {
                      width: `${Math.round(barFill * 100)}%`,
                      backgroundColor: strengthColors[strength],
                    },
                  ]}
                />
              </View>
            </View>
          ) : null}
          <Text style={styles.label}>Şifre tekrar</Text>
          <TextInput
            style={styles.input}
            value={confirm}
            onChangeText={setConfirm}
            placeholder="Şifreni tekrar gir"
            placeholderTextColor="#888"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            editable={!loading}
          />
          <Pressable
            style={styles.kvkkRow}
            onPress={() => setKvkk(!kvkk)}
            disabled={loading}
          >
            <Ionicons
              name={kvkk ? 'checkbox' : 'square-outline'}
              size={22}
              color={kvkk ? '#8ab4ff' : '#888'}
            />
            <Text style={styles.kvkkText}>
              <Text style={styles.kvkkBold}>KVKK</Text> kapsamında kişisel verilerimin işlenmesini
              okudum ve kabul ediyorum.
            </Text>
          </Pressable>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSignUp}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#0a0a0a" />
            ) : (
              <Text style={styles.buttonText}>Kayıt Ol</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  scroll: {
    flexGrow: 1,
    padding: 24,
    paddingBottom: 40,
  },
  inner: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
  },
  wordmarkWrap: {
    alignItems: 'center',
    marginBottom: 28,
    marginTop: 8,
  },
  heading: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 24,
  },
  label: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    color: '#ffffff',
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 12,
  },
  rules: {
    marginBottom: 12,
  },
  rule: {
    color: '#777',
    fontSize: 13,
    marginBottom: 4,
  },
  ruleOk: {
    color: '#8bd58b',
  },
  strengthBlock: {
    marginBottom: 16,
  },
  strengthLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  strengthCaption: {
    color: '#aaa',
    fontSize: 13,
  },
  strengthLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#2a2a2a',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
  },
  kvkkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 8,
    marginBottom: 8,
  },
  kvkkText: {
    flex: 1,
    color: '#ccc',
    fontSize: 13,
    lineHeight: 20,
  },
  kvkkBold: {
    color: '#fff',
    fontWeight: '700',
  },
  error: {
    color: '#ff8a80',
    fontSize: 14,
    marginBottom: 12,
  },
  button: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#0a0a0a',
    fontSize: 16,
    fontWeight: '700',
  },
});
