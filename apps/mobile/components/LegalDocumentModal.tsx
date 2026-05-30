import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import Markdown from 'react-native-markdown-display';
import {
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { LEGAL_DOCUMENTS, type LegalDocumentId } from '../legal/documents';
import { C } from '../theme';

interface Props {
  visible: boolean;
  documentId: LegalDocumentId | null;
  onClose: () => void;
  onConfirm?: () => void;
  mode?: 'consent' | 'view';
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
}

export function LegalDocumentModal({
  visible,
  documentId,
  onClose,
  onConfirm,
  mode = 'view',
  primaryActionLabel,
  onPrimaryAction,
}: Props) {
  const insets = useSafeAreaInsets();
  const document = documentId ? LEGAL_DOCUMENTS[documentId] : null;
  const isConsentMode = mode === 'consent';
  const [reachedBottom, setReachedBottom] = useState(false);
  const [progress, setProgress] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const markdown = useMemo(
    () => (document?.markdown ?? '').replace(/^#\s+.+\n+/, ''),
    [document?.markdown],
  );

  useEffect(() => {
    if (visible) {
      setReachedBottom(false);
      setProgress(0);
      setContentHeight(0);
      setViewportHeight(0);
    }
  }, [visible, documentId]);

  useEffect(() => {
    if (visible && isConsentMode && contentHeight > 0 && viewportHeight > 0) {
      updateProgress(contentHeight, viewportHeight, 0);
    }
  }, [contentHeight, isConsentMode, visible, viewportHeight]);

  function updateProgress(contentHeight: number, viewportHeight: number, offsetY: number) {
    const scrollable = contentHeight - viewportHeight;
    const pct = scrollable <= 0 ? 100 : Math.min(100, Math.max(0, (offsetY / scrollable) * 100));
    setProgress(pct);
    if (pct >= 98) setReachedBottom(true);
  }

  function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    updateProgress(contentSize.height, layoutMeasurement.height, contentOffset.y);
  }

  function handleConfirm() {
    onConfirm?.();
    onClose();
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent={false}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
        <View style={[styles.header, { paddingTop: Math.max(insets.top + 8, 20) }]}>
          <Text style={styles.title}>{document?.title ?? 'Yasal Metin'}</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button">
            <Ionicons name="close" size={24} color={C.text1} />
          </Pressable>
        </View>
        {isConsentMode ? (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress}%` as `${number}%` }]} />
          </View>
        ) : null}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          onScroll={isConsentMode ? handleScroll : undefined}
          onLayout={
            isConsentMode ? (e) => setViewportHeight(e.nativeEvent.layout.height) : undefined
          }
          onContentSizeChange={
            isConsentMode ? (_width, height) => setContentHeight(height) : undefined
          }
          scrollEventThrottle={16}
        >
          <Markdown style={markdownStyles}>{markdown}</Markdown>
        </ScrollView>
        {isConsentMode ? (
          <View style={styles.footer}>
            {reachedBottom ? (
              <Pressable
                style={styles.consentButton}
                onPress={handleConfirm}
                accessibilityRole="button"
              >
                <Text style={styles.consentButtonText}>Okudum, Onaylıyorum</Text>
              </Pressable>
            ) : (
              <View style={styles.readHint}>
                <Ionicons name="arrow-down" size={16} color={C.text2} />
                <Text style={styles.readHintText}>Onaylamak için metni sonuna kadar okuyun</Text>
              </View>
            )}
          </View>
        ) : primaryActionLabel ? (
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
  scroll: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 14,
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
    padding: 20,
    paddingTop: 24,
    paddingBottom: 96,
  },
  progressTrack: {
    height: 3,
    backgroundColor: C.border,
  },
  progressFill: {
    height: 3,
    backgroundColor: C.primary,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.bg,
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
  readHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  readHintText: {
    color: C.text2,
    fontSize: 13,
  },
  consentButton: {
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  consentButtonText: {
    color: C.text1,
    fontSize: 15,
    fontWeight: '700',
  },
});
