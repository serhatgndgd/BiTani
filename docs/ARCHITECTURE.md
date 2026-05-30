# BiTani Architecture

Bu doküman, yeni bir geliştiricinin veya AI asistanın BiTani kod tabanını hızlıca anlaması için hazırlanmıştır. Kaynaklar: mevcut mobil kod, Supabase Edge Function, migration dosyaları, script çıktıları ve proje kuralları.

## 1. Proje Yapısı

```text
BiTani/
├── apps/
│   └── mobile/
│       ├── App.tsx                    # Üst seviye auth/onboarding/main navigation kapısı
│       ├── screens/                   # React Native ekranları
│       ├── components/                # Paylaşılan UI ve brand bileşenleri
│       ├── context/                   # OtpFlowContext gibi küçük app context'leri
│       ├── legal/                     # KVKK/açık rıza dokümanları ve registry
│       ├── lib/                       # Supabase client ve platform adapter'ları
│       ├── navigation/                # Navigation parametre tipleri
│       ├── assets/                    # Expo ikon/splash asset'leri
│       └── theme.ts                   # Koyu tema renk token'ları
├── supabase/
│   ├── functions/
│   │   ├── chat/                      # Groq destekli sağlık asistanı Edge Function
│   │   └── delete-account/            # Hesap silme Edge Function
│   └── migrations/                    # DB migration'ları ve RLS/policy değişiklikleri
├── scripts/
│   ├── kub_endikasyon_cikarici.py     # Eski/ana KÜB+KT PDF pipeline
│   ├── kt_apply_parse.py              # KT 5 bölüm reparse/update pipeline
│   ├── kub_drug_interactions_apply.py # KÜB 4.5 ilaç etkileşimleri fill-only updater
│   ├── condition_matcher.py           # Ortak kural bazlı ilaç-hastalık eşleştirici
│   ├── condition_matching_apply.py    # condition_medications apply pipeline
│   └── synonyms.json                  # conditions_catalog id -> isim/sinonim sözlüğü
├── docs/
│   ├── ARCHITECTURE.md                # Bu dosya
│   └── MANUAL_QA_CHECKLIST.md         # Manual test checklist
└── CLAUDE.md                          # Kısa proje hafızası ve çalışma kuralları
```

### `apps/mobile/`

Expo SDK 54 / React Native 0.81 uygulamasıdır. TypeScript zorunludur. Navigation yapısı `App.tsx` içinde iki katmanlıdır:

- Auth stack: `Welcome`, `Login`, `Register`, `Otp`
- Main tabs: `Home`, `Search`, `Nearby`, `Chat`, `Profile`

Supabase session `expo-secure-store` üzerinden persist edilir. App açılışında session ve `profiles.onboarding_completed` kontrol edilerek Welcome, Onboarding veya MainTabs render edilir.

### `supabase/functions/chat/`

`index.ts`, mobil `ChatScreen` tarafından `supabase.functions.invoke('chat')` ile çağrılır. Kullanıcı JWT'sini doğrular, rate limit uygular, profil/hastalık/ilaç/prospektüs context'i oluşturur, Groq `llama-3.3-70b-versatile` modelini çağırır ve sohbet geçmişini `chat_history` tablosuna yazar.

### `supabase/migrations/`

Migration'lar RLS, chat history, consent kayıtları, rate limit RPC, `condition_medications` ve ilaç veri erişim politikalarını içerir. Bazı ana katalog tabloları (`medicationsV2`, `medication_kt`, `medication_kub`, `conditions_catalog`, `profiles`, `user_*`) başlangıç şemasından gelir; bu repo içinde tüm `CREATE TABLE` geçmişi yoktur.

### `scripts/`

TİTCK KÜB/KT PDF'lerinden ilaç prospektüs metni çıkarma, reparse etme, kalite analizi, sinonim üretme ve ilaç-hastalık eşleştirme işlerini yapar. Bu scriptler service role ile çalışır; `.env` dosyası commit edilmez.

## 2. Veritabanı Şeması

> Not: Aşağıdaki şema mevcut migration'lar, uygulama sorguları ve analiz raporlarından derlenmiştir. Başlangıç şemasında oluşturulmuş tabloların tüm constraint/policy tanımları repo içinde görünmeyebilir.

### `profiles`

Amaç: Supabase `auth.users` hesabının sağlık profili ve onboarding durumunu tutar. `App.tsx` bu tabloyu auth gate olarak kullanır.

Kolonlar:

| Kolon | Tip | Not |
|---|---|---|
| `id` | `uuid` | `auth.users(id)` ile bire bir kullanıcı id'si |
| `full_name` | `text` | Onboarding Step 1 ve Profile ekranında yönetilir |
| `birth_date` | `date` | Yaş hesaplama ve profil bilgisi |
| `gender` | `text` | `male`, `female`, `unspecified` |
| `height_cm` | `int` | 50-250 cm validasyonu |
| `weight_kg` | `numeric` | 10-300 kg validasyonu |
| `onboarding_completed` | `boolean not null default false` | MainTabs kapısı |

FK/RLS:

- `id` mantıksal olarak `auth.users(id)` referansıdır.
- RLS: kullanıcı sadece kendi profilini okuyup güncelleyebilmelidir.

