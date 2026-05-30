import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LegalDocumentModal } from '../components/LegalDocumentModal';
import { supabase } from '../lib/supabase';
import type { MainTabParamList } from '../navigation/types';
import { useTheme } from '../context/ThemeContext';
import { darkTheme as defaultThemeColors, type ThemeColors } from '../theme';

const C = defaultThemeColors;

// ─── Tipler ───────────────────────────────────────────────────────────────────

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
};

type ChatNavProp = BottomTabNavigationProp<MainTabParamList, 'Chat'>;

type ProfileRow = {
  full_name: string | null;
  name?: string | null;
};

type UserConditionRow = {
  conditions_catalog: { name: string } | { name: string }[] | null;
};

type ChatHistoryRow = {
  id: string;
  role: string;
  content: string;
  created_at: string;
  session_id: string | null;
  title: string | null;
  updated_at: string | null;
};

type ChatSessionSummary = {
  sessionId: string;
  title: string;
  updatedAt: string;
};

const CHAT_ERROR_NETWORK = 'İnternet bağlantınızı kontrol edin';
const CHAT_ERROR_SERVER = 'Asistan şu an yanıt veremiyor';
const CHAT_ERROR_GENERIC = 'Bir sorun oluştu, tekrar deneyin';
const CHAT_DISCLAIMER_ACCEPTED_KEY = 'chat_disclaimer_v1_accepted';
const DEFAULT_WELCOME_MESSAGE =
  'Merhaba! Ben BiTanı sağlık bilgi rehberiyim. Sağlıkla ilgili sorularında yardımcı olmaya hazırım.';

function mapChatError(error: unknown): string {
  if (!(error instanceof Error)) return CHAT_ERROR_GENERIC;
  const msg = error.message.toLowerCase();
  if (
    msg.includes('network') ||
    msg.includes('failed to fetch') ||
    msg.includes('request failed') ||
    msg.includes('timeout')
  ) {
    return CHAT_ERROR_NETWORK;
  }
  if (
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('server') ||
    msg.includes('edge function') ||
    msg.includes('function')
  ) {
    return CHAT_ERROR_SERVER;
  }
  return CHAT_ERROR_GENERIC;
}

// ─── Markdown parser ──────────────────────────────────────────────────────────

type Segment  = { text: string; bold: boolean; italic: boolean };
type MdLine   =
  | { kind: 'empty' }
  | { kind: 'list';  segments: Segment[] }
  | { kind: 'text';  segments: Segment[] };

function parseInline(raw: string): Segment[] {
  const segs: Segment[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let pos = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (m.index > pos) segs.push({ text: raw.slice(pos, m.index), bold: false, italic: false });
    if (m[1] !== undefined) segs.push({ text: m[1], bold: true,  italic: false });
    else if (m[2] !== undefined) segs.push({ text: m[2], bold: false, italic: true  });
    pos = m.index + m[0].length;
  }
  if (pos < raw.length) segs.push({ text: raw.slice(pos), bold: false, italic: false });
  return segs.length ? segs : [{ text: raw, bold: false, italic: false }];
}

function parseMd(text: string): MdLine[] {
  return text.split('\n').map((line): MdLine => {
    if (line.trim() === '') return { kind: 'empty' };
    const listM = line.match(/^(\s*)(•|-|\d+\.) (.+)/);
    if (listM) return { kind: 'list', segments: parseInline(listM[3]) };
    return { kind: 'text', segments: parseInline(line) };
  });
}

// ─── Yardımcı ─────────────────────────────────────────────────────────────────

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function fmtSessionDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function createSessionId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function welcomeMessage(content: string): Message {
  return { id: 'welcome', role: 'assistant', content, ts: Date.now() };
}

function titleFromMessage(text: string): string {
  return text.trim().slice(0, 40) || 'Yeni sohbet';
}

function firstConditionName(row: UserConditionRow): string | null {
  if (Array.isArray(row.conditions_catalog)) {
    return row.conditions_catalog[0]?.name ?? null;
  }
  return row.conditions_catalog?.name ?? null;
}

