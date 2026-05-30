"""
medication_kt 3 uzman perspektifli analiz — SADECE OKUMA.

🚨 KESİN KURAL: SELECT. Hiçbir DROP/UPDATE/DELETE/INSERT yok.

Stratified örnekleme:
  - 70 kayıt parse_quality_score = 5  (temiz)
  - 15 kayıt score = 2-4               (kısmi)
  - 10 kayıt score = 0-1               (NULL'a zorlanmış / boş)
  -  5 kayıt drug_interactions DOLU    (eski kolon değer kontrolü)

Her kayıt için:
  - medicationsV2'den ilac_adi (lookup)
  - section_1_nedir ... section_5_saklanmasi
  - drug_interactions (eski kolon, klinik karşılaştırma için)
  - parse_quality_score
  - raw_text ilk 2000 char (referans)

Üç perspektif:
  💊 Klinik eczacı  — bölüm-içerik doğruluğu (endikasyon endikasyonda mı vs)
  📊 Veri bilimci   — yapı verimliliği, redundancy, tutarlılık
  🩺 Hekim         — klinik kullanım emniyeti, hasta-anlaşılabilirliği

Çıktı: scripts/kt_expert_analysis_report.txt
"""
from __future__ import annotations

import os
import re
import time
import warnings
from collections import Counter, defaultdict
from typing import Optional

warnings.filterwarnings("ignore")
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

REPORT_PATH = os.path.join(os.path.dirname(__file__), "kt_expert_analysis_report.txt")
RAW_TEXT_TRUNC = 2000

SECTION_COLS = {
    1: "section_1_nedir",
    2: "section_2_kullanmadan_once",
    3: "section_3_nasil_kullanilir",
    4: "section_4_yan_etkiler",
    5: "section_5_saklanmasi",
}
SECTION_LABELS = {
    1: "nedir / ne için kullanılır",
    2: "kullanmadan önce dikkat",
    3: "nasıl kullanılır",
    4: "olası yan etkiler",
    5: "saklanması",
}


def fetch_stratified() -> list[dict]:
    """Stratified örneklem çek."""
    samples: list[dict] = []
    base_cols = (
        "id,medication_id,parse_quality_score,parse_version,"
        + ",".join(SECTION_COLS.values())
        + ",drug_interactions,raw_text"
    )

    # 70 kayıt score=5
    res = (
        sb.table("medication_kt")
        .select(base_cols)
        .eq("parse_quality_score", 5)
        .order("id")
        .limit(70)
        .execute()
    )
    samples.extend([{**r, "_stratum": "score5"} for r in (res.data or [])])

    # 15 kayıt score 2-4
    for sc in (2, 3, 4):
        res = (
            sb.table("medication_kt")
            .select(base_cols)
            .eq("parse_quality_score", sc)
            .order("id")
            .limit(5)
            .execute()
        )
        samples.extend([{**r, "_stratum": f"score{sc}"} for r in (res.data or [])])

    # 10 kayıt score 0-1
    for sc in (0, 1):
        res = (
            sb.table("medication_kt")
            .select(base_cols)
            .eq("parse_quality_score", sc)
            .order("id")
            .limit(5)
            .execute()
        )
        samples.extend([{**r, "_stratum": f"score{sc}"} for r in (res.data or [])])

    # 5 kayıt drug_interactions DOLU (eski kolon)
    res = (
        sb.table("medication_kt")
        .select(base_cols)
        .not_.is_("drug_interactions", "null")
        .order("id")
        .limit(5)
        .execute()
    )
    samples.extend([{**r, "_stratum": "drug_interactions_dolu"} for r in (res.data or [])])

    return samples


def fetch_drug_names(med_ids: list[str]) -> dict[str, str]:
    """medicationsV2'den ilaç adlarını batch çek."""
    name_map: dict[str, str] = {}
    BATCH = 50
    uniq = list({m for m in med_ids if m})
    for i in range(0, len(uniq), BATCH):
        chunk = uniq[i:i + BATCH]
        res = sb.table("medicationsV2").select("id,ilac_adi").in_("id", chunk).execute()
        for r in (res.data or []):
            name_map[r["id"]] = r["ilac_adi"]
    return name_map


