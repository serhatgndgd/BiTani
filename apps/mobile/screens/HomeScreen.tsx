import { Ionicons } from '@expo/vector-icons';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '../lib/supabase';
import type { MainTabParamList } from '../navigation/types';

// ─── Tipler ──────────────────────────────────────────────────────────────────

type HomeNavProp = BottomTabNavigationProp<MainTabParamList, 'Home'>;

type ProfileData = {
  full_name: string | null;
  height_cm: number | null;
  weight_kg: number | null;
};

type ConditionRow = {
  conditions_catalog: { name: string } | null;
};

type MedRow = {
  dosage: string | null;
  medications: { ilac_adi: string } | null;
};

type MedItem = { name: string; dosage: string | null };

// ─── Yardımcı fonksiyonlar ────────────────────────────────────────────────────

const TR_DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const TR_MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

function formatTurkishDate(): string {
  const now = new Date();
  return `${TR_DAYS[now.getDay()]}, ${now.getDate()} ${TR_MONTHS[now.getMonth()]} ${now.getFullYear()}`;
}

function computeBmi(h: number | null, w: number | null): number | null {
  if (!h || !w || h <= 0 || w <= 0) return null;
  return w / ((h / 100) ** 2);
}

type BmiInfo = { label: string; color: string };

function getBmiInfo(bmi: number): BmiInfo {
  if (bmi < 18.5) return { label: 'Zayıf', color: '#f59e0b' };
  if (bmi < 25)   return { label: 'Normal', color: '#34c759' };
  if (bmi < 30)   return { label: 'Fazla Kilolu', color: '#f59e0b' };
  return { label: 'Obez', color: '#ff4444' };
}

