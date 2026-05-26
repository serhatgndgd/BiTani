import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '../components/EmptyState';
import { HospitalIcon } from '../components/HospitalIcon';
import { PharmacyIcon } from '../components/PharmacyIcon';
import { SkeletonBox } from '../components/SkeletonBox';
import { C } from '../theme';

// ─── Env sabitleri ────────────────────────────────────────────────────────────

const NOBETECZA_KEY   = (process.env.EXPO_PUBLIC_NOBETECZA_API_KEY ?? '') as string;
const HOSPITAL_RADIUS = 5000; // 5 km
const PHARMACY_RADIUS = 3000; // 3 km

// ─── Tipler ───────────────────────────────────────────────────────────────────

type Tab = 'pharmacy' | 'hospital';

interface Coords {
  latitude: number;
  longitude: number;
}

// ── Nöbetçi eczane (nobetecza.com API) ───────────────────────────────────────
// Döküman: https://nobetecza.com/docs
// Endpoint: GET /v1/konum?lat=&lng=&radius=

interface NobeteczaPharmacy {
  id: number;
  ad: string;
  adres: string;
  telefon: string;
  il: string;
  il_slug: string;
  ilce: string;
  ilce_slug: string;
  tarif?: string;
  konum: { lat: number; lng: number };
  mesafe: number; // metre cinsinden
}

interface NobeteczaApiResponse {
  success: boolean;
  data: NobeteczaPharmacy[];
  adet: number;
  tarih: string;
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

// ── Overpass API ──────────────────────────────────────────────────────────────

interface OverpassTags {
  name?: string;
  'name:tr'?: string;
  'addr:street'?: string;
  'addr:housenumber'?: string;
  'addr:city'?: string;
  phone?: string;
  'contact:phone'?: string;
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags: OverpassTags;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

// ── Hastane / OSM eczane öğesi ────────────────────────────────────────────────

interface PlaceItem {
  key: string;
  adi: string;
  adres: string;
  lat: number;
  lng: number;
  mesafeKm: number;
}

// ─── Yardımcı fonksiyonlar ────────────────────────────────────────────────────

const NETWORK_ERROR_TEXT = 'İnternet bağlantınızı kontrol edin';
const LOCATION_ERROR_TEXT = 'Konum alınamadı. Lütfen ayarları kontrol edin';
const PHARMACY_FETCH_ERROR_TEXT = 'Nöbetçi eczaneler şu an yüklenemiyor';
const HOSPITAL_FETCH_ERROR_TEXT = 'Yakın hastaneler şu an yüklenemiyor';

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('network') ||
    msg.includes('failed to fetch') ||
    msg.includes('request failed') ||
    msg.includes('timeout')
  );
}

