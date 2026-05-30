"""
3 tablo karşılaştırmalı analizi — SADECE OKUMA, DB'ye hiçbir yazma yok.

Tablolar: medicationsV2, medication_kt, medication_kub
Perspektif: eczacı (klinik fayda) + doktor (güvenlik) + veri bilimci (teknik)
"""
from __future__ import annotations

import os
import re
import time
import warnings
from typing import Optional

warnings.filterwarnings("ignore")
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

OUTPUT = os.path.join(os.path.dirname(__file__), "three_table_analysis_report.txt")
lines_out: list[str] = []

def out(s: str = "") -> None:
    print(s)
    lines_out.append(s)

def fill_rate(table: str, col: str, total: int) -> float:
    try:
        r = sb.table(table).select("id", count="exact").not_.is_(col, "null").execute()
        return r.count / total * 100
    except Exception:
        return -1.0

def sample_vals(table: str, col: str, n: int = 3) -> list[str]:
    try:
        r = sb.table(table).select(col).not_.is_(col, "null").limit(n).execute()
        return [(row.get(col) or "")[:90].replace("\n"," ") for row in (r.data or [])]
    except Exception:
        return []

def avg_len(table: str, col: str, sample: int = 200) -> Optional[int]:
    try:
        r = sb.table(table).select(col).not_.is_(col, "null").limit(sample).execute()
        vals = [len(row.get(col) or "") for row in (r.data or []) if row.get(col)]
        return int(sum(vals) / len(vals)) if vals else None
    except Exception:
        return None

# ──────────────────────────────────────────────────────────────────────
t0 = time.time()
out("=" * 76)
out("3 TABLO ANALİZİ — medicationsV2 / medication_kt / medication_kub")
out("=" * 76)
out(f"Tarih: {time.strftime('%Y-%m-%d %H:%M:%S')}  |  SADECE OKUMA")
out()

# ── Satır sayıları ────────────────────────────────────────────────────
v2_total  = sb.table("medicationsV2").select("id", count="exact").execute().count
kt_total  = sb.table("medication_kt").select("id", count="exact").execute().count
kub_total = sb.table("medication_kub").select("id", count="exact").execute().count

out(f"Kayıt sayıları:")
out(f"  medicationsV2  : {v2_total:>6}")
out(f"  medication_kt  : {kt_total:>6}")
out(f"  medication_kub : {kub_total:>6}")

# Örtüşen medication_id sayıları
r_kt  = sb.table("medication_kt").select("medication_id").limit(10000).execute()
r_kub = sb.table("medication_kub").select("medication_id").limit(20000).execute()
r_v2  = sb.table("medicationsV2").select("id").limit(20000).execute()

kt_ids  = {r["medication_id"] for r in (r_kt.data  or [])}
kub_ids = {r["medication_id"] for r in (r_kub.data or [])}
v2_ids  = {r["id"]            for r in (r_v2.data  or [])}

out()
out(f"V2 ∩ KT  (aynı ilaçlar) : {len(v2_ids & kt_ids):>6}")
out(f"V2 ∩ KÜB (aynı ilaçlar) : {len(v2_ids & kub_ids):>6}")
out(f"KT ∩ KÜB (aynı ilaçlar) : {len(kt_ids & kub_ids):>6}")
out(f"V2 ∩ KT ∩ KÜB (üçü de)  : {len(v2_ids & kt_ids & kub_ids):>6}")

# ══════════════════════════════════════════════════════════════════════
out()
out("=" * 76)
out("BÖLÜM 1 — TÜM KOLONLAR + DOLULUK")
out("=" * 76)

# medicationsV2
out()
out("── medicationsV2 ──────────────────────────────────────────────────")
v2_sample = sb.table("medicationsV2").select("*").limit(1).execute()
v2_cols = list(v2_sample.data[0].keys()) if v2_sample.data else []
for c in v2_cols:
    fr = fill_rate("medicationsV2", c, v2_total)
    out(f"  {c:<35} {fr:5.1f}%")

