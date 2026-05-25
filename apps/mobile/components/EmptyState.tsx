import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { C } from '../theme';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

interface EmptyStateProps {
  icon?: IoniconsName;
  title: string;
  subtitle?: string;
  paddingTop?: number;
}

export function EmptyState({
  icon = 'search-outline',
  title,
  subtitle,
  paddingTop = 60,
}: EmptyStateProps) {
  return (
    <View style={[styles.wrap, { paddingTop }]}>
      <Ionicons name={icon} size={44} color={C.border} />
      <Text style={styles.title}>{title}</Text>
      {subtitle != null && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:     { alignItems: 'center', gap: 10 },
  title:    { color: C.text3, fontSize: 15, fontWeight: '600' },
  subtitle: { color: C.text3, fontSize: 13, textAlign: 'center', lineHeight: 20, opacity: 0.7 },
});