### `conditions_catalog`

Amaç: Kullanıcının seçebileceği kronik hastalık kataloğudur. Onboarding, Profile ve condition matching pipeline tarafından kullanılır.

Kolonlar:

| Kolon | Tip | Not |
|---|---|---|
| `id` | `uuid` | Primary key |
| `name` | `text` | Hastalık adı |
| `category` | `text` | UI gruplama kategorisi |

FK/RLS:

- Başka tabloya FK yoktur.
- `user_conditions.condition_id` ve `condition_medications.condition_id` bu tabloya referans verir.
- RLS: kamuya açık SELECT beklenir.

### `medicationsV2`

Amaç: Aktif TİTCK ilaç kataloğudur. Mobil arama, onboarding ilaç seçimi, profil ilaç yönetimi ve Edge Function ilaç context'i bu tabloyu kullanır.

Kolonlar:

| Kolon | Tip | Not |
|---|---|---|
| `id` | `uuid` | Primary key |
| `ilac_adi` | `text` | Marka/form dahil ilaç adı |
| `etkin_madde_adi` | `text` | Etkin madde |
| `firma_adi` | `text` | Firma/ruhsat sahibi bilgisi |
| `kub_onay_tarihi` | `date/text` | KÜB onay tarihi |
| `kt_onay_tarihi` | `date/text` | KT onay tarihi |
| `kub_url` | `text` | TİTCK KÜB PDF URL |
| `kt_url` | `text` | TİTCK KT PDF URL |
| `created_at` | `timestamptz` | Kayıt zamanı |

FK/RLS:

- `medication_kt.medication_id`, `medication_kub.medication_id`, `user_medications.medication_id` ve `condition_medications.medication_id` bu tabloya bağlanır.
- RLS etkin. Policy: `anon` ve `authenticated` için public SELECT.

### `medication_kt`

Amaç: Kullanma Talimatı (KT) PDF'lerinden hasta diliyle çıkarılmış 5 resmi bölümü tutar. Chat Edge Function, kullanıcının aktif ilaçları için bu tabloyu katmanlı context olarak kullanır.

Kolonlar:

| Kolon | Tip | Not |
|---|---|---|
| `id` | `uuid` | Primary key |
| `medication_id` | `uuid` | `medicationsV2(id)` |
| `raw_text` | `text` | Reparse/audit için ham PDF metni |
| `section_1_nedir` | `text` | "Nedir / ne için kullanılır" |
| `section_2_kullanmadan_once` | `text` | Kontrendikasyon, gebelik, etkileşim, dikkat uyarıları |
| `section_3_nasil_kullanilir` | `text` | Kullanım/doz talimatı; LLM doz önerisi yapamaz, sadece prospektüs dilini aktarır |
| `section_4_yan_etkiler` | `text` | Yan etkiler ve sıklık bilgisi |
| `section_5_saklanmasi` | `text` | Saklama koşulları |
| `parse_quality_score` | `int/numeric` | 0-5 bölüm kalitesi |
| `parse_version` | `text` | Örn. `kt-v2` |
| `parsed_at` | `timestamptz` | Parse zamanı |
| `created_at` | `timestamptz` | Kayıt zamanı |

FK/RLS:

- `medication_id -> medicationsV2(id)`.
- Mobil client doğrudan okumaz; chat Edge Function service role ile okur. Public RLS policy bu repo içinde görünmüyor.

### `medication_kub`

Amaç: Kısa Ürün Bilgisi (KÜB) PDF'lerinden klinik/profesyonel prospektüs bölümlerini tutar. Chat Edge Function güvenlik, etkileşim, kontrendikasyon ve yan etki bağlamında kullanır.

Kolonlar:

| Kolon | Tip | Not |
|---|---|---|
| `id` | `uuid` | Primary key |
| `medication_id` | `uuid` | `medicationsV2(id)` |
| `composition` | `text` | Etkin/yardımcı maddeler; bekletilen karar alanı |
| `therapeutic_indications` | `text` | KÜB 4.1 endikasyon |
| `dosage_and_administration` | `text` | KÜB 4.2; bekletilen karar alanı |
| `contraindications` | `text` | KÜB 4.3 |
| `special_warnings` | `text` | KÜB 4.4 |
| `drug_interactions` | `text` | KÜB 4.5 |
| `pregnancy_and_lactation` | `text` | KÜB 4.6 |
| `driving_and_machine_use` | `text` | KÜB 4.7; bekletilen karar alanı |
| `side_effects` | `text` | KÜB 4.8 |
| `overdose` | `text` | KÜB 4.9; bekletilen karar alanı |
| `raw_text` | `text` | Reparse/audit için ham PDF metni |
| `parsed_at` | `timestamptz` | Parse zamanı |
| `created_at` | `timestamptz` | Kayıt zamanı |

FK/RLS:

- `medication_id -> medicationsV2(id)`.
- Mobil client doğrudan okumaz; chat Edge Function service role ile okur. Public RLS policy bu repo içinde görünmüyor.

Drop edilmiş/redundant kolonlar:

