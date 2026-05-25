import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ─── Env sabitleri ────────────────────────────────────────────────────────────

const NOBETECZA_KEY = (process.env.EXPO_PUBLIC_NOBETECZA_API_KEY ?? '') as string;
const GOOGLE_MAPS_KEY = (process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '') as string;
const HOSPITAL_RADIUS = 5000; // 5 km

// ─── Tipler ───────────────────────────────────────────────────────────────────

type Tab = 'pharmacy' | 'hospital';

interface Coords {
  latitude: number;
  longitude: number;
}

// Nöbetçi eczane — API yanıtında farklı alan adları olabilir
interface EczaneRaw {
  adi?: string;
  ad?: string;
  name?: string;
  adres?: string;
  adres1?: string;
  adres2?: string;
  address?: string;
  telefon?: string;
  tel?: string;
  phone?: string;
  lat?: number | string;
  lng?: number | string;
  lon?: number | string;
  mesafe?: number | string;
  uzaklik?: number | string;
  distance?: number | string;
}

interface EczaneItem {
  key: string;
  adi: string;
  adres: string;
  telefon: string;
  lat: number | null;
  lng: number | null;
  mesafeKm: number | null;
}

// Google Places
interface PlaceResult {
  place_id: string;
  name: string;
  vicinity: string;
  geometry: {
    location: { lat: number; lng: number };
  };
  opening_hours?: { open_now: boolean };
}

interface PlacesApiResponse {
  results?: PlaceResult[];
  status: string;
}

// nobetecza API — farklı sarmalama biçimlerini destekler
type NobetczaResponse =
  | EczaneRaw[]
  | { data?: EczaneRaw[] | { eczaneler?: EczaneRaw[]; nobetci_eczaneler?: EczaneRaw[] } }
  | { eczaneler?: EczaneRaw[] }
  | { result?: EczaneRaw[] }
  | { success?: boolean; eczaneler?: EczaneRaw[] };

// ─── Yardımcı fonksiyonlar ────────────────────────────────────────────────────

function haversineKm(a: Coords, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.latitude) * Math.PI) / 180;
  const dLng = ((b.lng - a.longitude) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

function distLabel(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

/** NobetczaResponse içinden EczaneRaw[] çıkar */
function extractEczaneler(raw: NobetczaResponse): EczaneRaw[] {
  if (Array.isArray(raw)) return raw;

  const obj = raw as Record<string, unknown>;

  if (Array.isArray(obj['eczaneler'])) return obj['eczaneler'] as EczaneRaw[];
  if (Array.isArray(obj['result']))    return obj['result']    as EczaneRaw[];

  const data = obj['data'];
  if (Array.isArray(data)) return data;

  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d['eczaneler']))          return d['eczaneler']          as EczaneRaw[];
    if (Array.isArray(d['nobetci_eczaneler']))  return d['nobetci_eczaneler']  as EczaneRaw[];
  }

  return [];
}

/** EczaneRaw → EczaneItem (alan adı normalizasyonu) */
function normalizeEczane(raw: EczaneRaw, idx: number, userCoords: Coords): EczaneItem {
  const adi = raw.adi ?? raw.ad ?? raw.name ?? `Eczane ${idx + 1}`;
  const adres = raw.adres ?? raw.adres1 ?? raw.adres2 ?? raw.address ?? '';
  const telefon = raw.telefon ?? raw.tel ?? raw.phone ?? '';

  const latNum = raw.lat !== undefined ? Number(raw.lat) : null;
  const lngNum = (raw.lng ?? raw.lon) !== undefined ? Number(raw.lng ?? raw.lon) : null;

  let mesafeKm: number | null = null;
  const rawMesafe = raw.mesafe ?? raw.uzaklik ?? raw.distance;
  if (rawMesafe !== undefined) {
    const n = Number(rawMesafe);
    // API genellikle metre veya km cinsinden döner; <10 ise km, >=10 ise metre
    mesafeKm = !isNaN(n) ? (n >= 10 ? n / 1000 : n) : null;
  } else if (latNum !== null && lngNum !== null) {
    mesafeKm = haversineKm(userCoords, { lat: latNum, lng: lngNum });
  }

  return {
    key: `eczane-${idx}-${adi}`,
    adi,
    adres,
    telefon,
    lat: latNum,
    lng: lngNum,
    mesafeKm,
  };
}

function callPhone(tel: string): void {
  const cleaned = tel.replace(/\s+/g, '').replace(/-/g, '');
  void Linking.openURL(`tel:${cleaned}`);
}

function openMapsCoords(lat: number, lng: number, label: string): void {
  const encoded = encodeURIComponent(label);
  void Linking.openURL(
    `https://www.google.com/maps/search/?api=1&query=${lat},${lng}&query_place_id=${encoded}`,
  );
}

