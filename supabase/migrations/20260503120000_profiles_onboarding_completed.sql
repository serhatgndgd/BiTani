-- BiTanı: onboarding tamamlanınca ana uygulama; yeni kullanıcılar false ile başlar.
-- Supabase SQL Editor veya CLI ile çalıştırın.

alter table public.profiles
add column if not exists onboarding_completed boolean not null default false;

comment on column public.profiles.onboarding_completed is
  'Kullanıcı onboarding sihirbazını tamamladıysa true; yeni kayıt false.';

-- Daha önce profilini doldurmuş kullanıcılar tekrar onboarding görmesin (full_name kolonunuz yoksa bu bloğu silin).
update public.profiles
set onboarding_completed = true
where coalesce(btrim(full_name), '') <> '';
