import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '../lib/supabase';

// ─── Tipler ──────────────────────────────────────────────────────────────────

type MedResult = {
  id: string;
  ilac_adi: string;
  etkin_madde_adi: string | null;
  firma_adi: string | null;
  kub_url: string | null;
  kt_url: string | null;
};

// ─── Sabitler ─────────────────────────────────────────────────────────────────

const PAGE_SIZE    = 30;
const DEBOUNCE_MS  = 300;
const MIN_QUERY    = 2;

// ─── Ana bileşen ──────────────────────────────────────────────────────────────

export default function SearchScreen() {
  const [query, setQuery]             = useState('');
  const [results, setResults]         = useState<MedResult[]>([]);
  const [searching, setSearching]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore]         = useState(false);
  const [selected, setSelected]       = useState<MedResult | null>(null);
  const [userMedIds, setUserMedIds]   = useState<Set<string>>(new Set());

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offsetRef   = useRef(0);
  const activeQuery = useRef('');

  // Kullanıcının ilaç ID'lerini yükle (badge için)
  useEffect(() => {
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) return;
      const { data } = await supabase
        .from('user_medications')
        .select('medication_id')
        .eq('user_id', user.id)
        .eq('is_active', true);
      if (data) {
        const ids = (data as { medication_id: string }[]).map((r) => r.medication_id);
        setUserMedIds(new Set(ids));
      }
    })();
  }, []);

  // ─── Arama fonksiyonu ───────────────────────────────────────────────────────

  const doSearch = useCallback(async (q: string, offset: number, append: boolean) => {
    if (q.length < MIN_QUERY) {
      if (!append) { setResults([]); setHasMore(false); }
      return;
    }

    // Yarış durumunu önle: eski istekler yeni sonucu ezmemeli
    const requestQuery = q;
    if (offset === 0) setSearching(true);
    else setLoadingMore(true);

    try {
      const { data, error } = await supabase
        .from('medications')
        .select('id, ilac_adi, etkin_madde_adi, firma_adi, kub_url, kt_url')
        .or(`ilac_adi.ilike.%${q}%,etkin_madde_adi.ilike.%${q}%`)
        .order('ilac_adi')
        .range(offset, offset + PAGE_SIZE - 1);

      // Sorgu değiştiyse eski sonucu gösterme
      if (requestQuery !== activeQuery.current) return;
      if (error) throw error;

      const rows = (data ?? []) as MedResult[];
      setHasMore(rows.length === PAGE_SIZE);
      setResults((prev) => append ? [...prev, ...rows] : rows);
    } catch {
      // Hata sessizce geçilir; kullanıcı boş liste görür
    } finally {
      if (requestQuery === activeQuery.current) {
        setSearching(false);
        setLoadingMore(false);
      }
    }
  }, []);

  // ─── Debounced input handler ─────────────────────────────────────────────────

  const onChangeText = useCallback((text: string) => {
    setQuery(text);
    activeQuery.current = text;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (text.length < MIN_QUERY) {
      setResults([]);
      setHasMore(false);
      setSearching(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      offsetRef.current = 0;
      void doSearch(text, 0, false);
    }, DEBOUNCE_MS);
  }, [doSearch]);

  // ─── Sayfalama ───────────────────────────────────────────────────────────────

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore || query.length < MIN_QUERY) return;
    const nextOffset = offsetRef.current + PAGE_SIZE;
    offsetRef.current = nextOffset;
    void doSearch(query, nextOffset, true);
  }, [loadingMore, hasMore, query, doSearch]);

  // ─── Liste öğesi ─────────────────────────────────────────────────────────────

  const renderItem = useCallback(({ item }: { item: MedResult }) => {
    const isMine = userMedIds.has(item.id);
    return (
      <Pressable
        style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
        onPress={() => setSelected(item)}
      >
        <View style={styles.itemInfo}>
          <View style={styles.itemTitleRow}>
            <Text style={styles.itemName} numberOfLines={1}>{item.ilac_adi}</Text>
            {isMine && (
              <View style={styles.mineBadge}>
                <Text style={styles.mineBadgeText}>Benim</Text>
              </View>
            )}
          </View>
          {item.etkin_madde_adi != null && (
            <Text style={styles.itemSub} numberOfLines={1}>{item.etkin_madde_adi}</Text>
          )}
          {item.firma_adi != null && (
            <Text style={styles.itemFirma} numberOfLines={1}>{item.firma_adi}</Text>
          )}
        </View>
        <Ionicons name="chevron-forward" size={15} color="#333" />
      </Pressable>
    );
  }, [userMedIds]);

  const renderSeparator = () => <View style={styles.sep} />;

  const isEmpty = query.length >= MIN_QUERY && !searching && results.length === 0;

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>

      {/* Arama çubuğu */}
      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={17} color="#555" />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={onChangeText}
          placeholder="İlaç adı veya etken madde..."
          placeholderTextColor="#444"
          returnKeyType="search"
          clearButtonMode="while-editing"
          autoCorrect={false}
          autoCapitalize="none"
          spellCheck={false}
        />
        {searching && (
          <ActivityIndicator size="small" color="#1a6ef5" style={styles.searchSpinner} />
        )}
      </View>

      {/* Yardım metni */}
      {query.length === 0 && (
        <View style={styles.hint}>
          <Text style={styles.hintText}>
            Türkiye'de kayıtlı 25.000+ ilacı arayın.{'\n'}
            İlaç adı veya etken madde yazın.
          </Text>
        </View>
      )}
      {query.length === 1 && (
        <View style={styles.hint}>
          <Text style={styles.hintText}>1 karakter daha girin...</Text>
        </View>
      )}

      {/* Sonuç listesi */}
      {query.length >= MIN_QUERY && !searching && (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ItemSeparatorComponent={renderSeparator}
          onEndReached={loadMore}
          onEndReachedThreshold={0.35}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListEmptyComponent={
            isEmpty ? (
              <View style={styles.empty}>
                <Ionicons name="search-outline" size={38} color="#2a2a2a" />
                <Text style={styles.emptyTitle}>Sonuç bulunamadı</Text>
                <Text style={styles.emptySub}>"{query}" için eşleşen ilaç yok</Text>
              </View>
            ) : null
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footer}>
                <ActivityIndicator size="small" color="#1a6ef5" />
              </View>
            ) : null
          }
          contentContainerStyle={results.length === 0 ? styles.listEmpty : undefined}
        />
      )}

      {/* Arama sırasında skeleton */}
      {query.length >= MIN_QUERY && searching && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#1a6ef5" />
        </View>
      )}

      {/* İlaç Detay Modal */}
      <Modal
        visible={selected !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setSelected(null)}
      >
        <View style={styles.modalWrap}>
          {/* Backdrop */}
          <Pressable
            style={styles.backdrop}
            onPress={() => setSelected(null)}
          />
          {/* Bottom Sheet */}
          <View style={styles.sheet}>
            {selected !== null && (
              <DrugDetail drug={selected} onClose={() => setSelected(null)} />
            )}
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

// ─── İlaç Detay Bileşeni ─────────────────────────────────────────────────────

type DrugDetailProps = {
  drug: MedResult;
  onClose: () => void;
};

function DrugDetail({ drug, onClose }: DrugDetailProps) {
  const openUrl = (url: string) => { void Linking.openURL(url); };

  return (
    <View>
      {/* Tutamaç */}
      <View style={styles.handle} />

      {/* Başlık */}
      <View style={styles.detailHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.detailName}>{drug.ilac_adi}</Text>
          {drug.firma_adi != null && (
            <Text style={styles.detailFirma}>{drug.firma_adi}</Text>
          )}
        </View>
        <Pressable
          style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
          onPress={onClose}
          hitSlop={8}
        >
          <Ionicons name="close" size={20} color="#666" />
        </Pressable>
      </View>

      {/* Etken Madde */}
      {drug.etkin_madde_adi != null && (
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Etken Madde</Text>
          <Text style={styles.detailValue}>{drug.etkin_madde_adi}</Text>
        </View>
      )}

      {/* PDF Linkleri */}
      <View style={styles.linkGroup}>
        {drug.kub_url != null && (
          <Pressable
            style={({ pressed }) => [styles.linkBtn, pressed && styles.linkBtnPressed]}
            onPress={() => openUrl(drug.kub_url!)}
          >
            <Ionicons name="document-text-outline" size={18} color="#1a6ef5" />
            <Text style={styles.linkBtnText}>Kısa Ürün Bilgisi (KÜB)</Text>
            <Ionicons name="open-outline" size={14} color="#1a6ef5" style={{ marginLeft: 'auto' }} />
          </Pressable>
        )}
        {drug.kt_url != null && (
          <Pressable
            style={({ pressed }) => [styles.linkBtn, pressed && styles.linkBtnPressed]}
            onPress={() => openUrl(drug.kt_url!)}
          >
            <Ionicons name="reader-outline" size={18} color="#1a6ef5" />
            <Text style={styles.linkBtnText}>Kullanma Talimatı</Text>
            <Ionicons name="open-outline" size={14} color="#1a6ef5" style={{ marginLeft: 'auto' }} />
          </Pressable>
        )}
        {drug.kub_url == null && drug.kt_url == null && (
          <View style={styles.noLink}>
            <Ionicons name="document-outline" size={16} color="#333" />
            <Text style={styles.noLinkText}>PDF belgesi henüz mevcut değil</Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Stiller ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: '#0a0a0a' },

  /* Arama */
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141414',
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 8,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: '#222',
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    padding: 0,
  },
  searchSpinner: { marginLeft: 4 },

  /* Yardım metni */
  hint: { paddingHorizontal: 20, paddingTop: 28, alignItems: 'center' },
  hintText: { color: '#3a3a3a', fontSize: 14, textAlign: 'center', lineHeight: 22 },

  /* Liste */
  sep:       { height: 1, backgroundColor: '#181818', marginLeft: 16 },
  listEmpty: { flex: 1 },

  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 16,
    gap: 10,
  },
  itemPressed: { backgroundColor: '#111' },
  itemInfo:    { flex: 1 },

  itemTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  itemName:     { color: '#e8e8e8', fontSize: 14, fontWeight: '500', flex: 1 },

  mineBadge:     { backgroundColor: '#1a3a7a', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  mineBadgeText: { color: '#5b9cf6', fontSize: 11, fontWeight: '700' },

  itemSub:   { color: '#555', fontSize: 12, marginTop: 1 },
  itemFirma: { color: '#3a3a3a', fontSize: 11, marginTop: 2 },

  /* Boş durum */
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    gap: 10,
  },
  emptyTitle: { color: '#444', fontSize: 15, fontWeight: '600' },
  emptySub:   { color: '#333', fontSize: 13 },

  /* Footer */
  footer:         { paddingVertical: 18, alignItems: 'center' },
  loadingOverlay: { flex: 1, alignItems: 'center', paddingTop: 60 },

  /* Modal */
  modalWrap: { flex: 1, justifyContent: 'flex-end' },
  backdrop:  { ...{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, backgroundColor: 'rgba(0,0,0,0.65)' },
  sheet: {
    backgroundColor: '#141414',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingBottom: 36,
    borderTopWidth: 1,
    borderColor: '#222',
  },

  /* Detay */
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#2a2a2a',
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  detailHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16 },
  detailName:   { color: '#fff', fontSize: 17, fontWeight: '700', lineHeight: 24 },
  detailFirma:  { color: '#555', fontSize: 13, marginTop: 3 },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#1e1e1e',
    justifyContent: 'center', alignItems: 'center',
  },

  detailRow: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#242424',
  },
  detailLabel: { color: '#555', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 5 },
  detailValue: { color: '#ddd', fontSize: 14, lineHeight: 20 },

  linkGroup: { gap: 8, marginTop: 4 },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#0d1f3c',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1a3a6a',
  },
  linkBtnPressed: { opacity: 0.75 },
  linkBtnText: { color: '#5b9cf6', fontSize: 14, fontWeight: '500', flex: 1 },

  noLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  noLinkText: { color: '#333', fontSize: 13 },
});