function openMapsAddress(adres: string): void {
  void Linking.openURL(
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(adres)}`,
  );
}

function openMapsRoute(userCoords: Coords, destLat: number, destLng: number): void {
  void Linking.openURL(
    `https://www.google.com/maps/dir/?api=1` +
    `&origin=${userCoords.latitude},${userCoords.longitude}` +
    `&destination=${destLat},${destLng}` +
    `&travelmode=driving`,
  );
}

// ─── Alt bileşenler ───────────────────────────────────────────────────────────

interface EczaneCardProps {
  item: EczaneItem;
  userCoords: Coords;
}

function EczaneCard({ item, userCoords }: EczaneCardProps) {
  const hasPhone = item.telefon.trim().length > 0;
  const hasCoords = item.lat !== null && item.lng !== null;

  return (
    <View style={styles.card}>
      {/* İkon + İçerik */}
      <View style={[styles.cardIcon, styles.cardIconPharmacy]}>
        <Ionicons name="medkit" size={18} color="#10b981" />
      </View>

      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={2}>
          {item.adi}
        </Text>

        {/* Mesafe badge */}
        {item.mesafeKm !== null && (
          <View style={styles.distRow}>
            <Ionicons name="navigate-outline" size={11} color="#666" />
            <Text style={styles.distText}>{distLabel(item.mesafeKm)}</Text>
          </View>
        )}

        {/* Adres — tıklanabilir */}
        {item.adres.length > 0 && (
          <Pressable
            style={({ pressed }) => [styles.infoRow, pressed && { opacity: 0.6 }]}
            onPress={() =>
              hasCoords
                ? openMapsRoute(userCoords, item.lat!, item.lng!)
                : openMapsAddress(item.adres)
            }
          >
            <Ionicons name="location-outline" size={13} color="#1a6ef5" />
            <Text style={[styles.infoText, styles.infoLink]} numberOfLines={2}>
              {item.adres}
            </Text>
          </Pressable>
        )}

        {/* Telefon — tıklanabilir */}
        {hasPhone && (
          <Pressable
            style={({ pressed }) => [styles.infoRow, pressed && { opacity: 0.6 }]}
            onPress={() => callPhone(item.telefon)}
          >
            <Ionicons name="call-outline" size={13} color="#10b981" />
            <Text style={[styles.infoText, styles.infoCall]}>{item.telefon}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

interface HastaneCardProps {
  item: PlaceResult;
  userCoords: Coords;
}

function HastaneCard({ item, userCoords }: HastaneCardProps) {
  const km = haversineKm(userCoords, item.geometry.location);
  const isOpen = item.opening_hours?.open_now;
  const { lat, lng } = item.geometry.location;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.72 }]}
      onPress={() => openMapsRoute(userCoords, lat, lng)}
    >
      <View style={[styles.cardIcon, styles.cardIconHospital]}>
        <Ionicons name="business" size={18} color="#1a6ef5" />
      </View>

      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={1}>
          {item.name}
        </Text>

        <View style={styles.distRow}>
          <Ionicons name="navigate-outline" size={11} color="#666" />
          <Text style={styles.distText}>{distLabel(km)}</Text>
        </View>

        <View style={styles.infoRow}>
          <Ionicons name="location-outline" size={13} color="#555" />
          <Text style={styles.infoText} numberOfLines={1}>
            {item.vicinity}
          </Text>
        </View>
      </View>

      <View style={styles.cardRight}>
        {item.opening_hours != null && (
          <View
            style={[
              styles.openBadge,
              { backgroundColor: isOpen ? '#14532d' : '#3f0000' },
            ]}
          >
            <Text style={[styles.openText, { color: isOpen ? '#4ade80' : '#f87171' }]}>
              {isOpen ? 'Açık' : 'Kapalı'}
            </Text>
          </View>
        )}
        <Ionicons name="chevron-forward" size={15} color="#2a2a2a" />
      </View>
    </Pressable>
  );
}

// ─── Ana bileşen ──────────────────────────────────────────────────────────────

