"""
BiTanı veritabanı denetimi — SADECE OKUMA.

Hedef: medicationsV2 + medication_kub + medication_kt üçlüsünün
sağlığını, birbirine bağlılığını ve parse kalitesini değerlendirmek.

KESİN KURAL: yalnızca SELECT (ve HEAD count). Hiçbir DROP/DELETE/ALTER/UPDATE/INSERT yok.

Strateji: büyük text kolonlarını sayfa-sayfa indirmek statement-timeout veriyordu.
Bu sürüm: NULL/dolu sayımları için per-column COUNT sorguları kullanır,
parse kalitesi için ILIKE/MATCH üzerinden COUNT yapar, ve sadece gerekli
küçük kolonlu pagination uygular.
"""
from __future__ import annotations

import os
import warnings
from collections import defaultdict
from typing import Optional

warnings.filterwarnings("ignore")

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

PAGE = 1000


def header(title: str) -> None:
    print("\n" + "=" * 72)
    print(title)
    print("=" * 72)


def count_total(table: str) -> int:
    return sb.table(table).select("id", count="exact", head=True).execute().count or 0


def count_non_null(table: str, col: str) -> int:
    # PostgREST: NOT NULL = .not_.is_("col","null") veya .neq("col", None) yerine
    # null sayıp toplamdan çıkarmak en güvenli yöntem.
    null_cnt = sb.table(table).select("id", count="exact", head=True).is_(col, "null").execute().count or 0
    return null_cnt


def count_ilike(table: str, col: str, pat: str) -> int:
    try:
        return sb.table(table).select("id", count="exact", head=True).ilike(col, pat).execute().count or 0
    except Exception:
        return -1  # genellikle statement timeout


def count_match(table: str, col: str, regex: str) -> int:
    # PostgREST 'match' operator → POSIX regex
    try:
        return sb.table(table).select("id", count="exact", head=True).filter(col, "match", regex).execute().count or 0
    except Exception:
        return -1


def safe_count(table: str) -> Optional[int]:
    try:
        return sb.table(table).select("*", count="exact", head=True).execute().count or 0
    except Exception:
        return None


# ─────────────────────────────────────────────────────────────────────
# 1) HEDEF 3 TABLO ŞEMASI
# ─────────────────────────────────────────────────────────────────────
header("1. HEDEF 3 TABLONUN ŞEMASI")
schemas: dict[str, list[str]] = {}
for t in ("medicationsV2", "medication_kub", "medication_kt"):
    # raw_text'i çekmemek için bilinen kolon listesini alalım — küçük bir id satırı yeter
    sample = sb.table(t).select("*").limit(1).execute().data
    cols = list(sample[0].keys()) if sample else []
    schemas[t] = cols
    print(f"\n• {t}  ({len(cols)} kolon)")
    for c in cols:
        print(f"    - {c}")


# ─────────────────────────────────────────────────────────────────────
# 2) KAYIT SAYISI + BÖLÜM NULL %
# ─────────────────────────────────────────────────────────────────────
header("2. KAYIT SAYISI + BÖLÜM DOLULUK ORANI")
n_med = count_total("medicationsV2")
n_kub = count_total("medication_kub")
n_kt = count_total("medication_kt")
print(f"\nmedicationsV2 toplam ilaç     : {n_med:>6,}")
print(f"medication_kub toplam kayıt   : {n_kub:>6,}")
print(f"medication_kt  toplam kayıt   : {n_kt:>6,}")


def report_fill(table: str, total: int, ignore: set[str]) -> dict[str, int]:
    cols = [c for c in schemas[table] if c not in ignore]
    print(f"\n▸ {table} – bölüm doluluk (DOLU sayısı / toplam)")
    fill: dict[str, int] = {}
    for c in cols:
        nulls = count_non_null(table, c)  # ← aslında NULL sayar
        filled = total - nulls
        fill[c] = filled
        pct = 100 * filled / total if total else 0
        bar = "█" * int(pct / 5)
        warn = ""
        # meta kolonlar için uyarı gösterme
        meta = {"id", "medication_id", "parsed_at", "created_at", "source_url"}
        if c not in meta and pct < 60:
            warn = " ⚠️"
        print(f"    {c:30s}  {filled:>6,} / {total:<6,}  {pct:5.1f}%  {bar}{warn}")
    return fill


report_fill("medicationsV2", n_med, set())
kub_fill = report_fill("medication_kub", n_kub, set())
kt_fill = report_fill("medication_kt", n_kt, set())


