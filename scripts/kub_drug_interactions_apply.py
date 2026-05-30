"""
drug_interactions FILL-ONLY APPLY

Kesin kurallar:
  - WHERE drug_interactions IS NULL olan kayıtları çek
  - raw_text'ten 4.5 bölümünü reparse et
  - Güvenlik: <30 char → skip, kontaminasyon → skip
  - Yalnızca drug_interactions kolonu güncellenir
  - Dolu kayıtlara (IS NOT NULL) ASLA dokunulmaz
  - Anchor bulunamazsa kayıt NULL kalır
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

BATCH         = 50    # çekme batch'i
WRITE_BATCH   = 25    # upsert batch'i (küçük tut — RLS güvenli)
OUTPUT_PATH   = os.path.join(os.path.dirname(__file__), "kub_drug_interactions_apply_log.txt")

# ──────────────────────────────────────────────────────────────────────
# Dry-run ile aynı parser — değişiklik YOK
# ──────────────────────────────────────────────────────────────────────
_N45_VARIANTS = r"4\s*[.,]?\s*5"

INTERACTION_PATTERNS = [
    rf"^\s*{_N45_VARIANTS}\s+di[ğg]er\s+t[iı]bb[iı]",
    rf"^\s*{_N45_VARIANTS}\s+etki[lş]e[şs]im",
    rf"^\s*{_N45_VARIANTS}\s+ilaç",
    r"di[ğg]er\s+t[iı]bb[iı]\s+ürünler?\s+ile\s+etki[lş]e[şs]im",
    r"ilaç\s+etki[lş]e[şs]im",
    rf"^\s*{_N45_VARIANTS}\s*$",
]

NEXT_SECTION_PATTERNS = [
    r"^\s*4\s*[.,]?\s*6",
    r"^\s*4\s*[.,]?\s*7",
    r"^\s*4\s*[.,]?\s*8",
    r"^\s*4\s*[.,]?\s*9",
    r"^\s*5\s*[.,\s]",
    r"^\s*6\s*[.,\s]",
]

_KONTR_RX = re.compile(r"kontrend", re.IGNORECASE)


def normalize(line: str) -> str:
    s = line.lower()
    s = s.replace("'", " ").replace("'", " ")
    s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE)
    return re.sub(r"\s+", " ", s).strip()


def find_4_5_anchor(lines: list[str]) -> Optional[int]:
    found: Optional[int] = None
    for i, raw in enumerate(lines):
        norm = normalize(raw)
        for pat in INTERACTION_PATTERNS:
            if re.search(pat, norm, re.IGNORECASE):
                found = i
                break
    return found


def find_next_section(lines: list[str], after: int) -> Optional[int]:
    for i in range(after + 1, len(lines)):
        norm = normalize(lines[i])
        for pat in NEXT_SECTION_PATTERNS:
            if re.search(pat, norm, re.IGNORECASE):
                return i
    return None


def extract_drug_interactions(raw: str) -> tuple[Optional[str], str]:
    lines = raw.split("\n")
    start = find_4_5_anchor(lines)
    if start is None:
        return None, "no_anchor"
    end = find_next_section(lines, start)
    content = "\n".join(lines[start + 1: end] if end else lines[start + 1:]).strip()
    if not content or len(content) < 30:
        return None, "too_short"
    kontr_hits = len(_KONTR_RX.findall(content))
    if kontr_hits > 0 and kontr_hits / max(1, len(content.split())) > 0.05:
        return None, "contaminated"
    return content, "ok"


# ══════════════════════════════════════════════════════════════════════
# ANA AKIŞ
# ══════════════════════════════════════════════════════════════════════

lines_log: list[str] = []

def log(s: str = "") -> None:
    print(s)
    lines_log.append(s)


log("=" * 72)
log("drug_interactions FILL-ONLY APPLY")
log("=" * 72)
log(f"Başlangıç: {time.strftime('%Y-%m-%d %H:%M:%S')}")
log("Kural: WHERE drug_interactions IS NULL — dolu kayıtlara dokunulmaz.")
log()

# NULL toplam
count_res = (
    sb.table("medication_kub")
    .select("id", count="exact")
    .is_("drug_interactions", "null")
    .execute()
)
null_total = count_res.count
log(f"NULL kayıt sayısı (başlangıç): {null_total}")
log()

# ── Tüm NULL kayıtları çek → parse → toplu yaz ────────────────────────
counters = {"written": 0, "no_anchor": 0, "too_short": 0, "contaminated": 0, "no_raw": 0}
write_buffer: list[dict] = []   # {"id": ..., "drug_interactions": ...}
t0 = time.time()
offset = 0
fetched = 0

def flush_buffer() -> None:
    """Write buffer'ı DB'ye yaz."""
    if not write_buffer:
        return
    for item in write_buffer:
        sb.table("medication_kub").update(
            {"drug_interactions": item["drug_interactions"]}
        ).eq("id", item["id"]).is_("drug_interactions", "null").execute()
        # .is_("drug_interactions", "null") — ek güvenlik: dolu olursa yazmaz
    counters["written"] += len(write_buffer)
    write_buffer.clear()


log(f"{'Offset':>8}  {'Çekilen':>8}  {'Yazılan':>8}  {'Anchor Yok':>10}  {'Süre':>6}")
log("-" * 55)

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
            counters["no_raw"] += 1
            continue

        result, reason = extract_drug_interactions(raw)
        if reason == "ok" and result:
            write_buffer.append({"id": row["id"], "drug_interactions": result})
        else:
            counters[reason] = counters.get(reason, 0) + 1

        if len(write_buffer) >= WRITE_BATCH:
            flush_buffer()

    fetched += len(rows)
    elapsed = time.time() - t0
    log(f"{offset:>8}  {fetched:>8}  {counters['written']:>8}  {counters['no_anchor']:>10}  {elapsed:>5.0f}s")
    offset += BATCH

# Kalan buffer'ı yaz
flush_buffer()

elapsed_total = time.time() - t0

log()
log("=" * 72)
log("SONUÇ")
log("=" * 72)
log(f"Bitiş: {time.strftime('%Y-%m-%d %H:%M:%S')}")
log(f"Toplam süre          : {elapsed_total:.1f}s  ({elapsed_total/60:.1f} dak)")
log()
log(f"  ✅ Yazılan          : {counters['written']}")
log(f"  ⛔ Anchor yok       : {counters['no_anchor']}")
log(f"  ⛔ Çok kısa         : {counters['too_short']}")
log(f"  ⛔ Kontaminasyon    : {counters['contaminated']}")
log(f"  ⛔ raw_text yok     : {counters['no_raw']}")
log()

# Yeni doluluk oranı
after_res = (
    sb.table("medication_kub")
    .select("id", count="exact")
    .is_("drug_interactions", "null")
    .execute()
)
null_after = after_res.count
total_res = sb.table("medication_kub").select("id", count="exact").execute()
total = total_res.count

filled_before = total - null_total
filled_after  = total - null_after
pct_before    = filled_before / total * 100
pct_after     = filled_after  / total * 100

log(f"drug_interactions doluluk:")
log(f"  Önce : {filled_before:>6} / {total}  ({pct_before:.1f}%)")
log(f"  Sonra: {filled_after:>6} / {total}  ({pct_after:.1f}%)")
log(f"  Artış: +{counters['written']} kayıt  (+{pct_after - pct_before:.1f} puan)")

log()
log("=" * 72)
log("LOG SONU")
log("=" * 72)

with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
    f.write("\n".join(lines_log) + "\n")

print(f"\nLog: {OUTPUT_PATH}")
