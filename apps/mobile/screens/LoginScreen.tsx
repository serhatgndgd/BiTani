import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthError } from '@supabase/supabase-js';
import { useState } from 'react';
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

import { Wordmark } from '../components/Brand';
import { supabase } from '../lib/supabase';
import type { AuthStackParamList } from '../navigation/types';

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

export default function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
            placeholder="••••••••"
            placeholderTextColor="#888"
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
              <ActivityIndicator color="#0a0a0a" />
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
              Hesabın yok mu? <Text style={styles.linkBold}>Kayıt Ol</Text>
            </Text>
          </Pressable>
          <Pressable style={styles.backWelcome} onPress={() => navigation.navigate('Welcome')}>
            <Text style={styles.backWelcomeText}>← Ana ekrana dön</Text>
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
    fontSize: 24,
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
    marginBottom: 16,
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
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#0a0a0a',
    fontSize: 16,
    fontWeight: '600',
  },
  linkWrap: {
    marginTop: 24,
    alignItems: 'center',
  },
  link: {
    color: '#ffffff',
    fontSize: 15,
  },
  linkBold: {
    fontWeight: '700',
    color: '#8ab4ff',
  },
  backWelcome: {
    marginTop: 20,
    alignItems: 'center',
    paddingVertical: 8,
  },
  backWelcomeText: {
    color: '#666',
    fontSize: 14,
  },
});
