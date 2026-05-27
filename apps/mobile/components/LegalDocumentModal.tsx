import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LEGAL_DOCUMENTS, type LegalDocumentId } from '../legal/documents';
import { C } from '../theme';

interface Props {
  visible: boolean;
  documentId: LegalDocumentId | null;
  onClose: () => void;
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
}

export function LegalDocumentModal({
  visible,
  documentId,
  onClose,
  primaryActionLabel,
  onPrimaryAction,
}: Props) {
  const document = documentId ? LEGAL_DOCUMENTS[documentId] : null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.header}>
          <Text style={styles.title}>{document?.title ?? 'Yasal Metin'}</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button">
            <Ionicons name="close" size={24} color={C.text1} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Markdown style={markdownStyles}>{document?.markdown ?? ''}</Markdown>
        </ScrollView>
        {primaryActionLabel ? (
          <View style={styles.footer}>
            <Pressable
              style={styles.primaryButton}
              onPress={onPrimaryAction ?? onClose}
              accessibilityRole="button"
            >
              <Text style={styles.primaryButtonText}>{primaryActionLabel}</Text>
            </Pressable>
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

const markdownStyles = StyleSheet.create({
  body: {
    color: C.text2,
    fontSize: 15,
    lineHeight: 23,
  },
  heading1: {
    color: C.text1,
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '800',
    marginBottom: 16,
  },
  heading2: {
    color: C.text1,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '700',
    marginTop: 14,
    marginBottom: 8,
  },
  heading3: {
    color: C.text1,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '700',
    marginTop: 10,
    marginBottom: 6,
  },
  bullet_list: {
    marginBottom: 10,
  },
  list_item: {
    color: C.text2,
  },
  strong: {
    color: C.text1,
    fontWeight: '800',
  },
  paragraph: {
    marginBottom: 10,
  },
});

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  title: {
    flex: 1,
    color: C.text1,
    fontSize: 18,
    fontWeight: '700',
    marginRight: 12,
  },
  content: {
    padding: 18,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  primaryButton: {
    backgroundColor: C.text1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: C.bg,
    fontSize: 15,
    fontWeight: '700',
  },
});
