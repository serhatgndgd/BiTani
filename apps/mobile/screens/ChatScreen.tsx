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

// ─── Acil anahtar kelimeler ───────────────────────────────────────────────────

const ACIL_KELIMELER = [
  // Orijinal
  'acil', 'hastane', '112', 'ambulans', 'bayıl', 'ambulan',
  // Kardiyovasküler / nörolojik
  'göğüs ağrısı', 'kalp krizi', 'çarpıntı',
  'felç', 'inme', 'uyuşma', 'konuşamıyorum', 'görme kaybı',
  // Solunum
  'nefes alamıyorum', 'nefes darlığı', 'boğuluyorum',
  // Metabolik
  'şeker düştü', 'hipoglisemi', 'insülin şoku',
  // Alerjik reaksiyon
  'alerji şoku', 'anafilaksi',
  // Ruh sağlığı acil
  'kendime zarar', 'intihar', 'yaşamak istemiyorum',
  // Travma / bilinç
  'kan kaybı', 'kaza', 'bilinç kaybı', 'bayılıyorum',
];

// ─── Tipler ───────────────────────────────────────────────────────────────────

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type ApiMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ChatNavProp = BottomTabNavigationProp<MainTabParamList, 'Chat'>;

// ─── Yardımcı ─────────────────────────────────────────────────────────────────

function containsAcilKeyword(text: string): boolean {
  const lower = text.toLocaleLowerCase('tr');
  return ACIL_KELIMELER.some((k) => lower.includes(k));
}

// ─── Ana bileşen ──────────────────────────────────────────────────────────────

export default function ChatScreen() {
  const navigation = useNavigation<ChatNavProp>();

  const [loadingProfile, setLoadingProfile] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [apiMessages, setApiMessages] = useState<ApiMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showEmergency, setShowEmergency] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // ─── Profil yükle ───────────────────────────────────────────────────────────

  const loadProfile = useCallback(async () => {
    setLoadingProfile(true);

    const { data: { user } } = await supabase.auth.getUser();

    if (!user?.id) {
      setMessages([{
        id: 'welcome',
        role: 'assistant',
        content: 'Merhaba! Ben BiTanı sağlık asistanınım. Sağlıkla ilgili sorularını yanıtlamaya hazırım.',
      }]);
      setLoadingProfile(false);
      return;
    }

    setUserId(user.id);

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle();

    const firstName = (profile?.full_name as string | null)?.split(' ')[0] ?? '';
    const greeting = firstName
      ? `Merhaba ${firstName}! Ben BiTanı sağlık asistanınım. Sağlıkla ilgili sorularını yanıtlamaya hazırım.`
      : 'Merhaba! Ben BiTanı sağlık asistanınım. Sağlıkla ilgili sorularını yanıtlamaya hazırım.';

    setMessages([{ id: 'welcome', role: 'assistant', content: greeting }]);
    setLoadingProfile(false);
  }, []);

  useEffect(() => { void loadProfile(); }, [loadProfile]);

  // Otomatik scroll
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [messages, sending]);

  // ─── Mesaj gönder ───────────────────────────────────────────────────────────

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending || loadingProfile) return;

    setInput('');
    setSendError(null);

    const msgId = Date.now().toString();
    setMessages((prev) => [...prev, { id: msgId, role: 'user', content: text }]);

    const nextApiMessages: ApiMessage[] = [...apiMessages, { role: 'user', content: text }];

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('chat', {
        body: { messages: nextApiMessages, userId },
      });

      if (error) throw new Error(error.message);

      const reply = (data as { reply: string }).reply;
      if (!reply) throw new Error('Yanıt alınamadı.');

      setMessages((prev) => [...prev, { id: `${msgId}-a`, role: 'assistant', content: reply }]);
      setApiMessages([...nextApiMessages, { role: 'assistant', content: reply }]);

      if (containsAcilKeyword(text) || containsAcilKeyword(reply)) {
        setShowEmergency(true);
      }
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Bir hata oluştu.');
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
      setInput(text);
    } finally {
      setSending(false);
    }
  }, [input, sending, loadingProfile, apiMessages, userId]);

  // ─── Yükleniyor ─────────────────────────────────────────────────────────────

  if (loadingProfile) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        {/* Mesaj listesi */}
        <ScrollView
          ref={scrollRef}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
        >
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          {sending && <TypingIndicator />}
          {sendError ? <Text style={styles.errorText}>{sendError}</Text> : null}
        </ScrollView>

        {/* Acil butonu → NearbyScreen'e yönlendir */}
        {showEmergency && (
          <Pressable
            style={({ pressed }) => [styles.emergencyBtn, pressed && { opacity: 0.82 }]}
            onPress={() => navigation.navigate('Nearby')}
          >
            <Text style={styles.emergencyBtnIcon}>🚨</Text>
            <Text style={styles.emergencyBtnText}>
              Nöbetçi Eczane / Hastane Bul
            </Text>
            <Ionicons name="chevron-forward" size={18} color="#fff" />
          </Pressable>
        )}

        {/* Mesaj girişi */}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.textInput}
            value={input}
            onChangeText={setInput}
            placeholder="Mesajınızı yazın..."
            placeholderTextColor="#555"
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
            <Ionicons name="arrow-up" size={20} color="#0a0a0a" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Alt bileşenler ───────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  return (
    <View style={[styles.bubbleRow, isUser && styles.bubbleRowUser]}>
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        <Text style={[styles.bubbleText, isUser && styles.bubbleTextUser]}>
          {message.content}
        </Text>
      </View>
    </View>
  );
}

function TypingIndicator() {
  return (
    <View style={styles.bubbleRow}>
      <View style={[styles.bubble, styles.bubbleAssistant, styles.typingBubble]}>
        <ActivityIndicator size="small" color="#888" />
      </View>
    </View>
  );
}

// ─── Stiller ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#0a0a0a' },
  flex:   { flex: 1 },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },

  list:        { flex: 1 },
  listContent: { padding: 12, paddingBottom: 8 },

  bubbleRow:     { flexDirection: 'row', marginBottom: 10, justifyContent: 'flex-start' },
  bubbleRowUser: { justifyContent: 'flex-end' },

  bubble: {
    maxWidth: '78%',
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  bubbleAssistant:  { backgroundColor: '#1a1a1a', borderBottomLeftRadius: 4 },
  bubbleUser:       { backgroundColor: '#2a4fff', borderBottomRightRadius: 4 },
  bubbleText:       { color: '#e0e0e0', fontSize: 15, lineHeight: 22 },
  bubbleTextUser:   { color: '#fff' },
  typingBubble:     { paddingVertical: 12, paddingHorizontal: 18 },

  errorText: {
    color: '#ff6b6b',
    fontSize: 13,
    textAlign: 'center',
    marginVertical: 6,
    marginHorizontal: 16,
  },

  emergencyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#b91c1c',
  },
  emergencyBtnIcon: { fontSize: 18 },
  emergencyBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
  },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
    backgroundColor: '#0a0a0a',
    gap: 8,
  },
  textInput: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 22,
    color: '#fff',
    fontSize: 15,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 46,
    maxHeight: 120,
  },
  sendBtn:         { width: 46, height: 46, borderRadius: 23, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  sendBtnDisabled: { opacity: 0.35 },
});