function haversineKm(a: Coords, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.latitude)  * Math.PI) / 180;
  const dLng = ((b.lng - a.longitude) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) *
      Math.cos((b.lat    * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

function distLabel(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

function osmCoords(el: OverpassElement): { lat: number; lng: number } | null {
  if (el.type === 'node' && el.lat != null && el.lon != null) {
    return { lat: el.lat, lng: el.lon };
  }
  if (el.center != null) {
    return { lat: el.center.lat, lng: el.center.lon };
  }
  return null;
}

function osmToPlaceItem(el: OverpassElement, idx: number, userCoords: Coords): PlaceItem | null {
  const coords = osmCoords(el);
  if (!coords) return null;

  const adi = el.tags['name:tr'] ?? el.tags.name ?? `Yer ${idx + 1}`;

  const adresParts: string[] = [];
  if (el.tags['addr:street'])      adresParts.push(el.tags['addr:street']);
  if (el.tags['addr:housenumber']) adresParts.push(el.tags['addr:housenumber']);
  const adres = adresParts.join(' ');

  const mesafeKm = haversineKm(userCoords, coords);

  return {
    key: `osm-${el.type}-${el.id}`,
    adi,
    adres,
    lat: coords.lat,
    lng: coords.lng,
    mesafeKm,
  };
}

function normalizeEczane(raw: NobeteczaPharmacy): EczaneItem {
  return {
    key:      `eczane-${raw.id}`,
    adi:      raw.ad,
    adres:    raw.adres,
    telefon:  raw.telefon,
    lat:      raw.konum?.lat  ?? null,
    lng:      raw.konum?.lng  ?? null,
    mesafeKm: typeof raw.mesafe === 'number' ? raw.mesafe / 1000 : null,
  };
}

function callPhone(tel: string): void {
  const cleaned = tel.replace(/\s+/g, '').replace(/-/g, '');
  void Linking.openURL(`tel:${cleaned}`);
}

function openMapsRoute(userCoords: Coords, destLat: number, destLng: number): void {
  void Linking.openURL(
    `https://www.google.com/maps/dir/?api=1` +
    `&origin=${userCoords.latitude},${userCoords.longitude}` +
    `&destination=${destLat},${destLng}` +
    `&travelmode=driving`,
  );
}

function openMapsAddress(adres: string): void {
  void Linking.openURL(
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(adres)}`,
  );
}

// ─── Overpass sorguları ───────────────────────────────────────────────────────

function buildHastaneQuery(lat: number, lng: number): string {
  return (
    `[out:json][timeout:25];\n` +
    `(\n` +
    `  node["amenity"="hospital"](around:${HOSPITAL_RADIUS},${lat},${lng});\n` +
    `  way["amenity"="hospital"](around:${HOSPITAL_RADIUS},${lat},${lng});\n` +
    `  node["amenity"="clinic"](around:${HOSPITAL_RADIUS},${lat},${lng});\n` +
    `);\n` +
    `out center;`
  );
}

function buildEczaneOsmQuery(lat: number, lng: number): string {
  return (
    `[out:json][timeout:25];\n` +
    `(\n` +
    `  node["amenity"="pharmacy"](around:${PHARMACY_RADIUS},${lat},${lng});\n` +
    `);\n` +
    `out center;`
  );
}

async function fetchOverpass(query: string): Promise<OverpassResponse> {
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`Overpass API hatası: ${res.status}`);
  return (await res.json()) as OverpassResponse;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function NearbySkeletonList() {
  return (
    <View style={{ paddingHorizontal: 14, paddingTop: 4, gap: 10 }}>
      {[0, 1, 2, 3].map((i) => (
        <View
          key={i}
          style={{
            backgroundColor: C.surface,
            borderRadius: 14,
            padding: 14,
            flexDirection: 'row',
            gap: 12,
            borderWidth: 1,
            borderColor: C.border,
          }}
        >
          <SkeletonBox width={40} height={40} borderRadius={11} />
          <View style={{ flex: 1, gap: 8 }}>
            <SkeletonBox width="72%" height={14} />
            <SkeletonBox width="36%" height={11} />
            <SkeletonBox width="88%" height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

// ─── Alt bileşenler ───────────────────────────────────────────────────────────

interface EczaneCardProps {
  item: EczaneItem;
  userCoords: Coords;
}

function EczaneCard({ item, userCoords }: EczaneCardProps) {
  const hasPhone  = item.telefon.trim().length > 0;
  const hasCoords = item.lat !== null && item.lng !== null;

  return (
    <View style={styles.card}>
      <View style={styles.iconWrap}>
        <PharmacyIcon size={40} />
      </View>

      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={2}>{item.adi}</Text>

        {item.mesafeKm !== null && (
          <View style={styles.distRow}>
            <Ionicons name="navigate-outline" size={11} color={C.text3} />
            <Text style={styles.distText}>{distLabel(item.mesafeKm)}</Text>
          </View>
        )}

        {item.adres.length > 0 && (
          <Pressable
            style={({ pressed }) => [styles.infoRow, pressed && { opacity: 0.6 }]}
            onPress={() =>
              hasCoords
                ? openMapsRoute(userCoords, item.lat!, item.lng!)
                : openMapsAddress(item.adres)
            }
          >
            <Ionicons name="location-outline" size={13} color={C.primary} />
            <Text style={[styles.infoText, styles.infoLink]} numberOfLines={2}>
              {item.adres}
            </Text>
          </Pressable>
        )}

        {hasPhone && (
          <Pressable
            style={({ pressed }) => [styles.infoRow, pressed && { opacity: 0.6 }]}
            onPress={() => callPhone(item.telefon)}
          >
            <Ionicons name="call-outline" size={13} color={C.pharmacy} />
            <Text style={[styles.infoText, styles.infoCall]}>{item.telefon}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

interface PlaceCardProps {
  item: PlaceItem;
  userCoords: Coords;
  isPharmacy?: boolean;
}

function PlaceCard({ item, userCoords, isPharmacy = false }: PlaceCardProps) {
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.72 }]}
      onPress={() => openMapsRoute(userCoords, item.lat, item.lng)}
    >
      <View style={styles.iconWrap}>
        {isPharmacy ? <PharmacyIcon size={40} /> : <HospitalIcon size={40} />}
      </View>

      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={1}>{item.adi}</Text>

        <View style={styles.distRow}>
          <Ionicons name="navigate-outline" size={11} color={C.text3} />
          <Text style={styles.distText}>{distLabel(item.mesafeKm)}</Text>
        </View>

        {item.adres.length > 0 && (
          <View style={styles.infoRow}>
            <Ionicons name="location-outline" size={13} color={C.text3} />
            <Text style={styles.infoText} numberOfLines={1}>{item.adres}</Text>
          </View>
        )}
      </View>

      <View style={styles.cardRight}>
        <Ionicons name="chevron-forward" size={15} color={C.border} />
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

  const [eczaneler, setEczaneler]             = useState<EczaneItem[]>([]);
  const [loadingEczane, setLoadingEczane]     = useState(false);
  const [eczaneError, setEczaneError]         = useState<string | null>(null);

  const [osmEczaneler, setOsmEczaneler]             = useState<PlaceItem[]>([]);
  const [loadingOsmEczane, setLoadingOsmEczane]     = useState(false);
  const [osmEczaneError, setOsmEczaneError]         = useState<string | null>(null);

  const [hastaneler, setHastaneler]             = useState<PlaceItem[]>([]);
  const [loadingHastane, setLoadingHastane]     = useState(false);
  const [hastaneError, setHastaneError]         = useState<string | null>(null);

  const fetchedRef = useRef(false);

  // ─── Konum ────────────────────────────────────────────────────────────────────

  const getLocation = useCallback(async () => {
    setLoadingLocation(true);
    setLocationError(null);
    fetchedRef.current = false;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError(LOCATION_ERROR_TEXT);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setCoords({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
    } catch (error) {
      console.error('nearby-screen:', error);
      setLocationError(LOCATION_ERROR_TEXT);
    } finally {
      setLoadingLocation(false);
    }
  }, []);

  // ─── Nöbetçi Eczane API (nobetecza) ──────────────────────────────────────────

  const fetchEczaneler = useCallback(async (c: Coords) => {
    setLoadingEczane(true);
    setEczaneError(null);
    try {
      // GET /v1/konum — mesafe metre cinsinden döner, radius varsayılan 3 km
      const url =
        `https://api.nobetecza.com/v1/konum` +
        `?lat=${c.latitude}&lng=${c.longitude}&radius=${PHARMACY_RADIUS}`;
      const res = await fetch(url, { headers: { 'X-API-Key': NOBETECZA_KEY } });

      if (!res.ok) throw new Error(`Eczane API hatası: ${res.status}`);

      const json = (await res.json()) as NobeteczaApiResponse;
      if (!json.success) throw new Error('Nöbetçi eczane verisi alınamadı.');

      const items = (json.data ?? [])
        .map((r) => normalizeEczane(r))
        .sort((a, b) => (a.mesafeKm ?? 999) - (b.mesafeKm ?? 999));
      setEczaneler(items);
    } catch (error) {
      console.error('nearby-screen:', error);
      setEczaneError(isNetworkError(error) ? NETWORK_ERROR_TEXT : PHARMACY_FETCH_ERROR_TEXT);
    } finally {
      setLoadingEczane(false);
    }
  }, []);

  // ─── Eczane OSM Fallback (Overpass) ──────────────────────────────────────────

  const fetchOsmEczaneler = useCallback(async (c: Coords) => {
    setLoadingOsmEczane(true);
    setOsmEczaneError(null);
    try {
      const query = buildEczaneOsmQuery(c.latitude, c.longitude);
      const json  = await fetchOverpass(query);

      const items = json.elements
        .map((el, i) => osmToPlaceItem(el, i, c))
        .filter((item): item is PlaceItem => item !== null)
        .sort((a, b) => a.mesafeKm - b.mesafeKm);

      setOsmEczaneler(items);
    } catch (error) {
      console.error('nearby-screen:', error);
      setOsmEczaneError(isNetworkError(error) ? NETWORK_ERROR_TEXT : PHARMACY_FETCH_ERROR_TEXT);
    } finally {
      setLoadingOsmEczane(false);
    }
  }, []);

  // ─── Hastane (Overpass) ───────────────────────────────────────────────────────

  const fetchHastaneler = useCallback(async (c: Coords) => {
    setLoadingHastane(true);
    setHastaneError(null);
    try {
      const query = buildHastaneQuery(c.latitude, c.longitude);
      const json  = await fetchOverpass(query);

      const items = json.elements
        .map((el, i) => osmToPlaceItem(el, i, c))
        .filter((item): item is PlaceItem => item !== null)
        .sort((a, b) => a.mesafeKm - b.mesafeKm);

      setHastaneler(items);
    } catch (error) {
      console.error('nearby-screen:', error);
      setHastaneError(isNetworkError(error) ? NETWORK_ERROR_TEXT : HOSPITAL_FETCH_ERROR_TEXT);
    } finally {
      setLoadingHastane(false);
    }
  }, []);

  // ─── Effects ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    void getLocation();
  }, [getLocation]);

  useEffect(() => {
    if (!coords || fetchedRef.current) return;
    fetchedRef.current = true;

    if (NOBETECZA_KEY) {
      void fetchEczaneler(coords);
    } else {
      void fetchOsmEczaneler(coords);
    }
    void fetchHastaneler(coords);
  }, [coords, fetchEczaneler, fetchOsmEczaneler, fetchHastaneler]);

  // ─── Türetilen durum ──────────────────────────────────────────────────────────

  const isPharmacy   = tab === 'pharmacy';
  const useNobetecza = Boolean(NOBETECZA_KEY);

  const eczaneLoading = useNobetecza ? loadingEczane   : loadingOsmEczane;
  const eczaneErr     = useNobetecza ? eczaneError     : osmEczaneError;
  const eczaneCount   = useNobetecza ? eczaneler.length : osmEczaneler.length;

  const loading = isPharmacy ? eczaneLoading : loadingHastane;
  const error   = isPharmacy ? eczaneErr     : hastaneError;

  function retryFetch() {
    if (!coords) { void getLocation(); return; }
    if (isPharmacy) {
      if (useNobetecza) void fetchEczaneler(coords);
      else              void fetchOsmEczaneler(coords);
    } else {
      void fetchHastaneler(coords);
    }
  }

  // ─── Loading / Error durumları ────────────────────────────────────────────────

  if (loadingLocation) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
        <View style={styles.center}>
          <NearbySkeletonList />
          <Text style={styles.centerText}>Konum alınıyor…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (locationError) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
        <View style={styles.center}>
          <EmptyState
            icon="location-outline"
            title="Konum alınamadı"
            subtitle={locationError}
            paddingTop={0}
          />
          <Pressable style={styles.retryBtn} onPress={() => void getLocation()}>
            <Text style={styles.retryText}>Tekrar Dene</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Ana render ───────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>

      {/* ── Sekme seçici ── */}
      <View style={styles.tabBar}>
        <Pressable
          style={[styles.tabBtn, isPharmacy && styles.tabBtnActive]}
          onPress={() => setTab('pharmacy')}
        >
          <Ionicons name="medkit-outline" size={14} color={isPharmacy ? C.text1 : C.text3} />
          <Text style={[styles.tabText, isPharmacy && styles.tabTextActive]}>
            Nöbetçi Eczane
          </Text>
          {eczaneCount > 0 && (
            <View style={[styles.countBadge, isPharmacy && styles.countBadgeActive]}>
              <Text style={[styles.countText, isPharmacy && styles.countTextActive]}>
                {eczaneCount}
              </Text>
            </View>
          )}
        </Pressable>

        <Pressable
          style={[styles.tabBtn, !isPharmacy && styles.tabBtnActive]}
          onPress={() => setTab('hospital')}
        >
          <Ionicons name="business-outline" size={14} color={!isPharmacy ? C.text1 : C.text3} />
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
        <NearbySkeletonList />
      ) : error ? (
        <View style={styles.center}>
          <EmptyState
            icon="warning-outline"
            title="Veri yüklenemedi"
            subtitle={error}
            paddingTop={0}
          />
          <Pressable style={styles.retryBtn} onPress={retryFetch}>
            <Text style={styles.retryText}>Tekrar Dene</Text>
          </Pressable>
        </View>
      ) : isPharmacy ? (
        /* ─── Eczane sekmesi ─── */
        useNobetecza ? (
          eczaneler.length === 0 ? (
            <View style={styles.center}>
              <EmptyState
                icon="medkit-outline"
                title="Nöbetçi eczane bulunamadı"
                subtitle="Yakınınızda nöbetçi eczane yok."
                paddingTop={0}
              />
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
          osmEczaneler.length === 0 ? (
            <View style={styles.center}>
              <EmptyState
                icon="medkit-outline"
                title="Eczane bulunamadı"
                subtitle={`${PHARMACY_RADIUS / 1000} km içinde eczane yok.`}
                paddingTop={0}
              />
            </View>
          ) : (
            <FlatList
              data={osmEczaneler}
              keyExtractor={(item) => item.key}
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) =>
                coords ? (
                  <PlaceCard item={item} userCoords={coords} isPharmacy />
                ) : null
              }
            />
          )
        )
      ) : (
        /* ─── Hastane sekmesi ─── */
        hastaneler.length === 0 ? (
          <View style={styles.center}>
            <EmptyState
              icon="business-outline"
              title="Hastane bulunamadı"
              subtitle={`${HOSPITAL_RADIUS / 1000} km içinde hastane yok.`}
              paddingTop={0}
            />
          </View>
        ) : (
          <FlatList
            data={hastaneler}
            keyExtractor={(item) => item.key}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) =>
              coords ? <PlaceCard item={item} userCoords={coords} /> : null
            }
          />
        )
      )}

    </SafeAreaView>
  );
}

