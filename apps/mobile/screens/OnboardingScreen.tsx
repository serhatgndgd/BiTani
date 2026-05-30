import { Ionicons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  groupMedicationsByBrand,
  medicationVariantLabel,
  type MedicationBrandGroup as BaseMedicationBrandGroup,
} from '../lib/medicationBranding';
import { supabase } from '../lib/supabase';
import type { ConditionCatalogRow } from '../navigation/types';
import { C } from '../theme';

type Gender = 'male' | 'female' | 'unspecified';

type MedRow = {
  condition_id: string;
  medication: {
    id: string;
    ilac_adi: string;
    etkin_madde_adi: string | null;
  };
};

type MedicationBrandGroup = BaseMedicationBrandGroup<MedRow> & {
  conditionId: string;
};

type ConditionSection = { title: string; data: ConditionCatalogRow[] };
type MedSection      = { conditionId: string; title: string; data: MedicationBrandGroup[] };

type Props = { onComplete: () => void };

const TOTAL_STEPS = 4;

// Hastalığa göre ilaç önerisi (condition_medications) parametreleri
const CONDITION_MED_CONFIDENCE_MIN = 0.7;
const CONDITION_MED_LIMIT = 100; // hastalık başına en yüksek güvenli öneri sayısı
const DATE_PICKER_LOCALE = 'tr-TR';

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'male',        label: 'Erkek' },
  { value: 'female',      label: 'Kadın' },
  { value: 'unspecified', label: 'Belirtmek istemiyorum' },
];

const MONTH_LABELS = [
  ...Array.from({ length: 12 }, (_, index) =>
    new Date(2020, index, 1).toLocaleString(DATE_PICKER_LOCALE, { month: 'long' }),
  ),
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

function isAtLeast18(isoDate: string | null): boolean {
  if (!isoDate) return false;
  const birthDate = new Date(isoDate);
  if (Number.isNaN(birthDate.getTime())) return false;
  const adultDate = new Date();
  adultDate.setFullYear(adultDate.getFullYear() - 18);
  return birthDate.getTime() <= adultDate.getTime();
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

function groupMedRowsByBrand(rows: MedRow[], conditionId: string): MedicationBrandGroup[] {
  return groupMedicationsByBrand(rows, (row) => row.medication.ilac_adi)
    .map((group) => ({ ...group, conditionId }));
}

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

// ─── Seçim ikonu yardımcısı ───────────────────────────────────────────────────

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];
const ICON_ON:  IoniconsName = 'checkmark-circle';
const ICON_OFF: IoniconsName = 'checkmark-circle-outline';

const ONBOARDING_SAVE_ERROR_TEXT = 'Bilgileriniz kaydedilemedi. Tekrar deneyin';
const NETWORK_ERROR_TEXT = 'İnternet bağlantınızı kontrol edin';

function isNetworkError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = 'message' in error ? String(error.message ?? '').toLowerCase() : '';
  return (
    message.includes('network') ||
    message.includes('failed to fetch') ||
    message.includes('request failed') ||
    message.includes('timeout')
  );
}

