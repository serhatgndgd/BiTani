"""
KT yeniden-parse: TAM TABLO dry-run.

🚨 KESİN KURAL: yalnızca SELECT. Hiçbir UPDATE/INSERT/DELETE yok.
   raw_text dahil hiçbir mevcut veri değiştirilmez.

Amaç: 15.473 medication_kt kaydında prototipi koşturup başarı oranını
ölçmek. Çıktı: scripts/kt_reparse_fulltable_report.txt

Prototipten farklar:
  - SAMPLE_SIZE = 15473 (tüm tablo)
  - Batch = 200, ilerleme 2000 kayıtta bir
  - Birleşik başlık: "3-4.", "3 ve 4." formatları
  - Sığ-içerik flag'i: < 30 char bölüm "şüpheli"
  - raw_text bellekte tutulmuyor (sadece parse sonucu sayılır)
  - Tekil örnek/body çıktısı yok — sadece toplu istatistik
"""
from __future__ import annotations

import os
import re
import time
import warnings
from collections import Counter
from typing import Optional

warnings.filterwarnings("ignore")
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

SAMPLE_SIZE = 15473
BATCH = 200
PROGRESS_EVERY = 2000
SHALLOW_THRESHOLD = 30  # < bu kadar char = şüpheli
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "kt_reparse_fulltable_report.txt")

SECTION_PATTERNS = {
    1: [r"nedir.*ne.{0,3}i.in.*kullan", r"ne.{0,3}i.in.*kullan"],
    2: [r"kullanmadan.{0,5}.nce", r"dikkat.{0,5}edilmesi"],
    3: [r"nas.l.{0,5}kullan"],
    4: [r"olas.\s*yan.{0,5}etki", r"yan.{0,5}etkiler.{0,5}nelerdir"],
    5: [r"saklan"],
}
SECTION_NAMES = {
    1: "nedir_ne_icin_kullanilir",
    2: "kullanmadan_once_dikkat",
    3: "nasil_kullanilir",
    4: "olasi_yan_etkiler",
    5: "saklanmasi",
}

# Tek-başlıklı satır: "1. ..." veya "1) ..."
HEAD_SINGLE_RX = re.compile(r"^\s*([1-5])\s*[\.\)]?\s+(\S.*)$")
# Birleşik başlık: "3-4." / "3–4." / "3 ve 4." / "3,4."
HEAD_COMBO_RX = re.compile(
    r"^\s*([1-5])\s*(?:[-–~/,]|\s+ve\s+)\s*([1-5])\s*[\.\)]?\s+(\S.*)$",
    re.IGNORECASE,
)


def normalize_for_match(s: str) -> str:
    s = s.lower()
    s = s.replace("'", " ").replace("’", " ").replace("`", " ")
    s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def classify_header(line_content: str) -> Optional[int]:
    norm = normalize_for_match(line_content)
    for sec_id in (1, 2, 4, 5, 3):  # 3 en sona (en jenerik)
        for pat in SECTION_PATTERNS[sec_id]:
            if re.search(pat, norm):
                return sec_id
    return None


def parse_kt(raw: str) -> dict:
    """raw_text'i 5 bölüme ayır. Birleşik başlık (3-4.) desteklenir."""
    lines = raw.split("\n")
    # candidates: (line_idx, primary_section, secondary_section_or_None, header_text)
    candidates: list[tuple[int, int, Optional[int], str]] = []

    for idx, line in enumerate(lines):
        # Birleşik başlık önce (daha spesifik)
        m_combo = HEAD_COMBO_RX.match(line)
        if m_combo:
            n1 = int(m_combo.group(1))
            n2 = int(m_combo.group(2))
            rest = m_combo.group(3)
            sec = classify_header(rest)
            # n1 veya n2'den biri sec ile eşleşmeli
            if sec in (n1, n2):
                candidates.append((idx, n1, n2, line.strip()))
            continue
        # Tek başlık
        m = HEAD_SINGLE_RX.match(line)
        if not m:
            continue
        num = int(m.group(1))
        rest = m.group(2)
        sec = classify_header(rest)
        if sec is None or sec != num:
            continue
        candidates.append((idx, sec, None, line.strip()))

    if not candidates:
        return {
            "sections": {i: None for i in range(1, 6)},
            "headers": {},
            "combo_used": False,
            "candidate_count": 0,
        }

    # Her bölüm için SON occurrence
    headers: dict[int, tuple[int, str]] = {}
    combo_used = False
    for idx, primary, secondary, text in candidates:
        headers[primary] = (idx, text)
        if secondary is not None:
            headers[secondary] = (idx, text)
            combo_used = True

    # Sınırları sırala
    ordered = sorted(set(headers.items()), key=lambda kv: kv[1][0])
    # Aynı line_idx'te birleşik header iki bölümü açıyorsa
    # her ikisinin start_idx'i aynı, end_idx bir sonraki farklı line_idx'tir.
    sorted_lines = sorted(set(start for (start, _) in headers.values()))
    sections: dict[int, Optional[str]] = {i: None for i in range(1, 6)}
    for sec, (start_idx, _h) in headers.items():
        # bir sonraki farklı satır indeksini bul
        next_starts = [s for s in sorted_lines if s > start_idx]
        end_idx = next_starts[0] if next_starts else len(lines)
        content = "\n".join(lines[start_idx + 1:end_idx]).strip()
        sections[sec] = content if content else None

    return {
        "sections": sections,
        "headers": {sec: text for sec, (_, text) in headers.items()},
        "combo_used": combo_used,
        "candidate_count": len(candidates),
    }


# ─────────────────────────────────────────────────────────────────────
# Toplama döngüsü — raw_text'i bellekte tutmadan, batch-batch işle
# ─────────────────────────────────────────────────────────────────────
print(f"medication_kt TAM tablo dry-run başlıyor "
      f"(beklenen ~{SAMPLE_SIZE} kayıt, batch={BATCH})")
t0 = time.time()

processed = 0
quality_dist: Counter[int] = Counter()
missing_by_sec: Counter[int] = Counter()
shallow_by_sec: Counter[int] = Counter()
combo_used_count = 0
zero_section_records = 0
total_records = 0
section_len_sum: dict[int, int] = {i: 0 for i in range(1, 6)}
section_len_n: dict[int, int] = {i: 0 for i in range(1, 6)}
section_len_min: dict[int, int] = {i: 10**9 for i in range(1, 6)}
section_len_max: dict[int, int] = {i: 0 for i in range(1, 6)}
batch_timeouts = 0
last_progress = 0

offset = 0
while True:
    try:
        res = (
            sb.table("medication_kt")
            .select("id,raw_text")
            .order("id")
            .range(offset, offset + BATCH - 1)
            .execute()
        )
        batch = res.data or []
    except Exception as e:
        # Statement timeout vs → batch'i atla, bir sonraki offsete geç
        batch_timeouts += 1
        print(f"  ⚠ batch offset={offset} TIMEOUT (atlandı): {str(e)[:80]}")
        offset += BATCH
        if offset >= SAMPLE_SIZE:
            break
        continue

    if not batch:
        break

    for rec in batch:
        total_records += 1
        raw = rec.get("raw_text") or ""
        if not raw.strip():
            quality_dist[0] += 1
            zero_section_records += 1
            for i in range(1, 6):
                missing_by_sec[i] += 1
            continue

        parsed = parse_kt(raw)
        sections = parsed["sections"]
        score = sum(1 for v in sections.values() if v)
        quality_dist[score] += 1
        if parsed["combo_used"]:
            combo_used_count += 1
        if score == 0:
            zero_section_records += 1

        for i in range(1, 6):
            content = sections[i]
            if not content:
                missing_by_sec[i] += 1
                continue
            n = len(content)
            section_len_sum[i] += n
            section_len_n[i] += 1
            if n < section_len_min[i]:
                section_len_min[i] = n
            if n > section_len_max[i]:
                section_len_max[i] = n
            if n < SHALLOW_THRESHOLD:
                shallow_by_sec[i] += 1

    processed += len(batch)
    if processed - last_progress >= PROGRESS_EVERY:
        last_progress = processed
        elapsed = time.time() - t0
        rate = processed / elapsed if elapsed else 0
        eta = (SAMPLE_SIZE - processed) / rate if rate else 0
        print(f"  ilerleme: {processed:>5}/{SAMPLE_SIZE}  "
              f"({elapsed:.0f}s, {rate:.0f} kayıt/s, ETA {eta:.0f}s)")

    if len(batch) < BATCH:
        break
    offset += BATCH
    if offset >= SAMPLE_SIZE:
        break

total_elapsed = time.time() - t0
print(f"\nBitti. {total_records} kayıt işlendi, {total_elapsed:.1f}s.")


# ─────────────────────────────────────────────────────────────────────
# RAPORU dosyaya yaz
# ─────────────────────────────────────────────────────────────────────
lines: list[str] = []


def emit(s: str = "") -> None:
    lines.append(s)


emit("=" * 72)
emit("KT RE-PARSE TAM-TABLO DRY-RUN RAPORU")
emit("=" * 72)
emit(f"Tarih               : {time.strftime('%Y-%m-%d %H:%M:%S')}")
emit(f"Hedef tablo         : medication_kt (tüm satırlar)")
emit(f"Toplam işlenen kayıt: {total_records}")
emit(f"Beklenen satır sayısı: {SAMPLE_SIZE}")
emit(f"Toplam süre         : {total_elapsed:.1f}s "
     f"({total_records/total_elapsed:.0f} kayıt/s)")
emit(f"Batch timeout sayısı: {batch_timeouts}")
emit(f"DB yazma            : HİÇBİRİ. Salt-okuma SELECT'leri.")
emit("")

