import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { C } from '../theme';

export function ChatFooterNotice() {
  return (
    <View style={styles.box}>
      <Ionicons name="information-circle-outline" size={16} color={C.text3} />
      <Text style={styles.text}>
        BiTanı bilgilendirme amaçlıdır; önemli sağlık kararları için doktor veya eczacınıza danışın.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.bg,
  },
  text: {
    flex: 1,
    color: C.text3,
    fontSize: 12,
    lineHeight: 17,
  },
});