# ─────────────────────────────────────────────────────────────────────
# 3) İLİŞKİSEL BÜTÜNLÜK
# ─────────────────────────────────────────────────────────────────────
header("3. medicationsV2 ↔ medication_kub / medication_kt İLİŞKİSİ")


def paginate_ids(table: str, col: str = "id") -> list[str]:
    out: list[str] = []
    offset = 0
    while True:
        batch = sb.table(table).select(col).range(offset, offset + PAGE - 1).execute().data or []
        for r in batch:
            v = r.get(col)
            if v is not None:
                out.append(v)
        if len(batch) < PAGE:
            break
        offset += PAGE
    return out


print("\n· medicationsV2.id çekiliyor…")
med_ids_list = paginate_ids("medicationsV2", "id")
med_ids = set(med_ids_list)
print(f"  toplam: {len(med_ids):,}")

print("· medication_kub.medication_id çekiliyor…")
kub_med_ids = paginate_ids("medication_kub", "medication_id")
print(f"  toplam: {len(kub_med_ids):,}")

print("· medication_kt.medication_id çekiliyor…")
kt_med_ids = paginate_ids("medication_kt", "medication_id")
print(f"  toplam: {len(kt_med_ids):,}")

kub_set = set(kub_med_ids)
kt_set = set(kt_med_ids)

kub_null_fk = n_kub - len(kub_med_ids)
kt_null_fk = n_kt - len(kt_med_ids)
kub_orphans = kub_set - med_ids
kt_orphans = kt_set - med_ids
med_without_kub = med_ids - kub_set
med_without_kt = med_ids - kt_set
med_without_both = med_without_kub & med_without_kt


def dup_count(lst: list[str]) -> int:
    seen: dict[str, int] = defaultdict(int)
    for x in lst:
        seen[x] += 1
    return sum(1 for v in seen.values() if v > 1)


print("\n— Foreign-key bütünlüğü —")
print(f"  kub  ▶ NULL medication_id            : {kub_null_fk}")
print(f"  kub  ▶ medicationsV2'de YOK (orphan) : {len(kub_orphans)}")
print(f"  kt   ▶ NULL medication_id            : {kt_null_fk}")
print(f"  kt   ▶ medicationsV2'de YOK (orphan) : {len(kt_orphans)}")

print("\n— Kapsama —")
print(f"  medicationsV2 toplam ilaç            : {len(med_ids):,}")
print(f"  KÜB'ü olan ilaç                      : {len(med_ids & kub_set):,}  ({100*len(med_ids&kub_set)/max(len(med_ids),1):.1f}%)")
print(f"  KT'si olan ilaç                      : {len(med_ids & kt_set):,}  ({100*len(med_ids&kt_set)/max(len(med_ids),1):.1f}%)")
print(f"  KÜB'ü OLMAYAN ilaç                   : {len(med_without_kub):,}")
print(f"  KT'si OLMAYAN ilaç                   : {len(med_without_kt):,}")
print(f"  Ne KÜB ne KT bulunan ilaç            : {len(med_without_both):,}")

print(f"\n  kub'da medication_id duplikasyonu olan ilaç sayısı : {dup_count(kub_med_ids)}")
print(f"  kt'de  medication_id duplikasyonu olan ilaç sayısı : {dup_count(kt_med_ids)}")


# ─────────────────────────────────────────────────────────────────────
# 4) KULLANICI TABLOLARI HANGİ İLAÇ TABLOSUNA BAĞLI?
# ─────────────────────────────────────────────────────────────────────
header("4. KULLANICI TABLOLARI vs İLAÇ TABLOSU BAĞLANTISI")

# Boş tablolar PostgREST üzerinden kolon adı vermez → information_schema'dan çekmemiz lazım,
# ama RPC tanımlı değil. Bunun yerine 'columns' header'ı yoluyla deneyelim.
def list_columns(table: str) -> list[str]:
    try:
        r = sb.table(table).select("*").limit(1).execute()
        if r.data:
            return list(r.data[0].keys())
    except Exception:
        pass
    return []


for t in ("user_medications", "user_conditions", "condition_medications", "profiles"):
    cnt = safe_count(t)
    cols = list_columns(t)
    print(f"\n• {t}  (kayıt={cnt})")
    if cols:
        for c in cols:
            print(f"    - {c}")
    else:
        print("    (kayıt yok — PostgREST kolon listesini döndürmüyor)")


# ─────────────────────────────────────────────────────────────────────
# 5) PARSE KALİTESİ (kolon-başına COUNT, hızlı)
# ─────────────────────────────────────────────────────────────────────
header("5. PARSE KALİTESİ (medication_kub + medication_kt)")

