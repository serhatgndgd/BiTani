import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatFooterNotice } from '../components/ChatFooterNotice';
import { LegalDocumentModal } from '../components/LegalDocumentModal';
import { supabase } from '../lib/supabase';
import type { MainTabParamList } from '../navigation/types';
import { C } from '../theme';

// ─── Acil anahtar kelimeler ───────────────────────────────────────────────────

const ACIL_KELIMELER = [
  'acil', 'hastane', '112', 'ambulans', 'bayıl', 'ambulan',
  'göğüs ağrısı', 'kalp krizi', 'çarpıntı',
  'felç', 'inme', 'uyuşma', 'konuşamıyorum', 'görme kaybı',
  'nefes alamıyorum', 'nefes darlığı', 'boğuluyorum',
  'şeker düştü', 'hipoglisemi', 'insülin şoku',
  'alerji şoku', 'anafilaksi',
  'kendime zarar', 'intihar', 'yaşamak istemiyorum',
  'kan kaybı', 'kaza', 'bilinç kaybı', 'bayılıyorum',
  'yutkunamıyorum', 'yutamıyorum',
  'en kötü baş ağrım', 'patlar gibi baş ağrısı',
  'gözlerim çift görüyor',
  'yüzüm düştü', 'yüzümde uyuşma',
  'kol asılıyor', 'kolum çalışmıyor',
  'göğüse vuran karın ağrısı',
  'sırt ağrısı göğse yayılıyor',
  'çok fazla ilaç içtim', 'ilaçları içtim',
  'zehirlendim',
  'çocuğum düştü', 'bebek nefes almıyor',
  'çocuk ilaç içti',
];

// ─── Tipler ───────────────────────────────────────────────────────────────────

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
};

type ChatNavProp = BottomTabNavigationProp<MainTabParamList, 'Chat'>;

const CHAT_ERROR_NETWORK = 'İnternet bağlantınızı kontrol edin';
const CHAT_ERROR_SERVER = 'Asistan şu an yanıt veremiyor';
const CHAT_ERROR_GENERIC = 'Bir sorun oluştu, tekrar deneyin';
const CHAT_DISCLAIMER_ACCEPTED_KEY = 'chat_disclaimer_v1_accepted';

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

function normalizeForMatch(text: string): string {
  return text
    .toLocaleLowerCase('tr')
    .replace(/[.,!?;:]/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = Array.from({ length: b.length + 1 }, () =>
    Array<number>(a.length + 1).fill(0),
  );

  for (let i = 0; i <= a.length; i += 1) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[j][0] = j;

  for (let j = 1; j <= b.length; j += 1) {
    for (let i = 1; i <= a.length; i += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + cost,
      );
    }
  }

  return matrix[b.length][a.length];
}

function isWordSimilar(word: string, target: string): boolean {
  if (target.length <= 4) return word === target;
  const distance = levenshtein(word, target);
  const tolerance = Math.floor(target.length / 4);
  return distance <= tolerance;
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

function detectEmergency(text: string): boolean {
  const normalized = normalizeForMatch(text);
  const words = normalized.split(/\s+/).filter(Boolean);

  for (const keyword of ACIL_KELIMELER) {
    const normalizedKeyword = normalizeForMatch(keyword);

    if (!normalizedKeyword.includes(' ')) {
      for (const word of words) {
        if (isWordSimilar(word, normalizedKeyword)) return true;
      }
      continue;
    }

    const keywordWords = normalizedKeyword.split(' ').filter(Boolean);
    for (let i = 0; i <= words.length - keywordWords.length; i += 1) {
      const allMatch = keywordWords.every((kw, idx) =>
        isWordSimilar(words[i + idx] ?? '', kw),
      );
      if (allMatch) return true;
    }
  }

  return false;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

// ─── Alt bileşenler ───────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
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
        {/* Timestamp */}
        <Text style={[styles.bubbleTs, isUser ? styles.bubbleTsLeft : styles.bubbleTsRight]}>
          {fmtTime(message.ts)}
        </Text>
      </View>
    </View>
  );
}

function TypingIndicator() {
  return (
    <View style={styles.bubbleRow}>
      <View style={[styles.bubble, styles.bubbleAssistant, styles.typingBubble]}>
        <ActivityIndicator size="small" color={C.text3} />
      </View>
    </View>
  );
}

// ─── Ana bileşen ──────────────────────────────────────────────────────────────