export default function OnboardingScreen({ onComplete }: Props) {
  const [resolvedUserId, setResolvedUserId]     = useState<string | null>(null);
  const [userResolveError, setUserResolveError] = useState<string | null>(null);
  const [resolveKey, setResolveKey]             = useState(0);

  const [step, setStep]           = useState(1);
  const [stepError, setStepError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving]       = useState(false);

  const [fullName, setFullName] = useState('');
  const [day, setDay]           = useState('1');
  const [month, setMonth]       = useState('1');
  const [year, setYear]         = useState(String(new Date().getFullYear() - 25));
  const [gender, setGender]     = useState<Gender | null>(null);

  const [heightCm, setHeightCm]     = useState('');
  const [weightKg, setWeightKg]     = useState('');
  const [bmiWarning, setBmiWarning] = useState(false);

  const [conditions, setConditions]             = useState<ConditionCatalogRow[]>([]);
  const [catalogError, setCatalogError]         = useState<string | null>(null);
  const [loadingCatalog, setLoadingCatalog]     = useState(false);
  const [search, setSearch]                     = useState('');
  const [selectedIds, setSelectedIds]           = useState<Set<string>>(new Set());
  const [noChronic, setNoChronic]               = useState(false);

  const [medRows, setMedRows]                   = useState<MedRow[]>([]);
  const [loadingMeds, setLoadingMeds]           = useState(false);
  const [medError, setMedError]                 = useState<string | null>(null);
  const [condMedRows, setCondMedRows]           = useState<MedRow[]>([]);
  const [loadingCondMeds, setLoadingCondMeds]   = useState(false);
  const [condMedError, setCondMedError]         = useState<string | null>(null);
  const [medSearch, setMedSearch]               = useState('');
  const [selectedMedIds, setSelectedMedIds]     = useState<Set<string>>(new Set());
  const [medDosages, setMedDosages]             = useState<Map<string, string>>(new Map());
  const [noMedConditions, setNoMedConditions]   = useState<Set<string>>(new Set());
  const [expandedMedBrands, setExpandedMedBrands] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setUserResolveError(null);
    setResolvedUserId(null);
    (async () => {
      const id = await resolveAuthUserId();
      if (cancelled) return;
      if (!id) {
        console.error('onboarding-screen:', new Error('auth-user-unresolved'));
        setUserResolveError('Hesap bilgisi henüz yüklenemedi. İnternetini kontrol et veya aşağıdan tekrar dene.');
        return;
      }
      setResolvedUserId(id);
    })();
    return () => { cancelled = true; };
  }, [resolveKey]);

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

  useEffect(() => {
    const h = parseInt(heightCm.replace(',', '.').trim(), 10);
    const w = parseInt(weightKg.replace(',', '.').trim(), 10);
    if (!Number.isFinite(h) || !Number.isFinite(w) || h <= 0 || w <= 0) { setBmiWarning(false); return; }
    setBmiWarning(w / Math.pow(h / 100, 2) < 10 || w / Math.pow(h / 100, 2) > 60);
  }, [heightCm, weightKg]);

  useEffect(() => {
    if (step !== 3) return;
    let cancelled = false;
    (async () => {
      setLoadingCatalog(true); setCatalogError(null);
      const { data, error } = await supabase.from('conditions_catalog').select('id, name, category');
      if (cancelled) return;
      setLoadingCatalog(false);
      if (error) {
        console.error('onboarding-screen:', error);
        setCatalogError('Liste yüklenemedi. Bağlantını kontrol et.');
        return;
      }
      const rows = ((data ?? []) as ConditionCatalogRow[]).slice().sort((a, b) => {
        const c = (a.category || '').localeCompare(b.category || '', 'tr');
        return c !== 0 ? c : (a.name || '').localeCompare(b.name || '', 'tr');
      });
      setConditions(rows);
    })();
    return () => { cancelled = true; };
  }, [step]);

  useEffect(() => {
    if (step !== 4) return;
    const q = medSearch.trim();
    if (q.length < 2) {
      setMedRows([]);
      setLoadingMeds(false);
      setMedError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoadingMeds(true); setMedError(null);
      const { data, error } = await supabase
        .from('medicationsV2')
        .select('id, ilac_adi, etkin_madde_adi')
        .or(`ilac_adi.ilike.%${q}%,etkin_madde_adi.ilike.%${q}%`)
        .order('ilac_adi')
        .limit(40);
      if (cancelled) return;
      setLoadingMeds(false);
      if (error) {
        console.error('onboarding-screen:', error);
        setMedError('İlaçlar yüklenemedi. Bağlantını kontrol et.');
        setMedRows([]);
        return;
      }
      type MedicationSearchRow = { id: string; ilac_adi: string; etkin_madde_adi: string | null };
      const rows: MedRow[] = ((data ?? []) as MedicationSearchRow[]).map((medication) => ({
        condition_id: '__search__',
        medication,
      }));
      setMedRows(rows);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [step, medSearch]);

  // Step 4: seçili hastalıklara göre condition_medications'tan öneri yükle
  useEffect(() => {
    if (step !== 4) return;
    const condIds = [...selectedIds];
    if (noChronic || condIds.length === 0) {
      setCondMedRows([]);
      setCondMedError(null);
      setLoadingCondMeds(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingCondMeds(true); setCondMedError(null);
      try {
        type CondMedQueryRow = {
          confidence_score: number;
          medicationsV2: { id: string; ilac_adi: string; etkin_madde_adi: string | null } | null;
        };
        const perCondition = await Promise.all(
          condIds.map(async (conditionId) => {
            const { data, error } = await supabase
              .from('condition_medications')
              .select('confidence_score, medicationsV2(id, ilac_adi, etkin_madde_adi)')
              .eq('condition_id', conditionId)
              .gte('confidence_score', CONDITION_MED_CONFIDENCE_MIN)
              .order('confidence_score', { ascending: false })
              .limit(CONDITION_MED_LIMIT);
            if (error) throw new Error(error.message);
            return ((data ?? []) as unknown as CondMedQueryRow[])
              .filter((r) => r.medicationsV2 !== null)
              .map<MedRow>((r) => ({
                condition_id: conditionId,
                medication: r.medicationsV2 as NonNullable<CondMedQueryRow['medicationsV2']>,
              }));
          }),
        );
        if (cancelled) return;
        setCondMedRows(perCondition.flat());
      } catch (e) {
        if (cancelled) return;
        console.error('onboarding-screen:', e);
        setCondMedRows([]);
        setCondMedError('Öneriler yüklenemedi. İlacını adıyla arayabilirsin.');
      } finally {
        if (!cancelled) setLoadingCondMeds(false);
      }
    })();
    return () => { cancelled = true; };
  }, [step, selectedIds, noChronic]);

  const filteredConditions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conditions;
    return conditions.filter((c) => c.name.toLowerCase().includes(q) || (c.category ?? '').toLowerCase().includes(q));
  }, [conditions, search]);

  const grouped      = useMemo(() => groupByCategory(filteredConditions), [filteredConditions]);
  const selectedRows = useMemo(() => conditions.filter((c) => selectedIds.has(c.id)), [conditions, selectedIds]);
  const conditionNameMap = useMemo(() => new Map(selectedRows.map((c) => [c.id, c.name])), [selectedRows]);

  // Hastalığa göre öneriler (arama boşken gösterilir) — condition_id ile gruplu
  const condMedsGrouped = useMemo(() => {
    const map = new Map<string, MedRow[]>();
    for (const row of condMedRows) {
      const list = map.get(row.condition_id) ?? [];
      if (!list.some((r) => r.medication.id === row.medication.id)) list.push(row);
      map.set(row.condition_id, list);
    }
    return map;
  }, [condMedRows]);

  // ─── SectionList veri dönüşümleri ────────────────────────────────────────────

  const conditionSections = useMemo<ConditionSection[]>(
    () => [...grouped.entries()].map(([title, data]) => ({ title, data })),
    [grouped],
  );

  const medSections = useMemo<MedSection[]>(
    () =>
      [...condMedsGrouped.entries()].map(([conditionId, meds]) => ({
        conditionId,
        title: conditionNameMap.get(conditionId) ?? conditionId,
        data: noMedConditions.has(conditionId) ? [] : groupMedRowsByBrand(meds, conditionId),
      })),
    [condMedsGrouped, conditionNameMap, noMedConditions],
  );

  // Serbest arama: condition başvurusu olmaksızın, unique ilaçların düz listesi
  const flatMedResults = useMemo<MedRow[]>(() => {
    const q = medSearch.trim().toLowerCase();
    if (!q) return [];
    const seen = new Set<string>();
    const result: MedRow[] = [];
    for (const row of medRows) {
      if (!seen.has(row.medication.id)) {
        if (
          row.medication.ilac_adi.toLowerCase().includes(q) ||
          (row.medication.etkin_madde_adi?.toLowerCase().includes(q) ?? false)
        ) {
          seen.add(row.medication.id);
          result.push(row);
        }
      }
    }
    return result;
  }, [medRows, medSearch]);

  // Step 4 için tek SectionList kullanılır; search modunda tek section, normal modda condition'a göre gruplu.
  // Bu şekilde TextInput focus kaybedilmez.
  const step4Sections = useMemo<MedSection[]>(() => {
    if (medSearch.trim()) {
      return [{
        conditionId: '__search__',
        title: '',
        data: groupMedRowsByBrand(flatMedResults, '__search__'),
      }];
    }
    return medSections;
  }, [medSearch, flatMedResults, medSections]);

  // ─── Callbacks ───────────────────────────────────────────────────────────────

  const toggleCondition = useCallback((id: string) => {
    setNoChronic(false);
    setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);

  const removeChip = useCallback((id: string) => {
    setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }, []);

  const toggleNoChronic = useCallback(() => {
    setNoChronic((prev) => { if (!prev) setSelectedIds(new Set()); return !prev; });
  }, []);

  const toggleMed = useCallback((medId: string) => {
    setSelectedMedIds((prev) => {
      const n = new Set(prev);
      if (n.has(medId)) { n.delete(medId); setMedDosages((d) => { const nd = new Map(d); nd.delete(medId); return nd; }); }
      else n.add(medId);
      return n;
    });
  }, []);

  const toggleNoMedCondition = useCallback((conditionId: string) => {
    setNoMedConditions((prev) => {
      const n = new Set(prev);
      if (n.has(conditionId)) {
        n.delete(conditionId);
      } else {
        n.add(conditionId);
        const ids = condMedRows.filter((r) => r.condition_id === conditionId).map((r) => r.medication.id);
        setSelectedMedIds((sm) => { const nsm = new Set(sm); ids.forEach((id) => nsm.delete(id)); return nsm; });
      }
      return n;
    });
  }, [condMedRows]);

  const setDosage = useCallback((medId: string, val: string) => {
    setMedDosages((prev) => { const n = new Map(prev); n.set(medId, val); return n; });
  }, []);

  const toggleExpandedMedBrand = useCallback((key: string) => {
    setExpandedMedBrands((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // ─── SectionList render callbackleri — Step 3 ────────────────────────────────

  const keyExtractorCondition = useCallback((item: ConditionCatalogRow) => item.id, []);

  const renderConditionItem = useCallback(
    ({ item }: { item: ConditionCatalogRow }) => {
      const on = selectedIds.has(item.id);
      return (
        <Pressable
          style={[styles.checkRow, on && styles.checkRowSelected]}
          onPress={() => toggleCondition(item.id)}
          disabled={saving || noChronic || loadingCatalog}>
          <Text style={styles.rowName}>{item.name}</Text>
          <Ionicons name={on ? ICON_ON : ICON_OFF} size={22} color={on ? C.primary : C.text3} />
        </Pressable>
      );
    },
    [selectedIds, saving, noChronic, loadingCatalog, toggleCondition],
  );

  const renderConditionSectionHeader = useCallback(
    ({ section: { title } }: { section: ConditionSection }) => (
      <View style={styles.stickyHeader}>
        <Text style={styles.categoryTitle}>{title}</Text>
      </View>
    ),
    [],
  );

  // useMemo → React element: ListHeaderComponent'a geçildiğinde TextInput focus kaybolmaz
  const step3Header = useMemo(
    () => (
      <>
        <Text style={styles.title}>Kronik hastalıklar</Text>
        {selectedRows.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            style={styles.chipScroll} contentContainerStyle={styles.chipScrollInner}>
            {selectedRows.map((row) => (
              <Pressable key={row.id} style={styles.badge} onPress={() => removeChip(row.id)}>
                <Text style={styles.badgeText} numberOfLines={1}>{row.name}</Text>
                <Ionicons name="close-circle" size={18} color={C.text2} />
              </Pressable>
            ))}
          </ScrollView>
        )}
        <TextInput
          style={styles.input}
          value={search}
          onChangeText={setSearch}
          placeholder="Hastalık ara..."
          placeholderTextColor={C.text3}
          editable={!saving}
        />
        <Pressable
          style={[styles.checkRow, styles.noChronicRow, noChronic && styles.checkRowSelected]}
          onPress={toggleNoChronic}
          disabled={saving || loadingCatalog}>
          <Ionicons name={noChronic ? ICON_ON : ICON_OFF} size={22} color={noChronic ? C.primary : C.text3} />
          <Text style={styles.noChronicLabel}>Kronik hastalığım yok</Text>
        </Pressable>
        {loadingCatalog && <ActivityIndicator style={{ marginVertical: 20 }} color={C.primary} />}
        {catalogError   && <Text style={styles.err}>{catalogError}</Text>}
      </>
    ),
    [selectedRows, search, saving, noChronic, loadingCatalog, catalogError, toggleNoChronic, removeChip],
  );

  // ─── SectionList / FlatList render callbackleri — Step 4 ─────────────────────

  const keyExtractorMed = useCallback(
    (item: MedicationBrandGroup) => `${item.conditionId}:${item.brand}`,
    [],
  );

  const renderMedBrandGroup = useCallback(
    ({ item }: { item: MedicationBrandGroup }) => {
      const groupKey = `${item.conditionId}:${item.brand}`;
      const expanded = expandedMedBrands.has(groupKey);
      return (
        <View>
          <Pressable
            style={styles.medBrandRow}
            onPress={() => toggleExpandedMedBrand(groupKey)}
            disabled={saving}>
            <View style={styles.medInfo}>
              <Text style={styles.rowName}>{item.brand}</Text>
              <Text style={styles.medBrandCount}>{item.variants.length} varyant</Text>
            </View>
            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={C.text3} />
          </Pressable>
          {expanded
            ? item.variants.map((row) => {
                const { medication } = row;
                const sel = selectedMedIds.has(medication.id);
                return (
                  <View key={`${row.condition_id}:${medication.id}`}>
                    <Pressable
                      style={[styles.medVariantRow, sel && styles.checkRowSelected]}
                      onPress={() => toggleMed(medication.id)}
                      disabled={saving}>
                      <View style={styles.medInfo}>
                        <Text style={styles.rowName}>{medicationVariantLabel(medication.ilac_adi, item.brand)}</Text>
                        {medication.etkin_madde_adi
                          ? <Text style={styles.medSub}>{medication.etkin_madde_adi}</Text>
                          : null}
                      </View>
                      <Ionicons name={sel ? ICON_ON : ICON_OFF} size={22} color={sel ? C.primary : C.text3} />
                    </Pressable>
                    {sel && (
                      <TextInput
                        style={styles.dosageInput}
                        value={medDosages.get(medication.id) ?? ''}
                        onChangeText={(v) => setDosage(medication.id, v)}
                        placeholder="Doz (örn: 500 mg, günde 2×) — opsiyonel"
                        placeholderTextColor={C.text3}
                        editable={!saving}
                      />
                    )}
                  </View>
                );
              })
            : null}
        </View>
      );
    },
    [expandedMedBrands, medDosages, saving, selectedMedIds, setDosage, toggleExpandedMedBrand, toggleMed],
  );

  const renderMedSectionHeader = useCallback(
    ({ section }: { section: MedSection }) => {
      // Serbest arama modunda bölüm başlığı yok
      if (!section.title) return null;
      const { conditionId, title } = section;
      const noMed = noMedConditions.has(conditionId);
      return (
        <View style={styles.medSectionHeaderWrap}>
          <Text style={styles.categoryTitle}>{title}</Text>
          <Pressable
            style={[styles.checkRow, styles.noChronicRow, noMed && styles.checkRowSelected]}
            onPress={() => toggleNoMedCondition(conditionId)}
            disabled={saving}>
            <Ionicons name={noMed ? ICON_ON : ICON_OFF} size={22} color={noMed ? C.primary : C.text3} />
            <Text style={styles.noChronicLabel}>Bu hastalık için ilaç kullanmıyorum</Text>
          </Pressable>
        </View>
      );
    },
    [noMedConditions, toggleNoMedCondition, saving],
  );

  const step4Header = useMemo(
    () => (
      <>
        <Text style={styles.title}>Kullandığın İlaçlar</Text>
        <Text style={styles.infoText}>
          Hastalıklarına göre önerilen ilaçlar aşağıda gruplanmıştır. İlacını seç ya da adıyla ara.
        </Text>
        <TextInput
          style={styles.input}
          value={medSearch}
          onChangeText={setMedSearch}
          placeholder="İlaç adı ara..."
          placeholderTextColor={C.text3}
          editable={!saving}
        />
        {medSearch.trim().length === 0 && loadingCondMeds && <ActivityIndicator style={{ marginVertical: 20 }} color={C.primary} />}
        {medSearch.trim().length === 0 && condMedError && <Text style={styles.err}>{condMedError}</Text>}
        {loadingMeds && <ActivityIndicator style={{ marginVertical: 20 }} color={C.primary} />}
        {medError    && <Text style={styles.err}>{medError}</Text>}
      </>
    ),
    [medSearch, saving, loadingMeds, medError, loadingCondMeds, condMedError],
  );

  const step4Footer = useMemo(() => {
    const isSearching = medSearch.trim().length > 0;
    const showEmpty = isSearching
      ? !loadingMeds && !medError && flatMedResults.length === 0
      : !loadingCondMeds && !condMedError && condMedsGrouped.size === 0;
    return (
      <>
        {showEmpty && (
          <Text style={styles.infoText}>
            {medSearch.trim().length === 1
              ? 'İlaç aramak için en az 2 harf yazın.'
              : isSearching
              ? 'Aramanızla eşleşen ilaç bulunamadı.'
              : 'Hastalıklarınla eşleşen öneri bulunamadı. İlacını adıyla arayabilirsin.'}
          </Text>
        )}
        {stepError && <Text style={styles.err}>{stepError}</Text>}
        {saveError  && <Text style={styles.err}>{saveError}</Text>}
      </>
    );
  }, [medSearch, loadingMeds, medError, flatMedResults, loadingCondMeds, condMedError, condMedsGrouped.size, stepError, saveError]);

  // ─── Validasyon ve navigasyon ─────────────────────────────────────────────────

  const validateStep1 = (): boolean => {
    if (!fullName.trim())                { setStepError('Ad soyad gerekli.'); return false; }
    const birthIso = buildIsoDate(day, month, year);
    if (!birthIso)                       { setStepError('Geçerli bir doğum tarihi seç.'); return false; }
    if (!isAtLeast18(birthIso))          { setStepError('18 yaşından büyük olmanız gerekiyor.'); return false; }
    if (!gender)                         { setStepError('Cinsiyet seçimi gerekli.'); return false; }
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

  const saveStep1Profile = async (): Promise<boolean> => {
    if (!resolvedUserId) {
      setStepError('Kullanıcı doğrulanamadı.');
      return false;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('profiles').upsert(
        { id: resolvedUserId, full_name: fullName.trim() },
        { onConflict: 'id' },
      );
      if (error) {
        console.error('onboarding-screen:', error);
        setStepError(isNetworkError(error) ? NETWORK_ERROR_TEXT : ONBOARDING_SAVE_ERROR_TEXT);
        return false;
      }
      return true;
    } catch (error) {
      console.error('onboarding-screen:', error);
      setStepError(isNetworkError(error) ? NETWORK_ERROR_TEXT : ONBOARDING_SAVE_ERROR_TEXT);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const goNext = async () => {
    setStepError(null);
    if (step === 1) {
      if (!validateStep1()) return;
      const saved = await saveStep1Profile();
      if (!saved) return;
    }
    if (step === 2 && !validateStep2()) return;
    if (step < TOTAL_STEPS) setStep((s) => s + 1);
  };

  const goBack = () => { setStepError(null); if (step > 1) setStep((s) => s - 1); };

  const confirmSignOut = () => {
    Alert.alert(
      'Çıkış Yap',
      'Çıkış yapmak istediğine emin misin?',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Evet',
          onPress: () => {
            void supabase.auth.signOut();
          },
        },
      ],
    );
  };

  const handleSave = async () => {
    setSaveError(null);
    if (!validateStep1()) { setStep(1); return; }
    if (!validateStep2()) { setStep(2); return; }
    const birthIso = buildIsoDate(day, month, year);
    if (!birthIso || !gender || !resolvedUserId) { setSaveError('Kullanıcı doğrulanamadı.'); return; }
    const h = parseInt(heightCm.replace(',', '.').trim(), 10);
    const w = parseInt(weightKg.replace(',', '.').trim(), 10);
    setSaving(true);
    try {
      const { error: e1 } = await supabase.from('profiles').upsert(
        { id: resolvedUserId, full_name: fullName.trim(), birth_date: birthIso, gender, height_cm: h, weight_kg: w, onboarding_completed: true },
        { onConflict: 'id' },
      );
      if (e1) {
        console.error('onboarding-screen:', e1);
        setSaveError(isNetworkError(e1) ? NETWORK_ERROR_TEXT : ONBOARDING_SAVE_ERROR_TEXT);
        return;
      }

      const { error: e2 } = await supabase.from('user_conditions').delete().eq('user_id', resolvedUserId);
      if (e2) {
        console.error('onboarding-screen:', e2);
        setSaveError(isNetworkError(e2) ? NETWORK_ERROR_TEXT : ONBOARDING_SAVE_ERROR_TEXT);
        return;
      }

      if (!noChronic && selectedIds.size > 0) {
        const { error: e3 } = await supabase.from('user_conditions').insert(
          [...selectedIds].map((condition_id) => ({ user_id: resolvedUserId, condition_id })),
        );
        if (e3) {
          console.error('onboarding-screen:', e3);
          setSaveError(isNetworkError(e3) ? NETWORK_ERROR_TEXT : ONBOARDING_SAVE_ERROR_TEXT);
          return;
        }
      }

      const { error: e4 } = await supabase.from('user_medications').delete().eq('user_id', resolvedUserId);
      if (e4) {
        console.error('onboarding-screen:', e4);
        setSaveError(isNetworkError(e4) ? NETWORK_ERROR_TEXT : ONBOARDING_SAVE_ERROR_TEXT);
        return;
      }

      if (selectedMedIds.size > 0) {
        const { error: e5 } = await supabase.from('user_medications').insert(
          [...selectedMedIds].map((medication_id) => ({
            user_id: resolvedUserId, medication_id,
            dosage: medDosages.get(medication_id)?.trim() || null,
            is_active: true,
          })),
        );
        if (e5) {
          console.error('onboarding-screen:', e5);
          setSaveError(isNetworkError(e5) ? NETWORK_ERROR_TEXT : ONBOARDING_SAVE_ERROR_TEXT);
          return;
        }
      }
      onComplete();
    } catch (error) {
      console.error('onboarding-screen:', error);
      setSaveError(isNetworkError(error) ? NETWORK_ERROR_TEXT : ONBOARDING_SAVE_ERROR_TEXT);
    } finally { setSaving(false); }
  };

  const progress = step / TOTAL_STEPS;
  const selectedBirthIso = buildIsoDate(day, month, year);
  const isStep1Adult = isAtLeast18(selectedBirthIso);

  if (userResolveError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top','left','right']}>
        <View style={styles.center}>
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
      <SafeAreaView style={styles.safe} edges={['top','left','right']}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={styles.centerText}>Hesabın hazırlanıyor…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const hasMedConditions = !noChronic && selectedIds.size > 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top','left','right']}>

      {/* ── Progress çubuğu ── */}
      <View style={styles.progressWrap}>
        <Text style={styles.progressLabel}>Adım {step} / {TOTAL_STEPS}</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` as `${number}%` }]} />
        </View>
      </View>

      {/* ── Adım 1 & 2: ScrollView ── */}
      {(step === 1 || step === 2) && (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">

          {/* Adım 1 */}
          {step === 1 && (
            <>
              <Text style={styles.title}>Kişisel bilgiler</Text>
              <Text style={styles.fieldLabel}>Ad Soyad</Text>
              <TextInput style={styles.input} value={fullName} onChangeText={setFullName}
                placeholder="Adın Soyadın" placeholderTextColor={C.text3}
                autoCapitalize="words" editable={!saving} />

              <Text style={styles.fieldLabel}>Doğum tarihi</Text>
              <View style={styles.pickerRow}>
                <View style={styles.pickerCol}>
                  <Text style={styles.pickerCaption}>Gün</Text>
                  <View style={styles.pickerBox}>
                    <Picker selectedValue={day} onValueChange={(v) => setDay(String(v))} style={styles.picker} dropdownIconColor={C.text1}>
                      {dayItems.map((d) => <Picker.Item key={d} label={d} value={d} color={C.text1} />)}
                    </Picker>
                  </View>
                </View>
                <View style={styles.pickerCol}>
                  <Text style={styles.pickerCaption}>Ay</Text>
                  <View style={styles.pickerBox}>
                    <Picker selectedValue={month} onValueChange={(v) => setMonth(String(v))} style={styles.picker} dropdownIconColor={C.text1}>
                      {MONTH_LABELS.map((lbl, idx) => {
                        const v = String(idx + 1);
                        return <Picker.Item key={v} label={lbl} value={v} color={C.text1} />;
                      })}
                    </Picker>
                  </View>
                </View>
                <View style={styles.pickerCol}>
                  <Text style={styles.pickerCaption}>Yıl</Text>
                  <View style={styles.pickerBox}>
                    <Picker selectedValue={year} onValueChange={(v) => setYear(String(v))} style={styles.picker} dropdownIconColor={C.text1}>
                      {years.map((y) => <Picker.Item key={y} label={y} value={y} color={C.text1} />)}
                    </Picker>
                  </View>
                </View>
              </View>
              {!isStep1Adult ? (
                <Text style={styles.ageWarning}>18 yaşından büyük olmanız gerekiyor.</Text>
              ) : null}

              <Text style={styles.fieldLabel}>Cinsiyet</Text>
              <View style={styles.genderRow}>
                {GENDER_OPTIONS.map(({ value, label }) => {
                  const on = gender === value;
                  return (
                    <Pressable key={value} style={[styles.chip, on && styles.chipSelected]}
                      onPress={() => setGender(value)} disabled={saving}>
                      <Text style={[styles.chipText, on && styles.chipTextSelected]}>{label}</Text>
                      {on && <Ionicons name={ICON_ON} size={18} color={C.text1} />}
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          {/* Adım 2 */}
          {step === 2 && (
            <>
              <Text style={styles.title}>Vücut bilgileri</Text>
              <Text style={styles.fieldLabel}>Boy (cm)</Text>
              <TextInput style={styles.input} value={heightCm}
                onChangeText={(t) => setHeightCm(t.replace(/[^0-9]/g, ''))}
                placeholder="50 – 250" placeholderTextColor={C.text3}
                keyboardType="number-pad" editable={!saving} />
              <Text style={styles.fieldLabel}>Kilo (kg)</Text>
              <TextInput style={styles.input} value={weightKg}
                onChangeText={(t) => setWeightKg(t.replace(/[^0-9]/g, ''))}
                placeholder="10 – 300" placeholderTextColor={C.text3}
                keyboardType="number-pad" editable={!saving} />
              {bmiWarning && <Text style={styles.bmiWarn}>Lütfen değerleri kontrol edin.</Text>}
            </>
          )}

          {stepError && <Text style={styles.err}>{stepError}</Text>}
          {saveError  && <Text style={styles.err}>{saveError}</Text>}
        </ScrollView>
      )}

      {/* ── Adım 3: Hastalık seçimi — SectionList ── */}
      {step === 3 && (
        <SectionList<ConditionCatalogRow, ConditionSection>
          sections={conditionSections}
          keyExtractor={keyExtractorCondition}
          renderItem={renderConditionItem}
          renderSectionHeader={renderConditionSectionHeader}
          stickySectionHeadersEnabled={true}
          ListHeaderComponent={step3Header}
          ListFooterComponent={
            <>
              {stepError && <Text style={styles.err}>{stepError}</Text>}
              {saveError  && <Text style={styles.err}>{saveError}</Text>}
            </>
          }
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={10}
          maxToRenderPerBatch={20}
          windowSize={10}
          removeClippedSubviews={true}
        />
      )}

      {/* ── Adım 4: Kronik hastalık yok ── */}
      {step === 4 && !hasMedConditions && (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <Text style={styles.title}>Kullandığın İlaçlar</Text>
          <Text style={styles.infoText}>Kronik hastalık seçmediğin için bu adımı atlayabilirsin.</Text>
          {stepError && <Text style={styles.err}>{stepError}</Text>}
          {saveError  && <Text style={styles.err}>{saveError}</Text>}
        </ScrollView>
      )}

      {/* ── Adım 4: İlaç seçimi — tek SectionList (search/gruplu mod) ── */}
      {step === 4 && hasMedConditions && (
        <SectionList<MedicationBrandGroup, MedSection>
          sections={step4Sections}
          keyExtractor={keyExtractorMed}
          renderItem={renderMedBrandGroup}
          renderSectionHeader={renderMedSectionHeader}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={step4Header}
          ListFooterComponent={step4Footer}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={10}
          maxToRenderPerBatch={20}
          windowSize={10}
        />
      )}

      {/* ── Footer ── */}
      <View style={styles.footer}>
        <View style={styles.footerActions}>
          {step > 1
            ? <Pressable style={styles.secondaryBtn} onPress={goBack} disabled={saving}><Text style={styles.secondaryBtnText}>Geri</Text></Pressable>
            : <View style={{ flex: 1 }} />}
          {step < TOTAL_STEPS
            ? (
                <Pressable
                  style={[
                    styles.primaryBtn,
                    (saving || (step === 1 && !isStep1Adult)) && styles.primaryBtnDisabled,
                  ]}
                  onPress={() => void goNext()}
                  disabled={saving || (step === 1 && !isStep1Adult)}
                >
                  <Text style={styles.primaryBtnText}>İleri</Text>
                </Pressable>
              )
            : <Pressable style={[styles.primaryBtn, saving && styles.primaryBtnDisabled]} onPress={handleSave} disabled={saving}>
                {saving ? <ActivityIndicator color={C.text1} /> : <Text style={styles.primaryBtnText}>Tamamla</Text>}
              </Pressable>}
        </View>
        {step === 1 ? (
          <Pressable style={styles.signOutLink} onPress={confirmSignOut} disabled={saving}>
            <Text style={styles.signOutLinkText}>Farklı hesapla giriş yap</Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  center:     { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 16 },
  centerText: { color: C.text2, fontSize: 15 },

  progressWrap:  { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  progressLabel: { color: C.text1, fontSize: 14, fontWeight: '600', marginBottom: 8 },
  progressTrack: { height: 5, borderRadius: 3, backgroundColor: C.border, overflow: 'hidden' },
  progressFill:  { height: '100%', borderRadius: 3, backgroundColor: C.primary },

  scroll:        { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 32 },

  title:      { color: C.text1, fontSize: 22, fontWeight: '700', marginBottom: 16 },
  fieldLabel: { color: C.text1, fontSize: 14, fontWeight: '500', marginBottom: 8, marginTop: 4 },

  input: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, color: C.text1, fontSize: 16,
    paddingHorizontal: 14, paddingVertical: 14, marginBottom: 16,
  },

  pickerRow:     { flexDirection: 'row', gap: 8, marginBottom: 16 },
  pickerCol:     { flex: 1 },
  pickerCaption: { color: C.text2, fontSize: 12, marginBottom: 6 },
  pickerBox:     { borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, overflow: 'hidden' },
  picker:        { color: C.text1 },

  genderRow: { gap: 10 },

  chip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 10, borderWidth: 1, borderColor: C.border,
    paddingVertical: 12, paddingHorizontal: 14, marginBottom: 10, backgroundColor: C.surface,
  },
  chipSelected:     { borderColor: C.primary, backgroundColor: C.primary },
  chipText:         { color: C.text1, fontSize: 15 },
  chipTextSelected: { color: C.text1, fontWeight: '600' },

  bmiWarn: { color: C.warning, fontSize: 14, marginTop: 4, marginBottom: 8 },
  ageWarning: { color: C.warning, fontSize: 13, marginTop: -8, marginBottom: 14 },

  chipScroll:      { maxHeight: 44, marginBottom: 12 },
  chipScrollInner: { gap: 8, alignItems: 'center', paddingRight: 8 },

  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.surfaceAlt, borderRadius: 20,
    paddingVertical: 8, paddingHorizontal: 12,
    borderWidth: 1, borderColor: C.border, maxWidth: 220,
  },
  badgeText: { color: C.text1, fontSize: 13, flexShrink: 1 },

  // Sticky kategori başlığı (Step 3)
  stickyHeader: {
    backgroundColor: C.bg,
    marginHorizontal: -20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 2,
  },

  // İlaç grubu bölüm başlığı (Step 4, sticky değil)
  medSectionHeaderWrap: {
    backgroundColor: C.bg,
    marginTop: 16,
  },

  categoryTitle: { color: C.text1, fontSize: 16, fontWeight: '700', marginBottom: 10 },

  checkRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: 12,
    borderRadius: 10, borderWidth: 1, borderColor: C.border,
    marginBottom: 8, backgroundColor: C.surface,
  },
  checkRowSelected: { borderColor: C.primary, backgroundColor: C.primaryDim },
  noChronicRow:     { gap: 12 },
  noChronicLabel:   { color: C.text1, fontSize: 15, flex: 1 },
  rowName:          { color: C.text1, fontSize: 15, flex: 1, marginRight: 12 },
  medInfo:          { flex: 1, marginRight: 12 },
  medSub:           { color: C.text3, fontSize: 12, marginTop: 2 },
  medBrandRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 13, paddingHorizontal: 12,
    borderRadius: 10, borderWidth: 1, borderColor: C.border,
    marginBottom: 8, backgroundColor: C.surface,
  },
  medBrandCount: { color: C.text3, fontSize: 12, marginTop: 2 },
  medVariantRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: 12,
    borderRadius: 10, borderWidth: 1, borderColor: C.border,
    marginLeft: 12, marginBottom: 8, backgroundColor: C.surfaceAlt,
  },

  dosageInput: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
    borderRadius: 8, color: C.text2, fontSize: 14,
    paddingHorizontal: 12, paddingVertical: 10,
    marginTop: -2, marginBottom: 8, marginHorizontal: 2,
  },

  infoText: { color: C.text3, fontSize: 15, marginTop: 8, lineHeight: 22 },
  err:      { color: C.error, fontSize: 14, marginTop: 12 },

  footer: {
    padding: 16, paddingBottom: 28,
    borderTopWidth: 1, borderTopColor: C.border,
  },
  footerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  secondaryBtn:       { flex: 1, paddingVertical: 14, borderRadius: 10, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  secondaryBtnText:   { color: C.text1, fontSize: 16, fontWeight: '600' },
  primaryBtn:         { flex: 1, paddingVertical: 14, borderRadius: 10, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  primaryBtnDisabled: { opacity: 0.7 },
  primaryBtnText:     { color: C.text1, fontSize: 16, fontWeight: '700' },
  signOutLink:        { alignItems: 'center', marginTop: 14, paddingVertical: 4 },
  signOutLinkText:    { color: C.text3, fontSize: 13 },

  retryBtn:     { backgroundColor: C.text1, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 10 },
  retryBtnText: { color: C.bg, fontSize: 16, fontWeight: '700' },
});
