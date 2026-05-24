#!/usr/bin/env python3
"""
BiTanı — KÜB + KT Endikasyon Çıkarıcı  (v3.0.0)
═══════════════════════════════════════════════════

Pipeline:
  1. KÜB ve KT PDF'lerini async olarak indir
  2. KÜB'den 4.1 / 4.3 / 4.5 bölümlerini ayrı çıkar
  3. Groq Llama 3.3 ile her bölümü doğrula
     - 4.1 → is_contraindication = false
     - 4.3 → is_contraindication = true
     - 4.5 → medications.kub_etkilesim_metni kolonuna yaz (bilgi amaçlı)
  4. confidence_score hesapla (0.0 – 1.0)
  5. condition_medications tablosuna upsert et

Çalıştırma:
  cd scripts
  python -m venv .venv && source .venv/bin/activate
  pip install -r requirements-kub.txt
  python kub_endikasyon_cikarici.py

Ortam değişkenleri (.env):
  SUPABASE_URL            — zorunlu
  SUPABASE_SERVICE_ROLE_KEY — zorunlu
  GROQ_API_KEY            — zorunlu
  MAX_MEDICATIONS=N       — test için ilaç sınırı  (varsayılan: tümü)
  GROQ_RPM=30             — Groq rate limit req/dakika (varsayılan: 30)
  REPROCESS_ALL=1         — daha önce işlenenleri de yeniden işle
  KUB_DEBUG=1             — bölüm bulunamazsa PDF önizleme yazdır
  CONCURRENT_DOWNLOADS=10 — eş zamanlı PDF indirme sayısı
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import re
import sys
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import aiohttp
import requests
from dotenv import load_dotenv
from pypdf import PdfReader
from supabase import create_client

# ── .env yükle ───────────────────────────────────────────────────────────────
load_dotenv(Path(__file__).resolve().parent / ".env")

PIPELINE_VERSION = "v3.0.0"

# ── Ortam değişkenleri ───────────────────────────────────────────────────────

def _env(key: str, default: str = "") -> str:
    v = os.environ.get(key, default)
    return v.strip().strip('"').strip("'")


SUPABASE_URL  = _env("SUPABASE_URL").rstrip("/")
SUPABASE_KEY  = _env("SUPABASE_SERVICE_ROLE_KEY")
GROQ_API_KEY  = _env("GROQ_API_KEY")
GROQ_MODEL    = "llama-3.3-70b-versatile"
GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"

_max_raw = _env("MAX_MEDICATIONS")
MAX_MEDICATIONS: int | None = int(_max_raw) if _max_raw.isdigit() else None
GROQ_RPM: int = int(_env("GROQ_RPM", "30"))
CONCURRENT_DOWNLOADS: int = int(_env("CONCURRENT_DOWNLOADS", "10"))
REPROCESS_ALL: bool = _env("REPROCESS_ALL", "0").lower() in ("1", "true", "yes")
DEBUG: bool = _env("KUB_DEBUG", "0").lower() in ("1", "true", "yes")

MEDICATIONS_PAGE = 500
DEBUG_PREVIEW_LEN = 600
MAX_SECTION_CHARS = 3000   # Groq'a gönderilecek maksimum bölüm uzunluğu
MAX_GROQ_RETRIES = 3


# ── Doğrulama ────────────────────────────────────────────────────────────────

def _check_env() -> None:
    missing = []
    if not SUPABASE_URL:
        missing.append("SUPABASE_URL")
    if not SUPABASE_KEY or SUPABASE_KEY == "your_service_role_key_here":
        missing.append("SUPABASE_SERVICE_ROLE_KEY")
    if not GROQ_API_KEY or GROQ_API_KEY == "your_groq_api_key_here":
        missing.append("GROQ_API_KEY")
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
_S46 = re.compile(r"4[\.\s]*6[\s\.]+(gebelik|laktasyon|hamile)", re.I)
_KT_NE_ICIN = re.compile(r"ne(?:yin)?\s+için\s+kullan[ıi]l[ıi]r", re.I)
_BROSUR_FLAG = re.compile(r"kullanma\s+talimat[ıi]", re.I)


# ════════════════════════════════════════════════════════════════════════════
# PDF işleme (ProcessPoolExecutor'da çalışır — picklable fonksiyonlar)
# ════════════════════════════════════════════════════════════════════════════

def _parse_pdf_bytes(data: bytes) -> str:
    """PDF bytes → düz metin. subprocess'te çalışır."""
    try:
        import io
        reader = PdfReader(io.BytesIO(data))
        return "".join(p.extract_text() or "" for p in reader.pages)
    except Exception:
        return ""