# medication_kt
out()
out("── medication_kt ──────────────────────────────────────────────────")
kt_sample = sb.table("medication_kt").select("*").limit(1).execute()
kt_cols = list(kt_sample.data[0].keys()) if kt_sample.data else []
for c in kt_cols:
    fr = fill_rate("medication_kt", c, kt_total)
    out(f"  {c:<35} {fr:5.1f}%")

# medication_kub
out()
out("── medication_kub ─────────────────────────────────────────────────")
kub_sample = sb.table("medication_kub").select("*").limit(1).execute()
kub_cols = list(kub_sample.data[0].keys()) if kub_sample.data else []
for c in kub_cols:
    fr = fill_rate("medication_kub", c, kub_total)
    out(f"  {c:<35} {fr:5.1f}%")

# ══════════════════════════════════════════════════════════════════════
out()
out("=" * 76)
out("BÖLÜM 2 — V2 ↔ KT / KÜB ÖRTÜŞMESİ (içerik kalitesi karşılaştırması)")
out("=" * 76)

# 2a) source_url (KT) vs kt_url (V2)
out()
out("── 2a) KT.source_url vs V2.kt_url ────────────────────────────────")
kt_url_sample = sb.table("medication_kt").select("medication_id,source_url").limit(5).execute()
for row in (kt_url_sample.data or []):
    mid = row["medication_id"]
    kt_u = (row.get("source_url") or "")[:70]
    v2_r = sb.table("medicationsV2").select("kt_url").eq("id", mid).limit(1).execute()
    v2_u = ((v2_r.data or [{}])[0].get("kt_url") or "")[:70]
    match = "✅ AYNI" if kt_u == v2_u else ("⚠️ FARKLI" if kt_u and v2_u else "— biri boş")
    out(f"  mid={str(mid)[:8]}…  KT: {kt_u}")
    out(f"               V2: {v2_u}  → {match}")

# 2b) product_name (KÜB) vs ilac_adi (V2)
out()
out("── 2b) KÜB.product_name vs V2.ilac_adi ───────────────────────────")
kub_pn_sample = sb.table("medication_kub").select("medication_id,product_name").not_.is_("product_name","null").limit(5).execute()
for row in (kub_pn_sample.data or []):
    mid = row["medication_id"]
    kub_n = (row.get("product_name") or "")[:60]
    v2_r  = sb.table("medicationsV2").select("ilac_adi").eq("id", mid).limit(1).execute()
    v2_n  = ((v2_r.data or [{}])[0].get("ilac_adi") or "")[:60]
    same  = kub_n.strip().lower() == v2_n.strip().lower()
    mark  = "✅ AYNI" if same else "⚠️ FARKLI"
    out(f"  KÜB: '{kub_n}'")
    out(f"  V2 : '{v2_n}'  → {mark}")
    out()

# 2c) KÜB.source_url vs V2.kub_url
out()
out("── 2c) KÜB.source_url vs V2.kub_url ──────────────────────────────")
kub_url_sample = sb.table("medication_kub").select("medication_id,source_url").limit(5).execute()
same_url = diff_url = 0
for row in (kub_url_sample.data or []):
    mid   = row["medication_id"]
    kub_u = (row.get("source_url") or "")[:70]
    v2_r  = sb.table("medicationsV2").select("kub_url").eq("id", mid).limit(1).execute()
    v2_u  = ((v2_r.data or [{}])[0].get("kub_url") or "")[:70]
    match = kub_u == v2_u
    if match: same_url += 1
    else: diff_url += 1
    mark = "✅ AYNI" if match else "⚠️ FARKLI"
    out(f"  mid={str(mid)[:8]}…  {mark}")
    out(f"    KÜB: {kub_u}")
    out(f"    V2 : {v2_u}")
out(f"  Bu 5 örnekte: {same_url} aynı, {diff_url} farklı")