export default function NearbyScreen() {
  const [tab, setTab] = useState<Tab>('pharmacy');
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [loadingLocation, setLoadingLocation] = useState(true);

  const [eczaneler, setEczaneler] = useState<EczaneItem[]>([]);
  const [loadingEczane, setLoadingEczane] = useState(false);
  const [eczaneError, setEczaneError] = useState<string | null>(null);

  const [hastaneler, setHastaneler] = useState<PlaceResult[]>([]);
  const [loadingHastane, setLoadingHastane] = useState(false);
  const [hastaneError, setHastaneError] = useState<string | null>(null);

  const fetchedRef = useRef(false);

  // ─── Konum ──────────────────────────────────────────────────────────────────

  const getLocation = useCallback(async () => {
    setLoadingLocation(true);
    setLocationError(null);
    fetchedRef.current = false;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError('Konum iznine ihtiyaç var.\nAyarlar → Gizlilik → Konum');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setCoords({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
    } catch {
      setLocationError('Konum alınamadı. Tekrar deneyin.');
    } finally {
      setLoadingLocation(false);
    }
  }, []);

  // ─── Nöbetçi Eczane API ──────────────────────────────────────────────────────

  const fetchEczaneler = useCallback(async (c: Coords) => {
    if (!NOBETECZA_KEY) {
      setEczaneError(
        'Eczane API anahtarı eksik.\n' +
        '.env.local dosyasına EXPO_PUBLIC_NOBETECZA_API_KEY ekleyin.',
      );
      return;
    }

    setLoadingEczane(true);
    setEczaneError(null);
    try {
      const url =
        `https://api.nobetecza.com/v1/yakin` +
        `?lat=${c.latitude}&lng=${c.longitude}`;

      const res = await fetch(url, {
        headers: { 'X-API-Key': NOBETECZA_KEY },
      });

      if (!res.ok) {
        throw new Error(`Eczane API hatası: ${res.status}`);
      }

      const json = (await res.json()) as NobetczaResponse;
      const rawList = extractEczaneler(json);

      const items = rawList.map((r, i) => normalizeEczane(r, i, c));
      // Mesafeye göre sırala
      items.sort((a, b) => (a.mesafeKm ?? 999) - (b.mesafeKm ?? 999));
      setEczaneler(items);
    } catch (e) {
      setEczaneError(e instanceof Error ? e.message : 'Eczaneler yüklenemedi.');
    } finally {
      setLoadingEczane(false);
    }
  }, []);

  // ─── Google Maps Places API (Hastane) ────────────────────────────────────────

  const fetchHastaneler = useCallback(async (c: Coords) => {
    if (!GOOGLE_MAPS_KEY || GOOGLE_MAPS_KEY === 'buraya_google_maps_key') {
      setHastaneError(
        'Google Maps API anahtarı eksik.\n' +
        '.env.local dosyasına EXPO_PUBLIC_GOOGLE_MAPS_KEY ekleyin.',
      );
      return;
    }

    setLoadingHastane(true);
    setHastaneError(null);
    try {
      const url =
        `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
        `?location=${c.latitude},${c.longitude}` +
        `&radius=${HOSPITAL_RADIUS}` +
        `&type=hospital` +
        `&language=tr` +
        `&key=${GOOGLE_MAPS_KEY}`;

      const res = await fetch(url);
      const json = (await res.json()) as PlacesApiResponse;

      if (json.status !== 'OK' && json.status !== 'ZERO_RESULTS') {
        throw new Error(`Places API hatası: ${json.status}`);
      }

      const sorted = (json.results ?? []).sort((a, b) =>
        haversineKm(c, a.geometry.location) - haversineKm(c, b.geometry.location),
      );
      setHastaneler(sorted);
    } catch (e) {
      setHastaneError(e instanceof Error ? e.message : 'Hastaneler yüklenemedi.');
    } finally {
      setLoadingHastane(false);
    }
  }, []);

  // ─── Effects ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    void getLocation();
  }, [getLocation]);

  useEffect(() => {
    if (coords && !fetchedRef.current) {
      fetchedRef.current = true;
      void fetchEczaneler(coords);
      void fetchHastaneler(coords);
    }
  }, [coords, fetchEczaneler, fetchHastaneler]);

  // ─── Render yardımcıları ─────────────────────────────────────────────────────

  const isPharmacy = tab === 'pharmacy';
  const loading = isPharmacy ? loadingEczane : loadingHastane;
  const error   = isPharmacy ? eczaneError   : hastaneError;

  function retryFetch() {
    if (!coords) { void getLocation(); return; }
    if (isPharmacy) void fetchEczaneler(coords);
    else            void fetchHastaneler(coords);
  }

  // ─── Loading / Error durumları ───────────────────────────────────────────────

  if (loadingLocation) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1a6ef5" />
        <Text style={styles.centerText}>Konum alınıyor…</Text>
      </View>
    );
  }

  if (locationError) {
    return (
      <View style={styles.center}>
        <Ionicons name="location-outline" size={52} color="#2a2a2a" />
        <Text style={styles.centerText}>{locationError}</Text>
        <Pressable style={styles.retryBtn} onPress={() => void getLocation()}>
          <Text style={styles.retryText}>Tekrar Dene</Text>
        </Pressable>
      </View>
    );
  }

  // ─── Ana render ───────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>

      {/* ── Sekme seçici ── */}
      <View style={styles.tabBar}>
        {/* Nöbetçi Eczane */}
        <Pressable
          style={[styles.tabBtn, isPharmacy && styles.tabBtnActive]}
          onPress={() => setTab('pharmacy')}
        >
          <Ionicons
            name="medkit-outline"
            size={14}
            color={isPharmacy ? '#fff' : '#555'}
          />
          <Text style={[styles.tabText, isPharmacy && styles.tabTextActive]}>
            Nöbetçi Eczane
          </Text>
          {eczaneler.length > 0 && (
            <View style={[styles.countBadge, isPharmacy && styles.countBadgeActive]}>
              <Text style={[styles.countText, isPharmacy && styles.countTextActive]}>
                {eczaneler.length}
              </Text>
            </View>
          )}
        </Pressable>

        {/* Yakın Hastane */}
        <Pressable
          style={[styles.tabBtn, !isPharmacy && styles.tabBtnActive]}
          onPress={() => setTab('hospital')}
        >
          <Ionicons
            name="business-outline"
            size={14}
            color={!isPharmacy ? '#fff' : '#555'}
          />
          <Text style={[styles.tabText, !isPharmacy && styles.tabTextActive]}>
            Yakın Hastane
          </Text>
          {hastaneler.length > 0 && (
            <View style={[styles.countBadge, !isPharmacy && styles.countBadgeActive]}>
              <Text style={[styles.countText, !isPharmacy && styles.countTextActive]}>
                {hastaneler.length}
              </Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* ── İçerik ── */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1a6ef5" />
          <Text style={styles.centerText}>
            {isPharmacy ? 'Nöbetçi eczaneler' : 'Hastaneler'} aranıyor…
          </Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="warning-outline" size={48} color="#2a2a2a" />
          <Text style={styles.centerText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={retryFetch}>
            <Text style={styles.retryText}>Tekrar Dene</Text>
          </Pressable>
        </View>
      ) : isPharmacy ? (
        eczaneler.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="medkit-outline" size={48} color="#2a2a2a" />
            <Text style={styles.centerText}>Yakında nöbetçi eczane bulunamadı.</Text>
          </View>
        ) : (
          <FlatList
            data={eczaneler}
            keyExtractor={(item) => item.key}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) =>
              coords ? <EczaneCard item={item} userCoords={coords} /> : null
            }
          />
        )
      ) : (
        hastaneler.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="business-outline" size={48} color="#2a2a2a" />
            <Text style={styles.centerText}>{HOSPITAL_RADIUS / 1000} km içinde hastane bulunamadı.</Text>
          </View>
        ) : (
          <FlatList
            data={hastaneler}
            keyExtractor={(item) => item.place_id}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) =>
              coords ? <HastaneCard item={item} userCoords={coords} /> : null
            }
          />
        )
      )}

    </SafeAreaView>
  );
}

// ─── Stiller ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#0a0a0a' },
  center: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 14,
    padding: 28,
  },
  centerText: { color: '#555', fontSize: 14, textAlign: 'center', lineHeight: 22 },

  retryBtn:  { paddingHorizontal: 28, paddingVertical: 12, backgroundColor: '#1a6ef5', borderRadius: 12, marginTop: 4 },
  retryText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  /* Sekmeler */
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#141414',
    marginHorizontal: 14,
    marginTop: 12,
    marginBottom: 10,
    borderRadius: 12,
    padding: 4,
    gap: 4,
    borderWidth: 1,
    borderColor: '#1e1e1e',
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
    borderRadius: 9,
  },
  tabBtnActive:  { backgroundColor: '#1a6ef5' },
  tabText:       { color: '#555', fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  countBadge:        { backgroundColor: '#2a2a2a', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  countBadgeActive:  { backgroundColor: 'rgba(255,255,255,0.22)' },
  countText:         { color: '#666', fontSize: 11, fontWeight: '700' },
  countTextActive:   { color: '#fff' },

  /* Liste */
  list: { paddingHorizontal: 14, paddingBottom: 28, gap: 10 },

  /* Kart */
  card: {
    backgroundColor: '#141414',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderWidth: 1,
    borderColor: '#1e1e1e',
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 1,
  },
  cardIconPharmacy: { backgroundColor: 'rgba(16,185,129,0.12)' },
  cardIconHospital: { backgroundColor: 'rgba(26,110,245,0.12)' },

  cardBody:  { flex: 1, gap: 5 },
  cardName:  { color: '#e8e8e8', fontSize: 14, fontWeight: '600', lineHeight: 20 },

  cardRight: { alignItems: 'flex-end', gap: 6, justifyContent: 'center' },

  distRow:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  distText: { color: '#666', fontSize: 11 },

  infoRow:  { flexDirection: 'row', alignItems: 'center', gap: 5 },
  infoText: { color: '#555', fontSize: 12, flex: 1 },
  infoLink: { color: '#1a6ef5' },
  infoCall: { color: '#10b981', fontWeight: '500' },

  openBadge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  openText:  { fontSize: 11, fontWeight: '600' },
});