- `product_name`, `source_url`, `license_holder`, `pharmaceutical_form`, `shelf_life`, `storage_conditions`, `pharmacodynamic_properties`, `pharmacokinetic_properties`.
- Gerekçe: `medicationsV2` ile redundant, KT section'larıyla daha kullanıcı dostu karşılığı var veya chat kapsamı dışında teknik farmakoloji verisi.

### `condition_medications`

Amaç: Hastalık kataloğu ile ilaç kataloğu arasındaki kural bazlı eşleşmeleri tutar. Onboarding ve Profile ekranları seçili hastalıklara göre ilaç önerisini buradan çeker.

Kolonlar:

| Kolon | Tip | Not |
|---|---|---|
| `id` | `uuid default gen_random_uuid()` | Primary key |
| `condition_id` | `uuid not null` | `conditions_catalog(id)` |
| `medication_id` | `uuid not null` | `medicationsV2(id)` |
| `confidence_score` | `numeric` | Mobilde `>= 0.7` filtrelenir |
| `evidence` | `text` | Yeni matcher scriptinin kanıt alanı |
| `evidence_snippet` | `text` | Eski/kalite migration'ında kullanılan kanıt alanı |
| `is_contraindication` | `boolean default false` | Eski pipeline v3.x endikasyon/kontrendikasyon ayrımı |
| `extraction_method` | `text` | `keyword`, `embedding`, `llm`, `manual`, `hybrid` |
| `source` | `text` | `KUB_4_1`, `KT`, `KUB_4_1+KT`, `KUB_4_3` |
| `annotation_version` | `text` | Pipeline versiyonu |
| `created_at` | `timestamptz default now()` | Kayıt zamanı |

FK/RLS:

- `condition_id -> conditions_catalog(id)`.
- `medication_id -> medicationsV2(id)`.
- Unique: `(condition_id, medication_id)`.
- RLS etkin. Policy: `anon` ve `authenticated` için public SELECT.

### `user_conditions`

Amaç: Kullanıcının seçtiği kronik hastalıkları tutar.

Kolonlar:

| Kolon | Tip | Not |
|---|---|---|
| `user_id` | `uuid` | Kullanıcı id |
| `condition_id` | `uuid` | Hastalık id |

FK/RLS:

- `user_id -> profiles(id)` veya `auth.users(id)` mantıksal ilişkisi.
- `condition_id -> conditions_catalog(id)`.
- RLS: kullanıcı sadece kendi hastalıklarını okuyup yazabilmelidir.

### `user_medications`

Amaç: Kullanıcının aktif/pasif ilaçlarını ve opsiyonel doz notunu tutar. İlaç bırakma silme değil `is_active=false` ile yapılır.

Kolonlar:

| Kolon | Tip | Not |
|---|---|---|
| `user_id` | `uuid` | Kullanıcı id |
| `medication_id` | `uuid` | `medicationsV2(id)` |
| `dosage` | `text` | Kullanıcının serbest doz notu |
| `is_active` | `boolean` | `false` = bırakıldı, geçmiş korunur |

FK/RLS:

- `user_id -> profiles(id)` veya `auth.users(id)` mantıksal ilişkisi.
- `medication_id -> medicationsV2(id)`.
- Upsert conflict: `(user_id, medication_id)`.
- RLS: kullanıcı sadece kendi ilaçlarını okuyup yazabilmelidir.

### `consent_records`

Amaç: KVKK, açık rıza, AI transfer, chat history ve 18+ beyan kayıtlarını saklar.

Kolonlar:

| Kolon | Tip | Not |
|---|---|---|
| `id` | `uuid default gen_random_uuid()` | Primary key |
| `user_id` | `uuid` | `auth.users(id)` |
| `consent_type` | `text` | `kvkk_aydinlatma`, `saglik_veri`, `ai_transfer`, `chat_history`, `age_18` |
| `consent_given` | `boolean not null` | Kullanıcı onayı |
| `version` | `text default 'v1.0'` | Metin versiyonu |
| `given_at` | `timestamp default now()` | Onay zamanı |

FK/RLS:

- `user_id -> auth.users(id) on delete cascade`.
- RLS etkin. Policy: `auth.uid() = user_id`.

### `chat_history`

Amaç: Claude.ai benzeri session bazlı sohbet geçmişini row-per-message modeliyle saklar.

Kolonlar:

| Kolon | Tip | Not |
|---|---|---|
| `id` | `uuid default gen_random_uuid()` | Primary key |
| `user_id` | `uuid not null` | `auth.users(id)` |
| `session_id` | `uuid default gen_random_uuid()` | Sohbet oturumu |
| `title` | `text` | İlk kullanıcı mesajından türetilen başlık |
| `role` | `text` | `user` veya `assistant` |
| `content` | `text not null` | Mesaj içeriği |
| `created_at` | `timestamptz default now()` | Mesaj zamanı |
| `updated_at` | `timestamptz default now()` | Session sıralaması için güncel zaman |

FK/RLS:

- `user_id -> auth.users on delete cascade`.
- RLS etkin. Policy: kullanıcı kendi mesajlarını görebilir, ekleyebilir, silebilir.
- Index: `(user_id, created_at desc)`, `session_id`, `(user_id, updated_at desc)`.

## 3. Mobil Uygulama Ekranları

