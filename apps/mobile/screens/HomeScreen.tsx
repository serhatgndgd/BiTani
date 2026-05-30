import { Ionicons } from '@expo/vector-icons';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { EmptyState } from '../components/EmptyState';
import { supabase } from '../lib/supabase';
import type { MainTabParamList } from '../navigation/types';
import { C } from '../theme';

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

// ─── İlaç Zaman Grubu ────────────────────────────────────────────────────────

type DoseTime = 'sabah' | 'ogle' | 'aksam' | 'diger';

const DOSE_TIME_ORDER: DoseTime[] = ['sabah', 'ogle', 'aksam', 'diger'];

const DOSE_TIME_LABELS: Record<DoseTime, string> = {
  sabah: 'Sabah',
  ogle:  'Öğle',
  aksam: 'Akşam',
  diger: 'Diğer',
};

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];
const DOSE_TIME_ICONS: Record<DoseTime, IoniconsName> = {
  sabah: 'sunny-outline',
  ogle:  'partly-sunny-outline',
  aksam: 'moon-outline',
  diger: 'time-outline',
};

function getDoseTime(dosage: string | null): DoseTime {
  if (!dosage) return 'diger';
  const lower = dosage.toLocaleLowerCase('tr');
  if (lower.includes('sabah'))                              return 'sabah';
  if (lower.includes('öğle') || lower.includes('ogle'))    return 'ogle';
  if (lower.includes('akşam') || lower.includes('aksam'))  return 'aksam';
  return 'diger';
}

type MedsByTime = Record<DoseTime, MedItem[]>;

function groupMedsByTime(meds: MedItem[]): MedsByTime {
  const groups: MedsByTime = { sabah: [], ogle: [], aksam: [], diger: [] };
  for (const med of meds) {
    groups[getDoseTime(med.dosage)].push(med);
  }
  return groups;
}

// ─── Yardımcı fonksiyonlar ────────────────────────────────────────────────────

const TR_DAYS   = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const TR_MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

function formatTurkishDate(): string {
  const now = new Date();
  return `${TR_DAYS[now.getDay()]}, ${now.getDate()} ${TR_MONTHS[now.getMonth()]} ${now.getFullYear()}`;
}

function getTimeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Günaydın';
  if (hour < 14) return 'İyi öğlenler';
  if (hour < 18) return 'İyi günler';
  return 'İyi akşamlar';
}

function computeBmi(h: number | null, w: number | null): number | null {
  if (!h || !w || h <= 0 || w <= 0) return null;
  return w / ((h / 100) ** 2);
}

type BmiInfo = { label: string; color: string; dimColor: string };

function getBmiInfo(bmi: number): BmiInfo {
  if (bmi < 18.5) return { label: 'Zayıf',         color: C.warning, dimColor: C.warningDim };
  if (bmi < 25)   return { label: 'Normal',         color: C.success, dimColor: C.successDim };
  if (bmi < 30)   return { label: 'Fazla Kilolu',   color: C.warning, dimColor: C.warningDim };
  return           { label: 'Obez',                 color: C.error,   dimColor: C.errorDim   };
}

// ─── BMI Ring ─────────────────────────────────────────────────────────────────

const RING_SIZE    = 120;
const RING_STROKE  = 10;
const RING_CX      = RING_SIZE / 2;
const RING_CY      = RING_SIZE / 2;
const RING_R       = RING_CX - RING_STROKE / 2;
const RING_C       = 2 * Math.PI * RING_R;
const RING_ARC     = 0.75;                        // 270°
const RING_ARC_LEN = RING_C * RING_ARC;
const RING_GAP_LEN = RING_C - RING_ARC_LEN;

const BMI_MIN = 10;
const BMI_MAX = 40;

function BmiRing({ bmi, color }: { bmi: number; color: string }) {
  const progress = Math.min(1, Math.max(0, (bmi - BMI_MIN) / (BMI_MAX - BMI_MIN)));
  const fillLen  = RING_ARC_LEN * progress;

  return (
    <Svg width={RING_SIZE} height={RING_SIZE}>
      {/* Track — 270° arc, gap at bottom */}
      <Circle
        cx={RING_CX}
        cy={RING_CY}
        r={RING_R}
        stroke={C.border}
        strokeWidth={RING_STROKE}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${RING_ARC_LEN} ${RING_GAP_LEN}`}
        transform={`rotate(135, ${RING_CX}, ${RING_CY})`}
      />
      {/* Fill — shows progress fraction of the 270° arc */}
      {progress > 0.01 && (
        <Circle
          cx={RING_CX}
          cy={RING_CY}
          r={RING_R}
          stroke={color}
          strokeWidth={RING_STROKE}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${fillLen} ${RING_C - fillLen}`}
          transform={`rotate(135, ${RING_CX}, ${RING_CY})`}
        />
      )}
    </Svg>
  );
}

