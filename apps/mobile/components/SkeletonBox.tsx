import { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, type ViewStyle } from 'react-native';

import { useTheme } from '../context/ThemeContext';
import type { ThemeColors } from '../theme';

interface SkeletonBoxProps {
  width?: ViewStyle['width'];
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function SkeletonBox({
  width = '100%',
  height = 16,
  borderRadius = 6,
  style,
}: SkeletonBoxProps) {
  const { colors: C } = useTheme();
  const styles = useMemo(() => createStyles(C), [C]);
  const anim = useRef(new Animated.Value(0.25)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 0.65, duration: 750, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.25, duration: 750, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      style={[
        styles.base,
        { width, height, borderRadius, opacity: anim } as ViewStyle,
        style,
      ]}
    />
  );
}

function createStyles(C: ThemeColors) {
  return StyleSheet.create({
  base: { backgroundColor: C.border },
});
}