# ══════════════════════════════════════════════════════════════════════
out()
out("=" * 76)
out("BÖLÜM 3 — KT ↔ KÜB ÖRTÜŞMESİ (aynı ilaç, hangi kaynak daha iyi?)")
out("=" * 76)

OVERLAP_PAIRS = [
    ("KT section_5_saklanmasi",   "medication_kt",  "section_5_saklanmasi",
     "KÜB shelf_life",            "medication_kub", "shelf_life"),
    ("KT section_5_saklanmasi",   "medication_kt",  "section_5_saklanmasi",
     "KÜB storage_conditions",    "medication_kub", "storage_conditions"),
    ("KT section_3_nasil",        "medication_kt",  "section_3_nasil_kullanilir",
     "KÜB dosage_and_admin",      "medication_kub", "dosage_and_administration"),
    ("KT section_2_kullanmadan",  "medication_kt",  "section_2_kullanmadan_once",
     "KÜB special_warnings",      "medication_kub", "special_warnings"),
    ("KT section_2_kullanmadan",  "medication_kt",  "section_2_kullanmadan_once",
     "KÜB contraindications",     "medication_kub", "contraindications"),
]

SAMPLE_MIDS = list(kt_ids & kub_ids)[:3]

for (kt_label, kt_tbl, kt_col, kub_label, kub_tbl, kub_col) in OVERLAP_PAIRS:
    out()
    out(f"── {kt_label}  vs  {kub_label}")
    lens_kt  = []
    lens_kub = []
    for mid in SAMPLE_MIDS:
        r_kt_row  = sb.table(kt_tbl).select(kt_col).eq("medication_id", mid).limit(1).execute()
        r_kub_row = sb.table(kub_tbl).select(kub_col).eq("medication_id", mid).limit(1).execute()
        kt_val  = ((r_kt_row.data  or [{}])[0].get(kt_col)  or "").strip()
        kub_val = ((r_kub_row.data or [{}])[0].get(kub_col) or "").strip()
        if kt_val:  lens_kt.append(len(kt_val))
        if kub_val: lens_kub.append(len(kub_val))

    avg_kt  = int(sum(lens_kt)  / len(lens_kt))  if lens_kt  else 0
    avg_kub = int(sum(lens_kub) / len(lens_kub)) if lens_kub else 0
    out(f"  Ortalama uzunluk (3 örnek): KT={avg_kt} ch  |  KÜB={avg_kub} ch")

    # İlk eşleşen çift göster
    for mid in SAMPLE_MIDS[:1]:
        r_kt_row  = sb.table(kt_tbl).select(kt_col).eq("medication_id", mid).limit(1).execute()
        r_kub_row = sb.table(kub_tbl).select(kub_col).eq("medication_id", mid).limit(1).execute()
        kt_val  = ((r_kt_row.data  or [{}])[0].get(kt_col)  or "").strip()
        kub_val = ((r_kub_row.data or [{}])[0].get(kub_col) or "").strip()
        if kt_val or kub_val:
            out(f"  Örnek mid={str(mid)[:8]}…")
            out(f"    KT  ({len(kt_val)} ch): '{kt_val[:150].replace(chr(10),' ')}'")
            out(f"    KÜB ({len(kub_val)} ch): '{kub_val[:150].replace(chr(10),' ')}'")

# ══════════════════════════════════════════════════════════════════════
out()
out("=" * 76)
out("BÖLÜM 4 — CHAT İÇİN ANLAMSIZ KOLONLAR (3 uzman değerlendirmesi)")
out("=" * 76)

