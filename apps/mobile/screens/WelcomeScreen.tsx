import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef } from 'react';
import { Animated, Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';

import { Wordmark } from '../components/Brand';
import type { AuthStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Welcome'>;

const { width: SW, height: SH } = Dimensions.get('screen');

export default function WelcomeScreen({ navigation }: Props) {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 900,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.glowContainer} pointerEvents="none">
        <Svg width={SW} height={SH} viewBox={`0 0 ${SW} ${SH}`}>
          <Defs>
            <RadialGradient id="glow" cx="50%" cy="42%" r="55%">
              <Stop offset="0" stopColor="#1a6ef5" stopOpacity="0.15" />
              <Stop offset="1" stopColor="#1a6ef5" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Ellipse
            cx={SW / 2}
            cy={SH * 0.42}
            rx={SW * 0.8}
            ry={SH * 0.48}
            fill="url(#glow)"
          />
        </Svg>
      </View>

      <View style={styles.center}>
        <Animated.View style={{ opacity: fadeAnim }}>
          <Wordmark height={56} onDark showIcon />
        </Animated.View>
        <Text style={styles.slogan}>Sağlığın için akıllı asistan</Text>
        <Pressable
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          onPress={() => navigation.navigate('Register')}
        >
          <Text style={styles.primaryText}>Başla</Text>
        </Pressable>
        <Pressable style={styles.linkWrap} onPress={() => navigation.navigate('Login')}>
          <Text style={styles.linkText}>Giriş Yap</Text>
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
  glowContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  slogan: {
    color: '#a3a3a3',
    fontSize: 17,
    textAlign: 'center',
    lineHeight: 24,
    marginTop: 14,
    marginBottom: 48,
    maxWidth: 280,
  },
  primary: {
    backgroundColor: '#1a6ef5',
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 12,
    minWidth: 220,
    alignItems: 'center',
    shadowColor: '#1a6ef5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  pressed: {
    opacity: 0.88,
  },
  primaryText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  linkWrap: {
    marginTop: 24,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  linkText: {
    color: '#8ab4ff',
    fontSize: 15,
    fontWeight: '400',
  },
});