// ─── Ana bileşen ──────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const navigation = useNavigation<HomeNavProp>();

  const [loading, setLoading]           = useState(true);
  const [profile, setProfile]           = useState<ProfileData | null>(null);
  const [firstName, setFirstName]       = useState('');
  const [conditions, setConditions]     = useState<string[]>([]);
  const [medications, setMedications]   = useState<MedItem[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) return;

      const [profRes, condRes, medRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('full_name, height_cm, weight_kg')
          .eq('id', user.id)
          .maybeSingle(),
        supabase
          .from('user_conditions')
          .select('conditions_catalog(name)')
          .eq('user_id', user.id),
        supabase
          .from('user_medications')
          .select('dosage, medications(ilac_adi)')
          .eq('user_id', user.id)
          .eq('is_active', true),
      ]);

      const prof = profRes.data as ProfileData | null;
      setProfile(prof);
      setFirstName((prof?.full_name ?? '').split(' ')[0]);

      const condList = ((condRes.data ?? []) as unknown as ConditionRow[])
        .map((r) => r.conditions_catalog?.name)
        .filter((n): n is string => Boolean(n));
      setConditions(condList);

      const medList = ((medRes.data ?? []) as unknown as MedRow[])
        .map((r) => {
          const name = r.medications?.ilac_adi;
          return name ? { name, dosage: r.dosage } : null;
        })
        .filter((m): m is MedItem => m !== null);
      setMedications(medList);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  // ─── Yükleniyor ───────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1a6ef5" />
      </View>
    );
  }

  const bmi   = computeBmi(profile?.height_cm ?? null, profile?.weight_kg ?? null);
  const bInfo = bmi !== null ? getBmiInfo(bmi) : null;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Karşılama ── */}
        <View style={styles.greeting}>
          <Text style={styles.greetDate}>{formatTurkishDate()}</Text>
          <Text style={styles.greetName}>
            {firstName ? `Merhaba, ${firstName}! 👋` : 'Merhaba! 👋'}
          </Text>
        </View>

        {/* ── BMI Kartı ── */}
        {profile?.height_cm != null && profile?.weight_kg != null && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="body-outline" size={17} color="#666" />
              <Text style={styles.cardTitle}>Vücut Kitle İndeksi</Text>
            </View>
            <View style={styles.bmiRow}>
              <View style={styles.bmiStat}>
                <Text style={styles.bmiValue}>{profile.height_cm}</Text>
                <Text style={styles.bmiUnit}>cm</Text>
                <Text style={styles.bmiLabel}>Boy</Text>
              </View>
              <View style={styles.bmiDivider} />
              <View style={styles.bmiStat}>
                <Text style={styles.bmiValue}>{profile.weight_kg}</Text>
                <Text style={styles.bmiUnit}>kg</Text>
                <Text style={styles.bmiLabel}>Kilo</Text>
              </View>
              <View style={styles.bmiDivider} />
              <View style={styles.bmiStat}>
                <Text style={[styles.bmiScore, { color: bInfo?.color ?? '#fff' }]}>
                  {bmi?.toFixed(1)}
                </Text>
                <Text style={[styles.bmiLabel, { color: bInfo?.color ?? '#888', marginTop: 2 }]}>
                  {bInfo?.label ?? '—'}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* ── Hastalıklar Kartı ── */}
        {conditions.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="medical-outline" size={17} color="#666" />
              <Text style={styles.cardTitle}>Kronik Hastalıklarınız</Text>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{conditions.length}</Text>
              </View>
            </View>
            <View style={styles.chipWrap}>
              {conditions.map((c) => (
                <View key={c} style={styles.chip}>
                  <Text style={styles.chipText}>{c}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── İlaçlar Kartı ── */}
        {medications.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="medkit-outline" size={17} color="#666" />
              <Text style={styles.cardTitle}>Kullandığınız İlaçlar</Text>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{medications.length}</Text>
              </View>
            </View>
            {medications.map((m, idx) => (
              <View
                key={`${m.name}-${idx}`}
                style={[styles.medRow, idx < medications.length - 1 && styles.medRowBorder]}
              >
                <View style={styles.medDot} />
                <View style={styles.medInfo}>
                  <Text style={styles.medName}>{m.name}</Text>
                  {m.dosage != null && m.dosage !== '' && (
                    <Text style={styles.medDosage}>{m.dosage}</Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* ── Boş Durum (henüz veri yok) ── */}
        {conditions.length === 0 && medications.length === 0 && (
          <View style={styles.emptyCard}>
            <Ionicons name="clipboard-outline" size={36} color="#333" />
            <Text style={styles.emptyTitle}>Profiliniz hazırlanıyor</Text>
            <Text style={styles.emptySub}>
              Hastalık ve ilaç bilgileriniz Profil ekranından güncellenebilir.
            </Text>
          </View>
        )}

        {/* ── Asistan CTA ── */}
        <Pressable
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          onPress={() => navigation.navigate('Chat')}
        >
          <View style={styles.ctaIcon}>
            <Ionicons name="chatbubble-ellipses" size={22} color="#fff" />
          </View>
          <View style={styles.ctaText}>
            <Text style={styles.ctaTitle}>Asistana Sor</Text>
            <Text style={styles.ctaSub}>Sağlık sorularınız için yapay zeka asistanı</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.45)" />
        </Pressable>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Stiller ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: '#0a0a0a' },
  center:        { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },
  scroll:        { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 36, gap: 12 },

  /* Karşılama */
  greeting:  { marginBottom: 6 },
  greetDate: { color: '#444', fontSize: 13, fontWeight: '500', marginBottom: 5 },
  greetName: { color: '#fff', fontSize: 26, fontWeight: '700', letterSpacing: -0.3 },

  /* Kart */
  card: {
    backgroundColor: '#141414',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#222',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 14,
  },
  cardTitle: { color: '#888', fontSize: 12, fontWeight: '700', letterSpacing: 0.5, flex: 1, textTransform: 'uppercase' },

  badge:     { backgroundColor: '#222', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { color: '#666', fontSize: 12, fontWeight: '600' },

  /* BMI */
  bmiRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  bmiStat:   { alignItems: 'center', flex: 1 },
  bmiValue:  { color: '#fff', fontSize: 22, fontWeight: '700' },
  bmiScore:  { fontSize: 26, fontWeight: '800' },
  bmiUnit:   { color: '#555', fontSize: 11, marginTop: 1 },
  bmiLabel:  { color: '#555', fontSize: 11, marginTop: 3 },
  bmiDivider:{ width: 1, height: 40, backgroundColor: '#242424' },

  /* Hastalıklar */
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:     { backgroundColor: '#1e1e1e', borderRadius: 20, paddingHorizontal: 13, paddingVertical: 7, borderWidth: 1, borderColor: '#2a2a2a' },
  chipText: { color: '#ccc', fontSize: 13 },

  /* İlaçlar */
  medRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, gap: 12 },
  medRowBorder: { borderBottomWidth: 1, borderBottomColor: '#1e1e1e' },
  medDot:       { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#1a6ef5' },
  medInfo:      { flex: 1 },
  medName:      { color: '#e8e8e8', fontSize: 14, fontWeight: '500' },
  medDosage:    { color: '#555', fontSize: 12, marginTop: 2 },

  /* Boş durum */
  emptyCard:  { backgroundColor: '#141414', borderRadius: 16, padding: 28, alignItems: 'center', gap: 10, borderWidth: 1, borderColor: '#222' },
  emptyTitle: { color: '#555', fontSize: 15, fontWeight: '600' },
  emptySub:   { color: '#3a3a3a', fontSize: 13, textAlign: 'center', lineHeight: 20 },

  /* CTA */
  cta: {
    backgroundColor: '#1a6ef5',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  ctaPressed: { opacity: 0.82 },
  ctaIcon:    { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  ctaText:    { flex: 1 },
  ctaTitle:   { color: '#fff', fontSize: 15, fontWeight: '700' },
  ctaSub:     { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 2 },
});
