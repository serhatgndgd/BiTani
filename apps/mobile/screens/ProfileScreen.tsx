import { Ionicons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
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
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Profil
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

  // Hastalıklar
  const [userConditions, setUserConditions] = useState<ConditionCatalogRow[]>([]);
  const [conditionsModal, setConditionsModal] = useState(false);
  const [allConditions, setAllConditions] = useState<ConditionCatalogRow[]>([]);
  const [conditionsSearch, setConditionsSearch] = useState('');
  const [loadingConditions, setLoadingConditions] = useState(false);
  const [conditionsError, setConditionsError] = useState<string | null>(null);

  // İlaçlar
  const [userMedications, setUserMedications] = useState<UserMedication[]>([]);
  const [medsModal, setMedsModal] = useState(false);
  const [medSearch, setMedSearch] = useState('');
  const [medResults, setMedResults] = useState<MedicationRow[]>([]);
  const [searchingMeds, setSearchingMeds] = useState(false);
  const [selectedMed, setSelectedMed] = useState<MedicationRow | null>(null);
  const [dosageInput, setDosageInput] = useState('');
  const [addingMed, setAddingMed] = useState(false);
  const [addMedError, setAddMedError] = useState<string | null>(null);

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
    const maxD = dayItems.length;
    if (parseInt(day, 10) > maxD) setDay(String(maxD));
  }, [dayItems, day]);

  const filteredConditions = useMemo(() => {
    const q = conditionsSearch.trim().toLowerCase();
    if (!q) return allConditions;
    return allConditions.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.category && c.category.toLowerCase().includes(q)),
    );
  }, [allConditions, conditionsSearch]);

  const grouped = useMemo(() => groupByCategory(filteredConditions), [filteredConditions]);
  const userConditionIds = useMemo(() => new Set(userConditions.map((c) => c.id)), [userConditions]);
  const userMedIds = useMemo(() => new Set(userMedications.map((m) => m.medication_id)), [userMedications]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user?.id) {
      setLoadError('Kullanıcı bilgisi alınamadı.');
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
      setLoadError(profileRes.error.message || 'Profil yüklenemedi.');
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

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openEditProfile = () => {
    if (profile) {
      setFullName(profile.full_name ?? '');
      const parsed = parseIsoDate(profile.birth_date);
      setDay(parsed.day);
      setMonth(parsed.month);
      setYear(parsed.year);
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
    if (error) { setProfileError(error.message || 'Kaydedilemedi.'); return; }
    setProfile({ full_name: fullName.trim(), birth_date: iso, gender, height_cm: h, weight_kg: w });
    setEditingProfile(false);
  };

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
    if (userConditionIds.has(cond.id)) {
      const { error } = await supabase
        .from('user_conditions')
        .delete()
        .eq('user_id', userId)
        .eq('condition_id', cond.id);
      if (!error) setUserConditions((prev) => prev.filter((c) => c.id !== cond.id));
    } else {
      const { error } = await supabase
        .from('user_conditions')
        .insert({ user_id: userId, condition_id: cond.id });
      if (!error) setUserConditions((prev) => [...prev, cond]);
    }
  }, [userId, userConditionIds]);

  const removeCondition = useCallback(async (id: string) => {
    if (!userId) return;
    const { error } = await supabase
      .from('user_conditions')
      .delete()
      .eq('user_id', userId)
      .eq('condition_id', id);
    if (!error) setUserConditions((prev) => prev.filter((c) => c.id !== id));
  }, [userId]);

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

  const addMedication = async () => {
    if (!userId || !selectedMed) return;
    setAddingMed(true);
    setAddMedError(null);
    const { error } = await supabase.from('user_medications').insert({
      user_id: userId,
      medication_id: selectedMed.id,
      dosage: dosageInput.trim() || null,
      is_active: true,
    });
    setAddingMed(false);
    if (error) { setAddMedError(error.message || 'Eklenemedi.'); return; }
    setUserMedications((prev) => [
      ...prev,
      { medication_id: selectedMed.id, dosage: dosageInput.trim() || null, is_active: true, medications: selectedMed },
    ]);
    closeMedsModal();
  };

  const removeMedication = useCallback(async (medicationId: string) => {
    if (!userId) return;
    const { error } = await supabase
      .from('user_medications')
      .delete()
      .eq('user_id', userId)
      .eq('medication_id', medicationId);
    if (!error) setUserMedications((prev) => prev.filter((m) => m.medication_id !== medicationId));
  }, [userId]);

  const closeMedsModal = () => {
    setMedsModal(false);
    setSelectedMed(null);
    setDosageInput('');
    setMedSearch('');
    setMedResults([]);
    setAddMedError(null);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.center}>
        <Text style={styles.err}>{loadError}</Text>
        <Pressable style={styles.retryBtn} onPress={() => void loadData()}>
          <Text style={styles.retryBtnText}>Tekrar dene</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Profil Bilgileri */}
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
                    <Picker
                      selectedValue={day}
                      onValueChange={(v) => setDay(String(v))}
                      style={styles.picker}
                      dropdownIconColor="#fff"
                    >
                      {dayItems.map((d) => (
                        <Picker.Item key={d} label={d} value={d} color="#fff" />
                      ))}
                    </Picker>
                  </View>
                </View>
                <View style={styles.pickerCol}>
                  <Text style={styles.pickerCaption}>Ay</Text>
                  <View style={styles.pickerBox}>
                    <Picker
                      selectedValue={month}
                      onValueChange={(v) => setMonth(String(v))}
                      style={styles.picker}
                      dropdownIconColor="#fff"
                    >
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
                    <Picker
                      selectedValue={year}
                      onValueChange={(v) => setYear(String(v))}
                      style={styles.picker}
                      dropdownIconColor="#fff"
                    >
                      {years.map((y) => (
                        <Picker.Item key={y} label={y} value={y} color="#fff" />
                      ))}
                    </Picker>
                  </View>
                </View>
              </View>

              <Text style={styles.fieldLabel}>Cinsiyet</Text>
              <View style={styles.genderRow}>
                {GENDER_OPTIONS.map(({ value, label }) => {
                  const on = gender === value;
                  return (
                    <Pressable
                      key={value}
                      style={[styles.chip, on && styles.chipSelected]}
                      onPress={() => setGender(value)}
                      disabled={savingProfile}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextSelected]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>Boy (cm)</Text>
              <TextInput
                style={styles.input}
                value={heightCm}
                onChangeText={(t) => setHeightCm(t.replace(/[^0-9]/g, ''))}
                placeholder="50 – 250"
                placeholderTextColor="#888"
                keyboardType="number-pad"
                editable={!savingProfile}
              />

              <Text style={styles.fieldLabel}>Kilo (kg)</Text>
              <TextInput
                style={styles.input}
                value={weightKg}
                onChangeText={(t) => setWeightKg(t.replace(/[^0-9]/g, ''))}
                placeholder="10 – 300"
                placeholderTextColor="#888"
                keyboardType="number-pad"
                editable={!savingProfile}
              />

              {profileError ? <Text style={styles.err}>{profileError}</Text> : null}

              <View style={styles.editActions}>
                <Pressable
                  style={styles.cancelBtn}
                  onPress={() => { setEditingProfile(false); setProfileError(null); }}
                  disabled={savingProfile}
                >
                  <Text style={styles.cancelBtnText}>İptal</Text>
                </Pressable>
                <Pressable
                  style={[styles.saveBtn, savingProfile && styles.saveBtnDisabled]}
                  onPress={() => void saveProfile()}
                  disabled={savingProfile}
                >
                  {savingProfile
                    ? <ActivityIndicator color="#0a0a0a" />
                    : <Text style={styles.saveBtnText}>Kaydet</Text>}
                </Pressable>
              </View>
            </View>
          )}
        </View>

        {/* Kronik Hastalıklar */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Kronik Hastalıklar</Text>
            <Pressable onPress={() => void openConditionsModal()} style={styles.actionBtn}>
              <Ionicons name="add-circle-outline" size={16} color="#aaa" />
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
                  <Ionicons name="close-circle" size={15} color="#8ab4ff" />
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* İlaçlar */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Düzenli Kullandığım İlaçlar</Text>
            <Pressable onPress={() => setMedsModal(true)} style={styles.actionBtn}>
              <Ionicons name="add-circle-outline" size={16} color="#aaa" />
              <Text style={styles.actionBtnText}>Ekle</Text>
            </Pressable>
          </View>
          {userMedications.length === 0 ? (
            <Text style={styles.emptyText}>Kayıtlı ilaç yok.</Text>
          ) : (
            <View>
              {userMedications.map((um) => (
                <View key={um.medication_id} style={styles.medRow}>
                  <View style={styles.medInfo}>
                    <Text style={styles.medName}>{um.medications.ilac_adi}</Text>
                    {um.dosage ? <Text style={styles.medDosage}>{um.dosage}</Text> : null}
                    {um.medications.etkin_madde_adi
                      ? <Text style={styles.medSub}>{um.medications.etkin_madde_adi}</Text>
                      : null}
                  </View>
                  <Pressable onPress={() => void removeMedication(um.medication_id)} style={styles.removeBtn}>
                    <Ionicons name="trash-outline" size={18} color="#ff6b6b" />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Çıkış Yap */}
        <Pressable style={styles.signOutBtn} onPress={() => void supabase.auth.signOut()}>
          <Ionicons name="log-out-outline" size={20} color="#ff6b6b" />
          <Text style={styles.signOutText}>Çıkış Yap</Text>
        </Pressable>
      </ScrollView>

      {/* Hastalık Modal */}
      <Modal
        visible={conditionsModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setConditionsModal(false)}
      >
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Hastalık Ekle / Çıkar</Text>
            <Pressable onPress={() => setConditionsModal(false)}>
              <Ionicons name="close" size={24} color="#fff" />
            </Pressable>
          </View>
          <TextInput
            style={styles.modalSearch}
            value={conditionsSearch}
            onChangeText={setConditionsSearch}
            placeholder="Hastalık ara..."
            placeholderTextColor="#888"
          />
          {loadingConditions ? (
            <ActivityIndicator style={styles.modalLoader} color="#fff" />
          ) : conditionsError ? (
            <Text style={[styles.err, styles.modalPad]}>{conditionsError}</Text>
          ) : (
            <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
              {[...grouped.entries()].map(([category, rows]) => (
                <View key={category} style={styles.categoryBlock}>
                  <Text style={styles.categoryTitle}>{category}</Text>
                  {rows.map((row) => {
                    const on = userConditionIds.has(row.id);
                    return (
                      <Pressable
                        key={row.id}
                        style={[styles.checkRow, on && styles.checkRowSelected]}
                        onPress={() => void toggleCondition(row)}
                      >
                        <Text style={styles.rowName}>{row.name}</Text>
                        <Ionicons
                          name={on ? 'checkbox' : 'square-outline'}
                          size={22}
                          color={on ? '#8ab4ff' : '#aaa'}
                        />
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* İlaç Modal */}
      <Modal
        visible={medsModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeMedsModal}
      >
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>İlaç Ekle</Text>
            <Pressable onPress={closeMedsModal}>
              <Ionicons name="close" size={24} color="#fff" />
            </Pressable>
          </View>

          {selectedMed ? (
            <View style={styles.dosageView}>
              <Text style={styles.selectedMedName}>{selectedMed.ilac_adi}</Text>
              {selectedMed.etkin_madde_adi
                ? <Text style={styles.selectedMedSub}>{selectedMed.etkin_madde_adi}</Text>
                : null}
              <Text style={[styles.fieldLabel, styles.dosageLabel]}>Doz / Kullanım (isteğe bağlı)</Text>
              <TextInput
                style={styles.input}
                value={dosageInput}
                onChangeText={setDosageInput}
                placeholder="ör. Günde 1 tablet"
                placeholderTextColor="#888"
              />
              {addMedError ? <Text style={styles.err}>{addMedError}</Text> : null}
              <View style={styles.editActions}>
                <Pressable
                  style={styles.cancelBtn}
                  onPress={() => { setSelectedMed(null); setAddMedError(null); }}
                >
                  <Text style={styles.cancelBtnText}>Geri</Text>
                </Pressable>
                <Pressable
                  style={[styles.saveBtn, addingMed && styles.saveBtnDisabled]}
                  onPress={() => void addMedication()}
                  disabled={addingMed}
                >
                  {addingMed
                    ? <ActivityIndicator color="#0a0a0a" />
                    : <Text style={styles.saveBtnText}>Ekle</Text>}
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
                autoFocus
              />
              {searchingMeds ? (
                <ActivityIndicator style={styles.modalLoader} color="#fff" />
              ) : medSearch.trim().length > 0 && medResults.length === 0 ? (
                <Text style={[styles.emptyText, styles.modalPad]}>Sonuç bulunamadı.</Text>
              ) : (
                <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
                  {medResults.map((med) => {
                    const already = userMedIds.has(med.id);
                    return (
                      <Pressable
                        key={med.id}
                        style={[styles.medSearchRow, already && styles.medSearchRowAdded]}
                        onPress={() => {
                          if (!already) { setSelectedMed(med); setDosageInput(''); }
                        }}
                        disabled={already}
                      >
                        <View style={styles.medSearchInfo}>
                          <Text style={styles.medName}>{med.ilac_adi}</Text>
                          {med.etkin_madde_adi
                            ? <Text style={styles.medSub}>{med.etkin_madde_adi}</Text>
                            : null}
                          {med.firma_adi
                            ? <Text style={styles.medSub}>{med.firma_adi}</Text>
                            : null}
                        </View>
                        <Ionicons
                          name={already ? 'checkmark-circle' : 'add-circle-outline'}
                          size={22}
                          color={already ? '#8ab4ff' : '#aaa'}
                        />
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}
            </>
          )}
        </View>
      </Modal>
    </SafeAreaView>
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
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', padding: 24 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 48 },

  section: {
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#222',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sectionTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionBtnText: { color: '#aaa', fontSize: 13 },

  infoBlock: { gap: 2 },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e1e1e',
  },
  infoLabel: { color: '#888', fontSize: 14 },
  infoValue: { color: '#fff', fontSize: 14, fontWeight: '500', maxWidth: '60%', textAlign: 'right' },

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
    marginBottom: 14,
  },
  pickerRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  pickerCol: { flex: 1 },
  pickerCaption: { color: '#aaa', fontSize: 12, marginBottom: 6 },
  pickerBox: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#1a1a1a',
    overflow: 'hidden',
  },
  picker: { color: '#fff' },
  genderRow: { gap: 8, marginBottom: 14 },
  chip: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#333',
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#141414',
  },
  chipSelected: { borderColor: '#8ab4ff', backgroundColor: '#1a2332' },
  chipText: { color: '#ccc', fontSize: 15 },
  chipTextSelected: { color: '#fff', fontWeight: '600' },

  editActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#444',
    alignItems: 'center',
  },
  cancelBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  saveBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 10,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#0a0a0a', fontSize: 15, fontWeight: '700' },

  emptyText: { color: '#666', fontSize: 14 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  condChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1a1f28',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#3a4a6a',
  },
  condChipText: { color: '#c8d8ff', fontSize: 13 },

  medRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e1e1e',
  },
  medInfo: { flex: 1 },
  medName: { color: '#fff', fontSize: 15, fontWeight: '500' },
  medDosage: { color: '#8ab4ff', fontSize: 12, marginTop: 2 },
  medSub: { color: '#666', fontSize: 12, marginTop: 1 },
  removeBtn: { padding: 6 },

  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 6,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3a1a1a',
    backgroundColor: '#180a0a',
  },
  signOutText: { color: '#ff6b6b', fontSize: 16, fontWeight: '600' },

  err: { color: '#ff8a80', fontSize: 13, marginTop: 6 },
  retryBtn: {
    marginTop: 20,
    backgroundColor: '#fff',
    paddingVertical: 13,
    paddingHorizontal: 28,
    borderRadius: 10,
  },
  retryBtnText: { color: '#0a0a0a', fontSize: 15, fontWeight: '700' },

  modal: { flex: 1, backgroundColor: '#0a0a0a', paddingTop: 16 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  modalSearch: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    color: '#fff',
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
    margin: 14,
  },
  modalScroll: { flex: 1 },
  modalLoader: { marginTop: 32 },
  modalPad: { padding: 16 },

  categoryBlock: { paddingHorizontal: 14, marginBottom: 4 },
  categoryTitle: { color: '#fff', fontSize: 15, fontWeight: '700', marginTop: 14, marginBottom: 8 },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    marginBottom: 6,
    backgroundColor: '#121212',
  },
  checkRowSelected: { borderColor: '#4a5a7a', backgroundColor: '#1a1f28' },
  rowName: { color: '#fff', fontSize: 15, flex: 1, marginRight: 12 },

  dosageView: { padding: 16 },
  dosageLabel: { marginTop: 20 },
  selectedMedName: { color: '#fff', fontSize: 18, fontWeight: '700' },
  selectedMedSub: { color: '#888', fontSize: 13, marginTop: 4 },

  medSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  medSearchRowAdded: { opacity: 0.45 },
  medSearchInfo: { flex: 1 },
});