CHAT_USELESS = [
    ("medication_kub", "pharmacodynamic_properties",
     "Reseptör mekanizması, IC50, EC50 gibi farmakoloji teknik verisi. "
     "Hasta/kullanıcı sorusu hiçbir zaman 'bu ilacın farmakodinamiği nedir' olmaz."),
    ("medication_kub", "pharmacokinetic_properties",
     "Yarı-ömür, biyoyararlanım, dağılım hacmi. Klinisyen sorusu ama chat scope'u dışı. "
     "Yan etki/doz sorularında LLM context'e gürültü ekler."),
    ("medication_kub", "overdose",
     "Aşırı doz acil protokolü. Chat asistanı 112/acil yönlendirir, bu metni okumaz. "
     "Ayrıca ACIL_KELIMELER ile zaten yönlendiriliyor."),
    ("medication_kub", "driving_and_machine_use",
     "Araç/makine kullanımına etkisi. Faydalı ama çok nadir sorgulanır. "
     "special_warnings zaten içerebilir."),
    ("medication_kub", "pharmaceutical_form",
     "'Film kaplı tablet', 'enjeksiyonluk çözelti' gibi. "
     "medicationsV2.ilac_adi zaten içeriyor (XARELTO 20 mg film kaplı tablet)."),
    ("medication_kub", "license_holder",
     "Ruhsat sahibi firma adı. Kullanıcı/chat için hiçbir değeri yok."),
    ("medication_kub", "shelf_life",
     "KT section_5_saklanmasi zaten saklama bilgisini içeriyor ve daha kullanıcı odaklı dil."),
    ("medication_kub", "storage_conditions",
     "Aynı gerekçe. KT section_5 ile redundant, KÜB formatı teknik."),
    ("medication_kub", "product_name",
     "medicationsV2.ilac_adi ile redundant (5 örnekte aynı içerik)."),
    ("medication_kub", "source_url",
     "medicationsV2.kub_url ile redundant (5 örnekte aynı URL)."),
    ("medication_kt",  "drug_interactions",
     "KT formatında ilaç etkileşim bölümü yok (5 bölümlü yapı). "
     "Kodda kullanılmıyor. medication_kub.drug_interactions doldu (%80.3)."),
    ("medication_kt",  "source_url",
     "medicationsV2.kt_url ile redundant (5 örnekte aynı URL)."),
]

for tbl, col, reason in CHAT_USELESS:
    fr = fill_rate(tbl, col, kub_total if "kub" in tbl else kt_total)
    out(f"\n  [{tbl}.{col}]  doluluk={fr:.1f}%")
    out(f"    → {reason}")

# ══════════════════════════════════════════════════════════════════════
out()
out("=" * 76)
out("BÖLÜM 5 — 3 UZMAN ORTAK KARARI")
out("=" * 76)

