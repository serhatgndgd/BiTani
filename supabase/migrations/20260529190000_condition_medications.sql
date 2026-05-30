-- ============================================================
-- condition_medications — ilaç ↔ hastalık eşleştirme tablosu
--
-- Kaynak: TİTCK KÜB (medication_kub.therapeutic_indications) +
--         KT (medication_kt.section_1_nedir) endikasyon metinleri.
-- Eşleştirme: kural bazlı (conditions_catalog adı + sinonimler),
--             negasyon (kontrendike) filtreli, Türkçe-duyarlı.
-- Üretim: scripts/condition_matching_apply.py
--
-- NOT: medication_id, medicationsV2(id)'ye referans verir (eski
--      `medications` tablosu değil). conditions_catalog'a FK.
-- TİTCK verisi kamuya açık → anon/authenticated SELECT.
-- ============================================================

create table public.condition_medications (
  id              uuid primary key default gen_random_uuid(),
  condition_id    uuid not null references public.conditions_catalog(id) on delete cascade,
  medication_id   uuid not null references public."medicationsV2"(id)    on delete cascade,
  confidence_score numeric(3,2) not null,
  evidence        text,
  created_at      timestamptz default now(),
  unique(condition_id, medication_id)
);

create index idx_condmeds_condition  on public.condition_medications(condition_id);
create index idx_condmeds_medication on public.condition_medications(medication_id);
create index idx_condmeds_confidence on public.condition_medications(confidence_score);

-- RLS: anon/authenticated read (TİTCK kamuya açık veri)
alter table public.condition_medications enable row level security;

create policy "Public can read condition_medications"
  on public.condition_medications
  for select to anon, authenticated using (true);

grant select on public.condition_medications to anon, authenticated;