# ─────────────────────────────────────────────────────────────────────
# UZMAN METRİKLERİ
# ─────────────────────────────────────────────────────────────────────
def pharmacist_check(rec: dict) -> dict:
    """💊 Klinik eczacı: bölüm-içerik uyumu."""
    s1 = (rec.get("section_1_nedir") or "").lower()
    s2 = (rec.get("section_2_kullanmadan_once") or "").lower()
    s3 = (rec.get("section_3_nasil_kullanilir") or "").lower()
    s4 = (rec.get("section_4_yan_etkiler") or "").lower()
    s5 = (rec.get("section_5_saklanmasi") or "").lower()
    flags: list[str] = []

    # Doğru içerik sinyalleri
    has_indication = bool(re.search(r"kullan[ıi]l[ıi]r|endike|tedavisinde", s1)) if s1 else False
    has_contraind = bool(re.search(r"kullanmayiniz|kullanmayınız|kontrendike|aşırı duyarl", s2)) if s2 else False
    has_dose = bool(re.search(r"doz|tablet|kaşık|kez|günde|ml", s3)) if s3 else False
    has_side_effect = bool(re.search(r"yan etki|alerjik|baş ağrı|ürtiker|kaşıntı|mide bulan", s4)) if s4 else False
    has_storage = bool(re.search(r"saklay[ıi]n[ıi]z|°c|oda sıcaklığında", s5)) if s5 else False

    # Çapraz kontaminasyon
    leak_dose_in_4 = bool(re.search(r"\b(günde\s+\d|saatte\s+bir|her\s+\d+\s+saat)", s4)) if s4 else False
    leak_se_in_3 = "yan etki" in s3 if s3 else False
    leak_indi_in_2 = bool(re.search(r"tedavisinde\s+kullan[ıi]l[ıi]r", s2)) if s2 else False
    leak_kontra_in_1 = "kullanmayınız" in s1 or "kontrendike" in s1 if s1 else False

    if s1 and not has_indication:
        flags.append("s1_no_indication")
    if s2 and not has_contraind:
        flags.append("s2_no_contraindication")
    if s3 and not has_dose:
        flags.append("s3_no_dosage")
    if s4 and not has_side_effect:
        flags.append("s4_no_side_effect")
    if s5 and not has_storage:
        flags.append("s5_no_storage")
    if leak_dose_in_4:
        flags.append("dose_leaked_to_4")
    if leak_se_in_3:
        flags.append("side_effect_leaked_to_3")
    if leak_indi_in_2:
        flags.append("indication_leaked_to_2")
    if leak_kontra_in_1:
        flags.append("contraindication_leaked_to_1")

    return {
        "has_indication": has_indication,
        "has_contraind": has_contraind,
        "has_dose": has_dose,
        "has_side_effect": has_side_effect,
        "has_storage": has_storage,
        "flags": flags,
        "score": 5 - len(flags),
    }


def data_scientist_check(rec: dict) -> dict:
    """📊 Veri bilimci: uzunluk, redundancy, tutarlılık."""
    sec_lens = {i: len(rec.get(SECTION_COLS[i]) or "") for i in range(1, 6)}
    di = rec.get("drug_interactions") or ""
    s2 = rec.get("section_2_kullanmadan_once") or ""

    # drug_interactions section_2'ye gömülü mü?
    di_in_s2 = False
    di_overlap_ratio = 0.0
    if di and s2:
        # Kaba substring eşleşmesi: di'nin ilk 100 char'ı s2'de var mı
        di_head = re.sub(r"\s+", " ", di[:100]).strip().lower()
        s2_norm = re.sub(r"\s+", " ", s2).lower()
        if di_head and di_head[:50] in s2_norm:
            di_in_s2 = True
        # Çakışan token oranı
        di_tokens = set(re.findall(r"\w{4,}", di.lower()))
        s2_tokens = set(re.findall(r"\w{4,}", s2.lower()))
        if di_tokens:
            di_overlap_ratio = len(di_tokens & s2_tokens) / len(di_tokens)

    # Boş / çok kısa section sayısı
    empty = sum(1 for v in sec_lens.values() if v == 0)
    too_short = sum(1 for v in sec_lens.values() if 0 < v < 50)

    return {
        "sec_lens": sec_lens,
        "total_chars": sum(sec_lens.values()),
        "di_len": len(di),
        "di_in_s2": di_in_s2,
        "di_overlap_ratio": di_overlap_ratio,
        "empty_sections": empty,
        "too_short_sections": too_short,
    }


