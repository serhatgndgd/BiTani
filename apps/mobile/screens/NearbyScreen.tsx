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

// ─── Tipler ───────────────────────────────────────────────────────────────────

type PlaceType = 'hospital' | 'pharmacy';

interface PlaceResult {
  place_id: string;
  name: string;
  vicinity: string;
  geometry: {
    location: { lat: number; lng: number };
  };
  opening_hours?: { open_now: boolean };
  rating?: number;
}

interface PlacesApiResponse {
  results?: PlaceResult[];
  status: string;
}

interface Coords {
  latitude: number;
  longitude: number;
}

// ─── Sabitler ─────────────────────────────────────────────────────────────────

const RADIUS = 3000; // 3 km
const GOOGLE_API_KEY = (process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '') as string;

// ─── Yardımcı fonksiyonlar ────────────────────────────────────────────────────

/** Haversine formülü ile iki nokta arası mesafe (km) */
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

async function fetchNearby(coords: Coords, type: PlaceType): Promise<PlaceResult[]> {
  const url =
    `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
    `?location=${coords.latitude},${coords.longitude}` +
    `&radius=${RADIUS}` +
    `&type=${type}` +
    `&language=tr` +
    `&key=${GOOGLE_API_KEY}`;

  const res = await fetch(url);
  const json = (await res.json()) as PlacesApiResponse;

  if (json.status !== 'OK' && json.status !== 'ZERO_RESULTS') {
    throw new Error(`Places API hatası: ${json.status}`);
  }
  return json.results ?? [];
}

function openInMaps(place: PlaceResult, user: Coords): void {
  const { lat, lng } = place.geometry.location;
  const url =
    `https://www.google.com/maps/dir/?api=1` +
    `&origin=${user.latitude},${user.longitude}` +
    `&destination=${lat},${lng}` +
    `&travelmode=driving`;
  void Linking.openURL(url);
}

// ─── Alt bileşenler ───────────────────────────────────────────────────────────

interface PlaceCardProps {
  item: PlaceResult;
  type: PlaceType;
  userCoords: Coords;
}

function PlaceCard({ item, type, userCoords }: PlaceCardProps) {
  const km = haversineKm(userCoords, item.geometry.location);
  const isOpen = item.opening_hours?.open_now;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.72 }]}
      onPress={() => openInMaps(item, userCoords)}
    >
      <View style={styles.cardIcon}>
        <Ionicons
          name={type === 'hospital' ? 'medkit' : 'fitness'}
          size={20}
          color="#1a6ef5"
        />
      </View>

      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.cardAddr} numberOfLines={1}>
          {item.vicinity}
        </Text>

        <View style={styles.cardMeta}>
          <View style={styles.distRow}>
            <Ionicons name="navigate-outline" size={11} color="#666" />
            <Text style={styles.distText}>{distLabel(km)}</Text>
          </View>

          {item.opening_hours != null && (
            <View
              style={[
                styles.openBadge,
                { backgroundColor: isOpen ? '#14532d' : '#3f0000' },
              ]}
            >
              <Text
                style={[styles.openText, { color: isOpen ? '#4ade80' : '#f87171' }]}
              >
                {isOpen ? 'Açık' : 'Kapalı'}
              </Text>
            </View>
          )}
        </View>
      </View>

      <Ionicons name="chevron-forward" size={16} color="#2a2a2a" />
    </Pressable>
  );
}

// ─── Ana bileşen ──────────────────────────────────────────────────────────────

