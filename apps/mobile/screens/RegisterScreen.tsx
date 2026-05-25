import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthError } from '@supabase/supabase-js';
import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
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
import { C } from '../theme';

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
    minLen:  pw.length >= 8,
    upper:   /[A-ZÇĞİÖŞÜ]/.test(pw),
    digit:   /[0-9]/.test(pw),
    special: /[^A-Za-z0-9ÇçĞğİıÖöŞşÜü]/.test(pw),
  };
}

function passwordStrength(pw: string): Strength {
  const r = checkPasswordRules(pw);
  const score = [r.minLen, r.upper, r.digit, r.special].filter(Boolean).length;
  if (score <= 2 || !r.minLen) return 'weak';
  if (score === 3)              return 'medium';
  return 'strong';
}

// ─── Animated input ────────────────────────────────────────────────────────────

interface FocusInputProps {
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address';
  autoCapitalize?: 'none' | 'sentences';
  autoCorrect?: boolean;
  autoComplete?: 'email' | 'password' | 'new-password';
  editable?: boolean;
  style?: object;
}

function FocusInput(props: FocusInputProps) {
  const anim = useRef(new Animated.Value(0)).current;

  function handleFocus() {
    Animated.timing(anim, {
      toValue: 1,
      duration: 150,
      useNativeDriver: false,
    }).start();
  }

  function handleBlur() {
    Animated.timing(anim, {
      toValue: 0,
      duration: 150,
      useNativeDriver: false,
    }).start();
  }

  const borderColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [C.border, C.primary],
  });

  const backgroundColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [C.surface, C.primaryDim],
  });

  return (
    <Animated.View style={[styles.inputWrap, props.style, { borderColor, backgroundColor }]}>
      <TextInput
        style={styles.inputInner}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={C.text3}
        secureTextEntry={props.secureTextEntry}
        keyboardType={props.keyboardType ?? 'default'}
        autoCapitalize={props.autoCapitalize ?? 'sentences'}
        autoCorrect={props.autoCorrect}
        autoComplete={props.autoComplete}
        editable={props.editable}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
    </Animated.View>
  );
}

// ─── Ana ekran ────────────────────────────────────────────────────────────────

export default function RegisterScreen({ navigation }: Props) {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [kvkk, setKvkk]         = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  const rules    = useMemo(() => checkPasswordRules(password), [password]);
  const strength = useMemo(() => passwordStrength(password),   [password]);

  const strengthColors: Record<Strength, string> = {
    weak:   '#e53935',
    medium: '#f59e0b',
    strong: C.success,
  };

  const barFill = strength === 'weak' ? 0.33 : strength === 'medium' ? 0.66 : 1;

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
      if (data.session) return;
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
          <FocusInput
            value={email}
            onChangeText={setEmail}
            placeholder="ornek@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            editable={!loading}
            style={styles.inputGap}
          />

          <Text style={styles.label}>Şifre</Text>
          <FocusInput
            value={password}
            onChangeText={setPassword}
            placeholder="Güçlü bir şifre seç"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            editable={!loading}
            style={styles.inputGapSm}
          />

          {/* Şifre kuralları */}
          <View style={styles.rules}>
            <Text style={[styles.rule, rules.minLen && styles.ruleOk]}>• En az 8 karakter</Text>
            <Text style={[styles.rule, rules.upper  && styles.ruleOk]}>• En az 1 büyük harf</Text>
            <Text style={[styles.rule, rules.digit  && styles.ruleOk]}>• En az 1 rakam</Text>
            <Text style={[styles.rule, rules.special && styles.ruleOk]}>• En az 1 özel karakter</Text>
          </View>

          {/* Şifre gücü */}
          {password.length > 0 && (
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
                      width: `${Math.round(barFill * 100)}%` as `${number}%`,
                      backgroundColor: strengthColors[strength],
                    },
                  ]}
                />
              </View>
            </View>
          )}

          <Text style={styles.label}>Şifre tekrar</Text>
          <FocusInput
            value={confirm}
            onChangeText={setConfirm}
            placeholder="Şifreni tekrar gir"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            editable={!loading}
            style={styles.inputGap}
          />

          {/* KVKK */}
          <Pressable
            style={styles.kvkkRow}
            onPress={() => setKvkk(!kvkk)}
            disabled={loading}
          >
            <Ionicons
              name={kvkk ? 'checkbox' : 'square-outline'}
              size={22}
              color={kvkk ? C.primary : C.text3}
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
              <ActivityIndicator color={C.bg} />
            ) : (
              <Text style={styles.buttonText}>Kayıt Ol</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Stiller ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex:   { flex: 1, backgroundColor: C.bg },
  scroll: { flexGrow: 1, padding: 24, paddingBottom: 40 },
  inner:  { width: '100%', maxWidth: 400, alignSelf: 'center' },

  wordmarkWrap: { alignItems: 'center', marginBottom: 28, marginTop: 8 },

  heading: { color: C.text1, fontSize: 26, fontWeight: '700', marginBottom: 24 },

  label: { color: C.text1, fontSize: 14, fontWeight: '500', marginBottom: 8 },

  /* Input kapsayıcısı (Animated.View) */
  inputWrap:   { borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  inputInner:  { color: C.text1, fontSize: 16, paddingHorizontal: 14, paddingVertical: 14 },
  inputGap:    { marginBottom: 16 },
  inputGapSm:  { marginBottom: 8 },

  /* Kurallar */
  rules:  { marginBottom: 12 },
  rule:   { color: C.text3, fontSize: 13, marginBottom: 4 },
  ruleOk: { color: C.success },

  /* Şifre gücü */
  strengthBlock:  { marginBottom: 16 },
  strengthLabels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  strengthCaption:{ color: C.text2, fontSize: 13 },
  strengthLabel:  { fontSize: 13, fontWeight: '700' },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: C.border,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 3 },

  /* KVKK */
  kvkkRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 8, marginBottom: 8 },
  kvkkText: { flex: 1, color: C.text2, fontSize: 13, lineHeight: 20 },
  kvkkBold: { color: C.text1, fontWeight: '700' },

  error: { color: C.error, fontSize: 14, marginBottom: 12 },

  button:         { backgroundColor: C.text1, borderRadius: 10, paddingVertical: 16, alignItems: 'center', marginTop: 12 },
  buttonDisabled: { opacity: 0.7 },
  buttonText:     { color: C.bg, fontSize: 16, fontWeight: '700' },
});