# 5a) Yanlış bölüme yazılmış içerik (ilike count)
wrong_kontra_in_ti = count_ilike("medication_kub", "therapeutic_indications", "%kontrendike%")
wrong_indi_in_contra = count_ilike("medication_kub", "contraindications", "%endikasyon%")
wrong_gebelik_in_inter = count_ilike("medication_kub", "drug_interactions", "%gebelik%")

def fmt(n: int) -> str:
    return "TIMEOUT" if n < 0 else str(n)

print(f"\n  'kontrendike' kelimesi therapeutic_indications'ta : {fmt(wrong_kontra_in_ti)}")
print(f"  'endikasyon'  kelimesi contraindications'ta       : {fmt(wrong_indi_in_contra)}")
print(f"  'gebelik'     kelimesi drug_interactions'ta       : {fmt(wrong_gebelik_in_inter)}")

# 5b) Başlık numarası sızıntısı (her bölümün başında "4.x" veya "5.x"...)
print("\n— Başlık numarası sızıntısı (regex: bölümün başında '\\d+\\.\\d+') —")
KUB_SECTIONS = [
    "therapeutic_indications","contraindications","drug_interactions",
    "special_warnings","side_effects","pregnancy_and_lactation","overdose",
    "dosage_and_administration","pharmacodynamic_properties","pharmacokinetic_properties",
    "composition","pharmaceutical_form","shelf_life","storage_conditions",
]
total_leak = 0
leak_timeouts: list[str] = []
for c in KUB_SECTIONS:
    n = count_match("medication_kub", c, r"^\s*\d+\.\d+")
    if n < 0:
        leak_timeouts.append(c)
        print(f"    kub.{c:30s}  TIMEOUT")
    elif n > 0:
        total_leak += n
        print(f"    kub.{c:30s}  {n}")
print(f"  TOPLAM kub bölüm-başı numara sızıntısı: {total_leak}" + (f"  (timeout: {leak_timeouts})" if leak_timeouts else ""))

KT_SECTIONS = [
    "what_is_it","before_using","do_not_use","use_carefully","food_and_drink",
    "pregnancy","breastfeeding","driving_and_machine_use","important_excipients",
    "drug_interactions","how_to_use","possible_side_effects","storage_information",
    "health_personnel_info",
]
total_leak_kt = 0
kt_leak_timeouts: list[str] = []
for c in KT_SECTIONS:
    n = count_match("medication_kt", c, r"^\s*\d+\.\d+")
    if n < 0:
        kt_leak_timeouts.append(c)
        print(f"    kt.{c:30s}  TIMEOUT")
    elif n > 0:
        total_leak_kt += n
        print(f"    kt.{c:30s}  {n}")
print(f"  TOPLAM kt bölüm-başı numara sızıntısı: {total_leak_kt}" + (f"  (timeout: {kt_leak_timeouts})" if kt_leak_timeouts else ""))

# 5c) Çok kısa therapeutic_indications (sayfa-sayfa, sadece o kolon)
print("\n— therapeutic_indications < 50 karakter —")
short_ti = 0
short_examples: list[str] = []
offset = 0
while True:
    batch = sb.table("medication_kub").select("id,therapeutic_indications").range(offset, offset + PAGE - 1).execute().data or []
    for r in batch:
        ti = (r.get("therapeutic_indications") or "").strip()
        if ti and len(ti) < 50:
            short_ti += 1
            if len(short_examples) < 5:
                short_examples.append(f"{r['id']} :: {ti!r}")
    if len(batch) < PAGE:
        break
    offset += PAGE
print(f"  Toplam: {short_ti}")
for ex in short_examples:
    print(f"    · {ex}")


# ─────────────────────────────────────────────────────────────────────
# 6) SPESİFİK İLAÇ DOĞRULAMA
# ─────────────────────────────────────────────────────────────────────
header("6. SPESİFİK İLAÇ DOĞRULAMA")

probes = ["ASPIRIN", "PARACETAMOL", "VENTOLIN", "GLUKOFEN", "COUMADIN", "PLAVIX"]
for name in probes:
    res = sb.table("medicationsV2").select("id,ilac_adi,etkin_madde_adi").ilike("ilac_adi", f"%{name}%").limit(2).execute().data or []
    if not res:
        print(f"\n· {name:12s} ❌ medicationsV2'de bulunamadı")
        continue
    print(f"\n· {name:12s} ✅ örnek {len(res)} kayıt")
    for r in res:
        print(f"    {r['ilac_adi']}  (etkin: {r['etkin_madde_adi']})")
        kub = sb.table("medication_kub").select("therapeutic_indications,contraindications").eq("medication_id", r["id"]).limit(1).execute().data
        if kub:
            ti = (kub[0].get("therapeutic_indications") or "—")[:180].replace("\n", " ")
            ct = (kub[0].get("contraindications") or "—")[:180].replace("\n", " ")
            print(f"      KÜB endikasyon : {ti}")
            print(f"      KÜB kontrendi. : {ct}")
        else:
            print(f"      ⚠️  KÜB kaydı yok")


