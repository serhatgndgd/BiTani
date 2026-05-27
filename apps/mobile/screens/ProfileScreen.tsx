import { Ionicons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { LegalDocumentModal } from '../components/LegalDocumentModal';
import type { LegalDocumentId } from '../legal/documents';
import { supabase } from '../lib/supabase';
import type { ConditionCatalogRow } from '../navigation/types';
import { C } from '../theme';

type Gender = 'male' | 'female' | 'unspecified';

type ProfileData = {
  full_name: string | null;
  birth_date: string | null;
  gender: Gender | null;
  height_cm: number | null;
  weight_kg: number | null;
};

type MedicationRow = {
  id: string;
  ilac_adi: string;
  etkin_madde_adi: string | null;
  firma_adi: string | null;
};

type UserMedication = {
  medication_id: string;
  dosage: string | null;
  is_active: boolean;
  medications: MedicationRow;
};

type CondMedRow = {
  condition_id: string;
  medication: {
    id: string;
    ilac_adi: string;
    etkin_madde_adi: string | null;
  };
};

type ProfileConditionSection = { title: string; data: ConditionCatalogRow[] };
type ProfileMedSection       = { conditionId: string; title: string; data: CondMedRow[] };

const PROFILE_LOAD_ERROR_TEXT = 'Bilgileriniz yüklenemedi';
const PROFILE_SAVE_ERROR_TEXT = 'Bilgileriniz kaydedilemedi. Tekrar deneyin';
const CONDITION_SAVE_ERROR_TEXT = 'Hastalık eklenemedi. Tekrar deneyin';
const MED_ADD_ERROR_TEXT = 'İlaç eklenemedi. Tekrar deneyin';
const UPDATE_ERROR_TEXT = 'Güncellenemedi. Tekrar deneyin';
const DELETE_ACCOUNT_ERROR_TEXT = 'Hesabınız silinemedi. Tekrar deneyin';

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'male', label: 'Erkek' },
  { value: 'female', label: 'Kadın' },
  { value: 'unspecified', label: 'Belirtmek istemiyorum' },
];

const MONTH_LABELS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
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

