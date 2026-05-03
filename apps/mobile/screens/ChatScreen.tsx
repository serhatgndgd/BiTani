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

type ProfileData = {
  full_name: string | null;
  birth_date: string | null;
  gender: string | null;
  height_cm: number | null;
  weight_kg: number | null;
};

type AnthropicContent = { type: string; text: string };
type AnthropicSuccessBody = { content: AnthropicContent[] };
type AnthropicErrorBody = { error: { message: string } };

function containsAcilKeyword(text: string): boolean {
  const lower = text.toLocaleLowerCase('tr');
  return ACIL_KELIMELER.some((k) => lower.includes(k));
}

function getDummyReply(): string {
  return 'Anlıyorum, şikayetinizi not aldım. Belirtileriniz devam ederse bir doktora başvurmanızı öneririm.';
}

function computeAge(birthDate: string | null): string {
  if (!birthDate) return 'belirtilmemiş';
  const birth = new Date(birthDate);
  if (isNaN(birth.getTime())) return 'belirtilmemiş';
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return `${age} yaşında`;
}

function genderTr(gender: string | null): string {
  if (gender === 'male') return 'erkek';
  if (gender === 'female') return 'kadın';
  return 'belirtilmemiş';
}

function buildSystemPrompt(
  profile: ProfileData | null,
  conditions: string[],
  medications: string[],
): string {
  const name = profile?.full_name ?? 'Kullanıcı';
  const age = computeAge(profile?.birth_date ?? null);
  const gender = genderTr(profile?.gender ?? null);
  const height = profile?.height_cm != null ? `${profile.height_cm} cm` : 'belirtilmemiş';
  const weight = profile?.weight_kg != null ? `${profile.weight_kg} kg` : 'belirtilmemiş';
  const conditionsList = conditions.length > 0 ? conditions.join(', ') : 'yok';
  const medicationsList = medications.length > 0 ? medications.join(', ') : 'yok';

  return `Sen BiTanı uygulamasının Türkçe sağlık asistanısın. Kullanıcıyla samimi, sıcak ve anlayışlı bir dille konuşursun. Sağlık konularında genel bilgi ve rehberlik sağlarsın.

ÖNEMLİ KISITLAMALAR:
- Kesinlikle doktor değilsin; tıbbi tanı koymaz, ilaç reçete etmez veya mevcut tedaviyi değiştirmeni önermezsin.
- Acil durumlarda her zaman 112'yi veya en yakın sağlık kuruluşunu yönlendirirsin.
- Gerektiğinde mutlaka bir doktora başvurmasını hatırlatırsın.
- Yanıtlarını kısa, anlaşılır ve Türkçe tut.

Kullanıcı Profili:
- Ad: ${name}
- Yaş: ${age}
- Cinsiyet: ${gender}
- Boy: ${height}
- Kilo: ${weight}
- Kronik hastalıklar: ${conditionsList}
- Düzenli kullandığı ilaçlar: ${medicationsList}

Bu profil bilgilerini dikkate alarak kişiselleştirilmiş ve güvenli sağlık rehberliği sun.`;
}

// Gerçek API için korunuyor — dummy moddan çıkınca buraya dön
async function callAnthropic(messages: ApiMessage[], systemPrompt: string): Promise<string> {
  const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('API anahtarı yapılandırılmamış.');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    }),
  });

  const data = (await res.json()) as AnthropicSuccessBody | AnthropicErrorBody;
  if (!res.ok) {
    const err = data as AnthropicErrorBody;
    throw new Error(err.error?.message ?? `API hatası: ${res.status}`);
  }
  const success = data as AnthropicSuccessBody;
  const block = success.content.find((c) => c.type === 'text');
  if (!block?.text) throw new Error('Yanıt alınamadı.');
  return block.text;
}

void callAnthropic; // kullanılmayan uyarısını bastır

export default function ChatScreen() {
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [apiMessages, setApiMessages] = useState<ApiMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showEmergency, setShowEmergency] = useState(false);
  const [locating, setLocating] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const userMsgCountRef = useRef(0);

  const loadProfile = useCallback(async () => {
    setLoadingProfile(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.id) {
      setSystemPrompt(buildSystemPrompt(null, [], []));
      setLoadingProfile(false);
      return;
    }

    const [profileRes, condRes, medRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('full_name, birth_date, gender, height_cm, weight_kg')
        .eq('id', user.id)
        .maybeSingle(),
      supabase
        .from('user_conditions')
        .select('conditions_catalog(name)')
        .eq('user_id', user.id),
      supabase
        .from('user_medications')
        .select('dosage, medications(ilac_adi)')
        .eq('user_id', user.id),
    ]);

    const profile = profileRes.data as ProfileData | null;

    type CondRow = { conditions_catalog: { name: string } | null };
    const conditions = condRes.data
      ? (condRes.data as unknown as CondRow[])
          .map((r) => r.conditions_catalog?.name)
          .filter((n): n is string => !!n)
      : [];

    type MedRow = { dosage: string | null; medications: { ilac_adi: string } | null };
    const medications = medRes.data
      ? (medRes.data as unknown as MedRow[])
          .map((r) => {
            const name = r.medications?.ilac_adi;
            if (!name) return null;
            return r.dosage ? `${name} (${r.dosage})` : name;
          })
          .filter((n): n is string => !!n)
      : [];

    setSystemPrompt(buildSystemPrompt(profile, conditions, medications));

    const firstName = profile?.full_name?.split(' ')[0] ?? '';
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
    const userMsg: Message = { id: msgId, role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);

    const nextApiMessages: ApiMessage[] = [...apiMessages, { role: 'user', content: text }];

    userMsgCountRef.current += 1;

    setSending(true);
    try {
      // Dummy mod — gerçek API için getDummyReply yerine callAnthropic kullan
      const reply = getDummyReply();
      const assistantMsg: Message = { id: `${msgId}-a`, role: 'assistant', content: reply };
      setMessages((prev) => [...prev, assistantMsg]);
      setApiMessages([...nextApiMessages, { role: 'assistant', content: reply }]);

      const acilTetiklendi =
        containsAcilKeyword(text) ||
        containsAcilKeyword(reply) ||
        userMsgCountRef.current % 3 === 0;
      if (acilTetiklendi) setShowEmergency(true);
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
