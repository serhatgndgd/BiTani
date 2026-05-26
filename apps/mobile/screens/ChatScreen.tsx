import { Ionicons } from '@expo/vector-icons';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
];

// ─── Tipler ───────────────────────────────────────────────────────────────────

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
};

type ApiMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ChatNavProp = BottomTabNavigationProp<MainTabParamList, 'Chat'>;

const GENERIC_CHAT_ERROR = 'Asistan yanıtı alınamadı. Lütfen tekrar deneyin.';

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

function containsAcilKeyword(text: string): boolean {
  const lower = text.toLocaleLowerCase('tr');
  return ACIL_KELIMELER.some((k) => lower.includes(k));
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
  const [apiMessages, setApiMessages]       = useState<ApiMessage[]>([]);
  const [input, setInput]                   = useState('');
  const [sending, setSending]               = useState(false);
  const [sendError, setSendError]           = useState<string | null>(null);
  const [showEmergency, setShowEmergency]   = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const loadProfile = useCallback(async () => {
    setLoadingProfile(true);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user?.id) {
      setMessages([{
        id: 'welcome', role: 'assistant', ts: Date.now(),
        content: 'Merhaba! Ben BiTanı sağlık asistanınım. Sağlıkla ilgili sorularını yanıtlamaya hazırım.',
      }]);
      setLoadingProfile(false);
      return;
    }

    const { data: profile } = await supabase
      .from('profiles').select('full_name').eq('id', user.id).maybeSingle();

    const firstName = (profile?.full_name as string | null)?.split(' ')[0] ?? '';
    const greeting  = firstName
      ? `Merhaba ${firstName}! Ben BiTanı sağlık asistanınım. Sağlıkla ilgili sorularını yanıtlamaya hazırım.`
      : 'Merhaba! Ben BiTanı sağlık asistanınım. Sağlıkla ilgili sorularını yanıtlamaya hazırım.';

    setMessages([{ id: 'welcome', role: 'assistant', content: greeting, ts: Date.now() }]);
    setLoadingProfile(false);
  }, []);

  useEffect(() => { void loadProfile(); }, [loadProfile]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [messages, sending]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending || loadingProfile) return;

    setInput('');
    setSendError(null);

    const msgId = Date.now().toString();
    setMessages((prev) => [...prev, { id: msgId, role: 'user', content: text, ts: Date.now() }]);

    const nextApiMessages: ApiMessage[] = [...apiMessages, { role: 'user', content: text }];
    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Oturum doğrulanamadı.');

      const { data, error } = await supabase.functions.invoke('chat', {
        body: { messages: nextApiMessages },
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      if (error) throw new Error(GENERIC_CHAT_ERROR);

      const reply = (data as { reply: string }).reply;
      if (!reply) throw new Error('Yanıt alınamadı.');

      setMessages((prev) => [...prev, { id: `${msgId}-a`, role: 'assistant', content: reply, ts: Date.now() }]);
      setApiMessages([...nextApiMessages, { role: 'assistant', content: reply }]);

      if (containsAcilKeyword(text) || containsAcilKeyword(reply)) setShowEmergency(true);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Bir hata oluştu.');
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
      setInput(text);
    } finally {
      setSending(false);
    }
  }, [input, sending, loadingProfile, apiMessages]);

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
        <ScrollView
          ref={scrollRef}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
        >
          {messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)}
          {sending && <TypingIndicator />}
          {sendError && <Text style={styles.errorText}>{sendError}</Text>}
        </ScrollView>

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
