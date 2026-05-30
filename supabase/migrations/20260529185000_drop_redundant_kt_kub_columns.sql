-- ============================================================
-- Drop redundant / valueless columns from medication_kt and
-- medication_kub.
--
-- Güvenli olduğu kanıtlanan 10 kolon:
--
--   medication_kt
--   ├─ drug_interactions  : KT formatında bu bölüm yok (5 bölümlü yapı).
--   │                       Kodda (chat/index.ts dahil) hiç kullanılmıyor.
--   │                       medication_kub.drug_interactions (%80.3) var.
--   └─ source_url         : medicationsV2.kt_url ile birebir aynı
--                           (5/5 örnekte byte-by-byte eşleşti).
--
--   medication_kub
--   ├─ product_name       : medicationsV2.ilac_adi ile aynı bilgi
--   │                       (büyük/küçük harf farkı var, semantik aynı).
--   ├─ source_url         : medicationsV2.kub_url ile birebir aynı
--   │                       (5/5 örnekte byte-by-byte eşleşti).
--   ├─ license_holder     : Ruhsat sahibi firma; chat asistanı için
--   │                       sıfır değer, hiçbir kod kullanmıyor.
--   ├─ pharmaceutical_form: "Film kaplı tablet" gibi form bilgisi;
--   │                       medicationsV2.ilac_adi zaten içeriyor.
--   ├─ shelf_life         : Ortalama 5 char ("24 ay").
--   │                       medication_kt.section_5_saklanmasi (~772 ch)
--   │                       çok daha kapsamlı ve kullanıcı dostu.
--   ├─ storage_conditions : Ortalama 71 char, teknik format.
--   │                       Aynı gerekçe, KT section_5 yeterli.
--   ├─ pharmacodynamic_   : Reseptör mekanizması, IC50/EC50 verisi.
--   │   properties          Hasta sorusu asla bu olmaz. LLM context'e
--   │                       girince token israfı (~1200 ch/ilaç × 15.503).
--   └─ pharmacokinetic_   : Yarı-ömür, biyoyararlanım, dağılım hacmi.
--       properties          Aynı gerekçe; klinisyen sorusu, chat dışı.
--
-- KAPSAM DIŞI (bu migration'a dahil edilmedi):
--   overdose, driving_and_machine_use, dosage_and_administration,
--   composition → medication_kub chat bağlantısı sonrası yeniden
--   değerlendirilecek.
--
-- Geri alma: Bu kolonlar raw_text'ten reparse edilebilir veya
--   medicationsV2'den JOIN ile alınabilir. Drop güvenlidir.
-- ============================================================

-- ── medication_kt ─────────────────────────────────────────────
ALTER TABLE medication_kt
  DROP COLUMN IF EXISTS drug_interactions,
  DROP COLUMN IF EXISTS source_url;

-- ── medication_kub ────────────────────────────────────────────
ALTER TABLE medication_kub
  DROP COLUMN IF EXISTS product_name,
  DROP COLUMN IF EXISTS source_url,
  DROP COLUMN IF EXISTS license_holder,
  DROP COLUMN IF EXISTS pharmaceutical_form,
  DROP COLUMN IF EXISTS shelf_life,
  DROP COLUMN IF EXISTS storage_conditions,
  DROP COLUMN IF EXISTS pharmacodynamic_properties,
  DROP COLUMN IF EXISTS pharmacokinetic_properties;