### Navigation Gate (`apps/mobile/App.tsx`)

Amaç: Auth, onboarding, biyometrik kapı ve main tab render kararını verir.

Akış:

- Session yok: `AuthNavigator`, başlangıç `Welcome`.
- Session var + `profiles.onboarding_completed !== true`: `OnboardingScreen`.
- Session var + onboarding tamam: biyometrik doğrulama sonrası `MainNavigator`.
- Çıkış: `supabase.auth.signOut()` session'ı null yapar, Welcome görünür.

Kullandığı tablo/API:

- `supabase.auth.getSession()`, `onAuthStateChange()`, `getUser()`
- `profiles(onboarding_completed)`
- `expo-local-authentication`

### `WelcomeScreen` (`apps/mobile/screens/WelcomeScreen.tsx`)

Amaç: Marka giriş ekranı. Wordmark, glow ve EKG animasyonu gösterir.

Kullandığı tablo/API:

- DB kullanmaz.

State/logic:

- `Animated.Value` ile wordmark, slogan, buton ve SVG EKG animasyonları.

Navigation:

- Auth stack başlangıcıdır.
- `Başla` -> `Register`.
- `Giriş Yap` -> `Login`.

### `LoginScreen` (`apps/mobile/screens/LoginScreen.tsx`)

Amaç: E-posta + şifre ile giriş.

Kullandığı tablo/API:

- `supabase.auth.signInWithPassword()`.

Önemli state'ler:

- `email`, `password`, `error`, `loading`.
- Auth hataları kullanıcı dostu Türkçe mesajlara map edilir.

Navigation:

- `Welcome` içinden gelir.
- Başarılı login sonrası navigation elle yapılmaz; `App.tsx` auth listener session'ı yakalar ve onboarding/main gate'i çalışır.
- `Kayıt Ol` -> `Register`.
- `Ana ekrana dön` -> `Welcome`.

### `RegisterScreen` (`apps/mobile/screens/RegisterScreen.tsx`)

Amaç: Auth-only kayıt ekranı. Profil bilgisi toplamaz; full name ve doğum tarihi onboarding'e taşınmıştır.

Kullandığı tablo/API:

- `supabase.auth.signUp({ email, password })`
- `consent_records.insert()`
- `LegalDocumentModal` ile `apps/mobile/legal` dokümanları

Önemli state'ler:

- `email`, `password`, `confirm`
- `consents`: `kvkk_read`, `saglik_veri`, `ai_transfer`, `chat_history`, `age_18`
- `hasRead`: zorunlu metinler okunmadan checkbox işaretlenemez
- `readingConsent`, `error`, `loading`

Validasyon:

- E-posta formatı.
- Şifre: en az 8 karakter, büyük harf, rakam, özel karakter.
- Şifre tekrar eşleşmesi.
- Zorunlu rızalar: KVKK, sağlık verisi, chat history, 18+ beyanı.
- `ai_transfer` opsiyoneldir.

Navigation:

- `Welcome` veya `Login` içinden gelir.
- Email confirmation akışında `Otp` ekranına gider.
- Session doğrudan oluşursa `App.tsx` listener Onboarding'e yönlendirir.

### `OtpScreen` (`apps/mobile/screens/OtpScreen.tsx`)

Amaç: E-posta kayıt doğrulaması için 6 haneli OTP ekranı.

Kullandığı tablo/API:

- `supabase.auth.verifyOtp({ type: 'signup' })`
- `supabase.auth.resend()`
- `supabase.auth.getSession()`
- `consent_records.insert()` pending consent kaydı için

Önemli state'ler:

- `digits`: 6 kutucuklu OTP state'i.
- `secondsLeft`: resend geri sayımı.
- `verifyLoading`, `sessionSyncing`, `resendLoading`, `error`.

Navigation:

- `Register` içinden `email` ve `pendingConsents` ile gelir.
- Doğrulama sonrası `OtpFlowContext.onOtpSessionReady()` App tarafında profile gate'i yeniler.

### `OnboardingScreen` (`apps/mobile/screens/OnboardingScreen.tsx`)

Amaç: Yeni veya onboarding'i tamamlanmamış kullanıcıyı 4 adımda profil/hastalık/ilaç kaydından geçirir.

Kullandığı tablo/API:

- `profiles.upsert()`
- `conditions_catalog.select()`
- `user_conditions.delete()/insert()`
- `condition_medications.select()`
- `medicationsV2.select()`
- `user_medications.delete()/insert()`
- `supabase.auth.signOut()` Step 1 çıkış linki için

Önemli state'ler:

- Genel: `resolvedUserId`, `step`, `stepError`, `saveError`, `saving`
- Step 1: `fullName`, `day`, `month`, `year`, `gender`
- Step 2: `heightCm`, `weightKg`, `bmiWarning`
- Step 3: `conditions`, `search`, `selectedIds`, `noChronic`
- Step 4: `medSearch`, `condMedRows`, `medRows`, `selectedMedIds`, `medDosages`, `noMedConditions`, `expandedMedBrands`

Adımlar:

1. Kişisel bilgiler: ad soyad, doğum tarihi, 18+ kontrolü, cinsiyet. Step 1 geçilirken `profiles.full_name` erken kaydedilir.
2. Vücut bilgileri: boy/kilo, 50-250 cm ve 10-300 kg sınırı, BMI orantısızlık uyarısı.
3. Kronik hastalıklar: `conditions_catalog` kategorilerine göre çoklu seçim veya "kronik hastalığım yok".
4. İlaçlar: seçilen hastalıklara göre `condition_medications` önerileri ve serbest `medicationsV2` araması. Brand accordion ile varyant seçimi yapılır.

Navigation:

- `App.tsx` session + `needsOnboarding=true` durumunda doğrudan render eder; Auth stack içinde değildir.
- `onComplete()` çağrısı App tarafında `refreshProfileGate()` yapar.
- Step 1'de "Farklı hesapla giriş yap" linki sign out ile Welcome'a dönüş sağlar.

### `HomeScreen` (`apps/mobile/screens/HomeScreen.tsx`)

Amaç: Kullanıcıya ana sağlık özeti, BMI kartı, hastalıklar ve ilaç zaman grupları gösterir.

Kullandığı tablo/API:

- `profiles(full_name, height_cm, weight_kg)`
- `user_conditions -> conditions_catalog(name)`
- `user_medications -> medications(ilac_adi)`; not: bu ekranda eski `medications` relation kullanımı kalmış olabilir, aktif katalog genel olarak `medicationsV2`'dir.

Önemli state'ler:

- `profile`, `firstName`, `conditions`, `medications`, `loading`.
- İlaç doz notundan `sabah/öğle/akşam/diğer` gruplama.

Navigation:

- MainTabs `Home`.
- Kart aksiyonları tablar arası navigation yapabilir.

### `SearchScreen` (`apps/mobile/screens/SearchScreen.tsx`)

Amaç: TİTCK ilaç kataloğunda arama yapmak, marka bazında sonuçları gruplayıp varyant detaylarını göstermek.

Kullandığı tablo/API:

- `medicationsV2.select('id, ilac_adi, etkin_madde_adi, firma_adi, kub_url, kt_url')`
- `user_medications.select('medication_id')` aktif ilaç badge'i için
- `Linking.openURL()` KÜB/KT PDF bağlantıları için

Önemli state'ler:

- `query`, `results`, `searching`, `loadingMore`, `hasMore`, `searchError`
- `selected`: detay modalı
- `userMedIds`: kullanıcıda kayıtlı aktif ilaçlar
- `expandedBrands`: marka accordion açık/kapalı state'i

Navigation:

- MainTabs `Search`.
- Başka ekrana yönlendirme yapmaz; modal ve external PDF link kullanır.

### `NearbyScreen` (`apps/mobile/screens/NearbyScreen.tsx`)

Amaç: Yakındaki nöbetçi eczane ve hastane/klinikleri gösterir, arama/rota/telefon aksiyonları sunar.

Kullandığı tablo/API:

- `expo-location`: konum izni ve mevcut koordinat.
- Nobetecza API: nöbetçi eczane.
- Overpass API: OSM hastane/klinik ve fallback eczane.
- Google Maps URL ve `tel:` deep link.

Önemli state'ler:

- `tab`: `pharmacy` veya `hospital`.
- `coords`, `pharmacies`, `hospitals`.
- `loadingLocation`, `loadingPharmacies`, `loadingHospitals`.
- `locationError`, `pharmacyError`, `hospitalError`.

Navigation:

- MainTabs `Nearby`.
- External maps/phone linkleri açar.

### `ChatScreen` (`apps/mobile/screens/ChatScreen.tsx`)

Amaç: Kullanıcıya kişiselleştirilmiş sağlık asistanı sohbeti sunar.

Kullandığı tablo/API:

- `profiles(full_name)`
- `user_conditions -> conditions_catalog(name)`
- `chat_history` session listesi, session mesajları, delete
- `supabase.functions.invoke('chat')`
- `AsyncStorage`: chat disclaimer kabul flag'i

Önemli state'ler:

- `welcomeText`, `messages`, `activeSessionId`
- `sessions`, `historyVisible`, `historyLoading`
- `input`, `sending`, `sendError`
- `showEmergency`, `showDisclaimer`

Navigation:

- MainTabs `Chat`.
- Header left: geçmiş modalı.
- Header right: yeni sohbet.
- Chat input Edge Function'a son kullanıcı mesajı, `session_id` ve `title` gönderir.

### `ProfileScreen` (`apps/mobile/screens/ProfileScreen.tsx`)

Amaç: Profil, kronik hastalık ve ilaç yönetimi; sohbet geçmişi temizleme, hesap silme ve çıkış.

Kullandığı tablo/API:

- `profiles.select()/update()`
- `conditions_catalog.select()`
- `user_conditions.insert()/delete()`
- `user_medications.select()/update()/upsert()`
- `condition_medications.select()`
- `medicationsV2.select()`
- `chat_history.delete()`
- `delete-account` Edge Function
- `supabase.auth.signOut()`

Önemli state'ler:

