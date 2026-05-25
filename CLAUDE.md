# BiTanı - AI Destekli Sağlık Asistanı

## Proje Özeti
Türkçe, koyu temalı Expo (React Native) mobil sağlık uygulaması.
Kullanıcıların kronik hastalıklarına ve ilaçlarına göre kişiselleştirilmiş
sağlık önerileri sunar. Acil durumlarda Google Maps ile en yakın hastaneye yönlendirir.

## Tech Stack
- React Native / Expo SDK 54
- TypeScript (any kullanma)
- Supabase (auth, PostgreSQL, Edge Functions, RLS)
- React Navigation v7 (native stack + bottom tabs)
- Groq API - llama-3.3-70b-versatile (Supabase Edge Function üzerinden)
- expo-location (Google Maps acil yönlendirme)
- react-native-svg (BiTanı brand components)

## Klasör Yapısı
apps/mobile/
├── screens/          → Tüm ekranlar
├── components/       → Brand.tsx (logo, wordmark, splash)
├── context/          → OtpFlowContext.tsx
├── lib/              → supabase.ts
├── assets/           → icon, splash görseller
└── .ese/
└── functions/
    └── chat/         → index.ts (Groq Edge Function)

scripts/
├── kub_endikasyon_cikarici.py  → KÜB+KT PDF pipeline
├── .env              → SUPABASE_SERVICE_ROLE_KEY
└── .venv/            → Python virtual environment

## Veritabanı Şeması
auth.users (Supabase yönetir)
    ↓
profiles
├── id uuid → auth.users
├── full_name text
├── birth_date date
├── gender text (male/female/unspecified)
├── height_cm int
├── weight_kg numeric
└── onboarding_completed boolean (default false)

conditions_catalog (71 hastalık, sabit katalog)
├── id uuid
├── name text
└── category text
— Çıkarılanlar (v3.5.0 kalite filtresi): Mesane Aşırı Aktivitesi (K/E 36.8x),
  Hipertiroidi (K/E 15.3x), Hipotiroidi (K/E 15.3x)

medications (15.573 ilaç - TİTCK verisi)
├── id uuid
├── ilac_adi text
├── etkin_madde_adi text
├── firma_adi text
├── kub_url text
└── kt_url text

condition_medications (100.193 eşleşme — v3.5.0)
├── condition_id → conditions_catalog
├── medication_id → medications
├── confidence_score numeric
├── is_contraindication boolean
├── extraction_method text
├── evidence_snippet text
├── source text
└── annotation_version text
— Endikasyon: 47.813 | Kontrendikasyon: 52.380 | K/E: 1.10

## Auth Akışı
Session yok → WelcomeScreen
Session var + onboarding_completed false → OnboardingScreen (4 adım)
Session var + onboarding_completed true → MainTabs

## Onboarding Adımları
1. Kişisel bilgiler (ad, doğum tarihi, cinsiyet)
2. Vücut bilgileri (boy 50-250cm, kilo 10-300kg, BMI kontrolü)
3. Kronik hastalıklar (conditions_catalog'dan çoklu seçim)
4. İlaçlar (seçilen hastalıklara göre condition_medications'dan filtrelenmiş liste)

## Ekranlar
| Ekran | Durum | Açıklama |
|---|---|---|
| WelcomeScreen | ✅ | Animasyonlu giriş, BiTanı brand |
| LoginScreen | ✅ | Email + şifre |
| RegisterScreen | ✅ | Şifre gücü, KVKK onayı |
| OtpScreen | ✅ | 6 kutucuk, geri sayım, yapıştırma |
| OnboardingScreen | ✅ | 4 adım, hastalık+ilaç seçimi |
| HomeScreen | ❌ | Placeholder |
| SearchScreen | ❌ | Placeholder |
| ChatScreen | ✅ | Groq Llama 3.3, acil yönlendirme |

## Chat Mimarisi
Telefon → supabase.functions.invoke('chat')
    → Edge Function (supabase/functions/chat/index.ts)
    → Supabase'den kullanıcı profili çek
    → System prompt oluştur (Türkçe sağlık asistanı)
    → Groq API (llama-3.3-70b-versatile)
    → { reply: string } döndür

## Tasarım Sistemi
- Background: #0a0a0a
- Surface: #1a1a1a
- Text: #ffffff
- Primary Blue: #1a6ef5
- Error: #ff4444
- Dark tema zorunlu, Türkçe UI
- Font: Inter / system-ui

## RLS Politikaları
- profiles: kullanıcı sadece kendi profilini görür
- user_conditions: kullanıcı sadece kendi hastalıklarını görür
- user_medications: kullanıcı sadece kendi ilaçlarını görür
- medications: herkese açık (SELECT)
- conditions_catalog: herkese açık (SELECT)
- condition_medications: herkese açık (SELECT)

## KÜB+KT Pipeline
scripts/kub_endikasyon_cikarici.py:
- TİTCK'tan KÜB ve KT PDF'lerini indirir
- KÜB: "4.1 Terapötik Endikasyonlar" bölümü
- KT: "Ne için kullanılır" bölümü
- Türkiye ilaç verisini condition_medications tablosuna upsert eder
- REPROCESS_ALL=1 ile tüm ilaçları yeniden işler

## Kodlama Kuralları
- TypeScript zorunlu, any yasak
- Türkçe UI metinleri
- Supabase sorgularında RLS'e dikkat et
- Sağlık verisi hassastır, güvenlik öncelikli
- Component'lar küçük, tek sorumluluk prensibi
- Her input için validasyon ekle
- Boy: 50-250cm, Kilo: 10-300kg sınırları
- BMI orantısız girişlerde uyarı ver

## Önemli Notlar
- API key'ler asla client'ta olmamalı (Edge Function kullan)
- user_medications.is_active: false = ilaç bırakıldı (silinmez)
- onboarding_completed: true olana kadar kullanıcı MainTabs'a giremez
- Acil anahtar kelimeler ChatScreen'de hardcoded (ACIL_KELIMELER array)
- Groq API key Supabase secret olarak saklanır (GROQ_API_KEY)

## Supabase Proje Bilgisi
Project ref: jabggkqjiwctwdbiipho
URL: https://jabggkqjiwctwdbiipho.supabase.co

## GitHub
https://github.com/serhatgndgd/BiTani