export default function NearbyScreen() {
  const [tab, setTab] = useState<PlaceType>('hospital');
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [loadingLocation, setLoadingLocation] = useState(true);
  const [hospitals, setHospitals] = useState<PlaceResult[]>([]);
  const [pharmacies, setPharmacies] = useState<PlaceResult[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [placesError, setPlacesError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  // ─── Konum al ─────────────────────────────────────────────────────────────

  const getLocation = useCallback(async () => {
    setLoadingLocation(true);
    setLocationError(null);
    fetchedRef.current = false;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError('Konum iznine ihtiyaç var.\nAyarlardan izin verin.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setCoords({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
    } catch {
      setLocationError('Konum alınamadı. Lütfen tekrar deneyin.');
    } finally {
      setLoadingLocation(false);
    }
  }, []);

  // ─── Places API ───────────────────────────────────────────────────────────

  const fetchPlaces = useCallback(async (c: Coords) => {
    if (!GOOGLE_API_KEY) {
      setPlacesError(
        'Google Maps API anahtarı eksik.\n' +
        'EXPO_PUBLIC_GOOGLE_MAPS_KEY değişkenini .env dosyasına ekleyin.',
      );
      return;
    }
    setLoadingPlaces(true);
    setPlacesError(null);
    try {
      const [h, p] = await Promise.all([
        fetchNearby(c, 'hospital'),
        fetchNearby(c, 'pharmacy'),
      ]);
      setHospitals(h);
      setPharmacies(p);
    } catch (e) {
      setPlacesError(e instanceof Error ? e.message : 'Yerler yüklenemedi.');
    } finally {
      setLoadingPlaces(false);
    }
  }, []);

  useEffect(() => {
    void getLocation();
  }, [getLocation]);

  useEffect(() => {
    if (coords && !fetchedRef.current) {
      fetchedRef.current = true;
      void fetchPlaces(coords);
    }
  }, [coords, fetchPlaces]);

  // ─── Render durumları ─────────────────────────────────────────────────────

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

  const places = tab === 'hospital' ? hospitals : pharmacies;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      {/* ── Sekme seçici ── */}
      <View style={styles.tabBar}>
        <Pressable
          style={[styles.tabBtn, tab === 'hospital' && styles.tabBtnActive]}
          onPress={() => setTab('hospital')}
        >
          <Ionicons
            name="medkit-outline"
            size={15}
            color={tab === 'hospital' ? '#fff' : '#555'}
          />
          <Text style={[styles.tabText, tab === 'hospital' && styles.tabTextActive]}>
            Hastaneler
          </Text>
          {hospitals.length > 0 && (
            <View style={[styles.count, tab === 'hospital' && styles.countActive]}>
              <Text style={[styles.countText, tab === 'hospital' && styles.countTextActive]}>
                {hospitals.length}
              </Text>
            </View>
          )}
        </Pressable>

        <Pressable
          style={[styles.tabBtn, tab === 'pharmacy' && styles.tabBtnActive]}
          onPress={() => setTab('pharmacy')}
        >
          <Ionicons
            name="fitness-outline"
            size={15}
            color={tab === 'pharmacy' ? '#fff' : '#555'}
          />
          <Text style={[styles.tabText, tab === 'pharmacy' && styles.tabTextActive]}>
            Eczaneler
          </Text>
          {pharmacies.length > 0 && (
            <View style={[styles.count, tab === 'pharmacy' && styles.countActive]}>
              <Text style={[styles.countText, tab === 'pharmacy' && styles.countTextActive]}>
                {pharmacies.length}
              </Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* ── İçerik ── */}
      {loadingPlaces ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1a6ef5" />
          <Text style={styles.centerText}>
            {tab === 'hospital' ? 'Hastaneler' : 'Eczaneler'} aranıyor…
          </Text>
        </View>
      ) : placesError ? (
        <View style={styles.center}>
          <Ionicons name="warning-outline" size={52} color="#2a2a2a" />
          <Text style={styles.centerText}>{placesError}</Text>
          <Pressable
            style={styles.retryBtn}
            onPress={() => coords && void fetchPlaces(coords)}
          >
            <Text style={styles.retryText}>Tekrar Dene</Text>
          </Pressable>
        </View>
      ) : places.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="map-outline" size={52} color="#2a2a2a" />
          <Text style={styles.centerText}>
            {tab === 'hospital'
              ? '3 km içinde hastane bulunamadı.'
              : '3 km içinde eczane bulunamadı.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={places}
          keyExtractor={(item) => item.place_id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) =>
            coords ? (
              <PlaceCard item={item} type={tab} userCoords={coords} />
            ) : null
          }
        />
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
    gap: 6,
    paddingVertical: 10,
    borderRadius: 9,
  },
  tabBtnActive: { backgroundColor: '#1a6ef5' },
  tabText:      { color: '#555', fontSize: 13, fontWeight: '600' },
  tabTextActive:{ color: '#fff' },
  count:        { backgroundColor: '#2a2a2a', borderRadius: 9, paddingHorizontal: 6, paddingVertical: 1 },
  countActive:  { backgroundColor: 'rgba(255,255,255,0.2)' },
  countText:    { color: '#666', fontSize: 11, fontWeight: '700' },
  countTextActive:{ color: '#fff' },

  /* Liste */
  list: { paddingHorizontal: 14, paddingBottom: 24, gap: 10 },

  /* Kart */
  card: {
    backgroundColor: '#141414',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#1e1e1e',
  },
  cardIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: 'rgba(26,110,245,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardBody:    { flex: 1, gap: 3 },
  cardName:    { color: '#e8e8e8', fontSize: 14, fontWeight: '600' },
  cardAddr:    { color: '#555', fontSize: 12 },
  cardMeta:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  distRow:     { flexDirection: 'row', alignItems: 'center', gap: 3 },
  distText:    { color: '#666', fontSize: 11 },
  openBadge:   { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  openText:    { fontSize: 11, fontWeight: '600' },
});