function buildWelcomeMessage(profile: ProfileRow | null, conditions: string[]): string {
  const fullName = (profile?.full_name ?? profile?.name ?? '').trim();
  const firstName = fullName.split(/\s+/)[0] ?? '';
  const prefix = firstName ? `Merhaba ${firstName}!` : 'Merhaba!';

  if (conditions.length > 0) {
    return `${prefix} Ben BiTanı sağlık asistanınım. Kayıtlı hastalıklarını ve ilaçlarını bilerek sana daha doğru bilgi verebilirim. Sağlıkla ilgili bir şikayet veya sorun var mı?`;
  }

  return `${prefix} Ben BiTanı sağlık asistanınım. Sağlıkla ilgili sorularında yardımcı olmaya hazırım. Bir şikayetin veya sorun var mı?`;
}

// ─── Alt bileşenler ───────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const { colors: C } = useTheme();
  const styles = useMemo(() => createStyles(C), [C]);
  const isUser = message.role === 'user';

  // Kullanıcı: düz metin; asistan: markdown
  const content = isUser ? (
    <Text style={[styles.bubbleText, styles.bubbleTextUser]}>{message.content}</Text>
  ) : (
    parseMd(message.content).map((line, i) => {
      if (line.kind === 'empty') return <View key={i} style={styles.mdGap} />;

      const inlineNodes = line.segments.map((seg, j) => (
        <Text
          key={j}
          style={[
            seg.bold   ? styles.mdBold   : undefined,
            seg.italic ? styles.mdItalic : undefined,
          ]}
        >
          {seg.text}
        </Text>
      ));

      if (line.kind === 'list') {
        return (
          <View key={i} style={styles.mdListRow}>
            <Text style={styles.mdBullet}>{'• '}</Text>
            <Text style={[styles.bubbleText, styles.mdListBody]}>{inlineNodes}</Text>
          </View>
        );
      }
      return <Text key={i} style={styles.bubbleText}>{inlineNodes}</Text>;
    })
  );

  return (
    <View style={[styles.bubbleRow, isUser && styles.bubbleRowUser]}>
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        {content}
        {/* Timestamp — sağ alt (standart mesajlaşma UX) */}
        <Text style={styles.bubbleTs}>
          {fmtTime(message.ts)}
        </Text>
      </View>
    </View>
  );
}

function TypingIndicator() {
  const { colors: C } = useTheme();
  const styles = useMemo(() => createStyles(C), [C]);
  return (
    <View style={styles.bubbleRow}>
      <View style={[styles.bubble, styles.bubbleAssistant, styles.typingBubble]}>
        <ActivityIndicator size="small" color={C.text3} />
      </View>
    </View>
  );
}