- Profil edit: `editingProfile`, `fullName`, `day/month/year`, `gender`, `heightCm`, `weightKg`
- Hastalıklar: `userConditions`, `allConditions`, modal state
- İlaçlar: `userMedications`, öneri modalı, serbest arama modalı, `modalSelectedMedIds`, `modalMedDosages`
- Account deletion: `deleteModalVisible`, `deletingAccount`, `deleteAccountError`

Navigation:

- MainTabs `Profile`.
- Header right App.tsx'te `SignOutButton` gösterir.
- Sign out session'ı null yapar ve App auth gate Welcome'a döner.

## 4. Edge Function — Chat Mimarisi

Dosya: `supabase/functions/chat/index.ts`

### Request / Response

Request body:

```json
{
  "messages": [{ "role": "user", "content": "..." }],
  "is_emergency_flagged": false,
  "session_id": "uuid-optional",
  "title": "optional session title"
}
```

Headers:

- `Authorization: Bearer <supabase access_token>`
- `Content-Type: application/json`

Başarılı response:

```json
{
  "reply": "Türkçe asistan yanıtı",
  "is_emergency": false
}
```

Hata response örnekleri:

- `400`: `messages gerekli`
- `401`: `Oturum doğrulanamadı.`
- `429`: `Çok fazla mesaj gönderdiniz. Lütfen 1 dakika bekleyin.`
- `500`: `Asistan yanıtı alınamadı. Lütfen tekrar deneyin.`

### Güvenlik Katmanları

Sıra:

1. CORS preflight.
2. Request body shape kontrolü (`messages` array).
3. `Authorization` header ve JWT çıkarımı.
4. Service role Supabase client ile `auth.getUser(jwt)` doğrulaması.
5. Atomik `increment_rate_limit` RPC ile kullanıcı başına 60 saniyede 10 istek limiti.
6. Profil, hastalık ve aktif ilaçların service role ile çekilmesi.
7. Session scoped son 20 chat history mesajının çekilmesi.
8. Son kullanıcı mesajında input sanitizer:
   - 500 karakter kırpma.
   - Prompt injection pattern kontrolü (`ignore previous`, `system prompt`, `[system]`, vb.).
9. Server-side fuzzy emergency detection:
   - `ABSOLUTE_EMERGENCY`: LLM'e gitmeden direkt 112 yanıtı.
   - `SOFT_EMERGENCY`: system prompt'a emergency context ekler.
10. KT ve KÜB context build:
   - Kullanıcının aktif ilaçlarına göre.
   - Soru trigger'larına göre katmanlı.
11. Groq çağrısı:
   - Model: `llama-3.3-70b-versatile`
   - `temperature: 0.5`, `top_p: 0.9`, `frequency_penalty: 0.2`, `max_tokens: 1024`
12. LLM output validator:
   - Tanı/teşhis koyma.
   - Yeni ilaç/doz önerme.
   - İlaç bırakma/artırma/azaltma.
   - Kesin güvenli/zararlı dili.
   - Yasak pattern bulunursa sanitize edilmiş fallback/temiz yanıt.
13. `chat_history` insert.

### Context Building

Profil context:

- Ad, yaş, cinsiyet, boy, kilo.
- Kullanıcının bilinen hastalıkları.
- Aktif ilaçlar ve kullanıcı doz notu.

KT context:

- Kaynak tablo: `medication_kt`.
- Kullanılan kolonlar: `section_1_nedir`, `section_2_kullanmadan_once`, `section_3_nasil_kullanilir`, `section_4_yan_etkiler`, `section_5_saklanmasi`, `parse_quality_score`.
- `parse_quality_score < 3` ise section metinleri gönderilmez; kullanıcıya bu ilaç için detaylı prospektüs bilgisinin sınırlı olduğu söylenir.
- Char limit: bölüm başına 1500, toplam 8000.
- Katmanlar:
  - Genel: `section_1`, `section_5`.
  - Kullanım/güvenlik trigger'ı: `section_2`, `section_3`.
  - Yan etki trigger'ı: `section_4`.

KÜB context:

- Kaynak tablo: `medication_kub`.
- Kullanılan kolonlar: `therapeutic_indications`, `contraindications`, `special_warnings`, `drug_interactions`, `pregnancy_and_lactation`, `side_effects`.
- Char limit: toplam 6000.
- Katmanlar:
  - Genel: endikasyonlar.
  - Etkileşim/kontrendikasyon trigger'ı: ilaç etkileşimleri, kontrendikasyonlar, özel uyarılar.
  - Yan etki/gebelik/emzirme trigger'ı: yan etkiler, gebelik/emzirme.

Hastalık context:

- `user_conditions -> conditions_catalog(name)` listesinden üretilir.
- System prompt'ta "ilaç-kontrendikasyon ve etkileşim değerlendirmesinde kullanılmalıdır" notuyla yer alır.

### System Prompt Yapısı

Prompt blokları:

- Korunan sistem talimatı.
- Rol: BiTanı sağlık asistanı; doktor/eczacı değil.
- Semptom gelirse anamnez: tek seferde tek soru.
- Acil bayraklar.
- İlaç sorularında sınır, kontrol, yanıt şablonu.
- Kesin yasaklar.
- Evde ilaç dışı destekleyici öneriler.
- Kullanıcı bağlamı.
- Çıktı kuralları.
- Soft emergency varsa `EMERGENCY_CONTEXT`.

LLM sınırları:

- Tanı koyamaz.
- Yeni ilaç öneremez.
- Doz söyleyemez veya değiştiremez.
- "Doktora gitmene gerek yok" diyemez.
- Prospektüste olmayan güvenlik bilgisi ekleyemez.

### Session Bazlı History

Frontend:

- `ChatScreen` `activeSessionId` üretir.
- İlk kullanıcı mesajından `title` üretir.
- Yeni sohbet butonu yeni `session_id` açar.
- Geçmiş modalı `chat_history` session summary listesini gösterir.

Edge Function:

- `session_id` varsa history query `.eq('session_id', requestSessionId)` ile scope'lanır.
- Yoksa `crypto.randomUUID()` üretir.
- Son 20 mesaj ters sıradan alınıp Groq'a doğru sırada verilir.
- Her request sonunda user ve assistant mesajları aynı `session_id`, `title`, `updated_at` ile insert edilir.

### Emergency Detection

İki katman vardır:

- Absolute emergency: `kalp krizi`, `inme`, `intihar`, `bilinç kaybı`, `nefes almıyor`, `anafilaksi`, `zehirlenme`, vb. Bu durumda Groq çağrılmadan doğrudan 112 yanıtı döner ve history kaydedilir.
- Soft emergency: `acil`, `hastane`, `göğüs ağrısı`, `nefes darlığı`, `şeker düştü`, vb. Bu durumda LLM çağrılır ama system prompt'a emergency context eklenir.

Eşleşme fuzzy yapılır:

- Türkçe normalizasyon.
- Levenshtein toleransı.
- Tek kelime ve çok kelimeli phrase eşleşmeleri.

## 5. Veri İşleme — Python Scriptleri

### `scripts/kt_apply_parse.py`

Amaç: `medication_kt.raw_text` içinden resmi KT 5 bölümünü yeniden parse edip yalnız yeni 5 section kolonunu ve kalite metadata'sını update eder.

Yazdığı kolonlar:

- `section_1_nedir`
- `section_2_kullanmadan_once`
- `section_3_nasil_kullanilir`
- `section_4_yan_etkiler`
- `section_5_saklanmasi`
- `parse_quality_score`
- `parse_version`

Güvenlik:

- INSERT/DELETE yok.
- `raw_text` ve eski kolonlara dokunmaz.
- Default dry-run; apply için `--apply --confirm-i-understand` gerekir.
- `score < 2` için tüm section'ları `NULL` yaparak TOC-swallow/OCR hatalarını context'e sokmaz.

### `scripts/kub_drug_interactions_apply.py`

Amaç: `medication_kub.raw_text` içinden KÜB 4.5 "diğer tıbbi ürünlerle etkileşim" bölümünü fill-only mantıkla çıkarmak.

Yazdığı kolon:

- Sadece `medication_kub.drug_interactions`.

Güvenlik:

- Sadece `drug_interactions IS NULL` kayıtları çeker.
- Dolu kayıtları asla değiştirmez.
- `<30 char`, anchor bulunamaması ve kontaminasyon durumlarında skip eder.
- Güncelleme sırasında `.is_("drug_interactions", "null")` ek güvenlik koşulu kullanır.

### `scripts/condition_matching_apply.py`

Amaç: KÜB 4.1 (`medication_kub.therapeutic_indications`) ve KT section 1 (`medication_kt.section_1_nedir`) metinlerinden hastalık-ilaç eşleşmeleri üretip `condition_medications` tablosuna yazar.

Akış:

1. `medication_kub.therapeutic_indications` ve `medication_kt.section_1_nedir` metinlerini çeker.
2. `condition_matcher.Matcher` ile eşleştirir.
3. `condition_medications` tablosuna `upsert(on_conflict="condition_id,medication_id")` yapar.

Güvenlik:

- `CONFIRM=1` olmadan çalışmaz.
- Sadece `condition_medications` tablosuna yazar.
- Idempotent çalışır.

### `scripts/condition_matcher.py`

Amaç: Dry-run ve apply scriptlerinin ortak, DB'ye yazmayan kural bazlı eşleştirme çekirdeği.

Kurallar:

- `synonyms.json` içindeki canonical hastalık adı ve sinonimleri tarar.
- Türkçe duyarlı lower/normalizasyon yapar.
- Türkçe kelime sınırı için lookaround kullanır; kısmi kelime eşleşmesini önler.
- 3 harften kısa terimleri atlar.
- Eşleşme çevresindeki `kontrendik...` negasyonunu dışlar.
- Bir ilaç-hastalık çifti için en yüksek confidence skorunu tutar.

Confidence:

- Canonical ad: 0.90 taban.
- Sinonim: uzunluğa göre 0.62-0.88.
- KÜB kaynağı: +0.05.
- Üst sınır: 0.97.

### `scripts/synonyms.json`

Amaç: `conditions_catalog` id'lerini canonical hastalık adı ve eczacı-küratörlü sinonimlerle eşler.

Format:

```json
{
  "<condition_id>": {
    "name": "Hipertansiyon",
    "synonyms": ["yüksek tansiyon", "arteriyel hipertansiyon"]
  }
}
```