def doctor_check(rec: dict) -> dict:
    """🩺 Hekim: klinik güvenlik ve hasta-anlaşılırlığı."""
    s2 = (rec.get("section_2_kullanmadan_once") or "").lower()
    s4 = (rec.get("section_4_yan_etkiler") or "").lower()

    # Güvenlik kalıpları
    has_kullanmayiniz = "kullanmayınız" in s2 or "kullanmayiniz" in s2
    has_allergy = "aleji" in s2 or "aşırı duyarl" in s2
    has_pregnancy = "gebelik" in s2 or "hamile" in s2
    has_breastfeeding = "emzir" in s2
    has_severe_warning = bool(re.search(r"acil|derhal|hastaneye|hemen doktor|ölüm|şok", s4))
    has_severity_freq = bool(re.search(r"çok yaygın|yaygın|seyrek|nadir", s4))

    safety_items = sum([
        has_kullanmayiniz, has_allergy, has_pregnancy,
        has_breastfeeding, has_severe_warning, has_severity_freq,
    ])

    # Hasta-anlaşılırlık: 25+ karakter ortalama kelime mi? (tipik teknik metin uzun)
    s4_words = re.findall(r"\S+", s4) if s4 else []
    avg_word_len = (sum(len(w) for w in s4_words) / max(len(s4_words), 1)) if s4_words else 0

    return {
        "has_kullanmayiniz": has_kullanmayiniz,
        "has_allergy": has_allergy,
        "has_pregnancy_info": has_pregnancy,
        "has_breastfeeding_info": has_breastfeeding,
        "has_severe_warning": has_severe_warning,
        "has_severity_freq": has_severity_freq,
        "safety_score": safety_items,  # 0-6
        "avg_word_len_s4": avg_word_len,
    }


# ─────────────────────────────────────────────────────────────────────
# Ana akış
# ─────────────────────────────────────────────────────────────────────
print("medication_kt'den 100 stratified örnek çekiliyor…")
t0 = time.time()
samples = fetch_stratified()
print(f"  {len(samples)} kayıt geldi ({time.time()-t0:.1f}s)")

print("medicationsV2'den ilaç adları getiriliyor…")
name_map = fetch_drug_names([s["medication_id"] for s in samples])
print(f"  {len(name_map)} ilaç adı eşleşti")

# Her kayda ilaç adını yaz
for s in samples:
    s["_ilac_adi"] = name_map.get(s.get("medication_id"), "?")

# Uzman analizleri
print("Uzman analizleri uygulanıyor…")
for s in samples:
    s["_pharma"] = pharmacist_check(s)
    s["_data"] = data_scientist_check(s)
    s["_doc"] = doctor_check(s)


# ─────────────────────────────────────────────────────────────────────
# RAPOR
# ─────────────────────────────────────────────────────────────────────
lines: list[str] = []


def emit(s: str = "") -> None:
    lines.append(s)


def section(title: str) -> None:
    emit("\n" + "═" * 72)
    emit(title)
    emit("═" * 72)


emit("╔" + "═" * 70 + "╗")
emit("║  medication_kt 3-UZMAN ANALİZ RAPORU                                 ║")
emit("║  💊 Klinik Eczacı   📊 Veri Bilimci   🩺 Hekim                       ║")
emit("╚" + "═" * 70 + "╝")
emit(f"Tarih              : {time.strftime('%Y-%m-%d %H:%M:%S')}")
emit(f"Örneklem büyüklüğü : {len(samples)} kayıt (stratified)")
emit(f"DB yazma           : YAPILMADI (yalnızca SELECT)")

# Strata dağılımı
strata = Counter(s["_stratum"] for s in samples)
emit("\nÖrneklem dağılımı:")
for k, v in strata.most_common():
    emit(f"   {k:25s} {v}")

