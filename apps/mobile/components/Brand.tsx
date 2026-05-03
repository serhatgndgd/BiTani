import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

const BRAND = {
  blue: '#1a6ef5',
  blueDeep: '#0d4fcc',
  ink: '#0a0a0a',
  white: '#ffffff',
  mute: '#8a8f98',
};

// ---------- Icon Mark ----------

interface IconMarkProps {
  size?: number;
  bg?: string;
  stroke?: string;
  radius?: number;
}

export function IconMark({ size = 1024, bg = BRAND.blue, stroke = BRAND.white, radius = 0.225 }: IconMarkProps) {
  const r = size * radius;
  const pad = size * 0.16;
  const cy = size * 0.52;
  const x0 = pad;
  const x1 = size - pad;
  const w = x1 - x0;
  const seg = w / 16;

  const ekgPath = [
    `M ${x0} ${cy}`,
    `H ${x0 + seg * 2}`,
    `q ${seg * 0.5} ${-seg * 0.6} ${seg} 0`,
    `H ${x0 + seg * 5}`,
    `l ${seg * 0.6} ${seg * 0.5}`,
    `l ${seg * 0.5} ${-seg * 3.0}`,
    `l ${seg * 0.7} ${seg * 4.5}`,
    `l ${seg * 0.6} ${-seg * 2.0}`,
    `l ${seg * 0.6} 0`,
    `H ${x0 + seg * 11}`,
    `q ${seg * 0.75} ${-seg * 1.1} ${seg * 1.5} 0`,
    `H ${x1}`,
  ].join(' ');

  const sw = size * 0.052;
  const bgId = `bg-${size}`;
  const sheenId = `sheen-${size}`;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Defs>
        <LinearGradient id={bgId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={bg} stopOpacity="1" />
          <Stop offset="1" stopColor={bg} stopOpacity="0.92" />
        </LinearGradient>
        <RadialGradient id={sheenId} cx="0.3" cy="0.15" r="0.9">
          <Stop offset="0" stopColor="#ffffff" stopOpacity="0.10" />
          <Stop offset="0.6" stopColor="#ffffff" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width={size} height={size} rx={r} ry={r} fill={`url(#${bgId})`} />
      <Rect x="0" y="0" width={size} height={size} rx={r} ry={r} fill={`url(#${sheenId})`} />
      <Path
        d={ekgPath}
        fill="none"
        stroke={stroke}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={x1} cy={cy} r={size * 0.022} fill={stroke} />
    </Svg>
  );
}

// ---------- Wordmark ----------

interface WordmarkProps {
  height?: number;
  onDark?: boolean;
  showIcon?: boolean;
}

export function Wordmark({ height = 48, onDark = true, showIcon = true }: WordmarkProps) {
  const iconSize = height;
  const fontSize = height * 0.7;
  const color = onDark ? BRAND.white : BRAND.ink;
  const gap = height * 0.22;

  return (
    <View style={[styles.wordmarkRow, { gap }]}>
      {showIcon && (
        <View style={[styles.iconWrap, { width: iconSize, height: iconSize, borderRadius: iconSize * 0.225 }]}>
          <IconMark size={iconSize} bg={BRAND.blue} stroke={BRAND.white} />
        </View>
      )}
      <View style={styles.textRow}>
        <Text style={[styles.light, { fontSize, color }]}>Bi</Text>
        <Text style={[styles.bold, { fontSize, color }]}>Tanı</Text>
      </View>
    </View>
  );
}

// ---------- Splash Screen ----------

export function SplashBrand() {
  return (
    <View style={styles.splashCenter}>
      <View style={styles.splashIconWrap}>
        <IconMark size={132} bg={BRAND.blue} stroke={BRAND.white} />
      </View>
      <View style={[styles.textRow, { marginTop: 28 }]}>
        <Text style={[styles.light, { fontSize: 42, color: BRAND.white }]}>Bi</Text>
        <Text style={[styles.bold, { fontSize: 42, color: BRAND.white }]}>Tanı</Text>
      </View>
      <Text style={styles.tagline}>Sağlığın için akıllı asistan</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wordmarkRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWrap: {
    overflow: 'hidden',
  },
  textRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  light: {
    fontWeight: '300',
    letterSpacing: -1,
    lineHeight: undefined,
  },
  bold: {
    fontWeight: '700',
    letterSpacing: -1,
    lineHeight: undefined,
  },
  splashCenter: {
    alignItems: 'center',
  },
  splashIconWrap: {
    width: 132,
    height: 132,
    borderRadius: 30,
    overflow: 'hidden',
  },
  tagline: {
    marginTop: 12,
    fontSize: 15,
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: -0.1,
    textAlign: 'center',
    maxWidth: 280,
  },
});
