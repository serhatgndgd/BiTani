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
import { SafeAreaView } from 'react-native-safe-area-context';

import { Wordmark } from '../components/Brand';
import { LegalDocumentModal } from '../components/LegalDocumentModal';
import type { LegalDocumentId } from '../legal/documents';
import { supabase } from '../lib/supabase';
import type { AuthStackParamList, ConsentType, PendingConsent } from '../navigation/types';
import { useTheme } from '../context/ThemeContext';
import { darkTheme as defaultThemeColors, type ThemeColors } from '../theme';

const C = defaultThemeColors;

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

type Strength = 'weak' | 'medium' | 'strong';
type ConsentKey = 'kvkk_read' | 'saglik_veri' | 'ai_transfer' | 'chat_history' | 'age_18';
type ReadableConsentKey = Exclude<ConsentKey, 'age_18'>;
type ConsentState = Record<ConsentKey, boolean>;
type ReadState = Record<ReadableConsentKey, boolean>;

const INITIAL_CONSENTS: ConsentState = {
  kvkk_read: false,
  saglik_veri: false,
  ai_transfer: false,
  chat_history: false,
  age_18: false,
};

const INITIAL_READ_STATE: ReadState = {
  kvkk_read: false,
  saglik_veri: false,
  ai_transfer: false,
  chat_history: false,
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const CONSENT_DOCUMENTS: Record<ReadableConsentKey, LegalDocumentId> = {
  kvkk_read: 'kvkk_aydinlatma',
  saglik_veri: 'acik_riza',
  ai_transfer: 'acik_riza',
  chat_history: 'acik_riza',
};

function mapAuthError(error: AuthError): string {
  const raw = (error.message ?? '').toLowerCase();
  if (raw.includes('user already registered') || raw.includes('already been registered')) {
    return 'Bu e-posta adresi zaten kayıtlı. Giriş yapmayı deneyin.';
  }
  if (raw.includes('email not confirmed')) {
    return 'Bu e-posta onaylanmamış. Gelen kutunuzu kontrol edin.';
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
  const { colors: C } = useTheme();
  const styles = useMemo(() => createStyles(C), [C]);
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

interface ConsentRowProps {
  checked: boolean;
  label: string;
  onToggle: () => void;
  onRead?: () => void;
  hasRead?: boolean;
  readRequired?: boolean;
  disabled?: boolean;
}

function ConsentRow({
  checked,
  label,
  onToggle,
  onRead,
  hasRead = true,
  readRequired = true,
  disabled,
}: ConsentRowProps) {
  const { colors: C } = useTheme();
  const styles = useMemo(() => createStyles(C), [C]);
  const checkboxDisabled = disabled || (readRequired && !hasRead);

  return (
    <View style={styles.consentRow}>
      <Pressable
        style={[styles.consentMain, checkboxDisabled && styles.consentMainDisabled]}
        onPress={onToggle}
        disabled={checkboxDisabled}
      >
        <Ionicons
          name={checked ? 'checkbox' : 'square-outline'}
          size={22}
          color={checkboxDisabled ? C.text3 : checked ? C.primary : C.text2}
        />
        <Text style={styles.consentText}>{label}</Text>
      </Pressable>
      {onRead ? (
        <Pressable onPress={onRead} disabled={disabled} hitSlop={8} style={styles.readBtn}>
          <Text style={[styles.detailText, hasRead && styles.detailTextRead]}>
            {hasRead ? '✓ Okundu' : '📄 Oku'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ─── Ana ekran ────────────────────────────────────────────────────────────────

export default function RegisterScreen({ navigation }: Props) {
  const { colors: C } = useTheme();
  const styles = useMemo(() => createStyles(C), [C]);
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [consents, setConsents] = useState<ConsentState>(INITIAL_CONSENTS);
  const [hasRead, setHasRead] = useState<ReadState>(INITIAL_READ_STATE);
  const [readingConsent, setReadingConsent] = useState<ReadableConsentKey | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  const rules    = useMemo(() => checkPasswordRules(password), [password]);
  const strength = useMemo(() => passwordStrength(password),   [password]);

  const strengthColors: Record<Strength, string> = {
    weak:   C.error,
    medium: C.warning,
    strong: C.success,
  };

  const barFill = strength === 'weak' ? 0.33 : strength === 'medium' ? 0.66 : 1;
  const requiredConsentsAccepted =
    consents.kvkk_read &&
    consents.saglik_veri &&
    consents.chat_history &&
    consents.age_18;
  const submitDisabled =
    loading ||
    !requiredConsentsAccepted ||
    !email.trim() ||
    !rules.minLen ||
    !rules.upper ||
    !rules.digit ||
    !rules.special ||
    password !== confirm;

  function toggleConsent(key: ConsentKey) {
    setConsents((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function confirmConsentRead() {
    if (!readingConsent) return;
    setHasRead((prev) => ({ ...prev, [readingConsent]: true }));
    setConsents((prev) => ({ ...prev, [readingConsent]: true }));
  }

  function buildPendingConsents(): PendingConsent[] {
    const mapping: Record<ConsentKey, ConsentType> = {
      kvkk_read: 'kvkk_aydinlatma',
      saglik_veri: 'saglik_veri',
      ai_transfer: 'ai_transfer',
      chat_history: 'chat_history',
      age_18: 'age_18',
    };
    return (Object.keys(consents) as ConsentKey[]).map((key) => ({
      consent_type: mapping[key],
      consent_given: consents[key],
      version: 'v1.0',
    }));
  }

  async function saveConsentsForUser(userId: string) {
    const rows = buildPendingConsents().map((consent) => ({
      user_id: userId,
      consent_type: consent.consent_type,
      consent_given: consent.consent_given,
      version: consent.version,
    }));
    const { error: consentError } = await supabase.from('consent_records').insert(rows);
    if (consentError) {
      console.error('register-consents:', consentError);
      throw new Error('Rıza kayıtları kaydedilemedi. Tekrar deneyin.');
    }
  }

  async function handleSignUp() {
    setError(null);
    const trimmed = email.trim();
    if (!trimmed) {
      setError('E-posta gerekli.');
      return;
    }
    if (!EMAIL_PATTERN.test(trimmed)) {
      setError('Geçerli bir e-posta adresi girin.');
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
    if (!requiredConsentsAccepted) {
      setError('Devam etmek için zorunlu metinleri okuyup onaylamalısın.');
      return;
    }
    if (!hasRead.kvkk_read || !hasRead.saglik_veri || !hasRead.chat_history) {
      setError('Lütfen tüm belgeleri okuyup onaylayın.');
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
      if (data.session?.user?.id) {
        try {
          await saveConsentsForUser(data.session.user.id);
          // Başarılı — auth listener Onboarding'e yönlendirecek
        } catch (consentError) {
          console.error('signup-consent-save:', consentError);
          // Rızasız hesap bırakmamak için oturumu kapat
          try {
            await supabase.auth.signOut();
          } catch (signOutError) {
            console.error('signup-consent-cleanup-signout:', signOutError);
          }
          setError('Rıza kayıtlarınız kaydedilemedi. Lütfen tekrar deneyin.');
        }
        return;
      }
      if (data.user) {
        navigation.replace('Otp', { email: trimmed, pendingConsents: buildPendingConsents() });
        return;
      }
      setError('Kayıt tamamlanamadı. Tekrar dene.');
    } catch (unexpectedError) {
      console.error('signup-unexpected:', unexpectedError);
      setError('Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
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

            <View style={styles.consentBlock}>
              <Text style={styles.consentTitle}>Rıza ve Bilgilendirme</Text>
              <ConsentRow
                checked={consents.kvkk_read}
                label="KVKK Aydınlatma Metni'ni okudum"
                onToggle={() => toggleConsent('kvkk_read')}
                onRead={() => setReadingConsent('kvkk_read')}
                hasRead={hasRead.kvkk_read}
                disabled={loading}
              />
              <ConsentRow
                checked={consents.saglik_veri}
                label="Sağlık verilerimin işlenmesine açık rıza veriyorum"
                onToggle={() => toggleConsent('saglik_veri')}
                onRead={() => setReadingConsent('saglik_veri')}
                hasRead={hasRead.saglik_veri}
                disabled={loading}
              />
              <ConsentRow
                checked={consents.ai_transfer}
                label="AI servisine veri aktarımına rıza veriyorum (opsiyonel)"
                onToggle={() => toggleConsent('ai_transfer')}
                onRead={() => setReadingConsent('ai_transfer')}
                hasRead={hasRead.ai_transfer}
                disabled={loading}
              />
              <ConsentRow
                checked={consents.chat_history}
                label="Sohbet geçmişimin saklanmasına rıza veriyorum"
                onToggle={() => toggleConsent('chat_history')}
                onRead={() => setReadingConsent('chat_history')}
                hasRead={hasRead.chat_history}
                disabled={loading}
              />
              <ConsentRow
                checked={consents.age_18}
                label="18 yaşından büyüğüm"
                onToggle={() => toggleConsent('age_18')}
                readRequired={false}
                disabled={loading}
              />
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={[styles.button, submitDisabled && styles.buttonDisabled]}
              onPress={handleSignUp}
              disabled={submitDisabled}
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
      <LegalDocumentModal
        visible={readingConsent !== null}
        documentId={readingConsent ? CONSENT_DOCUMENTS[readingConsent] : null}
        onClose={() => setReadingConsent(null)}
        onConfirm={confirmConsentRead}
        mode="consent"
      />
    </SafeAreaView>
  );
}

// ─── Stiller ─────────────────────────────────────────────────────────────────

const styles = createStyles(C);

function createStyles(C: ThemeColors) {
  return StyleSheet.create({
  safe:   { flex: 1, backgroundColor: C.bg },
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

  consentBlock: {
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 12,
    marginTop: 4,
    marginBottom: 12,
    gap: 10,
  },
  consentTitle: { color: C.text1, fontSize: 15, fontWeight: '700', marginBottom: 2 },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  consentMain: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  consentMainDisabled: { opacity: 0.48 },
  consentText: { flex: 1, color: C.text2, fontSize: 13, lineHeight: 19 },
  readBtn: { paddingVertical: 2 },
  detailText: { color: C.primary, fontSize: 12, fontWeight: '700' },
  detailTextRead: { color: C.success },

  error: { color: C.error, fontSize: 14, marginBottom: 12 },

  button:         { backgroundColor: C.text1, borderRadius: 10, paddingVertical: 16, alignItems: 'center', marginTop: 12 },
  buttonDisabled: { opacity: 0.7 },
  buttonText:     { color: C.bg, fontSize: 16, fontWeight: '700' },
});
}