def _cut_section(text: str, start_re: re.Pattern, *end_res: re.Pattern) -> str | None:
    """Başlık regex'inden sonraki bölümü, bitiş regex'lerinden öncesine kadar kes."""
    m_start = start_re.search(text)
    if not m_start:
        return None
    start = m_start.end()
    end = len(text)
    for end_re in end_res:
        m_end = end_re.search(text, start)
        if m_end and m_end.start() < end:
            end = m_end.start()
    section = text[start:end].strip()
    return section[:MAX_SECTION_CHARS] if section else None


def extract_sections(full_text: str) -> dict[str, str | None]:
    """KÜB metninden 4.1, 4.3, 4.5 bölümlerini çıkar."""
    is_kt = bool(_BROSUR_FLAG.search(full_text[:4000]))
    if is_kt:
        kt = _cut_section(full_text, _KT_NE_ICIN,
                          re.compile(r"kullanmadan önce|nasıl kullan", re.I))
        return {"KT": kt, "4.1": None, "4.3": None, "4.5": None}

    return {
        "4.1": _cut_section(full_text, _S41, _S42, _S43),
        "4.3": _cut_section(full_text, _S43, _S44, _S45),
        "4.5": _cut_section(full_text, _S45, _S46),
        "KT":  None,
    }


# ════════════════════════════════════════════════════════════════════════════
# Groq LLM entegrasyonu
# ════════════════════════════════════════════════════════════════════════════

_SYSTEM_PROMPT = """\
Sen deneyimli bir klinik eczacısın. Sana bir ilaç KÜB (Kısa Ürün Bilgisi) bölümü \
ve onaylı hastalık listesi verilecek.

GÖREV:
Verilen metinde AÇIKÇA geçen hastalıkları, YALNIZCA listeden seçerek JSON döndür.

KURALLAR:
1. Listede olmayan hastalıkları ASLA ekleme.
2. Metinde geçmiyorsa boş matches listesi döndür.
3. is_contraindication:
   - true  → ilaç bu hastalıkta KESİNLİKLE kullanılMAMALI (kontrendikasyon/kullanılmaz/yasak)
   - false → ilaç bu hastalık için endike / kullanılır
4. confidence: 0.0–1.0
   - 0.95+ → metinde doğrudan ve açık ifade var
   - 0.70–0.94 → dolaylı/çıkarımsal
   - 0.50–0.69 → belirsiz
   - <0.50 → ekleme
5. evidence: metinden birebir kısa alıntı (max 120 karakter)

ÇIKTI (sadece geçerli JSON, başka hiçbir şey):
{
  "matches": [
    {
      "condition_id": "<uuid>",
      "condition_name": "<hastalık adı>",
      "is_contraindication": false,
      "confidence": 0.95,
      "evidence": "<kısa alıntı>"
    }
  ]
}"""


def _condition_list_text(conditions: list[dict]) -> str:
    lines = [f"- {c['id']} | {c['name']}" for c in conditions]
    return "\n".join(lines)


def _call_groq_sync(
    section_text: str,
    section_label: str,
    conditions: list[dict],
    is_contraindication_section: bool = False,
) -> list[dict]:
    """Groq API'yi senkron çağır. Rate limiting dışarıda yönetilir."""
    contra_hint = (
        "\nNOT: Bu bölüm KÜB'ün KONTRENDİKASYONLAR bölümüdür. "
        "Burada geçen hastalıklar için is_contraindication=true olmalı."
        if is_contraindication_section else ""
    )

    user_msg = (
        f"KÜB Bölümü: {section_label}{contra_hint}\n\n"
        f"=== METİN ===\n{section_text}\n\n"
        f"=== ONAYLANAN HASTALIK LİSTESİ ===\n{_condition_list_text(conditions)}"
    )

    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user",   "content": user_msg},
        ],
        "temperature": 0.1,
        "max_tokens": 1024,
        "response_format": {"type": "json_object"},
    }

    for attempt in range(1, MAX_GROQ_RETRIES + 1):
        try:
            resp = requests.post(
                GROQ_ENDPOINT,
                headers=headers,
                json=payload,
                timeout=60,
            )
            if resp.status_code == 429:
                wait = 2 ** attempt
                print(f"    ⏳ Groq rate limit, {wait}s bekleniyor...")
                time.sleep(wait)
                continue
            resp.raise_for_status()
            raw = resp.json()["choices"][0]["message"]["content"]
            data = json.loads(raw)
            matches = data.get("matches", [])
            # Geçerli uuid'lere sahip eşleşmeleri filtrele
            valid_ids = {c["id"] for c in conditions}
            return [
                m for m in matches
                if isinstance(m, dict)
                and m.get("condition_id") in valid_ids
                and isinstance(m.get("confidence"), (int, float))
                and m["confidence"] >= 0.50
            ]
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            if attempt == MAX_GROQ_RETRIES:
                print(f"    ⚠️  Groq JSON parse hatası ({attempt}. deneme): {e}")
                return []
        except requests.RequestException as e:
            if attempt == MAX_GROQ_RETRIES:
                print(f"    ⚠️  Groq istek hatası: {e}")
                return []
        time.sleep(1)
    return []


# ════════════════════════════════════════════════════════════════════════════
# Veri erişim katmanı
# ════════════════════════════════════════════════════════════════════════════

def fetch_processed_ids() -> set[str]:
    """condition_medications'ta kaydı olan ilaç id'leri."""
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
    """kub_url veya kt_url dolu ilaçları sayfalı çek."""
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
    return supabase.table("conditions_catalog").select("id, name, category").execute().data or []


def upsert_matches(medication_id: str, matches: list[dict], source: str) -> int:
    """condition_medications tablosuna yaz."""
    if not matches:
        return 0
    rows = [
        {
            "medication_id":      medication_id,
            "condition_id":       m["condition_id"],
            "confidence_score":   round(float(m["confidence"]), 3),
            "is_contraindication": bool(m.get("is_contraindication", False)),
            "extraction_method":  "llm",
            "evidence_snippet":   str(m.get("evidence", ""))[:200],
            "source":             source,
            "annotation_version": PIPELINE_VERSION,
        }
        for m in matches
    ]
    try:
        supabase.table("condition_medications").upsert(
            rows,
            on_conflict="medication_id,condition_id",
        ).execute()
        return len(rows)
    except Exception as e:
        print(f"    ❌ DB kayıt hatası: {e}")
        return 0


def save_interaction_text(medication_id: str, text: str) -> None:
    """4.5 etkileşim metnini medications tablosuna yaz (kolon varsa)."""
    try:
        supabase.table("medications").update(
            {"kub_etkilesim_metni": text[:2000]}
        ).eq("id", medication_id).execute()
    except Exception:
        pass  # Kolon henüz yoksa sessizce atla


# ════════════════════════════════════════════════════════════════════════════
# Async PDF indirme
# ════════════════════════════════════════════════════════════════════════════

async def _download(
    session: aiohttp.ClientSession,
    sem: asyncio.Semaphore,
    url: str,
) -> bytes | None:
    headers = {"User-Agent": "Mozilla/5.0 BiTani/3.0"}
    for attempt in range(1, 4):
        async with sem:
            try:
                async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=90)) as r:
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
    """KÜB ve KT PDF'lerini eş zamanlı indir."""
    kub_url = med.get("kub_url")
    kt_url  = med.get("kt_url")
    tasks = {}
    if kub_url:
        tasks["kub"] = _download(session, sem, kub_url)
    if kt_url:
        tasks["kt"] = _download(session, sem, kt_url)

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
    kontra: int = 0
    groq_calls: int = 0
    errors: int = 0


async def process_medication(
    med: dict,
    conditions: list[dict],
    session: aiohttp.ClientSession,
    dl_sem: asyncio.Semaphore,
    groq_sem: asyncio.Semaphore,
    executor: ProcessPoolExecutor,
) -> MedStats:
    """Tek bir ilacı tam pipeline'dan geçir."""
    st = MedStats()
    loop = asyncio.get_running_loop()
    name = (med.get("ilac_adi") or "")[:55]

    # 1. PDF'leri indir
    pdfs = await download_pdfs(med, session, dl_sem)
    if not pdfs:
        print(f"  ⚠️  {name}: PDF bulunamadı")
        st.errors += 1
        return st

    # 2. PDF'leri parse et (CPU-bound → ProcessPoolExecutor)
    texts: dict[str, str] = {}
    parse_tasks = {
        key: loop.run_in_executor(executor, _parse_pdf_bytes, data)
        for key, data in pdfs.items()
        if data
    }
    parsed = await asyncio.gather(*parse_tasks.values(), return_exceptions=True)
    for key, result in zip(parse_tasks.keys(), parsed):
        if isinstance(result, str) and result.strip():
            texts[key] = result

    if not texts:
        print(f"  ⚠️  {name}: PDF metni okunamadı")
        st.errors += 1
        return st

    # 3. Bölümleri çıkar
    all_sections: dict[str, tuple[str, bool]] = {}
    # (metin, is_contraindication_section)

    kub_text = texts.get("kub", "")
    kt_text  = texts.get("kt", "")

    if kub_text:
        secs = extract_sections(kub_text)

        if secs.get("KT"):
            # kub_url aslında KT belgesi
            all_sections["KT(kub_url)"] = (secs["KT"], False)
        else:
            if secs.get("4.1"):
                all_sections["KUB_4_1"] = (secs["4.1"], False)
            elif DEBUG:
                print(f"    🔍 4.1 bulunamadı — KÜB ilk {DEBUG_PREVIEW_LEN} karakter:")
                print(kub_text[:DEBUG_PREVIEW_LEN])

            if secs.get("4.3"):
                all_sections["KUB_4_3"] = (secs["4.3"], True)

            if secs.get("4.5"):
                # Etkileşim metnini kaydet (bilgi amaçlı)
                save_interaction_text(med["id"], secs["4.5"])

    if kt_text:
        secs_kt = extract_sections(kt_text)
        kt_section = secs_kt.get("KT") or secs_kt.get("4.1")
        if kt_section:
            all_sections["KT"] = (kt_section, False)
        elif DEBUG:
            print(f"    🔍 KT bölümü bulunamadı — KT ilk {DEBUG_PREVIEW_LEN} karakter:")
            print(kt_text[:DEBUG_PREVIEW_LEN])

    if not all_sections:
        print(f"  ─  {name}: İşlenebilir bölüm yok")
        return st

    # 4. Groq ile her bölümü doğrula
    for section_label, (section_text, is_contra_section) in all_sections.items():
        async with groq_sem:
            matches = await loop.run_in_executor(
                None,  # default thread pool (I/O bekler)
                _call_groq_sync,
                section_text,
                section_label,
                conditions,
                is_contra_section,
            )
        st.groq_calls += 1

        if not matches:
            continue

        # is_contraindication_section ise tüm eşleşmelere true zorla
        if is_contra_section:
            for m in matches:
                m["is_contraindication"] = True

        endikasyonlar = [m for m in matches if not m.get("is_contraindication")]
        kontralar     = [m for m in matches if     m.get("is_contraindication")]

        if endikasyonlar:
            cnt = upsert_matches(med["id"], endikasyonlar, source=section_label)
            st.endikasyon += cnt

        if kontralar:
            cnt = upsert_matches(med["id"], kontralar, source=section_label)
            st.kontra += cnt

    toplam = st.endikasyon + st.kontra
    if toplam:
        print(f"  ✅ {name}: {st.endikasyon} endikasyon + {st.kontra} kontrendikasyon "
              f"({st.groq_calls} Groq çağrısı)")
    else:
        print(f"  ─  {name}: Eşleşme yok ({st.groq_calls} Groq çağrısı)")

    return st