emit("=" * 72)
emit("1) BAŞARI ORANI")
emit("=" * 72)
full = quality_dist[5]
emit(f"  5/5 bölüm bulundu (tam başarı)      : {full:>5} / {total_records}  "
     f"({100*full/max(total_records,1):.1f}%)")
partial = sum(quality_dist[i] for i in range(1, 5))
emit(f"  Kısmi (1-4 bölüm)                   : {partial:>5} / {total_records}  "
     f"({100*partial/max(total_records,1):.1f}%)")
zero = quality_dist[0]
emit(f"  Hiçbir bölüm yok (0/5)              : {zero:>5} / {total_records}  "
     f"({100*zero/max(total_records,1):.1f}%)")
emit(f"  Birleşik başlık kullanılan kayıt    : {combo_used_count:>5} "
     f"({100*combo_used_count/max(total_records,1):.1f}%)")

emit("")
emit("=" * 72)
emit("2) parse_quality_score DAĞILIMI")
emit("=" * 72)
for score in range(5, -1, -1):
    n = quality_dist[score]
    pct = 100 * n / max(total_records, 1)
    bar = "█" * int(pct / 2)
    emit(f"  score={score}  →  {n:>5} kayıt  ({pct:5.1f}%)  {bar}")

emit("")
emit("=" * 72)
emit("3) HANGİ BÖLÜMLER EKSİK?")
emit("=" * 72)
for i in range(1, 6):
    n = missing_by_sec[i]
    pct = 100 * n / max(total_records, 1)
    bar = "█" * int(pct / 2)
    emit(f"  Bölüm {i} ({SECTION_NAMES[i]:30s}) eksik: {n:>5}  "
         f"({pct:5.1f}%)  {bar}")

emit("")
emit("=" * 72)
emit("4) SIĞ-İÇERİK ŞÜPHELİ KAYITLAR (bölüm < 30 char)")
emit("=" * 72)
total_shallow = sum(shallow_by_sec.values())
emit(f"  Toplam şüpheli bölüm vakası : {total_shallow}")
for i in range(1, 6):
    n = shallow_by_sec[i]
    pct = 100 * n / max(section_len_n[i], 1)
    emit(f"    Bölüm {i} ({SECTION_NAMES[i]:30s}) : {n:>4} "
         f"(o bölümden çıkarılanların %{pct:.1f}'i)")

emit("")
emit("=" * 72)
emit("5) BÖLÜM UZUNLUKLARI (karakter)")
emit("=" * 72)
for i in range(1, 6):
    n = section_len_n[i]
    if n == 0:
        emit(f"  Bölüm {i}: hiç çıkarılamadı")
        continue
    avg = section_len_sum[i] // n
    emit(f"  Bölüm {i} ({SECTION_NAMES[i]:30s}) "
         f"n={n:>5}  ort={avg:>6}  min={section_len_min[i]:>5}  "
         f"max={section_len_max[i]:>6}")

emit("")
emit("=" * 72)
emit("6) SALT-GÖRSEL PDF ADAYI")
emit("=" * 72)
emit(f"  0/5 bölüm çıkarılan kayıt sayısı   : {zero_section_records}")
emit(f"  Bu kayıtların ID'leri ileri inceleme için ayrı bir lookup")
emit(f"  gerektirir (id sıralı offset'lerde dağılıyor).")
emit(f"  Pratik aksiyon: bu {zero_section_records} kayıt için PDF'yi")
emit(f"  yeniden OCR'lamak veya manuel atlamak gerekebilir.")

emit("")
emit("=" * 72)
emit("ÖZET")
emit("=" * 72)
success_pct = 100 * full / max(total_records, 1)
near_success_pct = 100 * (quality_dist[5] + quality_dist[4]) / max(total_records, 1)
emit(f"  Tam başarı (5/5)               : {success_pct:5.1f}%")
emit(f"  Yakın başarı (4/5 veya 5/5)    : {near_success_pct:5.1f}%")
emit(f"  Başarısız (0/5)                : "
     f"{100*zero/max(total_records,1):5.1f}%  ({zero} kayıt)")
emit(f"  Birleşik başlık kullanan       : "
     f"{100*combo_used_count/max(total_records,1):5.1f}%  ({combo_used_count} kayıt)")
emit("")
emit(f"  Sıradaki karar: tam başarı oranı "
     f"({success_pct:.1f}%) production için yeterli mi?")
emit(f"  Eşik %95+ ise: parser yeterli, ayrı UPDATE script'i yazılabilir.")
emit(f"  Eşik altında ise: 0/5 vakalarını incele, birleşik başlık varyantı")
emit(f"  veya alternatif anchor stratejisi gerek.")
emit("")
emit("DB durumu: değişmedi. Sadece SELECT sorguları çalıştırıldı.")

with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))

print(f"\n📄 Rapor yazıldı: {OUTPUT_PATH}")
print("DB'ye HİÇBİR yazma yapılmadı.")