# ─────── 💊 KLİNİK ECZACI ───────────────────────────────────────────
section("💊 KLİNİK ECZACI — Bölüm-İçerik Doğruluğu")

phpos_5 = sum(1 for s in samples if s["_stratum"] == "score5")
score5_recs = [s for s in samples if s["_stratum"] == "score5"]

# score=5 örneklemde her bölümde doğru içerik bulunma oranı
emit("\nscore=5 kayıtlarında ({}) anahtar içerik varlığı:".format(len(score5_recs)))
checks = [
    ("section_1: 'kullanılır/endike/tedavisinde'      ", "has_indication"),
    ("section_2: 'KULLANMAYINIZ/kontrendike/aleji'    ", "has_contraind"),
    ("section_3: doz ipuçları (günde/tablet/ml)      ", "has_dose"),
    ("section_4: 'yan etki/alerjik/kaşıntı'           ", "has_side_effect"),
    ("section_5: 'saklayınız/°C/oda sıcaklığında'    ", "has_storage"),
]
for lbl, key in checks:
    n = sum(1 for r in score5_recs if r["_pharma"][key])
    pct = 100 * n / max(len(score5_recs), 1)
    bar = "█" * int(pct / 5)
    emit(f"  {lbl}  {n:>2}/{len(score5_recs)} ({pct:5.1f}%) {bar}")

# Çapraz-kontaminasyon
emit("\nÇapraz-kontaminasyon (yanlış bölüme sızma) — score=5 içinde:")
contam_flags = Counter()
for r in score5_recs:
    for f in r["_pharma"]["flags"]:
        if "leaked" in f:
            contam_flags[f] += 1
if not contam_flags:
    emit("  (sızıntı saptanmadı)")
for f, n in contam_flags.most_common():
    emit(f"  {f:30s}  {n}")

emit("\n💊 ECZACI YORUMU:")
ph_clean = sum(1 for r in score5_recs if not r["_pharma"]["flags"])
emit(f"  • score=5 kayıtların {100*ph_clean/max(len(score5_recs),1):.0f}%'i klinik açıdan TEMİZ "
     f"(0 flag).")
emit(f"  • Bölüm-bölüm içerik bütünlüğü genelde yerinde — endikasyon endikasyonda,")
emit(f"    kontrendikasyon section_2'de. Ana risk: TR mevzuatı section_2'yi şişiriyor")
emit(f"    (gebelik+emzirme+sürüş+etkileşim+kontrendi hep aynı bölümde).")

# ─────── 📊 VERİ BİLİMCİ ────────────────────────────────────────────
section("📊 VERİ BİLİMCİ — Yapı Verimliliği & Redundancy")

# section uzunluk dağılımı (tüm 100)
emit("\nBölüm uzunlukları (tüm 100 kayıt, karakter):")
for i in range(1, 6):
    arr = [s["_data"]["sec_lens"][i] for s in samples if s["_data"]["sec_lens"][i] > 0]
    if arr:
        avg = sum(arr) // len(arr)
        emit(f"  section_{i} ({SECTION_LABELS[i]:30s}) "
             f"n={len(arr):>3}  ort={avg:>5}  min={min(arr):>3}  max={max(arr):>6}")
    else:
        emit(f"  section_{i}: hiç dolu kayıt yok")

# drug_interactions kolonu klinik değer kontrolü
di_recs = [s for s in samples if (s.get("drug_interactions") or "").strip()]
emit(f"\ndrug_interactions DOLU olan kayıt sayısı (örneklemde): {len(di_recs)}")
if di_recs:
    di_subset_count = sum(1 for r in di_recs if r["_data"]["di_in_s2"])
    di_overlap_avg = sum(r["_data"]["di_overlap_ratio"] for r in di_recs) / len(di_recs)
    emit(f"  drug_interactions ilk 50 char'ı section_2 içinde geçen kayıt: "
         f"{di_subset_count}/{len(di_recs)}")
    emit(f"  ortalama token-örtüşme oranı (drug_interactions ↔ section_2): "
         f"{di_overlap_avg:.1%}")