export default function ChatScreen() {
  const navigation = useNavigation<ChatNavProp>();

  const [loadingProfile, setLoadingProfile] = useState(true);
  const [messages, setMessages]             = useState<Message[]>([]);
  const [input, setInput]                   = useState('');
  const [sending, setSending]               = useState(false);
  const [sendError, setSendError]           = useState<string | null>(null);
  const [showEmergency, setShowEmergency]   = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);

  const loadProfile = useCallback(async () => {
    setLoadingProfile(true);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user?.id) {
      setMessages([{
        id: 'welcome', role: 'assistant', ts: Date.now(),
        content: 'Merhaba! Ben BiTanı sağlık bilgi rehberiyim. Sağlıkla ilgili sorularında yardımcı olmaya hazırım.',
      }]);
      setLoadingProfile(false);
      return;
    }

    const { data: profile } = await supabase
      .from('profiles').select('full_name').eq('id', user.id).maybeSingle();

    const firstName = (profile?.full_name as string | null)?.split(' ')[0] ?? '';
    const greeting  = firstName
      ? `Merhaba ${firstName}! Ben BiTanı sağlık bilgi rehberiyim. Sağlıkla ilgili sorularında yardımcı olmaya hazırım.`
      : 'Merhaba! Ben BiTanı sağlık bilgi rehberiyim. Sağlıkla ilgili sorularında yardımcı olmaya hazırım.';

    setMessages([{ id: 'welcome', role: 'assistant', content: greeting, ts: Date.now() }]);
    setLoadingProfile(false);
  }, []);

  useEffect(() => { void loadProfile(); }, [loadProfile]);

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

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending || loadingProfile) return;

    setInput('');
    setSendError(null);

    const msgId = Date.now().toString();
    setMessages((prev) => [...prev, { id: msgId, role: 'user', content: text, ts: Date.now() }]);

    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Oturum doğrulanamadı.');

      const isEmergency = detectEmergency(text);
      // Edge function sadece son mesajı kullanıyor; geçmiş DB'den çekiliyor.
      // Büyüyen apiMessages array'i yerine tek elemanlı array gönder.
      const { data, error } = await supabase.functions.invoke('chat', {
        body: {
          messages: [{ role: 'user', content: text }],
          is_emergency_flagged: isEmergency,
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

      if (isEmergency || payload.is_emergency === true || detectEmergency(reply)) {
        setShowEmergency(true);
      }
    } catch (error) {
      console.error('chat-screen:', error);
      setSendError(mapChatError(error));
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
      setInput(text);
    } finally {
      setSending(false);
    }
  }, [input, sending, loadingProfile]);

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
        />

        {showEmergency && (
          <Pressable
            style={({ pressed }) => [styles.emergencyBtn, pressed && { opacity: 0.82 }]}
            onPress={() => navigation.navigate('Nearby')}
          >
            <Text style={styles.emergencyBtnIcon}>🚨</Text>
            <Text style={styles.emergencyBtnText}>Nöbetçi Eczane / Hastane Bul</Text>
            <Ionicons name="chevron-forward" size={18} color={C.text1} />
          </Pressable>
        )}

        <ChatFooterNotice />

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
    </SafeAreaView>
  );
}

// ─── Stiller ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: C.bg },
  flex:   { flex: 1 },
  center: { flex: 1, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' },

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
  bubbleText:      { color: '#e0e0e0', fontSize: 15, lineHeight: 22 },
  bubbleTextUser:  { color: C.text1 },

  /* Timestamp */
  bubbleTs:      { fontSize: 10, color: C.text3, marginTop: 5 },
  bubbleTsLeft:  { textAlign: 'left'  },  // kullanıcı mesajı (sağ balon) → solda
  bubbleTsRight: { textAlign: 'right' },  // asistan mesajı (sol balon) → sağda

  /* Markdown */
  mdGap:     { height: 6 },
  mdListRow: { flexDirection: 'row', alignItems: 'flex-start', paddingLeft: 2 },
  mdBullet:  { color: '#e0e0e0', fontSize: 15, lineHeight: 22, marginRight: 2 },
  mdListBody:{ flex: 1 },
  mdBold:    { fontWeight: '700' },
  mdItalic:  { fontStyle: 'italic' },

  typingBubble: { paddingVertical: 12, paddingHorizontal: 18 },

  errorText: {
    color: C.error, fontSize: 13, textAlign: 'center',
    marginVertical: 6, marginHorizontal: 16,
  },

  emergencyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 12, marginBottom: 8, paddingVertical: 14,
    borderRadius: 14, backgroundColor: '#b91c1c',
  },
  emergencyBtnIcon: { fontSize: 18 },
  emergencyBtnText: { color: C.text1, fontSize: 15, fontWeight: '700', flex: 1, textAlign: 'center' },

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
});
