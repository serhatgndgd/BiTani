import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, Ellipse, Path, RadialGradient, Stop } from 'react-native-svg';

import { Wordmark } from '../components/Brand';
import type { AuthStackParamList } from '../navigation/types';
import { C } from '../theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'Welcome'>;

const { width: SW, height: SH } = Dimensions.get('screen');

// ─── EKG sabitleri ────────────────────────────────────────────────────────────

// P-QRS-T dalgası — viewBox 200×36, baseline y=18
const EKG_PATH =
  'M 0 18 H 35 Q 45 11 55 18 H 80 L 85 24 L 93 2 L 101 34 L 109 10 L 117 18 H 145 Q 158 6 171 18 H 200';

// Yaklaşık path uzunluğu: 285 → 300 ile güvenli marj
const EKG_DASH = 300;

// Animated.createAnimatedComponent ile SVG Path'e animasyon bağlıyoruz
const AnimatedPath = Animated.createAnimatedComponent(Path);

// ─── Ekran ────────────────────────────────────────────────────────────────────

export default function WelcomeScreen({ navigation }: Props) {
  // Giriş animasyonları (native driver)
  const wordmarkAnim = useRef(new Animated.Value(0)).current;
  const sloganAnim   = useRef(new Animated.Value(0)).current;
  const buttonsAnim  = useRef(new Animated.Value(0)).current;

  // EKG stroke-dashoffset animasyonu (SVG prop → native driver kapalı)
  const ekgAnim     = useRef(new Animated.Value(EKG_DASH)).current;
  const ekgLoopRef  = useRef<ReturnType<typeof Animated.loop> | null>(null);

  useEffect(() => {
    // Staggered giriş animasyonları
    Animated.timing(wordmarkAnim, { toValue: 1, duration: 800, useNativeDriver: true }).start();

    const t1 = setTimeout(
      () => Animated.timing(sloganAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start(),
      300,
    );
    const t2 = setTimeout(
      () => Animated.timing(buttonsAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start(),
      600,
    );

    // EKG loop: 300 → -300 (tam çevrim = çiz + sil), loop reset görünmez çünkü
    // her iki uçta da path gizlidir (strokeDasharray "300 300" → offset=±300 = boş)
    const t3 = setTimeout(() => {
      const loop = Animated.loop(
        Animated.timing(ekgAnim, {
          toValue: -EKG_DASH,
          duration: 2400,
          useNativeDriver: false,
        }),
      );
      ekgLoopRef.current = loop;
      loop.start();
    }, 1000);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      ekgLoopRef.current?.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wordmarkScale = wordmarkAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.95, 1],
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>

      {/* ── Arka plan glow ── */}
      <View style={styles.glowContainer} pointerEvents="none">
        <Svg width={SW} height={SH} viewBox={`0 0 ${SW} ${SH}`}>
          <Defs>
            <RadialGradient id="glow" cx="50%" cy="42%" r="55%">
              <Stop offset="0" stopColor={C.primary} stopOpacity="0.15" />
              <Stop offset="1" stopColor={C.primary} stopOpacity="0"   />
            </RadialGradient>
          </Defs>
          <Ellipse cx={SW / 2} cy={SH * 0.42} rx={SW * 0.8} ry={SH * 0.48} fill="url(#glow)" />
        </Svg>
      </View>

      <View style={styles.center}>

        {/* ── Wordmark: fade + scale ── */}
        <Animated.View
          style={{
            opacity: wordmarkAnim,
            transform: [{ scale: wordmarkScale }],
          }}
        >
          <Wordmark height={56} onDark showIcon />
        </Animated.View>

        {/* ── EKG animasyonu ── */}
        <View style={styles.ekgWrap}>
          <Svg width={200} height={36} viewBox="0 0 200 36">
            <AnimatedPath
              d={EKG_PATH}
              stroke={C.primary}
              strokeWidth={1.5}
              strokeOpacity={0.8}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={`${EKG_DASH} ${EKG_DASH}`}
              strokeDashoffset={ekgAnim as unknown as number}
            />
          </Svg>
        </View>

        {/* ── Slogan: 300ms sonra fade ── */}
        <Animated.Text style={[styles.slogan, { opacity: sloganAnim }]}>
          Sağlığın için akıllı asistan
        </Animated.Text>

        {/* ── Butonlar: 600ms sonra fade ── */}
        <Animated.View style={{ opacity: buttonsAnim, width: '100%', alignItems: 'center' }}>
          <Pressable
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            onPress={() => navigation.navigate('Register')}
          >
            <Text style={styles.primaryText}>Başla</Text>
          </Pressable>
          <Pressable style={styles.linkWrap} onPress={() => navigation.navigate('Login')}>
            <Text style={styles.linkText}>Giriş Yap</Text>
          </Pressable>
        </Animated.View>

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  glowContainer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },

  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },

  ekgWrap: {
    marginTop: 12,
    marginBottom: 4,
  },

  slogan: {
    color: C.text2,
    fontSize: 17,
    textAlign: 'center',
    lineHeight: 24,
    marginTop: 10,
    marginBottom: 48,
    maxWidth: 280,
  },

  primary: {
    backgroundColor: C.primary,
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 12,
    minWidth: 220,
    alignItems: 'center',
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  pressed:     { opacity: 0.88 },
  primaryText: { color: C.text1, fontSize: 17, fontWeight: '700' },

  linkWrap: { marginTop: 24, paddingVertical: 10, paddingHorizontal: 16 },
  linkText: { color: C.primary, fontSize: 15, fontWeight: '400' },
});
