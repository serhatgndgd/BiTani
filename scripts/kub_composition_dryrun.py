"""
composition FILL-ONLY dry-run.

Kural:
  - WHERE composition IS NULL
  - raw_text'ten KÜB bölüm 2 (kalitatif/kantitatif/etkin madde) reparse
  - Güvenlik: <30 char → skip, raw_text yok → skip
  - DB'ye HİÇBİR yazma
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

DRYRUN_SAMPLE = 50
FULL_SCAN     = True
BATCH         = 50
OUTPUT_PATH   = os.path.join(os.path.dirname(__file__), "kub_composition_dryrun.txt")

# ──────────────────────────────────────────────────────────────────────
# Bölüm 2 anchor — OCR toleranslı
# KÜB formatı: "2. KALİTATİF VE KANTİTATİF BİLEŞİM"
# veya direkt içerik: "Etkin madde:" satırı
# ──────────────────────────────────────────────────────────────────────
_N2 = r"2\s*[.,]?\s*"   # "2." / "2," / "2 "

COMPOSITION_PATTERNS = [
    # Başlık satırı — numara zorunlu (B: gevşek "etkin madde" kaldırıldı)
    rf"^\s*{_N2}kalitatif\s+ve\s+kantitatif",
    rf"^\s*{_N2}kalitatif.*bile[şs]im",
    rf"^\s*{_N2}bile[şs]im",
    # Sadece başlık kelimesi (numara satırı ayrı, içerik bir sonraki satır)
    r"kalitatif\s+ve\s+kantitatif\s+bile[şs]im",
    # B: etkin madde anchor — satır başı + iki nokta zorunlu (gevşek kelime değil)
    r"^\s*etkin\s+madde(ler)?\s*:",
]

# Bitiş sinyali: bölüm 3 (farmasötik form) veya 4 (klinik özellikler)
NEXT_SECTION_PATTERNS = [
    r"^\s*3\s*[.,\s]",          # 3. Farmasötik form
    r"^\s*4\s*[.,\s]",          # 4. Klinik özellikler
    r"farmas[öo]tik\s+form",    # başlık kelimesi
    r"klinik\s+[öo]zellik",
]


def normalize(line: str) -> str:
    s = line.lower()
    s = s.replace("'", " ").replace("'", " ")
    s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE)
    return re.sub(r"\s+", " ", s).strip()


def find_composition_anchor(lines: list[str]) -> Optional[int]:
    """Bölüm 2 başlık satırının son occurrence index'ini döndür."""
    found: Optional[int] = None
    for i, raw in enumerate(lines):
        norm = normalize(raw)
        for pat in COMPOSITION_PATTERNS:
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


# A: kontaminasyon dedektörü — yanlış bölüm sinyalleri
_KONTR_RX = re.compile(r"kontrend",   re.IGNORECASE)
_ENDIK_RX = re.compile(r"endikasyon", re.IGNORECASE)


def extract_composition(raw: str) -> tuple[Optional[str], str]:
    """
    raw_text'ten bölüm 2'yi çıkar.
    (metin | None, sebep) döner.
    sebep: "ok" | "no_anchor" | "too_short" | "contaminated"
    """
    lines = raw.split("\n")
    start = find_composition_anchor(lines)
    if start is None:
        return None, "no_anchor"

    end = find_next_section(lines, start)
    content = "\n".join(lines[start + 1: end] if end else lines[start + 1:]).strip()

    if not content or len(content) < 30:
        return None, "too_short"

    # A: kontaminasyon — yanlış bölüm çekilmişse "kontrendike" veya "endikasyon" yoğun olur
    words = max(1, len(content.split()))
    kontr_hits = len(_KONTR_RX.findall(content))
    endik_hits = len(_ENDIK_RX.findall(content))
    if kontr_hits / words > 0.03 or endik_hits / words > 0.05:
        return None, "contaminated"

    return content, "ok"


# ══════════════════════════════════════════════════════════════════════

lines_out: list[str] = []

def out(s: str = "") -> None:
    print(s)
    lines_out.append(s)


out("=" * 72)
out("composition FILL-ONLY DRY-RUN")
out("=" * 72)
out(f"Üretim tarihi: {time.strftime('%Y-%m-%d %H:%M:%S')}")
out("DB'ye HİÇBİR yazma yapılmadı.")
out()

# NULL toplam
count_res = (
    sb.table("medication_kub")
    .select("id", count="exact")
    .is_("composition", "null")
    .execute()
)
null_total = count_res.count
out(f"composition IS NULL toplam: {null_total}")
out()

# İlk 50 örnek
out(f"İlk {DRYRUN_SAMPLE} NULL kayıt çekiliyor…")
sample_res = (
    sb.table("medication_kub")
    .select("id,raw_text,composition,product_name")
    .is_("composition", "null")
    .order("id")
    .limit(DRYRUN_SAMPLE)
    .execute()
)
samples = sample_res.data or []
out(f"{len(samples)} kayıt geldi.\n")

out("=" * 72)
out(f"ÖRNEK SONUÇLAR — 50 kayıt tarandı, ✅ olanlar gösteriliyor")
out("=" * 72)

counters = {"ok": 0, "no_anchor": 0, "too_short": 0, "contaminated": 0, "no_raw": 0}
ok_shown  = 0
skip_shown = 0   # skip tiplerinden birer örnek göster (debug için)
skip_seen: dict[str, int] = {}

for i, row in enumerate(samples):
    raw  = (row.get("raw_text") or "").strip()
    name = (row.get("product_name") or "?")[:40]
    rid  = str(row.get("id", ""))[:8]

    if not raw:
        counters["no_raw"] += 1
        result, reason = None, "no_raw"
    else:
        result, reason = extract_composition(raw)
        counters[reason] = counters.get(reason, 0) + 1

    # ✅ olanları göster (max 5)
    if reason == "ok" and ok_shown < 5:
        ok_shown += 1
        preview = (result or "").replace("\n", " / ")
        if len(preview) > 280:
            preview = preview[:200] + "  …  " + preview[-60:]
        has_etkin = bool(re.search(r"etkin\s+madde", result or "", re.IGNORECASE))
        out(f"\n[✅ {ok_shown}] id={rid}…  {name}")
        out(f"     İçerik: '{preview}'")
        out(f"     Uzunluk: {len(result or '')} char  |  Etkin madde ifadesi: {'✅' if has_etkin else '❌'}")

    # Kontaminasyon örneği — 1 tane göster (filtrenin çalıştığını doğrula)
    elif reason == "contaminated" and skip_seen.get("contaminated", 0) < 1:
        skip_seen["contaminated"] = skip_seen.get("contaminated", 0) + 1
        preview = "  (içerik gizlendi — kontaminasyon nedeniyle skip)"
        out(f"\n[⛔ KONTR] id={rid}…  {name}")
        out(f"     Sebep: kontaminasyon filtresi devrede{preview}")

# Özet
out()
out("=" * 72)
out(f"İLK {len(samples)} KAYIT ÖZETİ")
out("=" * 72)
total = len(samples)
out(f"  ✅ Doldurulacak (ok)       : {counters.get('ok',0):>4} / {total}  ({counters.get('ok',0)/total*100:.1f}%)")
out(f"  ⛔ Anchor bulunamadı       : {counters.get('no_anchor',0):>4} / {total}")
out(f"  ⛔ Çok kısa (<30 char)     : {counters.get('too_short',0):>4} / {total}")
out(f"  ⛔ Kontaminasyon           : {counters.get('contaminated',0):>4} / {total}")
out(f"  ⛔ raw_text yok            : {counters.get('no_raw',0):>4} / {total}")

# Tam tablo tarama
if FULL_SCAN and null_total > 0:
    out()
    out("=" * 72)
    out(f"TAM TABLO TARAMASI ({null_total} NULL kayıt)")
    out("=" * 72)
    out("Taranıyor…")

    full = {"ok": 0, "no_anchor": 0, "too_short": 0, "contaminated": 0, "no_raw": 0}
    lengths: list[int] = []
    t0 = time.time()
    offset = 0
    scanned = 0

    while True:
        res = (
            sb.table("medication_kub")
            .select("id,raw_text")
            .is_("composition", "null")
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
                full["no_raw"] += 1
                scanned += 1
                continue
            result, reason = extract_composition(raw)
            full[reason] = full.get(reason, 0) + 1
            if result:
                lengths.append(len(result))
            scanned += 1
        offset += BATCH
        if offset % 500 == 0:
            print(f"  {scanned}/{null_total}  ({time.time()-t0:.0f}s)", end="\r", flush=True)

    print()
    out(f"\nTarama tamamlandı: {scanned} kayıt  ({time.time()-t0:.1f}s)\n")
    ok_f = full.get("ok", 0)
    out(f"  ✅ Doldurulabilecek       : {ok_f:>5} / {scanned}  ({ok_f/max(1,scanned)*100:.1f}%)")
    out(f"  ⛔ Anchor bulunamadı      : {full.get('no_anchor',0):>5} / {scanned}")
    out(f"  ⛔ Çok kısa (<30 char)    : {full.get('too_short',0):>5} / {scanned}")
    out(f"  ⛔ Kontaminasyon          : {full.get('contaminated',0):>5} / {scanned}")
    out(f"  ⛔ raw_text yok           : {full.get('no_raw',0):>5} / {scanned}")

    if lengths:
        ls = sorted(lengths)
        n  = len(ls)
        out(f"\n  Uzunluk dağılımı:")
        out(f"    min={ls[0]}  p25={ls[n//4]}  p50={ls[n//2]}  p75={ls[3*n//4]}  p95={ls[int(n*.95)]}  max={ls[-1]}")

out()
out("=" * 72)
out("ONAY NOTU")
out("=" * 72)
out("  Onaylıyorsanız → kub_composition_apply.py çalıştırın.")
out("  DB'ye HİÇBİR yazma yapılmadı.")

with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
    f.write("\n".join(lines_out) + "\n")

print(f"\nRapor: {OUTPUT_PATH}")