out("""
┌─────────────────────────────────────────────────────────────────────┐
│ UZMAN 1 — ECZACI (klinik fayda, hasta güvenliği)                    │
├─────────────────────────────────────────────────────────────────────┤
│ Hasta bir ilaç sorduğunda gerçekten önemli olan bilgiler:           │
│   ✅ therapeutic_indications  — ne için kullanılır                  │
│   ✅ contraindications        — kimler kullanmamalı (güvenlik)      │
│   ✅ drug_interactions        — etkileşimler (polifarmasi riski)    │
│   ✅ side_effects             — yan etkiler                         │
│   ✅ special_warnings         — özel uyarılar (böbrek, karaciğer)  │
│   ✅ pregnancy_and_lactation  — gebelik/emzirme (kritik!)           │
│   ✅ KT section_1-5           — kullanıcı dili, doğrudan faydalı   │
│                                                                     │
│ Gereksiz (eczanede bile hasta sormuyor):                            │
│   ❌ pharmacodynamic/kinetic  — klinisyen sorusu, chat scope dışı  │
│   ❌ shelf_life / storage     — KT'de zaten var, daha iyi dil      │
│   ❌ license_holder           — hiç ilgisi yok                     │
│   ❌ overdose                 — 112 yönlendir, metin okuma          │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ UZMAN 2 — DOKTOR (klinik karar desteği, hata önleme)                │
├─────────────────────────────────────────────────────────────────────┤
│ Chat'te klinik hata yapılmaması için zorunlu:                       │
│   ✅ contraindications        — hata en çok buradan çıkar           │
│   ✅ drug_interactions        — polifarmasi hastası = kritik        │
│   ✅ special_warnings         — organ yetmezliği, yaş grupları      │
│   ✅ pregnancy_and_lactation  — teratojenite bilgisi                │
│                                                                     │
│ KT vs KÜB örtüşme görüşü:                                          │
│   • KT section_2 (kullanmadan önce): hasta dili, pratik            │
│   • KÜB contraindications: tıbbi/resmi, daha kapsamlı              │
│   → İKİSİ FARKLI katman. KT = kullanıcı, KÜB = klinik.             │
│   → KT section_2'yi KÜB contraindications yerine SAYMA.            │
│                                                                     │
│   • KT section_3 (nasıl kullanılır) vs KÜB dosage_and_admin:       │
│   → KÜB daha uzun ve teknik. KT daha sade.                         │
│   → Chat için KT yeterli. KÜB'ü context'e EKLEYEBİLİRSİN          │
│     ama öncelik KT.                                                 │
│                                                                     │
│   • KT section_5 (saklama) vs KÜB shelf_life/storage:              │
│   → KT yeterli, KÜB redundant.                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ UZMAN 3 — VERİ BİLİMCİ (storage, pipeline, LLM context)            │
├─────────────────────────────────────────────────────────────────────┤
│ Depolama / pipeline açısından:                                      │
│   • raw_text (%100 dolu): Reparse için zorunlu, TUTULMALI           │
│   • product_name = medicationsV2.ilac_adi → JOIN ile alınır, DROP  │
│   • source_url (KT+KÜB) = V2.kt_url / V2.kub_url → DROP           │
│                                                                     │
│ LLM context verimliliği:                                            │
│   • pharmacodynamic/kinetic: ortalama ~800-1500 char/kayıt         │
│     15.503 ilaç × ~1200 ch = 18 MB sadece bu iki kolon             │
│     → Hiç kullanılmayacak veri, context'e girince token israfı     │
│   • shelf_life + storage_conditions + license_holder: ~150 ch/kayıt│
│     Temiz drop, KT zaten kapsamakta                                 │
│                                                                     │
│ Drop riski sınıflandırması:                                         │
│   GÜVENLİ DROP (raw_text'ten reparse gerekmiyor):                  │
│     product_name, source_url (ikisi redundant, V2'de var)          │
│     license_holder, pharmaceutical_form (değersiz)                 │
│     shelf_life, storage_conditions (KT'de var)                     │
│     pharmacodynamic, pharmacokinetic (teknik, kimse okumaz)        │
│     KT.drug_interactions (kodda yok, KÜB'de var)                  │
│     KT.source_url (V2.kt_url ile aynı)                             │
│                                                                     │
│   RİSKLİ DROP (silince geri alınamaz, alternatif var):             │
│     overdose (acil bilgi, raw_text'ten reparse gerekir)            │
│     driving_and_machine_use (special_warnings'ta örtüşebilir)      │
│     composition (fill rate %79.6, kısmi doluluk)                   │
│     dosage_and_administration (KT ile örtüşüyor ama KÜB daha uzun) │
│                                                                     │
│   TUTULMALI (chat bağlantısı için değerli):                        │
│     therapeutic_indications, contraindications, drug_interactions  │
│     side_effects, special_warnings, pregnancy_and_lactation        │
│     KT section_1-5, parse_quality_score, raw_text                  │
└─────────────────────────────────────────────────────────────────────┘
""")

# ══════════════════════════════════════════════════════════════════════
out("=" * 76)
out("BÖLÜM 6 — NİHAİ TEMİZ YAPI ÖNERİSİ")
out("=" * 76)

