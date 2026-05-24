import { Ionicons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '../lib/supabase';
import type { ConditionCatalogRow } from '../navigation/types';

type Gender = 'male' | 'female' | 'unspecified';

type MedRow = {
  condition_id: string;
  medication: {
    id: string;
    ilac_adi: string;
    etkin_madde_adi: string | null;
  };
};

type Props = {
  onComplete: () => void;
};

const TOTAL_STEPS = 4;

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'male', label: 'Erkek' },
  { value: 'female', label: 'Kadın' },
  { value: 'unspecified', label: 'Belirtmek istemiyorum' },
];

const MONTH_LABELS = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
];

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function buildIsoDate(day: string, month: string, year: string): string | null {
  const d = parseInt(day, 10);
  const m = parseInt(month, 10);
  const y = parseInt(year, 10);
  if (!d || !m || !y) return null;
  const max = daysInMonth(y, m);
  if (d < 1 || d > max) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function groupByCategory(rows: ConditionCatalogRow[]): Map<string, ConditionCatalogRow[]> {
  const map = new Map<string, ConditionCatalogRow[]>();
  for (const row of rows) {
    const cat = row.category?.trim() || 'Diğer';
    const list = map.get(cat) ?? [];
    list.push(row);
    map.set(cat, list);
  }
  return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'tr')));
}

