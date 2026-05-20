import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
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

const ACIL_KELIMELER = ['acil', 'hastane', '112', 'ambulans', 'bayıl', 'ambulan'];

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type ApiMessage = {
  role: 'user' | 'assistant';
  content: string;
};

function containsAcilKeyword(text: string): boolean {
  const lower = text.toLocaleLowerCase('tr');
  return ACIL_KELIMELER.some((k) => lower.includes(k));
}

export default function ChatScreen() {
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [apiMessages, setApiMessages] = useState<ApiMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showEmergency, setShowEmergency] = useState(false);
  const [locating, setLocating] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const loadProfile = useCallback(async () => {
    setLoadingProfile(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.id) {
      setMessages([
        {
          id: 'welcome',
          role: 'assistant',
          content: 'Merhaba! Ben BiTanı sağlık asistanınım. Sağlıkla ilgili sorularını yanıtlamaya hazırım.',
        },
      ]);
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

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [messages, sending]);

  const openNearbyHospital = useCallback(async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Konum İzni Gerekli',
          'En yakın hastaneyi bulmak için lütfen konum iznine izin verin.',
          [{ text: 'Tamam' }],
        );
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude, longitude } = loc.coords;
      const url = `https://www.google.com/maps/search/hastane/@${latitude},${longitude},14z`;
      await Linking.openURL(url);
    } catch {
      Alert.alert('Hata', 'Konum alınamadı. Lütfen tekrar deneyin.', [{ text: 'Tamam' }]);
    } finally {
      setLocating(false);
    }
  }, []);

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

  if (loadingProfile) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#fff" />
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
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          {sending && <TypingIndicator />}
          {sendError ? <Text style={styles.errorText}>{sendError}</Text> : null}
        </ScrollView>

        {showEmergency && (
          <Pressable
            style={[styles.emergencyBtn, locating && styles.emergencyBtnDisabled]}
            onPress={() => void openNearbyHospital()}
            disabled={locating}
          >
            {locating ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Text style={styles.emergencyBtnIcon}>🚨</Text>
                <Text style={styles.emergencyBtnText}>En Yakın Hastaneyi Bul</Text>
                <Ionicons name="chevron-forward" size={18} color="#fff" />
              </>
            )}
          </Pressable>
        )}

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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  flex: { flex: 1 },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },

  list: { flex: 1 },
  listContent: { padding: 12, paddingBottom: 8 },

  bubbleRow: {
    flexDirection: 'row',
    marginBottom: 10,
    justifyContent: 'flex-start',
  },
  bubbleRowUser: { justifyContent: 'flex-end' },

  bubble: {
    maxWidth: '78%',
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  bubbleAssistant: {
    backgroundColor: '#1a1a1a',
    borderBottomLeftRadius: 4,
  },
  bubbleUser: {
    backgroundColor: '#2a4fff',
    borderBottomRightRadius: 4,
  },
  bubbleText: {
    color: '#e0e0e0',
    fontSize: 15,
    lineHeight: 22,
  },
  bubbleTextUser: { color: '#fff' },

  typingBubble: {
    paddingVertical: 12,
    paddingHorizontal: 18,
  },

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
  emergencyBtnDisabled: { opacity: 0.6 },
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
  sendBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: { opacity: 0.35 },
});