# ─────────────────────────────────────────────────────────────────────
# 7) STORAGE / FILE_PATH KOLONU
# ─────────────────────────────────────────────────────────────────────
header("7. STORAGE / DOSYA KOLONU KONTROLÜ")
for t in ("medicationsV2", "medication_kub", "medication_kt"):
    file_cols = [c for c in schemas[t] if any(k in c.lower() for k in ("path", "file", "storage", "bucket"))]
    url_cols = [c for c in schemas[t] if "url" in c.lower()]
    print(f"  {t:18s}  file/path benzeri kolon: {file_cols or '—'}  | url kolonu: {url_cols or '—'}")


# ─────────────────────────────────────────────────────────────────────
# 8) DİĞER TABLOLAR ENVANTERİ (silinmeyecek)
# ─────────────────────────────────────────────────────────────────────
header("8. DİĞER TABLOLAR ENVANTERİ (READ-ONLY)")
others = [
    "chat_history", "consent_records", "profiles", "user_conditions", "user_medications",
    "condition_medications", "conditions_catalog",
    "drug_brands", "drug_variants", "drug_documents", "drug_document_sections",
    "medications",
]
for t in others:
    c = safe_count(t)
    if c is None:
        print(f"  {t:30s}  ❌ tablo erişilemiyor")
    else:
        flag = " (BOŞ)" if c == 0 else ""
        print(f"  {t:30s}  {c:>6,} kayıt{flag}")


# ─────────────────────────────────────────────────────────────────────
# ÖZET
# ─────────────────────────────────────────────────────────────────────
header("ÖZET DEĞERLENDİRME")


def grade(name: str, n: int, problems: list[str]) -> str:
    if not problems:
        return f"🟢 {name}: SAĞLIKLI ({n:,} kayıt)"
    if len(problems) <= 2:
        return f"🟡 {name} ({n:,} kayıt) — " + "; ".join(problems)
    return f"🔴 {name} ({n:,} kayıt) — " + "; ".join(problems)


p_med, p_kub, p_kt = [], [], []

if len(med_without_kub) > n_med * 0.05:
    p_med.append(f"KÜB'ü olmayan ilaç fazla ({len(med_without_kub)})")
if len(med_without_kt) > n_med * 0.05:
    p_med.append(f"KT'si olmayan ilaç fazla ({len(med_without_kt)})")
if kub_orphans:
    p_kub.append(f"orphan kub kaydı: {len(kub_orphans)}")
if dup_count(kub_med_ids) > 0:
    p_kub.append(f"kub.medication_id duplikasyonu: {dup_count(kub_med_ids)}")
if short_ti > 50:
    p_kub.append(f"kısa indications (<50ch): {short_ti}")
if wrong_kontra_in_ti > 0:
    p_kub.append(f"indications içinde 'kontrendike': {wrong_kontra_in_ti}")
if wrong_indi_in_contra > 0:
    p_kub.append(f"contraindications içinde 'endikasyon': {wrong_indi_in_contra}")
if total_leak > 0:
    p_kub.append(f"başlık numarası sızıntısı: {total_leak}")
if kt_orphans:
    p_kt.append(f"orphan kt kaydı: {len(kt_orphans)}")
if total_leak_kt > 0:
    p_kt.append(f"kt başlık numarası sızıntısı: {total_leak_kt}")

print(grade("medicationsV2", n_med, p_med))
print(grade("medication_kub", n_kub, p_kub))
print(grade("medication_kt", n_kt, p_kt))

print("\n— Bütünlük —")
print(f"  medicationsV2 ↔ medication_kub : orphan={len(kub_orphans)}, kapsama={100*len(med_ids&kub_set)/max(len(med_ids),1):.1f}%")
print(f"  medicationsV2 ↔ medication_kt  : orphan={len(kt_orphans)},  kapsama={100*len(med_ids&kt_set)/max(len(med_ids),1):.1f}%")

print("\nNot: tüm sorgular SELECT/HEAD'tir. Hiçbir veri değiştirilmemiştir.")