/** getUser() bazen yeni oturumda ağ/sunucu gecikmesiyle boş döner; getSession() yerel oturumu okur. */
async function resolveAuthUserId(maxAttempts = 40, delayMs = 120): Promise<string | null> {
  for (let i = 0; i < maxAttempts; i += 1) {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (!error && user?.id) return user.id;
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.id) return session.user.id;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

export default function OnboardingScreen({ onComplete }: Props) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(null);
  const [userResolveError, setUserResolveError] = useState<string | null>(null);
  const [resolveKey, setResolveKey] = useState(0);

  // ── Navigation ──────────────────────────────────────────────────────────
  const [step, setStep] = useState(1);
  const [stepError, setStepError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // ── Step 1: Kişisel bilgiler ────────────────────────────────────────────
  const [fullName, setFullName] = useState('');
  const [day, setDay] = useState('1');
  const [month, setMonth] = useState('1');
  const [year, setYear] = useState(String(new Date().getFullYear() - 25));
  const [gender, setGender] = useState<Gender | null>(null);

  // ── Step 2: Vücut bilgileri ─────────────────────────────────────────────
  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [bmiWarning, setBmiWarning] = useState(false);

  // ── Step 3: Kronik hastalıklar ──────────────────────────────────────────
  const [conditions, setConditions] = useState<ConditionCatalogRow[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [noChronic, setNoChronic] = useState(false);

  // ── Step 4: İlaçlar ─────────────────────────────────────────────────────
  const [medRows, setMedRows] = useState<MedRow[]>([]);
  const [loadingMeds, setLoadingMeds] = useState(false);
  const [medError, setMedError] = useState<string | null>(null);
  const [medSearch, setMedSearch] = useState('');
  const [selectedMedIds, setSelectedMedIds] = useState<Set<string>>(new Set());
  const [medDosages, setMedDosages] = useState<Map<string, string>>(new Map());
  const [noMedConditions, setNoMedConditions] = useState<Set<string>>(new Set());

  // ── Auth resolve ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setUserResolveError(null);
    setResolvedUserId(null);
    (async () => {
      const id = await resolveAuthUserId();
      if (cancelled) return;
      if (!id) {
        setUserResolveError(
          'Hesap bilgisi henüz yüklenemedi. İnternetini kontrol et veya aşağıdan tekrar dene.',
        );
        return;
      }
      setResolvedUserId(id);
    })();
    return () => { cancelled = true; };
  }, [resolveKey]);

  // ── Picker hesapları ────────────────────────────────────────────────────
  const years = useMemo(() => {
    const y = new Date().getFullYear();
    return Array.from({ length: 100 }, (_, i) => String(y - i));
  }, []);

  const dayItems = useMemo(() => {
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    const max = Number.isFinite(y) && Number.isFinite(m) ? daysInMonth(y, m) : 31;
    return Array.from({ length: max }, (_, i) => String(i + 1));
  }, [year, month]);

  useEffect(() => {
    const d = parseInt(day, 10);
    if (d > dayItems.length) setDay(String(dayItems.length));
  }, [dayItems, day]);

  // ── BMI kontrolü ────────────────────────────────────────────────────────
  useEffect(() => {
    const h = parseInt(heightCm.replace(',', '.').trim(), 10);
    const w = parseInt(weightKg.replace(',', '.').trim(), 10);
    if (!Number.isFinite(h) || !Number.isFinite(w) || h <= 0 || w <= 0) {
      setBmiWarning(false);
      return;
    }
    setBmiWarning(w / Math.pow(h / 100, 2) < 10 || w / Math.pow(h / 100, 2) > 60);
  }, [heightCm, weightKg]);

  // ── Step 3: Hastalık kataloğu yükle ────────────────────────────────────
  useEffect(() => {
    if (step !== 3) return;
    let cancelled = false;
    (async () => {
      setLoadingCatalog(true);
      setCatalogError(null);
      const { data, error } = await supabase.from('conditions_catalog').select('id, name, category');
      if (cancelled) return;
      setLoadingCatalog(false);
      if (error) { setCatalogError('Liste yüklenemedi. Bağlantını kontrol et.'); return; }
      const rows = ((data ?? []) as ConditionCatalogRow[]).slice().sort((a, b) => {
        const c = (a.category || '').localeCompare(b.category || '', 'tr');
        return c !== 0 ? c : (a.name || '').localeCompare(b.name || '', 'tr');
      });
      setConditions(rows);
    })();
    return () => { cancelled = true; };
  }, [step]);

  // ── Step 4: İlaçları condition_medications'tan yükle ───────────────────
  useEffect(() => {
    if (step !== 4) return;
    if (noChronic || selectedIds.size === 0) return;
    let cancelled = false;
    setLoadingMeds(true);
    setMedError(null);
    (async () => {
      const selectedConditionIds = Array.from(selectedIds);
      console.log('[Step4] selectedConditionIds:', selectedConditionIds);
      console.log('[Step4] Supabase sorgusu: condition_medications.select(...).in("condition_id",', selectedConditionIds, ')');

      const { data, error } = await supabase
        .from('condition_medications')
        .select('condition_id, medications(id, ilac_adi, etkin_madde_adi)')
        .in('condition_id', selectedConditionIds);

      console.log('[Step4] Gelen veri:', JSON.stringify(data, null, 2));
      console.log('[Step4] Hata:', error);

      if (cancelled) return;
      setLoadingMeds(false);
      if (error) { setMedError('İlaçlar yüklenemedi. Bağlantını kontrol et.'); return; }
      type RawRow = {
        condition_id: string;
        medications: { id: string; ilac_adi: string; etkin_madde_adi: string | null } | null;
      };
      const rows: MedRow[] = ((data ?? []) as RawRow[])
        .filter((r) => r.medications != null)
        .map((r) => ({ condition_id: r.condition_id, medication: r.medications! }));
      console.log('[Step4] Parse edilmiş rows:', rows.length, 'adet');
      setMedRows(rows);
    })();
    return () => { cancelled = true; };
  }, [step, selectedIds, noChronic]);

  // ── Step 3: filtre + gruplama ───────────────────────────────────────────
  const filteredConditions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conditions;
    return conditions.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.category ?? '').toLowerCase().includes(q),
    );
  }, [conditions, search]);

  const grouped = useMemo(() => groupByCategory(filteredConditions), [filteredConditions]);

  const selectedRows = useMemo(
    () => conditions.filter((c) => selectedIds.has(c.id)),
    [conditions, selectedIds],
  );

  // ── Step 4: filtre + gruplama ───────────────────────────────────────────
  const conditionNameMap = useMemo(
    () => new Map(selectedRows.map((c) => [c.id, c.name])),
    [selectedRows],
  );

  const medsGrouped = useMemo(() => {
    const q = medSearch.trim().toLowerCase();
    const filtered = q
      ? medRows.filter(
          (r) =>
            r.medication.ilac_adi.toLowerCase().includes(q) ||
            (r.medication.etkin_madde_adi?.toLowerCase().includes(q) ?? false),
        )
      : medRows;

    const map = new Map<string, MedRow[]>();
    for (const row of filtered) {
      const list = map.get(row.condition_id) ?? [];
      if (!list.some((r) => r.medication.id === row.medication.id)) {
        list.push(row);
      }
      map.set(row.condition_id, list);
    }
    return map;
  }, [medRows, medSearch]);

  // ── Step 3: toggle'lar ──────────────────────────────────────────────────
  const toggleCondition = useCallback((id: string) => {
    setNoChronic(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const removeChip = (id: string) => {
    setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
  };

  const toggleNoChronic = useCallback(() => {
    setNoChronic((prev) => { if (!prev) setSelectedIds(new Set()); return !prev; });
  }, []);

  // ── Step 4: toggle'lar ──────────────────────────────────────────────────
  const toggleMed = useCallback((medId: string) => {
    setSelectedMedIds((prev) => {
      const next = new Set(prev);
      if (next.has(medId)) {
        next.delete(medId);
        setMedDosages((d) => { const nd = new Map(d); nd.delete(medId); return nd; });
      } else {
        next.add(medId);
      }
      return next;
    });
  }, []);

  const toggleNoMedCondition = useCallback(
    (conditionId: string) => {
      setNoMedConditions((prev) => {
        const next = new Set(prev);
        if (next.has(conditionId)) {
          next.delete(conditionId);
        } else {
          next.add(conditionId);
          const condMedIds = medRows
            .filter((r) => r.condition_id === conditionId)
            .map((r) => r.medication.id);
          setSelectedMedIds((sm) => {
            const nsm = new Set(sm);
            condMedIds.forEach((id) => nsm.delete(id));
            return nsm;
          });
        }
        return next;
      });
    },
    [medRows],
  );

  const setDosage = useCallback((medId: string, value: string) => {
    setMedDosages((prev) => { const next = new Map(prev); next.set(medId, value); return next; });
  }, []);

  // ── Validasyon ──────────────────────────────────────────────────────────
  const validateStep1 = (): boolean => {
    if (!fullName.trim()) { setStepError('Ad soyad gerekli.'); return false; }
    if (!buildIsoDate(day, month, year)) { setStepError('Geçerli bir doğum tarihi seç.'); return false; }
    if (!gender) { setStepError('Cinsiyet seçimi gerekli.'); return false; }
    return true;
  };

  const validateStep2 = (): boolean => {
    const h = parseInt(heightCm.replace(',', '.').trim(), 10);
    const w = parseInt(weightKg.replace(',', '.').trim(), 10);
    if (!Number.isFinite(h) || h < 50 || h > 250) { setStepError('Boy 50–250 cm arasında olmalı.'); return false; }
    if (!Number.isFinite(w) || w < 10 || w > 300) { setStepError('Kilo 10–300 kg arasında olmalı.'); return false; }
    if (bmiWarning) { setStepError('Lütfen değerleri kontrol edin.'); return false; }
    return true;
  };

  // ── Navigasyon ──────────────────────────────────────────────────────────
  const goNext = () => {
    setStepError(null);
    if (step === 1) { if (!validateStep1()) return; setStep(2); return; }
    if (step === 2) { if (!validateStep2()) return; setStep(3); return; }
    if (step === 3) { setStep(4); return; }
  };

  const goBack = () => {
    setStepError(null);
    if (step > 1) setStep((s) => s - 1);
  };

  // ── Kaydet ──────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaveError(null);
    if (!validateStep1()) { setStep(1); return; }
    if (!validateStep2()) { setStep(2); return; }
    const birthIso = buildIsoDate(day, month, year);
    if (!birthIso || !gender) return;
    if (!resolvedUserId) { setSaveError('Kullanıcı doğrulanamadı. Sayfayı yenile.'); return; }

    const h = parseInt(heightCm.replace(',', '.').trim(), 10);
    const w = parseInt(weightKg.replace(',', '.').trim(), 10);

    setSaving(true);
    try {
      // 1. Profil
      const { error: profileErr } = await supabase.from('profiles').upsert(
        { id: resolvedUserId, full_name: fullName.trim(), birth_date: birthIso, gender, height_cm: h, weight_kg: w, onboarding_completed: true },
        { onConflict: 'id' },
      );
      if (profileErr) { setSaveError(profileErr.message || 'Profil kaydedilemedi.'); return; }

      // 2. Hastalıklar
      const { error: delCondErr } = await supabase
        .from('user_conditions')
        .delete()
        .eq('user_id', resolvedUserId);
      if (delCondErr) { setSaveError(delCondErr.message || 'Kayıtlar temizlenemedi.'); return; }

      if (!noChronic && selectedIds.size > 0) {
        const condRows = [...selectedIds].map((condition_id) => ({ user_id: resolvedUserId, condition_id }));
        const { error: insCondErr } = await supabase.from('user_conditions').insert(condRows);
        if (insCondErr) { setSaveError(insCondErr.message || 'Hastalık seçimleri kaydedilemedi.'); return; }
      }

      // 3. İlaçlar
      const { error: delMedErr } = await supabase
        .from('user_medications')
        .delete()
        .eq('user_id', resolvedUserId);
      if (delMedErr) { setSaveError(delMedErr.message || 'İlaç kayıtları temizlenemedi.'); return; }

      if (selectedMedIds.size > 0) {
        const medInsertRows = [...selectedMedIds].map((medication_id) => ({
          user_id: resolvedUserId,
          medication_id,
          dosage: medDosages.get(medication_id)?.trim() || null,
          is_active: true,
        }));
        const { error: medInsErr } = await supabase.from('user_medications').insert(medInsertRows);
        if (medInsErr) { setSaveError(medInsErr.message || 'İlaç seçimleri kaydedilemedi.'); return; }
      }

      onComplete();
    } finally {
      setSaving(false);
    }
  };

  const progress = step / TOTAL_STEPS;

  // ── Auth yükleniyor / hata ──────────────────────────────────────────────
  if (userResolveError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <View style={styles.userBoot}>
          <Text style={styles.err}>{userResolveError}</Text>
          <Pressable style={styles.retryBtn} onPress={() => setResolveKey((k) => k + 1)}>
            <Text style={styles.retryBtnText}>Tekrar dene</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!resolvedUserId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <View style={styles.userBoot}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.userBootText}>Hesabın hazırlanıyor…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {/* Progress */}
      <View style={styles.progressWrap}>
        <Text style={styles.progressLabel}>Adım {step} / {TOTAL_STEPS}</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Step 1: Kişisel bilgiler ── */}
        {step === 1 ? (
          <>
            <Text style={styles.title}>Kişisel bilgiler</Text>
            <Text style={styles.fieldLabel}>Ad Soyad</Text>
            <TextInput
              style={styles.input}
              value={fullName}
              onChangeText={setFullName}
              placeholder="Adın Soyadın"
              placeholderTextColor="#888"
              autoCapitalize="words"
              editable={!saving}
            />
            <Text style={styles.fieldLabel}>Doğum tarihi</Text>
            <View style={styles.pickerRow}>
              <View style={styles.pickerCol}>
                <Text style={styles.pickerCaption}>Gün</Text>
                <View style={styles.pickerBox}>
                  <Picker selectedValue={day} onValueChange={(v) => setDay(String(v))} style={styles.picker} dropdownIconColor="#fff">
                    {dayItems.map((d) => <Picker.Item key={d} label={d} value={d} color="#fff" />)}
                  </Picker>
                </View>
              </View>
              <View style={styles.pickerCol}>
                <Text style={styles.pickerCaption}>Ay</Text>
                <View style={styles.pickerBox}>
                  <Picker selectedValue={month} onValueChange={(v) => setMonth(String(v))} style={styles.picker} dropdownIconColor="#fff">
                    {MONTH_LABELS.map((label, idx) => {
                      const v = String(idx + 1);
                      return <Picker.Item key={v} label={label} value={v} color="#fff" />;
                    })}
                  </Picker>
                </View>
              </View>
              <View style={styles.pickerCol}>
                <Text style={styles.pickerCaption}>Yıl</Text>
                <View style={styles.pickerBox}>
                  <Picker selectedValue={year} onValueChange={(v) => setYear(String(v))} style={styles.picker} dropdownIconColor="#fff">
                    {years.map((y) => <Picker.Item key={y} label={y} value={y} color="#fff" />)}
                  </Picker>
                </View>
              </View>
            </View>
            <Text style={styles.fieldLabel}>Cinsiyet</Text>
            <View style={styles.genderRow}>
              {GENDER_OPTIONS.map(({ value, label }) => {
                const on = gender === value;
                return (
                  <Pressable key={value} style={[styles.chip, on && styles.chipSelected]} onPress={() => setGender(value)} disabled={saving}>
                    <Text style={[styles.chipText, on && styles.chipTextSelected]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {/* ── Step 2: Vücut bilgileri ── */}
        {step === 2 ? (
          <>
            <Text style={styles.title}>Vücut bilgileri</Text>
            <Text style={styles.fieldLabel}>Boy (cm)</Text>
            <TextInput
              style={styles.input}
              value={heightCm}
              onChangeText={(t) => setHeightCm(t.replace(/[^0-9]/g, ''))}
              placeholder="50 – 250"
              placeholderTextColor="#888"
              keyboardType="number-pad"
              editable={!saving}
            />
            <Text style={styles.fieldLabel}>Kilo (kg)</Text>
            <TextInput
              style={styles.input}
              value={weightKg}
              onChangeText={(t) => setWeightKg(t.replace(/[^0-9]/g, ''))}
              placeholder="10 – 300"
              placeholderTextColor="#888"
              keyboardType="number-pad"
              editable={!saving}
            />
            {bmiWarning ? <Text style={styles.bmiWarn}>Lütfen değerleri kontrol edin.</Text> : null}
          </>
        ) : null}

        {/* ── Step 3: Kronik hastalıklar ── */}
        {step === 3 ? (
          <>
            <Text style={styles.title}>Kronik hastalıklar</Text>
            {selectedRows.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipScrollInner}>
                {selectedRows.map((row) => (
                  <Pressable key={row.id} style={styles.badge} onPress={() => removeChip(row.id)}>
                    <Text style={styles.badgeText} numberOfLines={1}>{row.name}</Text>
                    <Ionicons name="close-circle" size={18} color="#ccc" />
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
            <TextInput
              style={styles.input}
              value={search}
              onChangeText={setSearch}
              placeholder="Hastalık ara..."
              placeholderTextColor="#888"
              editable={!saving}
            />
            <Pressable
              style={[styles.checkRow, styles.noChronicRow, noChronic && styles.checkRowSelected]}
              onPress={toggleNoChronic}
              disabled={saving || loadingCatalog}
            >
              <Ionicons name={noChronic ? 'checkbox' : 'square-outline'} size={22} color={noChronic ? '#8ab4ff' : '#aaa'} />
              <Text style={styles.noChronicLabel}>Kronik hastalığım yok</Text>
            </Pressable>
            {loadingCatalog ? <ActivityIndicator style={{ marginVertical: 20 }} color="#fff" /> : null}
            {catalogError ? <Text style={styles.err}>{catalogError}</Text> : null}
            {[...grouped.entries()].map(([category, rows]) => (
              <View key={category} style={styles.categoryBlock}>
                <Text style={styles.categoryTitle}>{category}</Text>
                {rows.map((row) => {
                  const on = selectedIds.has(row.id);
                  return (
                    <Pressable
                      key={row.id}
                      style={[styles.checkRow, on && styles.checkRowSelected]}
                      onPress={() => toggleCondition(row.id)}
                      disabled={saving || noChronic || loadingCatalog}
                    >
                      <Text style={styles.rowName}>{row.name}</Text>
                      <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? '#8ab4ff' : '#aaa'} />
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </>
        ) : null}

        {/* ── Step 4: İlaçlar ── */}
        {step === 4 ? (
          <>
            <Text style={styles.title}>Kullandığın İlaçlar</Text>

            {noChronic || selectedIds.size === 0 ? (
              <Text style={styles.infoText}>
                Kronik hastalık seçmediğin için bu adımı atlayabilirsin.
              </Text>
            ) : (
              <>
                <TextInput
                  style={styles.input}
                  value={medSearch}
                  onChangeText={setMedSearch}
                  placeholder="İlaç adı ara..."
                  placeholderTextColor="#888"
                  editable={!saving}
                />
                {loadingMeds ? <ActivityIndicator style={{ marginVertical: 20 }} color="#fff" /> : null}
                {medError ? <Text style={styles.err}>{medError}</Text> : null}

                {[...medsGrouped.entries()].map(([conditionId, meds]) => {
                  const condName = conditionNameMap.get(conditionId) ?? conditionId;
                  const noMed = noMedConditions.has(conditionId);
                  return (
                    <View key={conditionId} style={styles.categoryBlock}>
                      <Text style={styles.categoryTitle}>{condName}</Text>
                      <Pressable
                        style={[styles.checkRow, styles.noChronicRow, noMed && styles.checkRowSelected]}
                        onPress={() => toggleNoMedCondition(conditionId)}
                        disabled={saving}
                      >
                        <Ionicons name={noMed ? 'checkbox' : 'square-outline'} size={22} color={noMed ? '#8ab4ff' : '#aaa'} />
                        <Text style={styles.noChronicLabel}>Bu hastalık için ilaç kullanmıyorum</Text>
                      </Pressable>
                      {!noMed
                        ? meds.map(({ medication }) => {
                            const selected = selectedMedIds.has(medication.id);
                            return (
                              <View key={medication.id}>
                                <Pressable
                                  style={[styles.checkRow, selected && styles.checkRowSelected]}
                                  onPress={() => toggleMed(medication.id)}
                                  disabled={saving}
                                >
                                  <View style={styles.medInfo}>
                                    <Text style={styles.rowName}>{medication.ilac_adi}</Text>
                                    {medication.etkin_madde_adi ? (
                                      <Text style={styles.medSub}>{medication.etkin_madde_adi}</Text>
                                    ) : null}
                                  </View>
                                  <Ionicons name={selected ? 'checkbox' : 'square-outline'} size={22} color={selected ? '#8ab4ff' : '#aaa'} />
                                </Pressable>
                                {selected ? (
                                  <TextInput
                                    style={styles.dosageInput}
                                    value={medDosages.get(medication.id) ?? ''}
                                    onChangeText={(v) => setDosage(medication.id, v)}
                                    placeholder="Doz (örn: 500 mg, günde 2×) — opsiyonel"
                                    placeholderTextColor="#555"
                                    editable={!saving}
                                  />
                                ) : null}
                              </View>
                            );
                          })
                        : null}
                    </View>
                  );
                })}

                {!loadingMeds && medsGrouped.size === 0 && !medError ? (
                  <Text style={styles.infoText}>
                    Seçilen hastalıklar için veritabanında ilaç kaydı bulunamadı.
                  </Text>
                ) : null}
              </>
            )}
          </>
        ) : null}

        {stepError ? <Text style={styles.err}>{stepError}</Text> : null}
        {saveError ? <Text style={styles.err}>{saveError}</Text> : null}
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        {step > 1 ? (
          <Pressable style={styles.secondaryBtn} onPress={goBack} disabled={saving}>
            <Text style={styles.secondaryBtnText}>Geri</Text>
          </Pressable>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        {step < TOTAL_STEPS ? (
          <Pressable style={styles.primaryBtn} onPress={goNext} disabled={saving}>
            <Text style={styles.primaryBtnText}>İleri</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.primaryBtn, saving && styles.primaryBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#0a0a0a" />
            ) : (
              <Text style={styles.primaryBtnText}>Tamamla</Text>
            )}
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  progressWrap: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  progressLabel: { color: '#fff', fontSize: 14, fontWeight: '600', marginBottom: 8 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: '#2a2a2a', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: '#ffffff' },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 32 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 16 },
  fieldLabel: { color: '#fff', fontSize: 14, fontWeight: '500', marginBottom: 8, marginTop: 4 },
  input: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    color: '#fff',
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 16,
  },
  pickerRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  pickerCol: { flex: 1 },
  pickerCaption: { color: '#aaa', fontSize: 12, marginBottom: 6 },
  pickerBox: { borderRadius: 10, borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#1a1a1a', overflow: 'hidden' },
  picker: { color: '#fff' },
  genderRow: { gap: 10 },
  chip: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#333',
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
    backgroundColor: '#141414',
  },
  chipSelected: { borderColor: '#8ab4ff', backgroundColor: '#1a2332' },
  chipText: { color: '#ccc', fontSize: 15 },
  chipTextSelected: { color: '#fff', fontWeight: '600' },
  bmiWarn: { color: '#ffb74d', fontSize: 14, marginTop: 4, marginBottom: 8 },
  chipScroll: { maxHeight: 44, marginBottom: 12 },
  chipScrollInner: { gap: 8, alignItems: 'center', paddingRight: 8 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#252525',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#3a3a3a',
    maxWidth: 220,
  },
  badgeText: { color: '#fff', fontSize: 13, flexShrink: 1 },
  categoryBlock: { marginTop: 16 },
  categoryTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 10 },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    marginBottom: 8,
    backgroundColor: '#121212',
  },
  checkRowSelected: { borderColor: '#4a5a7a', backgroundColor: '#1a1f28' },
  noChronicRow: { gap: 12 },
  noChronicLabel: { color: '#fff', fontSize: 15, flex: 1 },
  rowName: { color: '#fff', fontSize: 15, flex: 1, marginRight: 12 },
  medInfo: { flex: 1, marginRight: 12 },
  medSub: { color: '#888', fontSize: 12, marginTop: 2 },
  dosageInput: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 8,
    color: '#ccc',
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: -2,
    marginBottom: 8,
    marginHorizontal: 2,
  },
  infoText: { color: '#888', fontSize: 15, marginTop: 8, lineHeight: 22 },
  err: { color: '#ff8a80', fontSize: 14, marginTop: 12 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#444',
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  primaryBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnDisabled: { opacity: 0.7 },
  primaryBtnText: { color: '#0a0a0a', fontSize: 16, fontWeight: '700' },
  userBoot: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  userBootText: { color: '#aaa', marginTop: 16, fontSize: 15 },
  retryBtn: { marginTop: 24, backgroundColor: '#ffffff', paddingVertical: 14, paddingHorizontal: 28, borderRadius: 10 },
  retryBtnText: { color: '#0a0a0a', fontSize: 16, fontWeight: '700' },
});