// ─── Ana bileşen ──────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const navigation = useNavigation<HomeNavProp>();

  const [loading, setLoading]         = useState(true);
  const [profile, setProfile]         = useState<ProfileData | null>(null);
  const [firstName, setFirstName]     = useState('');
  const [conditions, setConditions]   = useState<string[]>([]);
  const [medications, setMedications] = useState<MedItem[]>([]);

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

  useFocusEffect(useCallback(() => { void loadData(); }, [loadData]));

  // ─── Yükleniyor ───────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  const bmi   = computeBmi(profile?.height_cm ?? null, profile?.weight_kg ?? null);
  const bInfo = bmi !== null ? getBmiInfo(bmi) : null;
  const medGroups = groupMedsByTime(medications);

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
            {firstName
              ? `${getTimeGreeting()}, ${firstName}! 👋`
              : `${getTimeGreeting()}! 👋`}
          </Text>
        </View>

        {/* ── BMI Kartı (ring + stats) ── */}
        {profile?.height_cm != null && profile?.weight_kg != null && bmi !== null && bInfo !== null && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="body-outline" size={17} color={C.text3} />
              <Text style={styles.cardTitle}>VÜCUT KİTLE İNDEKSİ</Text>
            </View>

            <View style={styles.bmiContent}>
              {/* ── Halka ── */}
              <View style={styles.bmiRingWrap}>
                <BmiRing bmi={bmi} color={bInfo.color} />
                {/* Merkez değer */}
                <View style={styles.bmiRingOverlay} pointerEvents="none">
                  <Text style={[styles.bmiRingValue, { color: bInfo.color }]}>
                    {bmi.toFixed(1)}
                  </Text>
                  <View style={[styles.bmiLabelPill, { backgroundColor: bInfo.dimColor }]}>
                    <Text style={[styles.bmiLabelPillText, { color: bInfo.color }]}>
                      {bInfo.label}
                    </Text>
                  </View>
                </View>
              </View>

              {/* ── Boy / Kilo istatistikleri ── */}
              <View style={styles.bmiStats}>
                <View style={styles.bmiStatRow}>
                  <Text style={styles.bmiStatValue}>{profile.height_cm}</Text>
                  <Text style={styles.bmiStatUnit}>cm</Text>
                  <Text style={styles.bmiStatLabel}>Boy</Text>
                </View>
                <View style={styles.bmiStatDivider} />
                <View style={styles.bmiStatRow}>
                  <Text style={styles.bmiStatValue}>{profile.weight_kg}</Text>
                  <Text style={styles.bmiStatUnit}>kg</Text>
                  <Text style={styles.bmiStatLabel}>Kilo</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* ── Günlük İlaç Hatırlatıcısı (Priority 7) ── */}
        {medications.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="alarm-outline" size={17} color={C.text3} />
              <Text style={styles.cardTitle}>GÜNLÜK İLAÇ HATIRLATICISI</Text>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{medications.length}</Text>
              </View>
            </View>

            {DOSE_TIME_ORDER.map((time) => {
              const items = medGroups[time];
              if (items.length === 0) return null;
              return (
                <View key={time} style={styles.doseGroup}>
                  {/* Zaman başlığı */}
                  <View style={styles.doseGroupHeader}>
                    <Ionicons name={DOSE_TIME_ICONS[time]} size={12} color={C.text3} />
                    <Text style={styles.doseGroupLabel}>
                      {DOSE_TIME_LABELS[time].toLocaleUpperCase('tr-TR')}
                    </Text>
                  </View>
                  {/* İlaçlar */}
                  {items.map((m, idx) => (
                    <View
                      key={`${m.name}-${idx}`}
                      style={[styles.doseRow, idx < items.length - 1 && styles.doseRowBorder]}
                    >
                      <View style={styles.doseCheck}>
                        <Ionicons name="ellipse-outline" size={16} color={C.border} />
                      </View>
                      <View style={styles.doseInfo}>
                        <Text style={styles.doseName}>{m.name}</Text>
                        {m.dosage != null && m.dosage !== '' && (
                          <Text style={styles.doseDosage}>{m.dosage}</Text>
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              );
            })}
          </View>
        )}

        {/* ── Hastalıklar Kartı ── */}
        {conditions.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="medical-outline" size={17} color={C.text3} />
              <Text style={styles.cardTitle}>KRONİK HASTALIKLARINIZ</Text>
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

        {/* ── İlaçlar Listesi Kartı ── */}
        {medications.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="medkit-outline" size={17} color={C.text3} />
              <Text style={styles.cardTitle}>KULLANDIĞINIZ İLAÇLAR</Text>
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

        {/* ── Boş Durum ── */}
        {conditions.length === 0 && medications.length === 0 && (
          <View style={[styles.card, { alignItems: 'center', paddingVertical: 28 }]}>
            <EmptyState
              icon="clipboard-outline"
              title="Profiliniz hazırlanıyor"
              subtitle="Hastalık ve ilaç bilgileriniz Profil ekranından güncellenebilir."
              paddingTop={0}
            />
          </View>
        )}

        {/* ── Yakın Hastane / Eczane CTA ── */}
        <Pressable
          style={({ pressed }) => [styles.cta, styles.ctaNearby, pressed && styles.ctaPressed]}
          onPress={() => navigation.navigate('Nearby')}
        >
          <View style={[styles.ctaIcon, styles.ctaNearbyIcon]}>
            <Ionicons name="location" size={22} color={C.error} />
          </View>
          <View style={styles.ctaText}>
            <Text style={styles.ctaTitle}>Yakın Hastane / Eczane</Text>
            <Text style={styles.ctaSub}>GPS ile yakınındaki sağlık noktaları</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={C.text3} />
        </Pressable>

        {/* ── Sohbet CTA ── */}
        <Pressable
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          onPress={() => navigation.navigate('Chat')}
        >
          <View style={styles.ctaIcon}>
            <Ionicons name="chatbubble-ellipses" size={22} color={C.text1} />
          </View>
          <View style={styles.ctaText}>
            <Text style={styles.ctaTitle}>Bilgi Rehberine Sor</Text>
            <Text style={styles.ctaSub}>Sağlık sorularınız için yapay zeka destekli rehber</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.45)" />
        </Pressable>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Stiller ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: C.bg },
  center:        { flex: 1, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' },
  scroll:        { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 36, gap: 12 },

  /* Karşılama */
  greeting:  { marginBottom: 6 },
  greetDate: { color: C.text3, fontSize: 13, fontWeight: '500', marginBottom: 5 },
  greetName: { color: C.text1, fontSize: 26, fontWeight: '700', letterSpacing: -0.3 },

  /* Kart */
  card: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 14,
  },
  cardTitle: {
    color: C.text3,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    flex: 1,
  },

  badge:     { backgroundColor: C.surfaceAlt, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { color: C.text3, fontSize: 12, fontWeight: '600' },

  /* BMI Ring Layout */
  bmiContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },

  bmiRingWrap: {
    width: RING_SIZE,
    height: RING_SIZE,
    position: 'relative',
  },
  bmiRingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bmiRingValue: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  bmiLabelPill: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginTop: 5,
  },
  bmiLabelPillText: {
    fontSize: 11,
    fontWeight: '600',
  },

  /* BMI Stats */
  bmiStats: {
    flex: 1,
    gap: 10,
  },
  bmiStatRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  bmiStatValue: { color: C.text1,  fontSize: 20, fontWeight: '700' },
  bmiStatUnit:  { color: C.text3,  fontSize: 12 },
  bmiStatLabel: { color: C.text3,  fontSize: 12, marginLeft: 2 },
  bmiStatDivider: { height: 1, backgroundColor: C.border },

  /* Günlük İlaç Hatırlatıcısı */
  doseGroup: {
    marginBottom: 10,
  },
  doseGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 8,
  },
  doseGroupLabel: {
    color: C.text3,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  doseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    gap: 10,
  },
  doseRowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  doseCheck:     { width: 20, alignItems: 'center' },
  doseInfo:      { flex: 1 },
  doseName:      { color: C.text1, fontSize: 14, fontWeight: '500' },
  doseDosage:    { color: C.text3, fontSize: 12, marginTop: 2 },

  /* Hastalıklar */
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:     {
    backgroundColor: C.surfaceAlt,
    borderRadius: 20,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: C.border,
  },
  chipText: { color: C.text2, fontSize: 13 },

  /* İlaçlar listesi */
  medRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, gap: 12 },
  medRowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  medDot:       { width: 7, height: 7, borderRadius: 3.5, backgroundColor: C.primary },
  medInfo:      { flex: 1 },
  medName:      { color: C.text1, fontSize: 14, fontWeight: '500' },
  medDosage:    { color: C.text3, fontSize: 12, marginTop: 2 },

  /* CTA */
  cta: {
    backgroundColor: C.primary,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  ctaPressed:    { opacity: 0.82 },
  ctaIcon:       {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  ctaText:       { flex: 1 },
  ctaTitle:      { color: C.text1, fontSize: 15, fontWeight: '700' },
  ctaSub:        { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 2 },

  ctaNearby:     { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  ctaNearbyIcon: { backgroundColor: C.errorDim },
});
