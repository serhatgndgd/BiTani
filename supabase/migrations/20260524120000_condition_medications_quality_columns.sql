-- ============================================================
-- Migration: condition_medications kalite kolonları
-- Tarih: 2026-05-24
-- Amaç: confidence_score, is_contraindication, extraction_method,
--       evidence_snippet ekle + tabloyu temizle (pipeline yeniden çalışacak)
-- ============================================================

-- 1. Yeni kolonları ekle
ALTER TABLE condition_medications
  ADD COLUMN IF NOT EXISTS confidence_score    numeric(4,3)
    CHECK (confidence_score >= 0 AND confidence_score <= 1),
  ADD COLUMN IF NOT EXISTS is_contraindication boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS extraction_method   text
    CHECK (extraction_method IN ('keyword', 'embedding', 'llm', 'manual', 'hybrid')),
  ADD COLUMN IF NOT EXISTS evidence_snippet    text,
  ADD COLUMN IF NOT EXISTS annotation_version  text,
  ADD COLUMN IF NOT EXISTS source              text
    CHECK (source IN ('KUB_4_1', 'KT', 'KUB_4_1+KT', 'KUB_4_3'));

-- 2. İndeksler
CREATE INDEX IF NOT EXISTS idx_cm_confidence
  ON condition_medications (confidence_score DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_cm_contraindication
  ON condition_medications (is_contraindication);

CREATE INDEX IF NOT EXISTS idx_cm_method
  ON condition_medications (extraction_method);

-- Güvenli eşleşmeler için partial index (mobil query optimize)
CREATE INDEX IF NOT EXISTS idx_cm_safe_matches
  ON condition_medications (condition_id, medication_id)
  WHERE is_contraindication = false
    AND (confidence_score IS NULL OR confidence_score >= 0.60);

-- 3. Mevcut 57k satırı temizle
--    Pipeline yeni kolonlarla yeniden çalıştırılacak.
TRUNCATE TABLE condition_medications;

-- ============================================================
-- Sonraki adımlar:
-- 1. kub_sections tablosunu oluştur (ayrı migration)
-- 2. Pipeline'ı yeni kolonlarla çalıştır:
--    cd scripts && python kub_endikasyon_cikarici.py
-- ============================================================
