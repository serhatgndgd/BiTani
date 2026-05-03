# BiTanı - AI Sağlık Asistanı

## Proje Özeti
Türkçe, koyu temalı Expo (React Native) mobil sağlık uygulaması.
Ana kod: apps/mobile/

## Tech Stack
- Expo SDK 54, React Native 0.81, React 19
- Supabase (auth, Postgres, RLS)
- TypeScript — any kullanma
- React Navigation v7

## Klasör Yapısı
- apps/mobile/screens/ → Ekranlar
- apps/mobile/lib/supabase.ts → Supabase client
- apps/mobile/context/ → Context providers
- supabase/migrations/ → DB migration'ları

## Veritabanı Tabloları
- profiles → id, full_name, birth_date, gender, height_cm, weight_kg, onboarding_completed
- medications → id, ilac_adi, etkin_madde_adi, firma_adi, kub_url, kt_url (25.572 kayıt)
- conditions_catalog → id, name, category (24 kayıt)
- user_conditions → user_id, condition_id
- user_medications → user_id, medication_id, dosage, is_active
- condition_medications → condition_id, medication_id

## Auth Akışı
Session yok → WelcomeScreen
Session var + onboarding_completed false → OnboardingScreen
Session var + onboarding_completed true → MainTabs

## Tasarım
- Background: #0a0a0a
- Surface: #1a1a1a
- Text: #ffffff
- Hata: #ff4444
- Dark tema zorunlu, Türkçe UI

## Kodlama Kuralları
- Türkçe UI metinleri
- TypeScript zorunlu, any yasak
- Supabase sorgularında RLS'e dikkat et
- Sağlık verisi hassastır, güvenlik öncelikli
- Component'lar küçük, tek sorumluluk prensibi
- Her input için validasyon ekle
- Boy: 50-250cm, Kilo: 10-300kg sınırları

## Ortam Değişkenleri
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY
