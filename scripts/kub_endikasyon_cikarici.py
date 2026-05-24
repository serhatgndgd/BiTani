#!/usr/bin/env python3
"""
BiTanı — KÜB + KT Endikasyon Çıkarıcı  (v3.1.0)
═══════════════════════════════════════════════════

Pipeline:
  1. KÜB ve KT PDF'lerini async olarak indir
  2. KÜB'den bölümleri çıkar:
     - 4.1 Terapötik Endikasyonlar → is_contraindication = false
     - 4.3 Kontrendikasyonlar      → is_contraindication = true
  3. KT'den:
     - "Ne için kullanılır"        → is_contraindication = false
  4. Keyword matching ile hastalık eşleştir
  5. confidence_score + evidence_snippet hesapla
  6. condition_medications tablosuna upsert et

Çalıştırma:
  cd scripts
  python -m venv .venv && source .venv/bin/activate
  pip install -r requirements-kub.txt
  python kub_endikasyon_cikarici.py

Ortam değişkenleri (.env):
  SUPABASE_URL              — zorunlu
  SUPABASE_SERVICE_ROLE_KEY — zorunlu
  MAX_MEDICATIONS=N         — test için ilaç sınırı (varsayılan: tümü)
  REPROCESS_ALL=1           — daha önce işlenenleri de yeniden işle
  KUB_DEBUG=1               — bölüm bulunamazsa PDF önizleme yazdır
  CONCURRENT_DOWNLOADS=10   — eş zamanlı PDF indirme sayısı
"""

from __future__ import annotations

import asyncio
import math
import os
import re
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import aiohttp
from dotenv import load_dotenv
from pypdf import PdfReader
from supabase import create_client

# ── .env yükle ───────────────────────────────────────────────────────────────
load_dotenv(Path(__file__).resolve().parent / ".env")

PIPELINE_VERSION = "v3.1.0"


# ── Ortam değişkenleri ───────────────────────────────────────────────────────

def _env(key: str, default: str = "") -> str:
    v = os.environ.get(key, default)
    return v.strip().strip('"').strip("'")


SUPABASE_URL = _env("SUPABASE_URL").rstrip("/")
SUPABASE_KEY = _env("SUPABASE_SERVICE_ROLE_KEY")

_max_raw = _env("MAX_MEDICATIONS")
MAX_MEDICATIONS: int | None = int(_max_raw) if _max_raw.isdigit() else None
CONCURRENT_DOWNLOADS: int = int(_env("CONCURRENT_DOWNLOADS", "10"))
REPROCESS_ALL: bool = _env("REPROCESS_ALL", "0").lower() in ("1", "true", "yes")
DEBUG: bool = _env("KUB_DEBUG", "0").lower() in ("1", "true", "yes")

MEDICATIONS_PAGE = 500
DEBUG_PREVIEW_LEN = 600
MAX_SECTION_CHARS = 3000


# ── Doğrulama ────────────────────────────────────────────────────────────────

def _check_env() -> None:
    missing = []
    if not SUPABASE_URL:
        missing.append("SUPABASE_URL")
    if not SUPABASE_KEY or SUPABASE_KEY == "your_service_role_key_here":
        missing.append("SUPABASE_SERVICE_ROLE_KEY")
    if missing:
        sys.exit(f"❌ Eksik ortam değişkeni: {', '.join(missing)}\n   scripts/.env dosyasını düzenle.")


_check_env()
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


# ════════════════════════════════════════════════════════════════════════════
# Regex: KÜB bölüm başlıkları
# ════════════════════════════════════════════════════════════════════════════

_S41 = re.compile(r"4[\.\s]*1[\s\.]+(terapötik|terapotik|endikasyon)", re.I)
_S42 = re.compile(r"4[\.\s]*2[\s\.]+(pozoloji|doz)", re.I)
_S43 = re.compile(r"4[\.\s]*3[\s\.]+(kontr(?:a)?endikasyon|kontrendike)", re.I)
_S44 = re.compile(r"4[\.\s]*4[\s\.]+(özel|ozel|uyar)", re.I)
_S45 = re.compile(r"4[\.\s]*5[\s\.]+(diğer|diger|etkile)", re.I)
_KT_NE_ICIN = re.compile(r"ne(?:yin)?\s+için\s+kullan[ıi]l[ıi]r", re.I)
_BROSUR_FLAG = re.compile(r"kullanma\s+talimat[ıi]", re.I)


# ════════════════════════════════════════════════════════════════════════════
# Keyword matching
# ════════════════════════════════════════════════════════════════════════════

def text_for_match(s: str) -> str:
    """Türkçe uyumlu küçük harf normalize."""
    return s.replace("İ", "i").replace("I", "ı").lower()


_SUFFIXES_LONGEST_FIRST: tuple[str, ...] = (
    "lerinden", "larından", "lerimize", "larımıza",
    "larının", "lerinin", "larına", "lerine",
    "larında", "lerinde", "larıyla", "leriyle",
    "ımızda", "imizde", "lığında", "liğinde",
    "lığı", "liği", "luğu", "lüğü",
    "undaki", "ündeki", "larım", "lerim",
    "ınız", "iniz", "ımız", "imiz",
    "unun", "ünün", "ının", "inin",
    "nın", "nin", "nun", "nün",
    "ları", "leri", "sinde", "sında",
    "sine", "sına", "inden", "ından",
    "sı", "si", "su", "sü",
    "da", "de", "ta", "te",
    "dan", "den", "tan", "ten",
    "la", "le", "na", "ne", "ya", "ye",
    "ın", "in", "un", "ün",
    "a", "e", "ı", "i", "u", "ü",
)


def _strip_suffix(word: str, max_steps: int = 6) -> frozenset[str]:
    out: set[str] = {word}
    cur = word
    for _ in range(max_steps):
        nxt = cur
        for suf in _SUFFIXES_LONGEST_FIRST:
            if cur.endswith(suf) and len(cur) - len(suf) >= 4:
                nxt = cur[: -len(suf)]
                break
        if nxt == cur:
            break
        out.add(nxt)
        cur = nxt
    return frozenset(out)


_CATALOG_EXTRAS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("hepatit b",    ("hepatit b", "hbv", "hbsag", "kronik hepatit b")),
    ("hepatit c",    ("hepatit c", "hcv", "kronik hepatit c")),
    ("diyabet",      ("diabet", "tip 2", "tip 1", "tip ii", "tip i",
                      "şeker hastalığı", "glisemi", "hiperglisemi",
                      "hipoglisemi", "insülin", "insulin", "dm")),
    ("hipertansiyon",("yüksek tansiyon", "yüksek kan basıncı",
                      "arteriyel hipertansiyon", "hipertansif", "kan basıncı")),
    ("astım",        ("astim", "bronş", "bronşial", "bronsiyal", "öksürük")),
    ("depresyon",    ("depresif", "majör depresyon", "major depresyon", "antidepresan")),
    ("epilepsi",     ("nöbet", "konvülziyon", "antiepileptik")),
    ("migren",       ("migrain", "baş ağrısı", "hemikrania")),
    ("kalp yetmezliği", ("kalp yetmezligi", "kardiyak yetmezlik",
                          "konjestif", "hfref", "hfpef")),
    ("böbrek",       ("bobrek", "renal", "nefro", "kronik böbrek", "ckd")),
    ("kolesterol",   ("hiperkolesterolemi", "dislipidemi", "ldl", "hdl", "trigliserid")),
    ("enfeksiyon",   ("antibiyotik", "bakteri", "sepsis", "septisemi")),
    ("tüberküloz",   ("tuberkuloz", "tuberculosis", "tbc", "mikobakter")),
    ("hiv",          ("aids", "antiretrovir", "antiretroviral", "cd4")),
    ("aritmi",       ("çarpıntı", "taşikardi", "bradikardi", "fibrilasyon")),
    ("tiroid",       ("hipotiroidi", "hipertiroidi", "guatr", "hashimoto")),
    ("osteoporoz",   ("kemik erimesi", "kemik kırığı")),
    ("reflü",        ("gerd", "mide yanması", "özofajit")),
    ("anemi",        ("anemisi", "demir eksikliği", "sideropenik", "hemoglobin")),
    ("psoriasis",    ("sedef hastalığı", "plak psoriasis")),
    ("demans",       ("alzheimer", "bilişsel", "bunama")),
    ("pnömoni",      ("pneumonia", "akciğer enfeksiyonu", "zatürre")),
    ("alerji",       ("allergik", "anafilaksi", "urtiker", "kaşıntı")),
    ("obezite",      ("obez", "kilolu", "şişman", "bmi")),
)


def _keywords_for_condition(name: str) -> frozenset[str]:
    n = text_for_match(name.strip())
    terms: set[str] = {n}

    # Kelime parçaları
    for tok in re.split(r"[\s,;/\(\)\[\]]+", n):
        if len(tok) >= 4:
            terms.add(tok)

    # Catalog extras
    for sub, extras in _CATALOG_EXTRAS:
        if sub in n:
            terms.update(extras)

    return frozenset(t for t in terms if len(text_for_match(t)) >= 3)


def match_keywords(section_text: str, conditions: list[dict]) -> list[dict]:
    """Keyword matching → [{condition_id, confidence_score, evidence_snippet}]"""
    hay = text_for_match(section_text)
    section_len = max(len(section_text), 1)
    results: list[dict] = []

    for c in conditions:
        cid  = c.get("id")
        name = c.get("name") or ""
        if not cid or not name:
            continue

        hit_count = 0
        first_snippet = ""

        for kw in _keywords_for_condition(name):
            for variant in _strip_suffix(text_for_match(kw)):
                if len(variant) >= 3 and variant in hay:
                    hit_count += 1
                    if not first_snippet:
                        idx   = hay.find(variant)
                        start = max(0, idx - 40)
                        end   = min(len(section_text), idx + 80)
                        first_snippet = section_text[start:end].strip()
                    break  # bu kw için yeter

        if hit_count > 0:
            raw_score  = hit_count / (1 + math.log(section_len / 100 + 1))
            confidence = min(round(raw_score, 3), 1.0)
            results.append({
                "condition_id":    cid,
                "confidence_score": confidence,
                "evidence_snippet": first_snippet[:200],
            })

    return results


# ════════════════════════════════════════════════════════════════════════════
# PDF işleme (ProcessPoolExecutor — picklable)
# ════════════════════════════════════════════════════════════════════════════

def _parse_pdf_bytes(data: bytes) -> str:
    try:
        import io
        reader = PdfReader(io.BytesIO(data))
        return "".join(p.extract_text() or "" for p in reader.pages)
    except Exception:
        return ""


def _cut(text: str, start_re: re.Pattern, *end_res: re.Pattern) -> str | None:
    m = start_re.search(text)
    if not m:
        return None
    start = m.end()
    end = len(text)
    for er in end_res:
        em = er.search(text, start)
        if em and em.start() < end:
            end = em.start()
    section = text[start:end].strip()
    return section[:MAX_SECTION_CHARS] if section else None


def extract_sections(full_text: str) -> dict[str, str | None]:
    """KÜB → {4.1, 4.3} | KT broşürü → {KT}"""
    if _BROSUR_FLAG.search(full_text[:4000]):
        return {
            "KT":  _cut(full_text, _KT_NE_ICIN,
                        re.compile(r"kullanmadan önce|nasıl kullan", re.I)),
            "4.1": None,
            "4.3": None,
        }
    return {
        "4.1": _cut(full_text, _S41, _S42, _S43),
        "4.3": _cut(full_text, _S43, _S44, _S45),
        "KT":  None,
    }


# ════════════════════════════════════════════════════════════════════════════
# Veri erişim katmanı
# ════════════════════════════════════════════════════════════════════════════

def fetch_processed_ids() -> set[str]:
    ids: set[str] = set()
    offset = 0
    while True:
        rows = (
            supabase.table("condition_medications")
            .select("medication_id")
            .order("medication_id")
            .range(offset, offset + MEDICATIONS_PAGE - 1)
            .execute()
            .data or []
        )
        ids.update(r["medication_id"] for r in rows if r.get("medication_id"))
        if len(rows) < MEDICATIONS_PAGE:
            break
        offset += MEDICATIONS_PAGE
    return ids


def fetch_medications(skip_ids: set[str]) -> list[dict]:
    out: list[dict] = []
    offset = 0
    while True:
        rows = (
            supabase.table("medications")
            .select("id, ilac_adi, kub_url, kt_url")
            .or_("kub_url.not.is.null,kt_url.not.is.null")
            .order("id")
            .range(offset, offset + MEDICATIONS_PAGE - 1)
            .execute()
            .data or []
        )
        for med in rows:
            if med.get("id") not in skip_ids:
                out.append(med)
                if MAX_MEDICATIONS and len(out) >= MAX_MEDICATIONS:
                    return out
        if len(rows) < MEDICATIONS_PAGE:
            break
        offset += MEDICATIONS_PAGE
    return out


def fetch_conditions() -> list[dict]:
    return (
        supabase.table("conditions_catalog")
        .select("id, name, category")
        .execute()
        .data or []
    )


def upsert_matches(
    medication_id: str,
    matches: list[dict],
    source: str,
    is_contraindication: bool,
) -> int:
    if not matches:
        return 0
    rows = [
        {
            "medication_id":       medication_id,
            "condition_id":        m["condition_id"],
            "confidence_score":    m["confidence_score"],
            "is_contraindication": is_contraindication,
            "extraction_method":   "keyword",
            "evidence_snippet":    m.get("evidence_snippet", "")[:200],
            "source":              source,
            "annotation_version":  PIPELINE_VERSION,
        }
        for m in matches
    ]
    try:
        supabase.table("condition_medications").upsert(
            rows, on_conflict="medication_id,condition_id"
        ).execute()
        return len(rows)
    except Exception as e:
        print(f"    ❌ DB kayıt hatası: {e}")
        return 0


# ════════════════════════════════════════════════════════════════════════════
# Async PDF indirme
# ════════════════════════════════════════════════════════════════════════════

async def _download(
    session: aiohttp.ClientSession,
    sem: asyncio.Semaphore,
    url: str,
) -> bytes | None:
    headers = {"User-Agent": "Mozilla/5.0 BiTani/3.1"}
    for attempt in range(1, 4):
        async with sem:
            try:
                async with session.get(
                    url, headers=headers,
                    timeout=aiohttp.ClientTimeout(total=90)
                ) as r:
                    if r.status == 200:
                        return await r.read()
                    if r.status in (429, 503):
                        await asyncio.sleep(2 ** attempt)
                        continue
                    return None
            except Exception:
                if attempt == 3:
                    return None
                await asyncio.sleep(attempt)
    return None


async def download_pdfs(
    med: dict,
    session: aiohttp.ClientSession,
    sem: asyncio.Semaphore,
) -> dict[str, bytes | None]:
    tasks: dict[str, asyncio.Task] = {}
    if med.get("kub_url"):
        tasks["kub"] = asyncio.create_task(_download(session, sem, med["kub_url"]))
    if med.get("kt_url"):
        tasks["kt"]  = asyncio.create_task(_download(session, sem, med["kt_url"]))
    if not tasks:
        return {}
    results = await asyncio.gather(*tasks.values(), return_exceptions=True)
    return {
        key: (r if isinstance(r, (bytes, type(None))) else None)
        for key, r in zip(tasks.keys(), results)
    }


# ════════════════════════════════════════════════════════════════════════════
# Tek ilaç işleme
# ════════════════════════════════════════════════════════════════════════════

@dataclass
class MedStats:
    endikasyon: int = 0
    kontra:     int = 0
    errors:     int = 0


async def process_medication(
    med: dict,
    conditions: list[dict],
    session: aiohttp.ClientSession,
    dl_sem: asyncio.Semaphore,
    executor: ProcessPoolExecutor,
) -> MedStats:
    st   = MedStats()
    loop = asyncio.get_running_loop()
    name = (med.get("ilac_adi") or "")[:55]

    # 1. PDF indir
    pdfs = await download_pdfs(med, session, dl_sem)
    if not pdfs:
        print(f"  ⚠️  {name}: PDF yok")
        st.errors += 1
        return st

    # 2. Parse (CPU-bound)
    texts: dict[str, str] = {}
    parse_tasks = {
        key: loop.run_in_executor(executor, _parse_pdf_bytes, data)
        for key, data in pdfs.items() if data
    }
    parsed = await asyncio.gather(*parse_tasks.values(), return_exceptions=True)
    for key, result in zip(parse_tasks.keys(), parsed):
        if isinstance(result, str) and result.strip():
            texts[key] = result

    if not texts:
        print(f"  ⚠️  {name}: PDF okunamadı")
        st.errors += 1
        return st

    # 3. Bölümleri çıkar + eşleştir
    # section_label → (metin, is_contraindication)
    sections_to_process: dict[str, tuple[str, bool]] = {}

    kub_text = texts.get("kub", "")
    kt_text  = texts.get("kt",  "")

    if kub_text:
        secs = extract_sections(kub_text)

        if secs.get("KT"):
            # kub_url aslında KT belgesi
            sections_to_process["KT(kub_url)"] = (secs["KT"], False)
        else:
            if secs.get("4.1"):
                sections_to_process["KUB_4_1"] = (secs["4.1"], False)
            elif DEBUG:
                print(f"    🔍 4.1 bulunamadı — ilk {DEBUG_PREVIEW_LEN} karakter:")
                print(kub_text[:DEBUG_PREVIEW_LEN])

            if secs.get("4.3"):
                sections_to_process["KUB_4_3"] = (secs["4.3"], True)

    if kt_text:
        secs_kt = extract_sections(kt_text)
        kt_sec = secs_kt.get("KT") or secs_kt.get("4.1")
        if kt_sec:
            sections_to_process["KT"] = (kt_sec, False)
        elif DEBUG:
            print(f"    🔍 KT bölümü bulunamadı — ilk {DEBUG_PREVIEW_LEN} karakter:")
            print(kt_text[:DEBUG_PREVIEW_LEN])

    if not sections_to_process:
        print(f"  ─  {name}: İşlenebilir bölüm yok")
        return st

    # 4. Her bölüm için keyword match + kaydet
    # Önce endikasyonları topla, sonra kontrendikasyonları çıkar
    endi_map: dict[str, dict] = {}   # condition_id → match
    kontra_map: dict[str, dict] = {} # condition_id → match

    for source, (section_text, is_contra) in sections_to_process.items():
        matches = match_keywords(section_text, conditions)
        for m in matches:
            cid = m["condition_id"]
            if is_contra:
                kontra_map[cid] = m
                endi_map.pop(cid, None)   # endikasyon listesinden çıkar
            else:
                if cid not in kontra_map:  # kontrendike değilse ekle
                    if cid not in endi_map or m["confidence_score"] > endi_map[cid]["confidence_score"]:
                        endi_map[cid] = m

    # 5. Kaydet
    if endi_map:
        cnt = upsert_matches(med["id"], list(endi_map.values()),
                             source="KUB_4_1+KT", is_contraindication=False)
        st.endikasyon += cnt

    if kontra_map:
        cnt = upsert_matches(med["id"], list(kontra_map.values()),
                             source="KUB_4_3", is_contraindication=True)
        st.kontra += cnt

    total = st.endikasyon + st.kontra
    if total:
        print(f"  ✅ {name}: {st.endikasyon} endikasyon + {st.kontra} kontrendikasyon")
    else:
        print(f"  ─  {name}: Eşleşme yok")

    return st


