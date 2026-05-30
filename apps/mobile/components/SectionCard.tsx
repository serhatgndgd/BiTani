import { Ionicons } from '@expo/vector-icons';
import { useMemo, type ReactNode } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { useTheme } from '../context/ThemeContext';
import type { ThemeColors } from '../theme';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

interface SectionCardProps {
  icon?: IoniconsName;
  title: string;
  count?: number;
  children: ReactNode;
  style?: ViewStyle;
}

export function SectionCard({ icon, title, count, children, style }: SectionCardProps) {
  const { colors: C } = useTheme();
  const styles = useMemo(() => createStyles(C), [C]);
  return (
    <View style={[styles.card, style]}>
      <View style={styles.header}>
        {icon != null && <Ionicons name={icon} size={17} color={C.text3} />}
        <Text style={styles.title}>{title.toLocaleUpperCase('tr-TR')}</Text>
        {count !== undefined && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{count}</Text>
          </View>
        )}
      </View>
      {children}
    </View>
  );
}

function createStyles(C: ThemeColors) {
  return StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 14,
  },
  title: {
    color: C.text3,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    flex: 1,
  },
  badge:     { backgroundColor: C.surfaceAlt, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { color: C.text3, fontSize: 12, fontWeight: '600' },
});
}