// ─── Stiller ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 14,
    padding: 28,
  },
  centerText: { color: C.text3, fontSize: 14, textAlign: 'center', lineHeight: 22, marginTop: 12 },

  retryBtn:  { paddingHorizontal: 28, paddingVertical: 12, backgroundColor: C.primary, borderRadius: 12, marginTop: 4 },
  retryText: { color: C.text1, fontSize: 14, fontWeight: '600' },

  /* Sekmeler */
  tabBar: {
    flexDirection: 'row',
    backgroundColor: C.surface,
    marginHorizontal: 14,
    marginTop: 12,
    marginBottom: 10,
    borderRadius: 12,
    padding: 4,
    gap: 4,
    borderWidth: 1,
    borderColor: C.border,
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
  tabBtnActive:  { backgroundColor: C.primary },
  tabText:       { color: C.text3, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: C.text1 },
  countBadge:       { backgroundColor: C.surfaceAlt, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  countBadgeActive: { backgroundColor: 'rgba(255,255,255,0.22)' },
  countText:        { color: C.text3, fontSize: 11, fontWeight: '700' },
  countTextActive:  { color: C.text1 },

  /* Liste */
  list: { paddingHorizontal: 14, paddingBottom: 28, gap: 10 },

  /* Kart */
  card: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  /* İkon sarmalayıcı (PharmacyIcon / HospitalIcon kendi şeklini çiziyor) */
  iconWrap: { marginTop: 1, flexShrink: 0 },

  cardBody:  { flex: 1, gap: 5 },
  cardName:  { color: C.text1, fontSize: 14, fontWeight: '600', lineHeight: 20 },

  cardRight: { alignItems: 'flex-end', gap: 6, justifyContent: 'center' },

  distRow:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  distText: { color: C.text3, fontSize: 11 },

  infoRow:  { flexDirection: 'row', alignItems: 'center', gap: 5 },
  infoText: { color: C.text3, fontSize: 12, flex: 1 },
  infoLink: { color: C.primary },
  infoCall: { color: C.pharmacy, fontWeight: '500' },
});