out("""
────────────────────────────────────────
medicationsV2  (DEĞİŞMEZ — meta tablo)
────────────────────────────────────────
KAL (tümü):
  id, ilac_adi, etkin_madde_adi, firma_adi
  kub_onay_tarihi, kt_onay_tarihi
  kub_url, kt_url
  created_at

────────────────────────────────────────
medication_kt  (kullanıcı dili bölümler)
────────────────────────────────────────
KAL:
  id, medication_id
  section_1_nedir              ← ne için, ana endikasyon
  section_2_kullanmadan_once   ← hasta odaklı uyarı + kontrendikasyon özeti
  section_3_nasil_kullanilir   ← doz/kullanım (hasta dili)
  section_4_yan_etkiler        ← yan etkiler (hasta dili)
  section_5_saklanmasi         ← saklama
  parse_quality_score          ← LLM filtresi için zorunlu
  parse_version                ← pipeline takibi
  raw_text                     ← reparse pipeline için tut

DROP — GÜVENLİ:
  drug_interactions  ← kodda kullanılmıyor, KÜB'de var
  source_url         ← V2.kt_url ile AYNI

────────────────────────────────────────
medication_kub  (klinik/resmi bilgiler)
────────────────────────────────────────
KAL:
  id, medication_id
  therapeutic_indications      ← klinik endikasyon (KT'den daha kapsamlı)
  contraindications            ← klinik kontrendikasyon (KT'den daha kapsamlı)
  drug_interactions            ← etkileşimler (%80.3 dolu)
  side_effects                 ← yan etkiler klinik versiyon
  special_warnings             ← özel popülasyon, organ yetmezliği
  pregnancy_and_lactation      ← gebelik/emzirme (KT'de yok)
  raw_text                     ← reparse pipeline için tut

DROP — GÜVENLİ (redundant / değersiz):
  product_name           ← V2.ilac_adi ile AYNI
  source_url             ← V2.kub_url ile AYNI
  license_holder         ← hiçbir değer yok
  pharmaceutical_form    ← V2.ilac_adi zaten içeriyor
  shelf_life             ← KT section_5 var, daha iyi
  storage_conditions     ← aynı gerekçe
  pharmacodynamic_properties  ← teknik, chat scope dışı
  pharmacokinetic_properties  ← aynı gerekçe

DROP — RİSKLİ (şimdilik tut, sonra karar):
  overdose               ← acil bilgi, raw_text'ten reparse gerekir
  driving_and_machine_use← special_warnings'ta örtüşüyor olabilir
  dosage_and_administration ← KT ile örtüşüyor ama KÜB daha uzun
  composition            ← fill rate düşük, chat değeri belirsiz

────────────────────────────────────────
GÜVENLİ DROP ÖNERİSİ (12 kolon, 2 tablo)
────────────────────────────────────────
  ALTER TABLE medication_kt  DROP COLUMN drug_interactions;
  ALTER TABLE medication_kt  DROP COLUMN source_url;
  ALTER TABLE medication_kub DROP COLUMN product_name;
  ALTER TABLE medication_kub DROP COLUMN source_url;
  ALTER TABLE medication_kub DROP COLUMN license_holder;
  ALTER TABLE medication_kub DROP COLUMN pharmaceutical_form;
  ALTER TABLE medication_kub DROP COLUMN shelf_life;
  ALTER TABLE medication_kub DROP COLUMN storage_conditions;
  ALTER TABLE medication_kub DROP COLUMN pharmacodynamic_properties;
  ALTER TABLE medication_kub DROP COLUMN pharmacokinetic_properties;

  NOT: medication_kub.raw_text TUTULMALI (reparse pipeline için).
  NOT: medication_kub.overdose, driving_and_machine_use,
       dosage_and_administration, composition — chat bağlanınca karar.
""")

out("=" * 76)
out(f"Rapor tamamlandı  ({time.time()-t0:.1f}s)")
out("DB'ye HİÇBİR yazma yapılmadı.")
out("=" * 76)

with open(OUTPUT, "w", encoding="utf-8") as f:
    f.write("\n".join(lines_out) + "\n")
print(f"\nRapor: {OUTPUT}")