function parseIsoDate(iso: string | null): { day: string; month: string; year: string } {
  const fallback = { day: '1', month: '1', year: String(new Date().getFullYear() - 25) };
  if (!iso) return fallback;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return fallback;
  return {
    year: String(parseInt(match[1], 10)),
    month: String(parseInt(match[2], 10)),
    day: String(parseInt(match[3], 10)),
  };
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

function genderLabel(g: Gender | null): string {
  if (g === 'male') return 'Erkek';
  if (g === 'female') return 'Kadın';
  if (g === 'unspecified') return 'Belirtilmemiş';
  return '—';
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Profil ──────────────────────────────────────────────────────────────
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [fullName, setFullName] = useState('');
  const [day, setDay] = useState('1');
  const [month, setMonth] = useState('1');
  const [year, setYear] = useState(String(new Date().getFullYear() - 25));
  const [gender, setGender] = useState<Gender | null>(null);
  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [conditionActionError, setConditionActionError] = useState<string | null>(null);
  const [medicationActionError, setMedicationActionError] = useState<string | null>(null);
  const [legalDocument, setLegalDocument] = useState<LegalDocumentId | null>(null);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);

  // ── Hastalıklar ─────────────────────────────────────────────────────────
  const [userConditions, setUserConditions] = useState<ConditionCatalogRow[]>([]);
  const [conditionsModal, setConditionsModal] = useState(false);
  const [allConditions, setAllConditions] = useState<ConditionCatalogRow[]>([]);
  const [conditionsSearch, setConditionsSearch] = useState('');
  const [loadingConditions, setLoadingConditions] = useState(false);
  const [conditionsError, setConditionsError] = useState<string | null>(null);

  // ── İlaçlar — liste ─────────────────────────────────────────────────────
  const [userMedications, setUserMedications] = useState<UserMedication[]>([]);
  const [showPastMeds, setShowPastMeds] = useState(false);

  // ── İlaçlar — modal ─────────────────────────────────────────────────────
  const [medsModal, setMedsModal] = useState(false);
  const [medModalTab, setMedModalTab] = useState<'conditions' | 'search'>('conditions');
  const [addingMed, setAddingMed] = useState(false);
  const [addMedError, setAddMedError] = useState<string | null>(null);

  // Hastalığa göre sekmesi
  const [condMedRows, setCondMedRows] = useState<CondMedRow[]>([]);
  const [loadingCondMeds, setLoadingCondMeds] = useState(false);
  const [condMedError, setCondMedError] = useState<string | null>(null);
  const [condMedSearch, setCondMedSearch] = useState('');
  const [modalSelectedMedIds, setModalSelectedMedIds] = useState<Set<string>>(new Set());
  const [modalMedDosages, setModalMedDosages] = useState<Map<string, string>>(new Map());

  // Serbest arama sekmesi
  const [medSearch, setMedSearch] = useState('');
  const [medResults, setMedResults] = useState<MedicationRow[]>([]);
  const [searchingMeds, setSearchingMeds] = useState(false);
  const [selectedMed, setSelectedMed] = useState<MedicationRow | null>(null);
  const [dosageInput, setDosageInput] = useState('');

  // ── Hesaplanan değerler ──────────────────────────────────────────────────
  const activeMeds = useMemo(() => userMedications.filter((m) => m.is_active), [userMedications]);
  const pastMeds = useMemo(() => userMedications.filter((m) => !m.is_active), [userMedications]);
  const activeMedIds = useMemo(() => new Set(activeMeds.map((m) => m.medication_id)), [activeMeds]);
  const pastMedIds = useMemo(() => new Set(pastMeds.map((m) => m.medication_id)), [pastMeds]);

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
    if (parseInt(day, 10) > dayItems.length) setDay(String(dayItems.length));
  }, [dayItems, day]);

  const filteredConditions = useMemo(() => {
    const q = conditionsSearch.trim().toLowerCase();
    if (!q) return allConditions;
    return allConditions.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.category ?? '').toLowerCase().includes(q),
    );
  }, [allConditions, conditionsSearch]);

  const grouped = useMemo(() => groupByCategory(filteredConditions), [filteredConditions]);
  const userConditionIds = useMemo(() => new Set(userConditions.map((c) => c.id)), [userConditions]);

  const conditionNameMap = useMemo(
    () => new Map(userConditions.map((c) => [c.id, c.name])),
    [userConditions],
  );

  // Hastalığa göre sekme: filtre + grup
  const condMedGrouped = useMemo(() => {
    const q = condMedSearch.trim().toLowerCase();
    const filtered = q
      ? condMedRows.filter(
          (r) =>
            r.medication.ilac_adi.toLowerCase().includes(q) ||
            (r.medication.etkin_madde_adi?.toLowerCase().includes(q) ?? false),
        )
      : condMedRows;

    const map = new Map<string, CondMedRow[]>();
    for (const row of filtered) {
      const list = map.get(row.condition_id) ?? [];
      if (!list.some((r) => r.medication.id === row.medication.id)) list.push(row);
      map.set(row.condition_id, list);
    }
    return map;
  }, [condMedRows, condMedSearch]);

  // ─── SectionList veri dönüşümleri (modal listeler) ───────────────────────

  const conditionModalSections = useMemo<ProfileConditionSection[]>(
    () => [...grouped.entries()].map(([title, data]) => ({ title, data })),
    [grouped],
  );

  const condMedModalSections = useMemo<ProfileMedSection[]>(
    () =>
      [...condMedGrouped.entries()].map(([conditionId, meds]) => ({
        conditionId,
        title: conditionNameMap.get(conditionId) ?? conditionId,
        data: meds,
      })),
    [condMedGrouped, conditionNameMap],
  );

  // ── Veri yükleme ────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user?.id) {
      console.error('profile-screen:', userErr);
      setLoadError(PROFILE_LOAD_ERROR_TEXT);
      setLoading(false);
      return;
    }
    setUserId(user.id);

    const [profileRes, condRes, medRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('full_name, birth_date, gender, height_cm, weight_kg')
        .eq('id', user.id)
        .maybeSingle(),
      supabase
        .from('user_conditions')
        .select('conditions_catalog(id, name, category)')
        .eq('user_id', user.id),
      supabase
        .from('user_medications')
        .select('medication_id, dosage, is_active, medications(id, ilac_adi, etkin_madde_adi, firma_adi)')
        .eq('user_id', user.id),
    ]);

    if (profileRes.error) {
      console.error('profile-screen:', profileRes.error);
      setLoadError(PROFILE_LOAD_ERROR_TEXT);
      setLoading(false);
      return;
    }

    if (profileRes.data) {
      const p = profileRes.data as ProfileData;
      setProfile(p);
      setFullName(p.full_name ?? '');
      const parsed = parseIsoDate(p.birth_date);
      setDay(parsed.day);
      setMonth(parsed.month);
      setYear(parsed.year);
      setGender(p.gender);
      setHeightCm(p.height_cm != null ? String(p.height_cm) : '');
      setWeightKg(p.weight_kg != null ? String(p.weight_kg) : '');
    }

    if (!condRes.error && condRes.data) {
      type CondRow = { conditions_catalog: ConditionCatalogRow | null };
      const rows = (condRes.data as unknown as CondRow[])
        .map((r) => r.conditions_catalog)
        .filter((c): c is ConditionCatalogRow => c !== null);
      setUserConditions(rows);
    }

    if (!medRes.error && medRes.data) {
      type MedQueryRow = {
        medication_id: string;
        dosage: string | null;
        is_active: boolean;
        medications: MedicationRow | null;
      };
      const rows: UserMedication[] = (medRes.data as unknown as MedQueryRow[])
        .filter((r) => r.medications !== null)
        .map((r) => ({
          medication_id: r.medication_id,
          dosage: r.dosage,
          is_active: r.is_active,
          medications: r.medications as MedicationRow,
        }));
      setUserMedications(rows);
    }

    setLoading(false);
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const reloadMedications = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('user_medications')
      .select('medication_id, dosage, is_active, medications(id, ilac_adi, etkin_madde_adi, firma_adi)')
      .eq('user_id', userId);
    if (!data) return;
    type MedQueryRow = {
      medication_id: string; dosage: string | null;
      is_active: boolean; medications: MedicationRow | null;
    };
    setUserMedications(
      (data as unknown as MedQueryRow[])
        .filter((r) => r.medications !== null)
        .map((r) => ({
          medication_id: r.medication_id,
          dosage: r.dosage,
          is_active: r.is_active,
          medications: r.medications as MedicationRow,
        })),
    );
  }, [userId]);

  const clearChatHistory = useCallback(async () => {
    if (!userId) return;
    await supabase.from('chat_history').delete().eq('user_id', userId);
  }, [userId]);

  const deleteAccount = useCallback(async () => {
    setDeletingAccount(true);
    setDeleteAccountError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('missing-session');
      const { error } = await supabase.functions.invoke('delete-account', {
        body: {},
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      if (error) throw error;
      // Modal önce kapat; auth.signOut() component'ı unmount eder —
      // sonraki setState unmounted component uyarısını önler.
      setDeleteModalVisible(false);
      await supabase.auth.signOut();
    } catch (error) {
      console.error('delete-account:', error);
      setDeleteAccountError(DELETE_ACCOUNT_ERROR_TEXT);
    } finally {
      setDeletingAccount(false);
    }
  }, []);

  // ── Profil düzenleme ────────────────────────────────────────────────────
  const openEditProfile = () => {
    if (profile) {
      setFullName(profile.full_name ?? '');
      const parsed = parseIsoDate(profile.birth_date);
      setDay(parsed.day); setMonth(parsed.month); setYear(parsed.year);
      setGender(profile.gender);
      setHeightCm(profile.height_cm != null ? String(profile.height_cm) : '');
      setWeightKg(profile.weight_kg != null ? String(profile.weight_kg) : '');
    }
    setProfileError(null);
    setEditingProfile(true);
  };

  const saveProfile = async () => {
    if (!userId) return;
    if (!fullName.trim()) { setProfileError('Ad soyad gerekli.'); return; }
    const iso = buildIsoDate(day, month, year);
    if (!iso) { setProfileError('Geçerli bir doğum tarihi seç.'); return; }
    if (!gender) { setProfileError('Cinsiyet seçimi gerekli.'); return; }
    const h = parseInt(heightCm.replace(',', '.').trim(), 10);
    const w = parseInt(weightKg.replace(',', '.').trim(), 10);
    if (!Number.isFinite(h) || h < 50 || h > 250) { setProfileError('Boy 50–250 cm arasında olmalı.'); return; }
    if (!Number.isFinite(w) || w < 10 || w > 300) { setProfileError('Kilo 10–300 kg arasında olmalı.'); return; }

    setSavingProfile(true);
    setProfileError(null);
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim(), birth_date: iso, gender, height_cm: h, weight_kg: w })
      .eq('id', userId);
    setSavingProfile(false);
    if (error) {
      console.error('profile-screen:', error);
      setProfileError(PROFILE_SAVE_ERROR_TEXT);
      return;
    }
    setProfile({ full_name: fullName.trim(), birth_date: iso, gender, height_cm: h, weight_kg: w });
    setEditingProfile(false);
  };

  // ── Hastalık modalı ─────────────────────────────────────────────────────
  const openConditionsModal = async () => {
    setConditionsModal(true);
    if (allConditions.length > 0) return;
    setLoadingConditions(true);
    setConditionsError(null);
    const { data, error } = await supabase.from('conditions_catalog').select('id, name, category');
    setLoadingConditions(false);
    if (error) { setConditionsError('Liste yüklenemedi.'); return; }
    const sorted = ((data ?? []) as ConditionCatalogRow[]).slice().sort((a, b) => {
      const c = (a.category || '').localeCompare(b.category || '', 'tr');
      return c !== 0 ? c : (a.name || '').localeCompare(b.name || '', 'tr');
    });
    setAllConditions(sorted);
  };

  const toggleCondition = useCallback(async (cond: ConditionCatalogRow) => {
    if (!userId) return;
    setConditionActionError(null);
    if (userConditionIds.has(cond.id)) {
      const { error } = await supabase
        .from('user_conditions').delete().eq('user_id', userId).eq('condition_id', cond.id);
      if (!error) {
        setUserConditions((prev) => prev.filter((c) => c.id !== cond.id));
      } else {
        console.error('profile-screen:', error);
        setConditionActionError(CONDITION_SAVE_ERROR_TEXT);
      }
    } else {
      const { error } = await supabase
        .from('user_conditions').insert({ user_id: userId, condition_id: cond.id });
      if (!error) {
        setUserConditions((prev) => [...prev, cond]);
      } else {
        console.error('profile-screen:', error);
        setConditionActionError(CONDITION_SAVE_ERROR_TEXT);
      }
    }
  }, [userId, userConditionIds]);

  const removeCondition = useCallback(async (id: string) => {
    if (!userId) return;
    setConditionActionError(null);
    const { error } = await supabase
      .from('user_conditions').delete().eq('user_id', userId).eq('condition_id', id);
    if (!error) {
      setUserConditions((prev) => prev.filter((c) => c.id !== id));
    } else {
      console.error('profile-screen:', error);
      setConditionActionError(CONDITION_SAVE_ERROR_TEXT);
    }
  }, [userId]);

  // ── İlaç listesi aksiyonları ─────────────────────────────────────────────
  const quitMedication = useCallback(async (medicationId: string) => {
    if (!userId) return;
    setMedicationActionError(null);
    const { error } = await supabase
      .from('user_medications')
      .update({ is_active: false })
      .eq('user_id', userId)
      .eq('medication_id', medicationId);
    if (!error) {
      setUserMedications((prev) =>
        prev.map((m) => m.medication_id === medicationId ? { ...m, is_active: false } : m),
      );
      void clearChatHistory();
    } else {
      console.error('profile-screen:', error);
      setMedicationActionError(UPDATE_ERROR_TEXT);
    }
  }, [userId, clearChatHistory]);

  const resumeMedication = useCallback(async (medicationId: string) => {
    if (!userId) return;
    setMedicationActionError(null);
    const { error } = await supabase
      .from('user_medications')
      .update({ is_active: true })
      .eq('user_id', userId)
      .eq('medication_id', medicationId);
    if (!error) {
      setUserMedications((prev) =>
        prev.map((m) => m.medication_id === medicationId ? { ...m, is_active: true } : m),
      );
      void clearChatHistory();
    } else {
      console.error('profile-screen:', error);
      setMedicationActionError(UPDATE_ERROR_TEXT);
    }
  }, [userId, clearChatHistory]);

  // ── İlaç modalı — aç / kapat ─────────────────────────────────────────────
  const openMedsModal = useCallback(async () => {
    const defaultTab = userConditions.length > 0 ? 'conditions' : 'search';
    setMedModalTab(defaultTab);
    setModalSelectedMedIds(new Set());
    setModalMedDosages(new Map());
    setCondMedSearch('');
    setMedSearch('');
    setMedResults([]);
    setSelectedMed(null);
    setDosageInput('');
    setAddMedError(null);
    setMedsModal(true);

    if (userConditions.length === 0) return;
    setLoadingCondMeds(true);
    setCondMedError(null);
    const { data, error } = await supabase
      .from('condition_medications')
      .select('condition_id, medications(id, ilac_adi, etkin_madde_adi)')
      .in('condition_id', userConditions.map((c) => c.id))
      .eq('is_contraindication', false)
      .gte('confidence_score', 0.5);
    setLoadingCondMeds(false);
    if (error) { setCondMedError('İlaçlar yüklenemedi.'); return; }
    type RawRow = {
      condition_id: string;
      medications: { id: string; ilac_adi: string; etkin_madde_adi: string | null } | null;
    };
    const rows: CondMedRow[] = ((data ?? []) as unknown as RawRow[])
      .filter((r) => r.medications != null)
      .map((r) => ({ condition_id: r.condition_id, medication: r.medications! }));
    setCondMedRows(rows);
  }, [userConditions]);

  const closeMedsModal = useCallback(() => {
    setMedsModal(false);
    setModalSelectedMedIds(new Set());
    setModalMedDosages(new Map());
    setCondMedSearch('');
    setMedSearch('');
    setMedResults([]);
    setSelectedMed(null);
    setDosageInput('');
    setAddMedError(null);
  }, []);

  // ── İlaç ekleme ─────────────────────────────────────────────────────────
  // Hastalığa göre sekme: toplu ekle
  const addSelectedMedications = useCallback(async () => {
    if (!userId || modalSelectedMedIds.size === 0) return;
    setAddingMed(true);
    setAddMedError(null);
    try {
      const rows = [...modalSelectedMedIds].map((medication_id) => ({
        user_id: userId,
        medication_id,
        dosage: modalMedDosages.get(medication_id)?.trim() || null,
        is_active: true,
      }));
      const { error } = await supabase
        .from('user_medications')
        .upsert(rows, { onConflict: 'user_id,medication_id' });
      if (error) throw new Error(error.message);

      await reloadMedications();
      void clearChatHistory();
      closeMedsModal();
    } catch (e) {
      console.error('profile-screen:', e);
      setAddMedError(MED_ADD_ERROR_TEXT);
    } finally {
      setAddingMed(false);
    }
  }, [userId, modalSelectedMedIds, modalMedDosages, closeMedsModal, reloadMedications, clearChatHistory]);

  // Serbest arama sekmesi: tek ilaç ekle
  const addSingleMedication = useCallback(async () => {
    if (!userId || !selectedMed) return;
    setAddingMed(true);
    setAddMedError(null);
    const dosage = dosageInput.trim() || null;

    const { error } = await supabase
      .from('user_medications')
      .upsert(
        { user_id: userId, medication_id: selectedMed.id, dosage, is_active: true },
        { onConflict: 'user_id,medication_id' },
      );

    setAddingMed(false);
    if (error) {
      console.error('profile-screen:', error);
      setAddMedError(MED_ADD_ERROR_TEXT);
      return;
    }

    await reloadMedications();
    void clearChatHistory(); // addSelectedMedications ile tutarlı: kullanıcı bağlamı değişti
    closeMedsModal();
  }, [userId, selectedMed, dosageInput, closeMedsModal, reloadMedications, clearChatHistory]);

  // ── Serbest arama debounce ───────────────────────────────────────────────
  useEffect(() => {
    const q = medSearch.trim();
    if (!q) { setMedResults([]); return; }
    const timer = setTimeout(async () => {
      setSearchingMeds(true);
      const { data, error } = await supabase
        .from('medications')
        .select('id, ilac_adi, etkin_madde_adi, firma_adi')
        .ilike('ilac_adi', `%${q}%`)
        .limit(25);
      setSearchingMeds(false);
      if (!error && data) setMedResults(data as MedicationRow[]);
    }, 350);
    return () => clearTimeout(timer);
  }, [medSearch]);

  // ── Modal toggle'ları ────────────────────────────────────────────────────
  const toggleModalMed = useCallback((medId: string) => {
    setModalSelectedMedIds((prev) => {
      const next = new Set(prev);
      if (next.has(medId)) {
        next.delete(medId);
        setModalMedDosages((d) => { const nd = new Map(d); nd.delete(medId); return nd; });
      } else {
        next.add(medId);
      }
      return next;
    });
  }, []);

  const setModalDosage = useCallback((medId: string, value: string) => {
    setModalMedDosages((prev) => { const next = new Map(prev); next.set(medId, value); return next; });
  }, []);

  // ─── Modal SectionList / FlatList render callbackleri ────────────────────

  // Hastalık modalı
  const keyExtractorCond = useCallback((item: ConditionCatalogRow) => item.id, []);

  const renderConditionModalItem = useCallback(
    ({ item: row }: { item: ConditionCatalogRow }) => {
      const on = userConditionIds.has(row.id);
      return (
        <Pressable
          style={[styles.checkRow, on && styles.checkRowSelected]}
          onPress={() => void toggleCondition(row)}>
          <Text style={styles.rowName}>{row.name}</Text>
          <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? '#8ab4ff' : '#aaa'} />
        </Pressable>
      );
    },
    [userConditionIds, toggleCondition],
  );

  const renderConditionModalSectionHeader = useCallback(
    ({ section: { title } }: { section: ProfileConditionSection }) => (
      <Text style={styles.modalSectionTitle}>{title}</Text>
    ),
    [],
  );

  // İlaç modalı — Hastalığa Göre sekmesi
  const keyExtractorCondMed = useCallback(
    (item: CondMedRow) => `${item.condition_id}:${item.medication.id}`,
    [],
  );

  const renderCondMedItem = useCallback(
    ({ item: { medication } }: { item: CondMedRow }) => {
      const isActive = activeMedIds.has(medication.id);
      const selected = modalSelectedMedIds.has(medication.id);
      return (
        <View>
          <Pressable
            style={[styles.checkRow, selected && styles.checkRowSelected, isActive && styles.checkRowDimmed]}
            onPress={() => { if (!isActive) toggleModalMed(medication.id); }}
            disabled={isActive}>
            <View style={styles.medInfoCol}>
              <Text style={[styles.rowName, isActive && styles.rowNameDimmed]}>
                {medication.ilac_adi}
              </Text>
              {medication.etkin_madde_adi
                ? <Text style={styles.medSub}>{medication.etkin_madde_adi}</Text>
                : null}
              {isActive ? <Text style={styles.alreadyLabel}>Zaten kullanılıyor</Text> : null}
            </View>
            {isActive
              ? <Ionicons name="checkmark-circle" size={22} color="#4a5a7a" />
              : <Ionicons name={selected ? 'checkbox' : 'square-outline'} size={22} color={selected ? '#8ab4ff' : '#aaa'} />}
          </Pressable>
          {selected ? (
            <TextInput
              style={styles.dosageInline}
              value={modalMedDosages.get(medication.id) ?? ''}
              onChangeText={(v) => setModalDosage(medication.id, v)}
              placeholder="Doz (örn: 500 mg, günde 2×) — opsiyonel"
              placeholderTextColor="#555"
            />
          ) : null}
        </View>
      );
    },
    [activeMedIds, modalSelectedMedIds, toggleModalMed, modalMedDosages, setModalDosage],
  );

  const renderCondMedSectionHeader = useCallback(
    ({ section: { title } }: { section: ProfileMedSection }) => (
      <Text style={styles.modalSectionTitle}>{title}</Text>
    ),
    [],
  );

  // İlaç modalı — Serbest Arama sekmesi
  const keyExtractorMedSearch = useCallback((item: MedicationRow) => item.id, []);

  const renderSearchMedItem = useCallback(
    ({ item: med }: { item: MedicationRow }) => {
      const isActive = activeMedIds.has(med.id);
      return (
        <Pressable
          style={[styles.medSearchRow, isActive && styles.medSearchRowAdded]}
          onPress={() => { if (!isActive) { setSelectedMed(med); setDosageInput(''); } }}
          disabled={isActive}>
          <View style={styles.medSearchInfo}>
            <Text style={styles.medName}>{med.ilac_adi}</Text>
            {med.etkin_madde_adi ? <Text style={styles.medSub}>{med.etkin_madde_adi}</Text> : null}
            {med.firma_adi ? <Text style={styles.medSub}>{med.firma_adi}</Text> : null}
          </View>
          <Ionicons
            name={isActive ? 'checkmark-circle' : 'add-circle-outline'}
            size={22}
            color={isActive ? '#8ab4ff' : '#aaa'}
          />
        </Pressable>
      );
    },
    [activeMedIds, setSelectedMed],
  );

  // ── Loading / hata ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={C.text1} />
        </View>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.center}>
          <Text style={styles.err}>{loadError}</Text>
          <Pressable style={styles.retryBtn} onPress={() => void loadData()}>
            <Text style={styles.retryBtnText}>Tekrar dene</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Profil Bilgileri ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Profil Bilgileri</Text>
            {!editingProfile && (
              <Pressable onPress={openEditProfile} style={styles.actionBtn}>
                <Ionicons name="pencil-outline" size={16} color="#aaa" />
                <Text style={styles.actionBtnText}>Düzenle</Text>
              </Pressable>
            )}
          </View>

          {!editingProfile ? (
            <View style={styles.infoBlock}>
              <InfoRow label="Ad Soyad" value={profile?.full_name || '—'} />
              <InfoRow label="Doğum Tarihi" value={profile?.birth_date || '—'} />
              <InfoRow label="Cinsiyet" value={genderLabel(profile?.gender ?? null)} />
              <InfoRow label="Boy" value={profile?.height_cm != null ? `${profile.height_cm} cm` : '—'} />
              <InfoRow label="Kilo" value={profile?.weight_kg != null ? `${profile.weight_kg} kg` : '—'} />
            </View>
          ) : (
            <View>
              <Text style={styles.fieldLabel}>Ad Soyad</Text>
              <TextInput
                style={styles.input}
                value={fullName}
                onChangeText={setFullName}
                placeholder="Adın Soyadın"
                placeholderTextColor="#888"
                autoCapitalize="words"
                editable={!savingProfile}
              />
              <Text style={styles.fieldLabel}>Doğum Tarihi</Text>
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
                    <Pressable key={value} style={[styles.chip, on && styles.chipSelected]} onPress={() => setGender(value)} disabled={savingProfile}>
                      <Text style={[styles.chipText, on && styles.chipTextSelected]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.fieldLabel}>Boy (cm)</Text>
              <TextInput style={styles.input} value={heightCm} onChangeText={(t) => setHeightCm(t.replace(/[^0-9]/g, ''))} placeholder="50 – 250" placeholderTextColor="#888" keyboardType="number-pad" editable={!savingProfile} />
              <Text style={styles.fieldLabel}>Kilo (kg)</Text>
              <TextInput style={styles.input} value={weightKg} onChangeText={(t) => setWeightKg(t.replace(/[^0-9]/g, ''))} placeholder="10 – 300" placeholderTextColor="#888" keyboardType="number-pad" editable={!savingProfile} />
              {profileError ? <Text style={styles.err}>{profileError}</Text> : null}
              <View style={styles.editActions}>
                <Pressable style={styles.cancelBtn} onPress={() => { setEditingProfile(false); setProfileError(null); }} disabled={savingProfile}>
                  <Text style={styles.cancelBtnText}>İptal</Text>
                </Pressable>
                <Pressable style={[styles.saveBtn, savingProfile && styles.saveBtnDisabled]} onPress={() => void saveProfile()} disabled={savingProfile}>
                  {savingProfile ? <ActivityIndicator color="#0a0a0a" /> : <Text style={styles.saveBtnText}>Kaydet</Text>}
                </Pressable>
              </View>
            </View>
          )}
        </View>

        {/* ── Kronik Hastalıklar ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Kronik Hastalıklar</Text>
            <Pressable onPress={() => void openConditionsModal()} style={styles.actionBtn}>
              <Ionicons name="add-circle-outline" size={16} color={C.text2} />
              <Text style={styles.actionBtnText}>Ekle</Text>
            </Pressable>
          </View>
          {userConditions.length === 0 ? (
            <Text style={styles.emptyText}>Kayıtlı kronik hastalık yok.</Text>
          ) : (
            <View style={styles.chipWrap}>
              {userConditions.map((c) => (
                <Pressable key={c.id} style={styles.condChip} onPress={() => void removeCondition(c.id)}>
                  <Text style={styles.condChipText}>{c.name}</Text>
                  <Ionicons name="close-circle" size={15} color={C.primary} />
                </Pressable>
              ))}
            </View>
          )}
          {conditionActionError ? <Text style={styles.err}>{conditionActionError}</Text> : null}
        </View>

        {/* ── Düzenli Kullandığım İlaçlar ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Düzenli Kullandığım İlaçlar</Text>
            <Pressable onPress={() => void openMedsModal()} style={styles.actionBtn}>
              <Ionicons name="add-circle-outline" size={16} color={C.text2} />
              <Text style={styles.actionBtnText}>Ekle</Text>
            </Pressable>
          </View>

          {activeMeds.length === 0 ? (
            <Text style={styles.emptyText}>Aktif ilaç kaydı yok.</Text>
          ) : (
            <View>
              {activeMeds.map((um) => (
                <View key={um.medication_id} style={styles.medRow}>
                  <View style={styles.medInfo}>
                    <Text style={styles.medName}>{um.medications.ilac_adi}</Text>
                    {um.dosage ? <Text style={styles.medDosage}>{um.dosage}</Text> : null}
                    {um.medications.etkin_madde_adi
                      ? <Text style={styles.medSub}>{um.medications.etkin_madde_adi}</Text>
                      : null}
                  </View>
                  <Pressable onPress={() => void quitMedication(um.medication_id)} style={styles.quitBtn}>
                    <Text style={styles.quitBtnText}>Bırak</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          {medicationActionError ? <Text style={styles.err}>{medicationActionError}</Text> : null}

          {/* Geçmiş İlaçlar toggle */}
          {pastMeds.length > 0 ? (
            <View style={styles.pastSection}>
              <Pressable style={styles.pastToggle} onPress={() => setShowPastMeds((v) => !v)}>
                <Text style={styles.pastToggleText}>Geçmiş İlaçlar ({pastMeds.length})</Text>
                <Ionicons name={showPastMeds ? 'chevron-up' : 'chevron-down'} size={16} color={C.text3} />
              </Pressable>
              {showPastMeds
                ? pastMeds.map((um) => (
                    <View key={um.medication_id} style={styles.pastMedRow}>
                      <View style={styles.medInfo}>
                        <Text style={styles.pastMedName}>{um.medications.ilac_adi}</Text>
                        {um.medications.etkin_madde_adi
                          ? <Text style={styles.medSub}>{um.medications.etkin_madde_adi}</Text>
                          : null}
                      </View>
                      <Pressable onPress={() => void resumeMedication(um.medication_id)} style={styles.resumeBtn}>
                        <Text style={styles.resumeBtnText}>Yeniden başla</Text>
                      </Pressable>
                    </View>
                  ))
                : null}
            </View>
          ) : null}
        </View>

        {/* ── Yasal Metinler ve Hesap ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Yasal Metinler</Text>
          <View style={styles.legalList}>
            <LegalRow title="KVKK Aydınlatma Metni" onPress={() => setLegalDocument('kvkk_aydinlatma')} />
            <LegalRow title="Açık Rıza Beyanı" onPress={() => setLegalDocument('acik_riza')} />
            <LegalRow title="Sorumluluk Reddi Beyanı" onPress={() => setLegalDocument('sorumluluk_reddi')} />
            <LegalRow title="Gizlilik Politikası" onPress={() => setLegalDocument('gizlilik_politikasi')} />
          </View>
          <Pressable
            style={styles.deleteAccountBtn}
            onPress={() => {
              setDeleteAccountError(null);
              setDeleteModalVisible(true);
            }}
          >
            <Ionicons name="trash-outline" size={18} color={C.error} />
            <Text style={styles.deleteAccountText}>Hesabımı Sil</Text>
          </Pressable>
        </View>

        {/* ── Çıkış ── */}
        <Pressable style={styles.signOutBtn} onPress={() => void supabase.auth.signOut()}>
          <Ionicons name="log-out-outline" size={20} color={C.error} />
          <Text style={styles.signOutText}>Çıkış Yap</Text>
        </Pressable>
      </ScrollView>

      {/* ── Hastalık Modal ── */}
      <Modal visible={conditionsModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setConditionsModal(false)}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Hastalık Ekle / Çıkar</Text>
            <Pressable onPress={() => setConditionsModal(false)}>
              <Ionicons name="close" size={24} color={C.text1} />
            </Pressable>
          </View>
          <TextInput style={styles.modalSearch} value={conditionsSearch} onChangeText={setConditionsSearch} placeholder="Hastalık ara..." placeholderTextColor="#888" />
          {loadingConditions ? (
            <ActivityIndicator style={styles.modalLoader} color="#fff" />
          ) : conditionsError ? (
            <Text style={[styles.err, styles.modalPad]}>{conditionsError}</Text>
          ) : (
            <SectionList<ConditionCatalogRow, ProfileConditionSection>
              sections={conditionModalSections}
              keyExtractor={keyExtractorCond}
              renderItem={renderConditionModalItem}
              renderSectionHeader={renderConditionModalSectionHeader}
              stickySectionHeadersEnabled={false}
              style={styles.modalScroll}
              contentContainerStyle={styles.modalListContent}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={15}
              maxToRenderPerBatch={20}
              windowSize={10}
              removeClippedSubviews={true}
            />
          )}
        </View>
      </Modal>

      {/* ── İlaç Modal ── */}
      <Modal visible={medsModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeMedsModal}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>İlaç Ekle</Text>
            <Pressable onPress={closeMedsModal}>
              <Ionicons name="close" size={24} color={C.text1} />
            </Pressable>
          </View>

          {/* Sekme seçici — sadece hastalık varsa göster */}
          {userConditions.length > 0 ? (
            <View style={styles.tabRow}>
              <Pressable
                style={[styles.tab, medModalTab === 'conditions' && styles.tabActive]}
                onPress={() => { setMedModalTab('conditions'); setSelectedMed(null); }}
              >
                <Text style={[styles.tabText, medModalTab === 'conditions' && styles.tabTextActive]}>
                  Hastalığa Göre
                </Text>
              </Pressable>
              <Pressable
                style={[styles.tab, medModalTab === 'search' && styles.tabActive]}
                onPress={() => { setMedModalTab('search'); setModalSelectedMedIds(new Set()); setModalMedDosages(new Map()); }}
              >
                <Text style={[styles.tabText, medModalTab === 'search' && styles.tabTextActive]}>
                  Serbest Arama
                </Text>
              </Pressable>
            </View>
          ) : (
            <Text style={[styles.emptyText, styles.modalPad]}>
              Hastalık eklersen ilacını daha hızlı bulabilirsin.
            </Text>
          )}

          {/* ── Hastalığa Göre sekmesi ── */}
          {medModalTab === 'conditions' ? (
            <>
              <TextInput
                style={styles.modalSearch}
                value={condMedSearch}
                onChangeText={setCondMedSearch}
                placeholder="İlaç adı ara..."
                placeholderTextColor="#888"
              />
              {loadingCondMeds ? (
                <ActivityIndicator style={styles.modalLoader} color={C.text1} />
              ) : condMedError ? (
                <Text style={[styles.err, styles.modalPad]}>{condMedError}</Text>
              ) : (
                <SectionList<CondMedRow, ProfileMedSection>
                  sections={condMedModalSections}
                  keyExtractor={keyExtractorCondMed}
                  renderItem={renderCondMedItem}
                  renderSectionHeader={renderCondMedSectionHeader}
                  stickySectionHeadersEnabled={false}
                  ListEmptyComponent={
                    !loadingCondMeds && !condMedError ? (
                      <Text style={[styles.emptyText, styles.modalPad]}>
                        Hastalıklarınla eşleşen ilaç bulunamadı.{'\n'}Serbest arama sekmesini dene.
                      </Text>
                    ) : null
                  }
                  style={styles.modalScroll}
                  contentContainerStyle={styles.modalListContent}
                  keyboardShouldPersistTaps="handled"
                  initialNumToRender={10}
                  maxToRenderPerBatch={20}
                  windowSize={10}
                />
              )}

              {/* Ekle footer */}
              {modalSelectedMedIds.size > 0 ? (
                <View style={[styles.modalFooter, { paddingBottom: insets.bottom + 14 }]}>
                  {addMedError ? <Text style={[styles.err, { marginBottom: 8 }]}>{addMedError}</Text> : null}
                  <Pressable
                    style={[styles.saveBtn, addingMed && styles.saveBtnDisabled]}
                    onPress={() => void addSelectedMedications()}
                    disabled={addingMed}
                  >
                    {addingMed
                      ? <ActivityIndicator color={C.bg} />
                      : <Text style={styles.saveBtnText}>Ekle ({modalSelectedMedIds.size})</Text>}
                  </Pressable>
                </View>
              ) : null}
            </>
          ) : null}

          {/* ── Serbest Arama sekmesi ── */}
          {medModalTab === 'search' ? (
            selectedMed ? (
              <View style={styles.dosageView}>
                <Text style={styles.selectedMedName}>{selectedMed.ilac_adi}</Text>
                {selectedMed.etkin_madde_adi
                  ? <Text style={styles.selectedMedSub}>{selectedMed.etkin_madde_adi}</Text>
                  : null}
                <Text style={[styles.fieldLabel, { marginTop: 20 }]}>Doz / Kullanım (isteğe bağlı)</Text>
                <TextInput
                  style={styles.input}
                  value={dosageInput}
                  onChangeText={setDosageInput}
                  placeholder="ör. Günde 1 tablet"
                  placeholderTextColor="#888"
                />
                {addMedError ? <Text style={styles.err}>{addMedError}</Text> : null}
                <View style={styles.editActions}>
                  <Pressable style={styles.cancelBtn} onPress={() => { setSelectedMed(null); setAddMedError(null); }}>
                    <Text style={styles.cancelBtnText}>Geri</Text>
                  </Pressable>
                  <Pressable style={[styles.saveBtn, addingMed && styles.saveBtnDisabled]} onPress={() => void addSingleMedication()} disabled={addingMed}>
                    {addingMed ? <ActivityIndicator color="#0a0a0a" /> : <Text style={styles.saveBtnText}>Ekle</Text>}
                  </Pressable>
                </View>
              </View>
            ) : (
              <>
                <TextInput
                  style={styles.modalSearch}
                  value={medSearch}
                  onChangeText={setMedSearch}
                  placeholder="İlaç adı ara..."
                  placeholderTextColor="#888"
                  autoFocus={userConditions.length === 0}
                />
                {searchingMeds ? (
                  <ActivityIndicator style={styles.modalLoader} color={C.text1} />
                ) : medSearch.trim().length > 0 && medResults.length === 0 ? (
                  <Text style={[styles.emptyText, styles.modalPad]}>Sonuç bulunamadı.</Text>
                ) : (
                  <FlatList<MedicationRow>
                    data={medResults}
                    keyExtractor={keyExtractorMedSearch}
                    renderItem={renderSearchMedItem}
                    style={styles.modalScroll}
                    contentContainerStyle={styles.modalListContent}
                    keyboardShouldPersistTaps="handled"
                    initialNumToRender={10}
                    maxToRenderPerBatch={20}
                    windowSize={5}
                  />
                )}
              </>
            )
          ) : null}
        </View>
      </Modal>

      <LegalDocumentModal
        visible={legalDocument !== null}
        documentId={legalDocument}
        onClose={() => setLegalDocument(null)}
      />

      <Modal
        visible={deleteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!deletingAccount) setDeleteModalVisible(false);
        }}
      >
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitle}>Hesabınızı silmek istiyor musunuz?</Text>
            <Text style={styles.confirmText}>
              Hesabınız ve uygulamadaki kayıtlı verileriniz silinir. Bu işlem geri alınamaz.
            </Text>
            {deleteAccountError ? <Text style={styles.err}>{deleteAccountError}</Text> : null}
            <View style={styles.editActions}>
              <Pressable
                style={styles.cancelBtn}
                onPress={() => setDeleteModalVisible(false)}
                disabled={deletingAccount}
              >
                <Text style={styles.cancelBtnText}>Vazgeç</Text>
              </Pressable>
              <Pressable
                style={[styles.confirmDeleteBtn, deletingAccount && styles.saveBtnDisabled]}
                onPress={() => void deleteAccount()}
                disabled={deletingAccount}
              >
                {deletingAccount ? (
                  <ActivityIndicator color={C.text1} />
                ) : (
                  <Text style={styles.confirmDeleteText}>Sil</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function LegalRow({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable style={styles.legalRow} onPress={onPress}>
      <Text style={styles.legalRowText}>{title}</Text>
      <Ionicons name="chevron-forward" size={17} color={C.text3} />
    </Pressable>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center', padding: 24 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 48 },

  section: { backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: C.border },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  sectionTitle: { color: C.text1, fontSize: 16, fontWeight: '700' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionBtnText: { color: C.text2, fontSize: 13 },

  infoBlock: { gap: 2 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.surfaceAlt },
  infoLabel: { color: C.text2, fontSize: 14 },
  infoValue: { color: C.text1, fontSize: 14, fontWeight: '500', maxWidth: '60%', textAlign: 'right' },

  fieldLabel: { color: C.text1, fontSize: 14, fontWeight: '500', marginBottom: 8, marginTop: 4 },
  input: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 10, color: C.text1, fontSize: 16, paddingHorizontal: 14, paddingVertical: 14, marginBottom: 14 },
  pickerRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  pickerCol: { flex: 1 },
  pickerCaption: { color: C.text2, fontSize: 12, marginBottom: 6 },
  pickerBox: { borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, overflow: 'hidden' },
  picker: { color: C.text1 },
  genderRow: { gap: 8, marginBottom: 14 },
  chip: { borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: C.surface },
  chipSelected: { borderColor: C.primary, backgroundColor: C.primaryDim },
  chipText: { color: C.text2, fontSize: 15 },
  chipTextSelected: { color: C.text1, fontWeight: '600' },

  editActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: { flex: 1, paddingVertical: 13, borderRadius: 10, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  cancelBtnText: { color: C.text1, fontSize: 15, fontWeight: '600' },
  saveBtn: { flex: 1, paddingVertical: 13, borderRadius: 10, backgroundColor: C.text1, alignItems: 'center', justifyContent: 'center' },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: C.bg, fontSize: 15, fontWeight: '700' },

  emptyText: { color: C.text3, fontSize: 14 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  condChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.primaryDim, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: C.border },
  condChipText: { color: C.text1, fontSize: 13 },

  // İlaç listesi
  medRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.surfaceAlt },
  medInfo: { flex: 1 },
  medName: { color: C.text1, fontSize: 15, fontWeight: '500' },
  medDosage: { color: C.primary, fontSize: 12, marginTop: 2 },
  medSub: { color: C.text3, fontSize: 12, marginTop: 1 },
  quitBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.errorDim },
  quitBtnText: { color: C.error, fontSize: 13, fontWeight: '600' },

  // Geçmiş
  pastSection: { marginTop: 14, borderTopWidth: 1, borderTopColor: C.surfaceAlt, paddingTop: 10 },
  pastToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  pastToggleText: { color: C.text3, fontSize: 13 },
  pastMedRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  pastMedName: { color: C.text3, fontSize: 14 },
  resumeBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.successDim },
  resumeBtnText: { color: C.success, fontSize: 12, fontWeight: '600' },

  signOutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 6, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.errorDim },
  signOutText: { color: C.error, fontSize: 16, fontWeight: '600' },

  legalList: { marginTop: 14, borderTopWidth: 1, borderTopColor: C.surfaceAlt },
  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: C.surfaceAlt,
  },
  legalRowText: { color: C.text1, fontSize: 14 },
  deleteAccountBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    paddingVertical: 13,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.error,
    backgroundColor: C.errorDim,
  },
  deleteAccountText: { color: C.error, fontSize: 15, fontWeight: '700' },

  err: { color: C.error, fontSize: 13, marginTop: 6 },
  retryBtn: { marginTop: 20, backgroundColor: C.text1, paddingVertical: 13, paddingHorizontal: 28, borderRadius: 10 },
  retryBtnText: { color: C.bg, fontSize: 15, fontWeight: '700' },

  // Modal
  modal: { flex: 1, backgroundColor: C.bg, paddingTop: 16 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle: { color: C.text1, fontSize: 18, fontWeight: '700' },
  modalSearch: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 10, color: C.text1, fontSize: 15, paddingHorizontal: 14, paddingVertical: 12, margin: 14 },
  modalScroll: { flex: 1 },
  modalListContent: { paddingHorizontal: 14, paddingBottom: 16 },
  modalSectionTitle: { color: C.text1, fontSize: 15, fontWeight: '700', marginTop: 14, marginBottom: 8 },
  modalLoader: { marginTop: 32 },
  modalPad: { padding: 16 },
  modalFooter: { padding: 14, borderTopWidth: 1, borderTopColor: C.border },

  confirmBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  confirmBox: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: C.border,
  },
  confirmTitle: { color: C.text1, fontSize: 18, fontWeight: '800', marginBottom: 10 },
  confirmText: { color: C.text2, fontSize: 14, lineHeight: 21 },
  confirmDeleteBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 10,
    backgroundColor: C.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmDeleteText: { color: C.text1, fontSize: 15, fontWeight: '700' },

  // Sekmeler
  tabRow: { flexDirection: 'row', marginHorizontal: 14, marginTop: 12, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: C.surface },
  tabActive: { backgroundColor: C.primaryDim },
  tabText: { color: C.text3, fontSize: 14, fontWeight: '600' },
  tabTextActive: { color: C.primary },

  categoryBlock: { paddingHorizontal: 14, marginBottom: 4 },
  categoryTitle: { color: C.text1, fontSize: 15, fontWeight: '700', marginTop: 14, marginBottom: 8 },
  checkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: C.border, marginBottom: 6, backgroundColor: C.surface },
  checkRowSelected: { borderColor: C.border, backgroundColor: C.primaryDim },
  checkRowDimmed: { opacity: 0.45 },
  rowName: { color: C.text1, fontSize: 15, flex: 1, marginRight: 12 },
  rowNameDimmed: { color: C.text3 },
  medInfoCol: { flex: 1, marginRight: 12 },
  alreadyLabel: { color: C.text3, fontSize: 11, marginTop: 2 },
  dosageInline: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 8, color: C.text2, fontSize: 14, paddingHorizontal: 12, paddingVertical: 10, marginTop: -2, marginBottom: 8, marginHorizontal: 2 },

  dosageView: { padding: 16 },
  selectedMedName: { color: C.text1, fontSize: 18, fontWeight: '700' },
  selectedMedSub: { color: C.text2, fontSize: 13, marginTop: 4 },

  medSearchRow: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: C.surface },
  medSearchRowAdded: { opacity: 0.45 },
  medSearchInfo: { flex: 1 },
});