function ChatHistoryRowItem({
  item,
  onPress,
  onLongPress,
}: {
  item: ChatSessionSummary;
  onPress: (sessionId: string) => void;
  onLongPress: (session: ChatSessionSummary) => void;
}) {
  const { colors: C } = useTheme();
  const styles = useMemo(() => createStyles(C), [C]);
  return (
    <Pressable
      style={({ pressed }) => [styles.historyRow, pressed && { opacity: 0.72 }]}
      onPress={() => onPress(item.sessionId)}
      onLongPress={() => onLongPress(item)}
    >
      <View style={styles.historyRowText}>
        <Text style={styles.historyTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.historyDate}>{fmtSessionDate(item.updatedAt)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={C.text3} />
    </Pressable>
  );
}

// ─── Ana bileşen ──────────────────────────────────────────────────────────────

export default function ChatScreen() {
  const { colors: C } = useTheme();
  const styles = useMemo(() => createStyles(C), [C]);
  const navigation = useNavigation<ChatNavProp>();

  const [loadingProfile, setLoadingProfile] = useState(true);
  const [welcomeText, setWelcomeText]       = useState(DEFAULT_WELCOME_MESSAGE);
  const [messages, setMessages]             = useState<Message[]>([welcomeMessage(DEFAULT_WELCOME_MESSAGE)]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessions, setSessions]             = useState<ChatSessionSummary[]>([]);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [input, setInput]                   = useState('');
  const [sending, setSending]               = useState(false);
  const [sendError, setSendError]           = useState<string | null>(null);
  const [showEmergency, setShowEmergency]   = useState(false);
  const [dismissedEmergencySessionIds, setDismissedEmergencySessionIds] = useState<Set<string>>(new Set());
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);

  const loadSessions = useCallback(async (userId: string): Promise<ChatSessionSummary[]> => {
    const { data, error } = await supabase
      .from('chat_history')
      .select('session_id, title, updated_at, created_at')
      .eq('user_id', userId)
      .not('session_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(500);

    if (error) throw error;

    const summaries = new Map<string, ChatSessionSummary>();
    for (const row of (data ?? []) as Pick<ChatHistoryRow, 'session_id' | 'title' | 'updated_at' | 'created_at'>[]) {
      if (!row.session_id || summaries.has(row.session_id)) continue;
      summaries.set(row.session_id, {
        sessionId: row.session_id,
        title: row.title?.trim() || 'Yeni sohbet',
        updatedAt: row.updated_at ?? row.created_at,
      });
    }
    return [...summaries.values()];
  }, []);

  const loadSessionMessages = useCallback(async (sessionId: string): Promise<Message[]> => {
    const { data, error } = await supabase
      .from('chat_history')
      .select('id, role, content, created_at, session_id, title, updated_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    return ((data ?? []) as ChatHistoryRow[])
      .filter((row) => row.role === 'user' || row.role === 'assistant')
      .map((row) => ({
        id: row.id,
        role: row.role as 'user' | 'assistant',
        content: row.content,
        ts: new Date(row.created_at).getTime(),
      }));
  }, []);

  const loadInitialChat = useCallback(async () => {
    setLoadingProfile(true);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user?.id) {
      setActiveSessionId(createSessionId());
      setMessages([welcomeMessage(DEFAULT_WELCOME_MESSAGE)]);
      setLoadingProfile(false);
      return;
    }

    try {
      const [profileRes, conditionsRes, sessionSummaries] = await Promise.all([
        supabase
          .from('profiles')
          .select('full_name')
          .eq('id', user.id)
          .maybeSingle(),
        supabase
          .from('user_conditions')
          .select('conditions_catalog(name)')
          .eq('user_id', user.id),
        loadSessions(user.id),
      ]);

      const conditions = ((conditionsRes.data ?? []) as UserConditionRow[])
        .map(firstConditionName)
        .filter((name): name is string => !!name);
      const greeting = buildWelcomeMessage((profileRes.data as ProfileRow | null) ?? null, conditions);
      setWelcomeText(greeting);
      setSessions(sessionSummaries);

      const latestSession = sessionSummaries[0];
      if (latestSession) {
        const sessionMessages = await loadSessionMessages(latestSession.sessionId);
        setActiveSessionId(latestSession.sessionId);
        setMessages(sessionMessages.length > 0 ? sessionMessages : [welcomeMessage(greeting)]);
      } else {
        setActiveSessionId(createSessionId());
        setMessages([welcomeMessage(greeting)]);
      }
    } catch (error) {
      console.error('chat-welcome:', error);
      setActiveSessionId(createSessionId());
      setMessages([welcomeMessage(DEFAULT_WELCOME_MESSAGE)]);
    } finally {
      setLoadingProfile(false);
    }
  }, [loadSessionMessages, loadSessions]);

  useEffect(() => { void loadInitialChat(); }, [loadInitialChat]);

  useEffect(() => {
    let mounted = true;
    async function loadDisclaimerState() {
      try {
        const accepted = await AsyncStorage.getItem(CHAT_DISCLAIMER_ACCEPTED_KEY);
        if (mounted) setShowDisclaimer(accepted !== 'true');
      } catch (error) {
        console.error('chat-disclaimer:', error);
        if (mounted) setShowDisclaimer(true);
      }
    }
    void loadDisclaimerState();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (messages.length === 0) return;
    const timer = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(timer);
  }, [messages, sending]);

  const keyExtractor = useCallback((item: Message) => item.id, []);

  const renderMessage = useCallback(
    ({ item }: { item: Message }) => <MessageBubble message={item} />,
    [],
  );

  const renderListFooter = useCallback(() => {
    if (!sending && !sendError) return null;
    return (
      <>
        {sending && <TypingIndicator />}
        {sendError && <Text style={styles.errorText}>{sendError}</Text>}
      </>
    );
  }, [sending, sendError]);

  const acceptDisclaimer = useCallback(async () => {
    try {
      await AsyncStorage.setItem(CHAT_DISCLAIMER_ACCEPTED_KEY, 'true');
    } catch (error) {
      console.error('chat-disclaimer-accept:', error);
    } finally {
      setShowDisclaimer(false);
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return;
    const nextSessions = await loadSessions(user.id);
    setSessions(nextSessions);
  }, [loadSessions]);

  const startNewChat = useCallback(() => {
    Keyboard.dismiss();
    setActiveSessionId(createSessionId());
    setMessages([welcomeMessage(welcomeText)]);
    setInput('');
    setSendError(null);
    setShowEmergency(false);
    setHistoryVisible(false);
  }, [welcomeText]);

  const dismissEmergency = useCallback(() => {
    if (activeSessionId) {
      setDismissedEmergencySessionIds((prev) => {
        const next = new Set(prev);
        next.add(activeSessionId);
        return next;
      });
    }
    setShowEmergency(false);
  }, [activeSessionId]);

  const openHistory = useCallback(() => {
    setHistoryVisible(true);
    setHistoryLoading(true);
    void refreshSessions().finally(() => setHistoryLoading(false));
  }, [refreshSessions]);

  const selectSession = useCallback(async (sessionId: string) => {
    setHistoryLoading(true);
    try {
      const sessionMessages = await loadSessionMessages(sessionId);
      setActiveSessionId(sessionId);
      setMessages(sessionMessages.length > 0 ? sessionMessages : [welcomeMessage(welcomeText)]);
      setSendError(null);
      setShowEmergency(false);
      setHistoryVisible(false);
    } catch (error) {
      console.error('chat-history-load:', error);
      setSendError(CHAT_ERROR_GENERIC);
    } finally {
      setHistoryLoading(false);
    }
  }, [loadSessionMessages, welcomeText]);

  const deleteSession = useCallback((session: ChatSessionSummary) => {
    Alert.alert(
      'Sohbeti Sil',
      `"${session.title}" sohbetini silmek istediğine emin misin?`,
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Sil',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const { data: { user } } = await supabase.auth.getUser();
              if (!user?.id) return;
              const { error } = await supabase
                .from('chat_history')
                .delete()
                .eq('user_id', user.id)
                .eq('session_id', session.sessionId);
              if (error) {
                console.error('chat-history-delete:', error);
                setSendError(CHAT_ERROR_GENERIC);
                return;
              }
              await refreshSessions();
              if (activeSessionId === session.sessionId) {
                startNewChat();
              }
            })();
          },
        },
      ],
    );
  }, [activeSessionId, refreshSessions, startNewChat]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <Pressable onPress={openHistory} hitSlop={10} style={styles.headerIconBtn}>
          <Ionicons name="list-outline" size={22} color={C.text1} />
        </Pressable>
      ),
      headerRight: () => (
        <Pressable onPress={startNewChat} hitSlop={10} style={styles.headerIconBtn}>
          <Ionicons name="create-outline" size={22} color={C.text1} />
        </Pressable>
      ),
    });
  }, [navigation, openHistory, startNewChat]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending || loadingProfile) return;

    setInput('');
    setSendError(null);

    const msgId = Date.now().toString();
    const sessionId = activeSessionId ?? createSessionId();
    const hasUserMessage = messages.some((message) => message.role === 'user');
    const existingSession = sessions.find((session) => session.sessionId === sessionId);
    const title = hasUserMessage ? existingSession?.title ?? titleFromMessage(text) : titleFromMessage(text);
    if (!activeSessionId) setActiveSessionId(sessionId);
    setMessages((prev) => [...prev, { id: msgId, role: 'user', content: text, ts: Date.now() }]);

    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Oturum doğrulanamadı.');

      // Edge function sadece son mesajı kullanıyor; geçmiş DB'den çekiliyor.
      // Büyüyen apiMessages array'i yerine tek elemanlı array gönder.
      const { data, error } = await supabase.functions.invoke('chat', {
        body: {
          messages: [{ role: 'user', content: text }],
          session_id: sessionId,
          title,
        },
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      if (error) throw error;

      const payload = data as { reply: string; is_emergency?: boolean };
      const reply = payload.reply;
      if (!reply) throw new Error('server-empty-reply');

      setMessages((prev) => [...prev, { id: `${msgId}-a`, role: 'assistant', content: reply, ts: Date.now() }]);
      void refreshSessions();

      const dismissedForSession = dismissedEmergencySessionIds.has(sessionId);
      setShowEmergency(payload.is_emergency === true && !dismissedForSession);
    } catch (error) {
      console.error('chat-screen:', error);
      setSendError(mapChatError(error));
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
      setInput(text);
    } finally {
      setSending(false);
    }
  }, [
    activeSessionId,
    dismissedEmergencySessionIds,
    input,
    loadingProfile,
    messages,
    refreshSessions,
    sending,
    sessions,
  ]);

  if (loadingProfile) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <FlatList
          ref={listRef}
          data={messages}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          keyExtractor={keyExtractor}
          renderItem={renderMessage}
          ListFooterComponent={renderListFooter}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onScrollBeginDrag={Keyboard.dismiss}
        />

        {showEmergency && (
          <View style={styles.emergencyCard}>
            <Ionicons name="medical-outline" size={18} color={C.error} />
            <Text style={styles.emergencyCardText}>Yakında destek gerekebilir.</Text>
            <Pressable
              style={({ pressed }) => [styles.emergencyAction, pressed && { opacity: 0.75 }]}
              onPress={() => navigation.navigate('Nearby')}
            >
              <Text style={styles.emergencyActionText}>Eczane / Hastane</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.emergencyDismiss, pressed && { opacity: 0.6 }]}
              onPress={dismissEmergency}
              hitSlop={8}
            >
              <Ionicons name="close" size={16} color={C.text3} />
            </Pressable>
          </View>
        )}

        <View style={styles.inputRow}>
          <TextInput
            style={styles.textInput}
            value={input}
            onChangeText={setInput}
            placeholder="Mesajınızı yazın..."
            placeholderTextColor={C.text3}
            returnKeyType="send"
            submitBehavior="submit"
            onSubmitEditing={() => void send()}
            editable={!sending}
          />
          <Pressable
            style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
            onPress={() => void send()}
            disabled={!input.trim() || sending}
          >
            <Ionicons name="arrow-up" size={20} color={C.bg} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
      <LegalDocumentModal
        visible={showDisclaimer}
        documentId="sorumluluk_reddi"
        onClose={acceptDisclaimer}
        primaryActionLabel="Okudum ve Kabul Ediyorum"
        onPrimaryAction={acceptDisclaimer}
      />
      <Modal
        visible={historyVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setHistoryVisible(false)}
      >
        <SafeAreaView style={styles.historyModal} edges={['top', 'bottom', 'left', 'right']}>
          <View style={styles.historyHeader}>
            <Text style={styles.historyHeaderTitle}>Sohbet Geçmişi</Text>
            <Pressable onPress={() => setHistoryVisible(false)} hitSlop={10}>
              <Ionicons name="close" size={24} color={C.text1} />
            </Pressable>
          </View>
          {historyLoading ? (
            <View style={styles.historyCenter}>
              <ActivityIndicator color={C.primary} />
            </View>
          ) : sessions.length === 0 ? (
            <View style={styles.historyCenter}>
              <Ionicons name="chatbubble-ellipses-outline" size={34} color={C.text3} />
              <Text style={styles.historyEmptyTitle}>Henüz sohbet yok</Text>
              <Text style={styles.historyEmptyText}>İlk mesajını gönderdiğinde burada görünecek.</Text>
            </View>
          ) : (
            <FlatList
              data={sessions}
              keyExtractor={(item) => item.sessionId}
              contentContainerStyle={styles.historyList}
              renderItem={({ item }) => (
                <ChatHistoryRowItem
                  item={item}
                  onPress={(sessionId) => void selectSession(sessionId)}
                  onLongPress={deleteSession}
                />
              )}
            />
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Stiller ─────────────────────────────────────────────────────────────────

const styles = createStyles(C);

function createStyles(C: ThemeColors) {
  return StyleSheet.create({
  safe:   { flex: 1, backgroundColor: C.bg },
  flex:   { flex: 1 },
  center: { flex: 1, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' },
  headerIconBtn: { paddingHorizontal: 14, paddingVertical: 6 },

  list:        { flex: 1 },
  listContent: { padding: 12, paddingBottom: 8, gap: 2 },

  bubbleRow:     { flexDirection: 'row', marginBottom: 10, justifyContent: 'flex-start' },
  bubbleRowUser: { justifyContent: 'flex-end' },

  bubble: {
    maxWidth: '78%', borderRadius: 18,
    paddingVertical: 10, paddingHorizontal: 14,
  },
  bubbleAssistant: { backgroundColor: C.surface, borderBottomLeftRadius: 4 },
  bubbleUser:      { backgroundColor: C.primary,  borderBottomRightRadius: 4 },
  bubbleText:      { color: C.text1, fontSize: 15, lineHeight: 22 },
  bubbleTextUser:  { color: C.onPrimary },

  /* Timestamp — sağ alta hizalı (WhatsApp/Telegram standardı) */
  bubbleTs: { fontSize: 10, color: C.text3, marginTop: 5, textAlign: 'right' },

  /* Markdown */
  mdGap:     { height: 6 },
  mdListRow: { flexDirection: 'row', alignItems: 'flex-start', paddingLeft: 2 },
  mdBullet:  { color: C.text1, fontSize: 15, lineHeight: 22, marginRight: 2 },
  mdListBody:{ flex: 1 },
  mdBold:    { fontWeight: '700' },
  mdItalic:  { fontStyle: 'italic' },

  typingBubble: { paddingVertical: 12, paddingHorizontal: 18 },

  errorText: {
    color: C.error, fontSize: 13, textAlign: 'center',
    marginVertical: 6, marginHorizontal: 16,
  },

  emergencyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  emergencyCardText: { color: C.text2, fontSize: 12, flex: 1 },
  emergencyAction: {
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: C.errorDim,
  },
  emergencyActionText: { color: C.error, fontSize: 12, fontWeight: '700' },
  emergencyDismiss: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },

  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: C.surface,
    backgroundColor: C.bg, gap: 8,
  },
  textInput: {
    flex: 1, backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border,
    borderRadius: 22, color: C.text1, fontSize: 15,
    paddingHorizontal: 16, paddingVertical: 12,
    minHeight: 46, maxHeight: 120,
  },
  sendBtn:         { width: 46, height: 46, borderRadius: 23, backgroundColor: C.text1, justifyContent: 'center', alignItems: 'center' },
  sendBtnDisabled: { opacity: 0.35 },

  historyModal: { flex: 1, backgroundColor: C.bg },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  historyHeaderTitle: { color: C.text1, fontSize: 20, fontWeight: '700' },
  historyList: { padding: 14, gap: 10 },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    backgroundColor: C.surface,
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 10,
  },
  historyRowText: { flex: 1 },
  historyTitle: { color: C.text1, fontSize: 15, fontWeight: '600', marginBottom: 4 },
  historyDate: { color: C.text3, fontSize: 12 },
  historyCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 28 },
  historyEmptyTitle: { color: C.text1, fontSize: 16, fontWeight: '700' },
  historyEmptyText: { color: C.text3, fontSize: 14, textAlign: 'center' },
});
}
