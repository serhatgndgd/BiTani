import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { AuthStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Welcome'>;

export default function WelcomeScreen({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.center}>
        <Text style={styles.logo}>BiTanı</Text>
        <Text style={styles.slogan}>Sağlığın için akıllı asistan</Text>
        <Pressable
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          onPress={() => navigation.navigate('Register')}
        >
          <Text style={styles.primaryText}>Başla</Text>
        </Pressable>
        <Pressable style={styles.linkWrap} onPress={() => navigation.navigate('Login')}>
          <Text style={styles.linkBold}>Giriş Yap</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  logo: {
    color: '#ffffff',
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: -1,
    marginBottom: 12,
  },
  slogan: {
    color: '#a3a3a3',
    fontSize: 17,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 48,
    maxWidth: 280,
  },
  primary: {
    backgroundColor: '#ffffff',
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 12,
    minWidth: 220,
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.88,
  },
  primaryText: {
    color: '#0a0a0a',
    fontSize: 17,
    fontWeight: '700',
  },
  linkWrap: {
    marginTop: 24,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  linkBold: {
    color: '#8ab4ff',
    fontSize: 16,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
