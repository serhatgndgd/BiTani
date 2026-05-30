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
import { SafeAreaView } from 'react-native-safe-area-context';

import { Wordmark } from '../components/Brand';
import { supabase } from '../lib/supabase';
import type { AuthStackParamList } from '../navigation/types';
import { useTheme } from '../context/ThemeContext';
import { darkTheme as defaultThemeColors, type ThemeColors } from '../theme';

const C = defaultThemeColors;

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

function mapAuthError(error: AuthError): string {
  const raw = (error.message ?? '').toLowerCase();
  if (raw.includes('invalid login') || raw.includes('invalid credentials')) {
    return 'E-posta veya şifre hatalı.';
  }
  if (raw.includes('email not confirmed')) {
    return 'E-posta adresin henüz doğrulanmadı. Gelen kutunu kontrol et.';
  }
  if (raw.includes('too many requests')) {
    return 'Çok fazla deneme yapıldı. Lütfen bir süre sonra tekrar dene.';
  }
  return error.message || 'Giriş yapılamadı. Tekrar dene.';
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
  autoComplete?: 'email' | 'password';
  editable?: boolean;
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
    <Animated.View style={[styles.inputWrap, { borderColor, backgroundColor }]}>
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

export default function LoginScreen({ navigation }: Props) {
  const { colors: C } = useTheme();
  const styles = useMemo(() => createStyles(C), [C]);
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  async function handleSignIn() {
    setError(null);
    const trimmed = email.trim();
    if (!trimmed || !password) {
      setError('E-posta ve şifre gerekli.');
      return;
    }
    setLoading(true);
    try {
      const { error: signError } = await supabase.auth.signInWithPassword({
        email: trimmed,
        password,
      });
      if (signError) {
        setError(mapAuthError(signError));
      }
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

            <Text style={styles.heading}>Giriş Yap</Text>

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
            />

            <Text style={styles.label}>Şifre</Text>
            <FocusInput
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password"
              editable={!loading}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleSignIn}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={C.bg} />
              ) : (
                <Text style={styles.buttonText}>Giriş Yap</Text>
              )}
            </Pressable>

            <Pressable
              style={styles.linkWrap}
              onPress={() => navigation.navigate('Register')}
              disabled={loading}
            >
              <Text style={styles.link}>
                Hesabın yok mu?{' '}
                <Text style={styles.linkBold}>Kayıt Ol</Text>
              </Text>
            </Pressable>

            <Pressable
              style={styles.backWelcome}
              onPress={() => navigation.navigate('Welcome')}
            >
              <Text style={styles.backWelcomeText}>← Ana ekrana dön</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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

  heading: { color: C.text1, fontSize: 24, fontWeight: '700', marginBottom: 24 },

  label: { color: C.text1, fontSize: 14, fontWeight: '500', marginBottom: 8 },

  /* Input kapsayıcısı (Animated.View) */
  inputWrap: {
    borderWidth: 1,
    borderRadius: 10,
    marginBottom: 16,
    overflow: 'hidden',
  },
  inputInner: {
    color: C.text1,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },

  error: { color: C.error, fontSize: 14, marginBottom: 12 },

  button: {
    backgroundColor: C.text1,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText:     { color: C.bg, fontSize: 16, fontWeight: '600' },

  linkWrap: { marginTop: 24, alignItems: 'center' },
  link:     { color: C.text1, fontSize: 15 },
  linkBold: { fontWeight: '700', color: C.primary },

  backWelcome:     { marginTop: 20, alignItems: 'center', paddingVertical: 8 },
  backWelcomeText: { color: C.text3, fontSize: 14 },
});
}
