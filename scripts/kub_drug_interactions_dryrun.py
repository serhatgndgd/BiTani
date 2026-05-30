"""
drug_interactions FILL-ONLY dry-run.

Kural:
  - WHERE drug_interactions IS NULL olan kayıtları çek
  - raw_text'ten 4.5 bölümünü reparse et
  - Güvenlik filtreleri:
      * Reparse < 30 char → SKIP
      * "kontrendike" yoğunsa (yanlış bölüm) → SKIP
  - DB'ye HİÇBİR yazma yapılmaz

Çıktı:
  - İlk 50 örneğin detaylı gösterimi
  - Tüm NULL kayıtlar için özet istatistik
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

DRYRUN_SAMPLE = 50     # detaylı gösterilecek örnek
FULL_SCAN     = True   # 4517 kayıdın tamamını istatistik için tara
BATCH         = 50

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "kub_drug_interactions_dryrun.txt")

# ──────────────────────────────────────────────────────────────────────
# 4.5 Anchor — OCR toleranslı
# ──────────────────────────────────────────────────────────────────────
# "4.5", "4,5", "4. 5", "4 5", "4.S" (OCR O/0 değil ama yine de)
_N45_VARIANTS = r"4\s*[.,]?\s*5"

INTERACTION_PATTERNS = [
    # Başlık satırı: "4.5 Diğer tıbbi ürünler ile etkileşimler..."
    rf"^\s*{_N45_VARIANTS}\s+di[ğg]er\s+t[iı]bb[iı]",
    rf"^\s*{_N45_VARIANTS}\s+etki[lş]e[şs]im",
    rf"^\s*{_N45_VARIANTS}\s+ilaç",
    # İçerik başlığı (numara olmadan)
    r"di[ğg]er\s+t[iı]bb[iı]\s+ürünler?\s+ile\s+etki[lş]e[şs]im",
    r"ilaç\s+etki[lş]e[şs]im",
    # Yalnızca numara satırı (başlık bir sonraki satırda)
    rf"^\s*{_N45_VARIANTS}\s*$",
]

# 4.5'ten sonra başlayabilecek KÜB bölümleri (bitiş sinyali)
NEXT_SECTION_PATTERNS = [
    r"^\s*4\s*[.,]?\s*6",   # 4.6
    r"^\s*4\s*[.,]?\s*7",   # 4.7
    r"^\s*4\s*[.,]?\s*8",   # 4.8
    r"^\s*4\s*[.,]?\s*9",   # 4.9
    r"^\s*5\s*[.,\s]",      # 5.x
    r"^\s*6\s*[.,\s]",      # 6.x
]

# Güvenlik: "kontrendikasyon" baskınlığı
_KONTR_RX = re.compile(r"kontrend", re.IGNORECASE)


def normalize(line: str) -> str:
    s = line.lower()
    s = s.replace("'", " ").replace("'", " ")
    s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def find_4_5_anchor(lines: list[str]) -> Optional[int]:
    """4.5 bölüm başlık satırının index'ini döndür — son occurrence (TOC değil)."""
    found: Optional[int] = None
    for i, raw in enumerate(lines):
        norm = normalize(raw)
        for pat in INTERACTION_PATTERNS:
            if re.search(pat, norm, re.IGNORECASE):
                found = i
                break
    return found


def find_next_section(lines: list[str], after: int) -> Optional[int]:
    """after index'inden sonra gelen ilk KÜB ana bölüm başlığını döndür."""
    for i in range(after + 1, len(lines)):
        norm = normalize(lines[i])
        for pat in NEXT_SECTION_PATTERNS:
            if re.search(pat, norm, re.IGNORECASE):
                return i
    return None


def extract_drug_interactions(raw: str) -> tuple[Optional[str], str]:
    """
    raw_text'ten 4.5 bölümünü çıkar.
    Döner: (extracted_text | None, reason)
    reason: "ok" | "no_anchor" | "too_short" | "contaminated"
    """
    lines = raw.split("\n")
    start = find_4_5_anchor(lines)
    if start is None:
        return None, "no_anchor"

    end = find_next_section(lines, start)
    content_lines = lines[start + 1: end] if end else lines[start + 1:]
    content = "\n".join(content_lines).strip()

    if not content or len(content) < 30:
        return None, "too_short"

    # Kontaminasyon kontrolü: "kontrendike" yoğunluğu
    kontr_hits = len(_KONTR_RX.findall(content))
    word_count = max(1, len(content.split()))
    if kontr_hits > 0 and kontr_hits / word_count > 0.05:
        # "kontrendike" her 20 kelimeden birden fazlaysa yanlış bölüm
        return None, "contaminated"

    return content, "ok"


# ══════════════════════════════════════════════════════════════════════
# ANA AKIŞ
# ══════════════════════════════════════════════════════════════════════

lines_out: list[str] = []


def out(s: str = "") -> None:
    print(s)
    lines_out.append(s)


out("=" * 72)
out("drug_interactions FILL-ONLY DRY-RUN")
out("=" * 72)
out(f"Üretim tarihi: {time.strftime('%Y-%m-%d %H:%M:%S')}")
out("DB'ye HİÇBİR yazma yapılmadı.")
out()

# ── NULL kayıt sayısını doğrula ────────────────────────────────────────
count_res = (
    sb.table("medication_kub")
    .select("id", count="exact")
    .is_("drug_interactions", "null")
    .execute()
)
null_total = count_res.count
out(f"drug_interactions IS NULL toplam: {null_total}")
out()

# ── İlk DRYRUN_SAMPLE kaydı çek ────────────────────────────────────────
out(f"İlk {DRYRUN_SAMPLE} NULL kayıt çekiliyor…")
sample_res = (
    sb.table("medication_kub")
    .select("id,raw_text,drug_interactions,product_name")
    .is_("drug_interactions", "null")
    .order("id")
    .limit(DRYRUN_SAMPLE)
    .execute()
)
samples = sample_res.data or []
out(f"{len(samples)} kayıt geldi.\n")

# ── Her örneği parse et ────────────────────────────────────────────────
out("=" * 72)
out(f"ÖRNEK SONUÇLAR ({len(samples)} kayıt)")
out("=" * 72)

counters = {"ok": 0, "no_anchor": 0, "too_short": 0, "contaminated": 0}

for i, row in enumerate(samples):
    raw = (row.get("raw_text") or "").strip()
    name = (row.get("product_name") or "?")[:40]
    rid  = str(row.get("id", ""))[:8]

    if not raw:
        result, reason = None, "no_anchor"
    else:
        result, reason = extract_drug_interactions(raw)

    counters[reason] = counters.get(reason, 0) + 1

    status = {
        "ok":           "✅ DOLDURULACAK",
        "no_anchor":    "⛔ anchor yok",
        "too_short":    "⛔ çok kısa",
        "contaminated": "⛔ kontaminasyon",
    }.get(reason, f"? {reason}")

    out(f"\n[{i+1:>3}] id={rid}…  {name}")
    out(f"     Karar : {status}")
    if result:
        preview = result.replace("\n", " ")
        # İlk 200 + son 80 char göster
        if len(preview) > 300:
            preview = preview[:200] + "  …(…)…  " + preview[-80:]
        out(f"     İçerik: '{preview}'")
        out(f"     Uzunluk: {len(result)} char")
    else:
        out(f"     Sebep  : {reason}")

# ── Özet ──────────────────────────────────────────────────────────────
out()
out("=" * 72)
out(f"İLK {len(samples)} KAYIT ÖZETİ")
out("=" * 72)
total = len(samples)
out(f"  ✅ Doldurulacak (ok)       : {counters.get('ok', 0):>4} / {total}  ({counters.get('ok',0)/total*100:.1f}%)")
out(f"  ⛔ Anchor bulunamadı       : {counters.get('no_anchor', 0):>4} / {total}")
out(f"  ⛔ Çok kısa (<30 char)     : {counters.get('too_short', 0):>4} / {total}")
out(f"  ⛔ Kontaminasyon filtresi  : {counters.get('contaminated', 0):>4} / {total}")

# ── Tam tablo tarama (opsiyonel) ──────────────────────────────────────
if FULL_SCAN and null_total > 0:
    out()
    out("=" * 72)
    out(f"TAM TABLO TARAMASI ({null_total} NULL kayıt)")
    out("=" * 72)
    out("raw_text + id çekiliyor (batch=50)…")

    full_counters = {"ok": 0, "no_anchor": 0, "too_short": 0, "contaminated": 0}
    lengths: list[int] = []
    t0 = time.time()
    offset = 0
    scanned = 0

    while True:
        res = (
            sb.table("medication_kub")
            .select("id,raw_text")
            .is_("drug_interactions", "null")
            .order("id")
            .range(offset, offset + BATCH - 1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            break

        for row in rows:
            raw = (row.get("raw_text") or "").strip()
            if not raw:
                full_counters["no_anchor"] += 1
                scanned += 1
                continue
            result, reason = extract_drug_interactions(raw)
            full_counters[reason] = full_counters.get(reason, 0) + 1
            if result:
                lengths.append(len(result))
            scanned += 1

        offset += BATCH
        if offset % 500 == 0:
            print(f"  {scanned}/{null_total}  ({time.time()-t0:.0f}s)", end="\r", flush=True)

    print()
    out(f"\nTarama tamamlandı: {scanned} kayıt  ({time.time()-t0:.1f}s)\n")
    total_f = scanned
    ok_f    = full_counters.get("ok", 0)

    out(f"  ✅ Doldurulabilecek       : {ok_f:>5} / {total_f}  ({ok_f/max(1,total_f)*100:.1f}%)")
    out(f"  ⛔ Anchor bulunamadı      : {full_counters.get('no_anchor',0):>5} / {total_f}")
    out(f"  ⛔ Çok kısa (<30 char)    : {full_counters.get('too_short',0):>5} / {total_f}")
    out(f"  ⛔ Kontaminasyon filtresi : {full_counters.get('contaminated',0):>5} / {total_f}")

    if lengths:
        lengths_sorted = sorted(lengths)
        n = len(lengths_sorted)
        p25 = lengths_sorted[n // 4]
        p50 = lengths_sorted[n // 2]
        p75 = lengths_sorted[3 * n // 4]
        p95 = lengths_sorted[int(n * 0.95)]
        out(f"\n  Çıkarılan metin uzunluğu dağılımı:")
        out(f"    min={lengths_sorted[0]}  p25={p25}  p50={p50}  p75={p75}  p95={p95}  max={lengths_sorted[-1]}")

out()
out("=" * 72)
out("ONAY NOTU")
out("=" * 72)
out("  Yukarıdaki sonuçları onaylıyorsanız:")
out("  → kub_drug_interactions_apply.py çalıştırın (fill-only, güvenli yazma)")
out("  Onaylamıyorsanız anchor/filtre mantığını düzeltelim.")
out()
out("DB'ye HİÇBİR yazma yapılmadı.")

with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
    f.write("\n".join(lines_out) + "\n")

print(f"\nRapor: {OUTPUT_PATH}")