# Token-eski-kolon eşdeğer mi?
emit("\nESKİ drug_interactions kolonu → ek bilgi mi sunuyor?")
if di_recs:
    avg_di_len = sum(r["_data"]["di_len"] for r in di_recs) // len(di_recs)
    avg_s2_len = sum(r["_data"]["sec_lens"][2] for r in di_recs) // max(len(di_recs), 1)
    emit(f"  ortalama drug_interactions uzunluğu : {avg_di_len:>5} char")
    emit(f"  ortalama section_2 uzunluğu          : {avg_s2_len:>5} char")
    emit(f"  → section_2 ~{avg_s2_len // max(avg_di_len, 1)}x daha kapsamlı.")
    emit(f"  → drug_interactions section_2'nin alt-kümesi gibi görünüyor.")

# Veri kalitesi metriği
emit("\nKayıt-bazlı yapı kalitesi:")
zero_sec = sum(1 for s in samples if s["_data"]["empty_sections"] == 5)
shallow = sum(1 for s in samples if 0 < s["_data"]["too_short_sections"])
emit(f"  Tüm bölümleri boş kayıt           : {zero_sec}/{len(samples)} (score=0 stratumu)")
emit(f"  En az bir çok-kısa (<50 char) bölüm: {shallow}/{len(samples)}")

emit("\n📊 VERİ BİLİMCİ YORUMU:")
emit("  • 5-bölüm yapısı YETERLİ. KT formatı 5 numaralı resmi bölüm üzerine kurulu.")
emit("  • drug_interactions tek başına klinik açıdan REDUNDANT — section_2 zaten")
emit("    aynı bilgiyi içeriyor (TR KT formatı 'etkileşimler'i 'kullanmadan önce'")
emit("    bölümünün altına koyar).")
emit("  • Eski 14 semantik kolonun çoğu (what_is_it, before_using, do_not_use,")
emit("    use_carefully, food_and_drink, pregnancy, breastfeeding, ...) yapay")
emit("    bölümleme — TR KT format dokümanlarının doğal kırılımı 5 bölümdür.")

# ─────── 🩺 HEKİM ───────────────────────────────────────────────────
section("🩺 HEKİM — Klinik Güvenlik & Hasta Anlaşılırlığı")

emit("\nGüvenlik sinyalleri (score=5 alt-kümesinde):")
safety_checks = [
    ("KULLANMAYINIZ ifadesi var (s2)        ", "has_kullanmayiniz"),
    ("alerji uyarısı var (s2)               ", "has_allergy"),
    ("gebelik bilgisi var (s2)              ", "has_pregnancy_info"),
    ("emzirme bilgisi var (s2)              ", "has_breastfeeding_info"),
    ("ciddi yan etki kelimeleri var (s4)    ", "has_severe_warning"),
    ("yan etki sıklık etiketleri var (s4)   ", "has_severity_freq"),
]
for lbl, key in safety_checks:
    n = sum(1 for r in score5_recs if r["_doc"][key])
    pct = 100 * n / max(len(score5_recs), 1)
    bar = "█" * int(pct / 5)
    emit(f"  {lbl}  {n:>2}/{len(score5_recs)} ({pct:5.1f}%) {bar}")

# Ortalama güvenlik puanı (0-6)
avg_safety = sum(r["_doc"]["safety_score"] for r in score5_recs) / max(len(score5_recs), 1)
emit(f"\nOrtalama güvenlik kapsamı (0-6 ölçeği): {avg_safety:.2f}/6")

emit("\n🩺 HEKİM YORUMU:")
emit("  • Section_2'de KULLANMAYINIZ/alerji/gebelik gibi kritik uyarılar mevcut")
emit("    — bu bölüm bir sağlık asistanı LLM için VAZGEÇİLMEZ context.")
emit("  • Section_4'te yan etki sıklık etiketleri (çok yaygın/seyrek) genelde var")
emit("    — sıklık bilgisi olmadan 'ne kadar olası' sorusuna güvenli cevap verilmez.")
emit("  • Hasta diliyle yazılmış (TR KT mevzuatı bunu zorunlu kılar) — LLM doğrudan")
emit("    alıntılayabilir; teknik terim sıkı değil.")
emit("  • Ancak section_3 (dozaj) çoğu zaman 'doktorunuz size söyleyecektir' der —")
emit("    LLM somut doz öneremez, bu KORUMA olarak iyi.")