# ════════════════════════════════════════════════════════════════════════════
# Ana async döngü
# ════════════════════════════════════════════════════════════════════════════

async def main_async() -> None:
    print("═" * 58)
    print(f"  BiTanı KÜB+KT Pipeline  {PIPELINE_VERSION}")
    print(f"  Yöntem: Keyword Matching")
    print(f"  Paralel İndirme: {CONCURRENT_DOWNLOADS}")
    if REPROCESS_ALL:
        print("  ⚠️  REPROCESS_ALL=1 — tüm ilaçlar yeniden işlenecek")
    if MAX_MEDICATIONS:
        print(f"  ⚙️  MAX_MEDICATIONS={MAX_MEDICATIONS} (test modu)")
    print("═" * 58)

    print("\n📋 Veriler çekiliyor...")
    skip_ids    = set() if REPROCESS_ALL else fetch_processed_ids()
    medications = fetch_medications(skip_ids)
    conditions  = fetch_conditions()

    print(f"  Atlanacak (işlenmiş): {len(skip_ids)}")
    print(f"  İşlenecek ilaç      : {len(medications)}")
    print(f"  Hastalık kataloğu   : {len(conditions)}\n")

    if not medications:
        print("✅ İşlenecek ilaç yok.")
        return

    total      = MedStats()
    start_time = time.time()
    dl_sem     = asyncio.Semaphore(CONCURRENT_DOWNLOADS)

    connector = aiohttp.TCPConnector(limit_per_host=CONCURRENT_DOWNLOADS)
    async with aiohttp.ClientSession(connector=connector) as session:
        with ProcessPoolExecutor(max_workers=4) as executor:
            for idx, med in enumerate(medications, 1):
                print(f"[{idx:>5}/{len(medications)}] ", end="")
                st = await process_medication(med, conditions, session, dl_sem, executor)
                total.endikasyon += st.endikasyon
                total.kontra     += st.kontra
                total.errors     += st.errors

    elapsed = time.time() - start_time
    print("\n" + "═" * 58)
    print(f"  Pipeline tamamlandı  {PIPELINE_VERSION}")
    print("─" * 58)
    print(f"  İşlenen ilaç         : {len(medications)}")
    print(f"  Endikasyon kaydı     : {total.endikasyon}")
    print(f"  Kontrendikasyon kaydı: {total.kontra}")
    print(f"  Hata                 : {total.errors}")
    print(f"  Süre                 : {elapsed / 60:.1f} dakika")
    print("═" * 58)


def main() -> None:
    asyncio.run(main_async())


if __name__ == "__main__":
    main()