Kullanım:

- `condition_matcher.py` bu dosyayı okur.
- `build_synonyms.py` canlı DB'den `conditions_catalog(id,name)` çekerek üretimi/validasyonu destekler.

## 6. Kritik Kararlar ve Sınırlar

### LLM tıbbi sınırları

BiTanı bilgi ve yönlendirme asistanıdır. Şunları yapamaz:

- Tanı/teşhis koymak.
- Yeni ilaç başlatmak veya "şu ilacı al" demek.
- Doz önermek, doz artırmak/azaltmak.
- Kullanılan ilacı bırak demek.
- Doktor/eczacı kontrolünü gereksiz göstermek.
- Prospektüste olmayan güvenlik bilgisini kesin gerçek gibi sunmak.

### `parse_quality_score < 3` gate

KT parser OCR ve bölüm sınırı hatalarına açıktır. `parse_quality_score < 3` kayıtlar:

- Eksik veya yanlış bölüm ayrımı içerme riski taşır.
- LLM context'e girerse yanlış güvenlik bilgisi üretebilir.
- Bu nedenle Edge Function, bu kayıtların section metinlerini göndermek yerine "detaylı prospektüs bilgisi sınırlı" mesajı verir.

### `condition_medications confidence >= 0.7` eşiği

Onboarding ve Profile öneri listeleri `confidence_score >= 0.7` kullanır.

Gerekçe:

- Sağlık uygulamasında precision recall'dan daha önemlidir.
- Kısa sinonimler ve zayıf keyword eşleşmeleri yanlış ilaç önerisi gibi algılanabilir.
- 0.7 altı eşleşmeler araştırma/pipeline tarafında kalmalı, kullanıcı UI'ına taşınmamalıdır.

### KÜB reparse yapılmayan/bekletilen kolonlar

`contraindications` için reparse prototipinde 200 örnekten 132'si DAMAGE sınıfına düşmüştür. Bu yaklaşık %66 damage riskidir. Bu nedenle mevcut dolu kontrendikasyon metinlerini topluca overwrite etmek güvenli değildir.

Bekletilen alanlar:

- `contraindications`: klinik güvenlik açısından kritik; yüksek damage riski nedeniyle toplu reparse yok.
- `overdose`: acil protokol bilgisi; chat zaten 112/acil yönlendirmesi yapar, ayrıca reparse gerekir.
- `driving_and_machine_use`: faydalı olabilir ama `special_warnings` ile örtüşebilir.
- `dosage_and_administration`: KÜB daha klinik/uzun; LLM doz öneremez, bu nedenle dikkatli kullanılmalı.
- `composition`: yardımcı madde/alerjen için yararlı olabilir ama doluluk ve parse kalitesi kararı bekliyor.

### `medication_kt` eski 14 kolon neden silindi?

KT resmi yapısı 5 ana bölümden oluşur. Eski 14 semantik kolon (`what_is_it`, `before_using`, `do_not_use`, `use_carefully`, `food_and_drink`, `pregnancy`, `breastfeeding`, `driving_and_machine_use`, `important_excipients`, `drug_interactions`, `how_to_use`, `possible_side_effects`, `storage_information`, `health_personnel_info`) yapay ayrıştırmaydı.

Gerekçe:

- 5 bölüm yapısı resmi KT formatıyla uyumlu.
- Eski kolonların çoğu section 1-5 içinde zaten var.
- `drug_interactions`, KT formatında ayrı resmi bölüm değil; çoğunlukla section 2 içinde.
- LLM için 5 bölüm daha güvenli ve token verimli.
- `parse_quality_score` ve `parse_version` ile kalite kontrol daha net.

### `drug_variants` / `drug_brands` neden silindi?

Ayrı `drug_variants` / `drug_brands` tablosu yerine marka-varyant gruplaması mobil tarafta `medicationsV2.ilac_adi` üzerinden türetilir.

Gerekçe:

- Kaynak gerçeklik `medicationsV2` satırıdır; her satır spesifik form/varyanttır.
- Ayrı brand/variant tabloları stale alias ve senkronizasyon riski üretir.
- RLS ve FK yüzeyi genişler.
- Onboarding/Search/Profile UI, marka adını regex ile çıkarıp varyantları accordion altında gösterir; bu UX için ayrı tablo zorunlu değildir.

## 7. Açık Kalan İşler

- Giriş ekranı UI kontrolü: Login/Register/OTP akışında görsel ve error-state QA.
- PR merge: `feat/condition-medications-ui` branch'inin merge'e hazırlanması.
- KÜB beklet kolonları kararı: `overdose`, `driving_and_machine_use`, `dosage_and_administration`, `composition`.
- OCR kuyruğu: `parse_quality_score=0` olan 1.272 KT kaydını yeniden işleme/manuel inceleme.
- Chapter 4 bitirme tezi: veri pipeline ve kalite kararlarının tez bölümü için derlenmesi.
- Groq onay katmanı: `condition_medications` confidence değerini LLM batch doğrulama ile artırma.
- Profile'a hamilelik/emzirme bayrağı: `profiles` veya ayrı sağlık durumu tablosunda tutulmalı; KÜB gebelik/emzirme context'i için kritik.