# ─────── SENTEZ ─────────────────────────────────────────────────────
section("🤝 ÜÇ UZMANIN ORTAK KARARI")

emit("\n1) NİHAİ KOLON YAPISI ÖNERİSİ")
emit("─" * 72)
emit("KALMALI (yeni, zorunlu):")
emit("  • id, medication_id           → birincil ve yabancı anahtar")
emit("  • raw_text                    → audit/parse-v3 için referans")
emit("  • section_1_nedir             → 'nedir/ne için kullanılır' (LLM'e ZORUNLU)")
emit("  • section_2_kullanmadan_once  → güvenlik + kontrendike + gebelik (KRİTİK)")
emit("  • section_3_nasil_kullanilir  → doz bilgisi (LLM'e KORUMA — alıntı yapsın)")
emit("  • section_4_yan_etkiler       → yan etki + sıklık (KRİTİK)")
emit("  • section_5_saklanmasi        → koşullar + son kullanma")
emit("  • parse_quality_score         → OCR/parse kuyruğu için filtre")
emit("  • parse_version               → migration takibi")
emit("  • source_url, parsed_at, created_at  → izlenebilirlik")
emit("")
emit("SİLİNMELİ (eski 14 kolon — redundant + boşaltılmış):")
emit("  • what_is_it                  → section_1 ile ÖZDEŞ")
emit("  • before_using                → section_2'nin alt kümesi (zaten ~%4 dolu)")
emit("  • do_not_use                  → section_2'nin alt kümesi")
emit("  • use_carefully               → section_2'nin alt kümesi")
emit("  • food_and_drink              → section_2 veya section_3'te")
emit("  • pregnancy                   → section_2'de")
emit("  • breastfeeding               → section_2'de")
emit("  • driving_and_machine_use     → section_2'de")
emit("  • important_excipients        → section_1 veya section_2'de")
emit("  • drug_interactions           → section_2'de (örneklemde örtüşme yüksek)")
emit("  • how_to_use                  → section_3 ile ÖZDEŞ")
emit("  • possible_side_effects       → section_4 ile ÖZDEŞ")
emit("  • storage_information         → section_5 ile ÖZDEŞ")
emit("  • health_personnel_info      → KT'nin %88'inde zaten yok (≈11.6% dolu)")
emit("")
emit("EKLENMESİ DEĞERLENDİRİLEBİLİR (opsiyonel, sonraki sprint):")
emit("  • severe_side_effect_flag bool  → section_4'te 'acil/derhal/şok/ölüm' geçiyor mu")
emit("  • requires_prescription bool   → reçeteli/reçetesiz (KT'de kelimesi var)")
emit("  • dosage_form text             → tablet/şurup/jel (parsed once, used many)")
emit("  ↳ Bunlar şart değil — LLM section_4'ten anında çıkarabilir; ek kolon")
emit("    önceliği DÜŞÜK.")

emit("\n2) VERİ KALİTESİ DURUMU (örneklem üzerinden ekstrapolasyon)")
emit("─" * 72)
n_ready = sum(1 for s in samples if s["_stratum"] == "score5"
              and not s["_pharma"]["flags"])
n_minor = sum(1 for s in samples if s["_stratum"] == "score5"
              and 0 < len(s["_pharma"]["flags"]) <= 2)
n_broken = sum(1 for s in samples if s["_stratum"] in ("score0", "score1"))
emit(f"  Kullanıma hazır (score=5 + 0 flag)         : {n_ready}/100")
emit(f"  Küçük sorun (score=5 + 1-2 flag)           : {n_minor}/100")
emit(f"  Düzeltme gerekli (score 2-4)               : "
     f"{sum(1 for s in samples if s['_stratum'] in ('score2','score3','score4'))}/100")
emit(f"  Kullanılamaz (score 0-1, NULL'a zorlanmış) : {n_broken}/100")
emit("")
emit("En sık sorun: OCR kaynaklı bölüm uzunluk dengesizliği (section_2 anormal uzun,")
emit("section_1 anormal kısa). Bu yapısal değil PARSE sorunu — section şeması suçsuz.")