# ════════════════════════════════════════════════════════════════════════════
# Ana async döngü
# ════════════════════════════════════════════════════════════════════════════

async def main_async() -> None:
    print("═" * 58)
    print(f"  BiTanı KÜB+KT Pipeline  {PIPELINE_VERSION}")
    print(f"  Model : {GROQ_MODEL}")
    print(f"  RPM   : {GROQ_RPM}  |  Paralel İndirme: {CONCURRENT_DOWNLOADS}")
    if REPROCESS_ALL:
        print("  ⚠️  REPROCESS_ALL=1 — tüm ilaçlar yeniden işlenecek")
    if MAX_MEDICATIONS:
        print(f"  ⚙️  MAX_MEDICATIONS={MAX_MEDICATIONS} (test modu)")
    print("═" * 58)

    # Veri çek
    print("\n📋 Veriler çekiliyor...")
    skip_ids   = set() if REPROCESS_ALL else fetch_processed_ids()
    medications = fetch_medications(skip_ids)
    conditions  = fetch_conditions()

    print(f"  Atlanacak (işlenmiş): {len(skip_ids)}")
    print(f"  İşlenecek ilaç      : {len(medications)}")
    print(f"  Hastalık kataloğu   : {len(conditions)}\n")

    if not medications:
        print("✅ İşlenecek ilaç yok.")
        return

    # Groq rate limit hesabı
    # Her ilaç için ortalama 2 bölüm = 2 Groq çağrısı
    # GROQ_RPM / 60 = saniyede kaç istek
    groq_interval = 60.0 / GROQ_RPM         # saniye / istek
    groq_sem = asyncio.Semaphore(max(1, GROQ_RPM // 10))  # burst penceresi

    dl_sem = asyncio.Semaphore(CONCURRENT_DOWNLOADS)

    # Toplam istatistikler
    total = MedStats()
    start_time = time.time()

    connector = aiohttp.TCPConnector(limit_per_host=CONCURRENT_DOWNLOADS)
    async with aiohttp.ClientSession(connector=connector) as session:
        with ProcessPoolExecutor(max_workers=4) as executor:
            for idx, med in enumerate(medications, 1):
                print(f"\n[{idx:>5}/{len(medications)}] ", end="")
                st = await process_medication(
                    med, conditions, session, dl_sem, groq_sem, executor
                )
                total.endikasyon += st.endikasyon
                total.kontra     += st.kontra
                total.groq_calls += st.groq_calls
                total.errors     += st.errors

                # Groq rate limit: her çağrı sonrası bekle
                if st.groq_calls:
                    await asyncio.sleep(groq_interval * st.groq_calls)

    # Özet
    elapsed = time.time() - start_time
    print("\n" + "═" * 58)
    print(f"  Pipeline tamamlandı  {PIPELINE_VERSION}")
    print("─" * 58)
    print(f"  İşlenen ilaç         : {len(medications)}")
    print(f"  Endikasyon kaydı     : {total.endikasyon}")
    print(f"  Kontrendikasyon kaydı: {total.kontra}")
    print(f"  Groq API çağrısı     : {total.groq_calls}")
    print(f"  Hata                 : {total.errors}")
    print(f"  Süre                 : {elapsed / 60:.1f} dakika")
    print("═" * 58)


def main() -> None:
    asyncio.run(main_async())


if __name__ == "__main__":
    main()