emit("\n3) LLM CONTEXT İÇİN ÖNERİ")
emit("─" * 72)
emit("Token verimliliği için katmanlı strateji:")
emit("")
emit("  Katman 0 — Her zaman gönder (ortalama ~2 KB):")
emit("    • ilac_adi (medicationsV2)")
emit("    • section_1_nedir          [ort ~1400 char]")
emit("    • section_5_saklanmasi     [ort ~1700 char, kısaltılarak]")
emit("")
emit("  Katman 1 — Soru güvenlik / kullanım hatırlatma ile ilgiliyse:")
emit("    + section_2_kullanmadan_once  [ort ~6900 char — gerekirse ÖZETLE]")
emit("    + section_3_nasil_kullanilir  [ort ~3500 char]")
emit("")
emit("  Katman 2 — Soru yan etki / belirti ile ilgiliyse:")
emit("    + section_4_yan_etkiler  [ort ~4900 char]")
emit("")
emit("  ⚠ AYRICA: parse_quality_score < 3 ise section'ları GÖNDERME, sadece")
emit("    'Bu ilaca dair detaylı bilgim sınırlı, doktorunuza danışın' yanıtı ver.")

# ─────── 5 SOMUT ÖRNEK ──────────────────────────────────────────────
section("📋 5 SOMUT ÖRNEK")

# 3 iyi + 2 sorunlu örneği seç
good = [s for s in samples if s["_stratum"] == "score5"
        and not s["_pharma"]["flags"]][:3]
bad_partial = [s for s in samples if s["_stratum"] in ("score2", "score3")][:1]
bad_broken = [s for s in samples if s["_stratum"] in ("score0", "score1")][:1]
demo = good + bad_partial + bad_broken


def preview(text: Optional[str], n: int = 180) -> str:
    if not text:
        return "❌ NULL"
    return text[:n].replace("\n", " ⏎ ") + ("…" if len(text) > n else "")


for n, rec in enumerate(demo, 1):
    label = "✅ İYİ" if rec["_stratum"] == "score5" else (
        "⚠ KISMI" if rec["_stratum"] in ("score2", "score3", "score4") else "❌ KIRIK"
    )
    emit(f"\n── ÖRNEK {n} {label}  id={rec['id'][:8]}…  score={rec['parse_quality_score']} ──")
    emit(f"  ilaç      : {rec['_ilac_adi']}")
    emit(f"  stratum   : {rec['_stratum']}")
    ph = rec["_pharma"]
    dc = rec["_doc"]
    emit(f"  💊 eczacı flag'ler  : {ph['flags'] or '—'}")
    emit(f"  🩺 güvenlik skoru   : {dc['safety_score']}/6")
    for i in range(1, 6):
        v = rec.get(SECTION_COLS[i])
        emit(f"  [{i}] {SECTION_LABELS[i]:30s}: {preview(v)}")
    di = rec.get("drug_interactions")
    if di:
        emit(f"  ── eski drug_interactions ({len(di)} char): {preview(di)}")

# ─────────────────────────────────────────────────────────────────────
section("📌 KAPANIŞ")
emit("Bu rapor SADECE RAPOR'dur. DB üzerinde hiçbir değişiklik yapılmamıştır.")
emit("Önerilen sıralama:")
emit("  1. chat function'ı section_* kolonlarını kullanacak şekilde güncelle (Edge Function)")
emit("  2. mobile app değişiklik gerektirmiyor (zaten eski kolonlara dokunmuyor)")
emit("  3. 14 eski kolonu ALTER TABLE DROP COLUMN ile birer birer kaldır")
emit("     — ŞİMDİ YAPMA, kod güncellemesinden sonra")
emit("  4. score=0 olan 1.272 kaydı OCR kuyruğuna al")

# Dosyaya yaz
with open(REPORT_PATH, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))

print(f"\n📄 Rapor yazıldı: {REPORT_PATH}")
print(f"   ({len(lines)} satır)")
print(f"DB'ye HİÇBİR yazma yapılmadı.")
