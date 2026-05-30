"""
therapeutic_indications kontaminasyon temizliği — DRY-RUN, DB'ye yazma yok.

699 kayıtta therapeutic_indications içine kontrendikasyon metni taşmış.
Strateji:
  - "kontrendike" ilk geçtiği konumdan ÖNCE biten kısmı gerçek endikasyon say
  - Kesme noktası: kontrendike sinyali veren satırın başı
  - Güvenlik: kesince geriye < 50 char kalıyorsa → DOKUNMA

Kesme sinyalleri (sırasıyla):
  1. Satır başında "kontrendike" kelimesi
  2. Satır başında KÜB 4.3 numarası (4.3, 4,3, vb.)
  3. Satır başında "aşağıdaki durumlarda kullanılmamalı"
  4. Satır başında "kullanılmamalıdır" — kesin uyarı
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
BATCH         = 50
OUTPUT_PATH   = os.path.join(os.path.dirname(__file__), "kub_indications_decontam_dryrun.txt")

# ──────────────────────────────────────────────────────────────────────
# Kesme noktası tespiti
# ──────────────────────────────────────────────────────────────────────
# Bir satırın "kontrendikasyon bölümü başlangıcı" olduğunu gösteren sinyaller
# v2: SADECE güçlü 4 sinyal — INLINE_KONTR fallback kaldırıldı
# "kontrendike olduğu durumlarda kullanılır" endikasyon cümleleri korunur.
CUT_PATTERNS = [
    # 1. KÜB 4.3 bölüm numarası — satır başında
    r"^\s*4\s*[.,]?\s*3[\s.,]",
    r"^\s*4\s*[.,]?\s*3\s*$",
    # 2. "kontrendike/kasyon" satır BAŞINDA (endikasyon cümlesi ortasında değil)
    r"^\s*kontrend",
    # 3. "kullanılmamalıdır / kullanılmamalı" — yasak ifadesi
    r"kullan[iı]lmamal[iı](d[iı]r)?",
    # 4. Kontrendikasyon başlık satırı (tek başına, yalnızca bu kelimeden oluşan)
    r"^\s*kontrend[iı]kasyon(lar)?\s*$",
]

# Hala INLINE_KONTR — sadece "bu kayıtta kontrendike var mı?" kontrolü için
# find_cut_line'da fallback olarak KULLANILMAZ
_HAS_KONTR = re.compile(r"kontrend", re.IGNORECASE)


def normalize_line(line: str) -> str:
    s = line.lower().replace("‘", " ").replace("’", " ")
    s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE)
    return re.sub(r"\s+", " ", s).strip()


def find_cut_line(text: str) -> Optional[int]:
    """
    Güçlü sinyal: satır başı CUT_PATTERNS'den ilk eşleşen satır index'i.
    INLINE fallback YOK — satır ortasındaki "kontrendike olduğu" korunur.
    None → kesme noktası bulunamadı (kayda dokunulmaz).
    """
    lines = text.split("\n")
    for i, line in enumerate(lines):
        norm = normalize_line(line)
        for pat in CUT_PATTERNS:
            if re.search(pat, norm, re.IGNORECASE):
                return i
    return None


def trim_indication(text: str) -> tuple[Optional[str], str]:
    """
    Kontaminasyonu kes.
    Döner: (temizlenmiş_metin | None, karar)
    karar: "trimmed" | "too_short_after_trim" | "no_cut_needed" | "no_kontr"
    """
    if not _HAS_KONTR.search(text):
        return None, "no_kontr"   # Bu fonksiyona bu kayıt gelmemeli zaten

    cut_idx = find_cut_line(text)
    if cut_idx is None:
        return None, "no_cut_needed"

    lines = text.split("\n")
    before = "\n".join(lines[:cut_idx]).strip()

    if len(before) < 50:
        return None, "too_short_after_trim"

    return before, "trimmed"


# ══════════════════════════════════════════════════════════════════════

lines_out: list[str] = []

def out(s: str = "") -> None:
    print(s)
    lines_out.append(s)


out("=" * 72)
out("therapeutic_indications DECONTAMINASYON DRY-RUN")
out("=" * 72)
out(f"Üretim tarihi: {time.strftime('%Y-%m-%d %H:%M:%S')}")
out("DB'ye HİÇBİR yazma yapılmadı.")
out()

# Kontamine kayıt sayısını doğrula
count_res = (
    sb.table("medication_kub")
    .select("id", count="exact")
    .ilike("therapeutic_indications", "%kontrendike%")
    .execute()
)
kontr_total = count_res.count
out(f"'kontrendike' içeren therapeutic_indications: {kontr_total}")
out()

# İlk DRYRUN_SAMPLE kaydı çek
out(f"İlk {DRYRUN_SAMPLE} kontamine kayıt çekiliyor…")
sample_res = (
    sb.table("medication_kub")
    .select("id,therapeutic_indications,product_name")
    .ilike("therapeutic_indications", "%kontrendike%")
    .order("id")
    .limit(DRYRUN_SAMPLE)
    .execute()
)
samples = sample_res.data or []
out(f"{len(samples)} kayıt geldi.\n")

# ── Her kaydı işle ────────────────────────────────────────────────────
counters = {
    "trimmed":              0,
    "too_short_after_trim": 0,
    "no_cut_needed":        0,
    "no_kontr":             0,
}
shown_trimmed   = 0
shown_risky     = 0
shown_protected = 0   # no_cut_needed — satır-ici "kontrendike", korundu

out("=" * 72)
out("ÖRNEKLER (trimmed: max 10 | riskli: max 3 | korunan: max 3)")
out("=" * 72)

for i, row in enumerate(samples):
    text = (row.get("therapeutic_indications") or "").strip()
    name = (row.get("product_name") or "?")[:40]
    rid  = str(row.get("id", ""))[:8]

    result, decision = trim_indication(text)
    counters[decision] = counters.get(decision, 0) + 1

    # Başarılı trim — max 10 göster
    if decision == "trimmed" and shown_trimmed < 10:
        shown_trimmed += 1
        before_preview = text[:200].replace("\n", " | ")
        after_preview  = (result or "")[:160].replace("\n", " | ")
        cut_idx = find_cut_line(text)
        cut_line = text.split("\n")[cut_idx].strip()[:90] if cut_idx is not None else "?"
        out(f"\n[TRIM {shown_trimmed:>2}] id={rid}  {name}")
        out(f"  ÖNCE  ({len(text):>5} ch): '{before_preview}'")
        out(f"  KES   : '{cut_line}'")
        out(f"  SONRA ({len(result or ''):>5} ch): '{after_preview}'")

    # Riskli — max 3
    elif decision == "too_short_after_trim" and shown_risky < 3:
        shown_risky += 1
        before_preview = text[:150].replace("\n", " | ")
        cut_idx = find_cut_line(text)
        cut_line = text.split("\n")[cut_idx].strip()[:90] if cut_idx is not None else "?"
        lines_b = text.split("\n")[:cut_idx] if cut_idx is not None else []
        rem = len("\n".join(lines_b).strip())
        out(f"\n[RISK  {shown_risky}] id={rid}  {name}  (kesince {rem} ch < 50)")
        out(f"  Mevcut ({len(text):>5} ch): '{before_preview}'")
        out(f"  KES   : '{cut_line}'")
        out(f"  -> DOKUNULMAYACAK")

    # Korunan (no_cut_needed — inline "kontrendike", güçlü sinyal yok) — max 3
    elif decision == "no_cut_needed" and shown_protected < 3:
        shown_protected += 1
        preview = text[:200].replace("\n", " | ")
        out(f"\n[KORU  {shown_protected}] id={rid}  {name}")
        out(f"  ({len(text)} ch, güçlü sinyal yok — endikasyon cümlesi korundu)")
        out(f"  '{preview}'")

# ── Özet ──────────────────────────────────────────────────────────────
out()
out("=" * 72)
out(f"İLK {len(samples)} KONTAMINE KAYIT ÖZETİ")
out("=" * 72)
total = len(samples)
tr  = counters.get("trimmed", 0)
ts  = counters.get("too_short_after_trim", 0)
nc  = counters.get("no_cut_needed", 0)
nk  = counters.get("no_kontr", 0)
out(f"  TRIM  Temizlenebilir               : {tr:>4} / {total}  ({tr/total*100:.1f}%)")
out(f"  RISK  Riskli (kesince <50 ch)     : {ts:>4} / {total}  ({ts/total*100:.1f}%)")
out(f"  KORU  Korunan (inline, no signal) : {nc:>4} / {total}  ({nc/total*100:.1f}%)")
out(f"  ----  kontrendike yok (DB hatasi) : {nk:>4} / {total}")

# ── Tam tablo tarama ──────────────────────────────────────────────────
out()
out("=" * 72)
out(f"TAM TABLO TARAMASI ({kontr_total} kontamine kayıt)")
out("=" * 72)
out("Taranıyor…")

full = {"trimmed": 0, "too_short_after_trim": 0, "no_cut_needed": 0, "no_kontr": 0}
trim_gains: list[int] = []   # temizlenen karakter sayısı (ne kadar kısalıyor)
t0 = time.time()
offset = 0
scanned = 0

while True:
    res = (
        sb.table("medication_kub")
        .select("id,therapeutic_indications")
        .ilike("therapeutic_indications", "%kontrendike%")
        .order("id")
        .range(offset, offset + BATCH - 1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        break

    for row in rows:
        text = (row.get("therapeutic_indications") or "").strip()
        result, decision = trim_indication(text)
        full[decision] = full.get(decision, 0) + 1
        if decision == "trimmed" and result:
            trim_gains.append(len(text) - len(result))
        scanned += 1

    offset += BATCH
    if offset % 200 == 0:
        print(f"  {scanned}/{kontr_total}  ({time.time()-t0:.0f}s)", end="\r", flush=True)

print()
out(f"\nTarama tamamlandı: {scanned} kayıt  ({time.time()-t0:.1f}s)\n")

tr_f = full.get("trimmed", 0)
ts_f = full.get("too_short_after_trim", 0)
nc_f = full.get("no_cut_needed", 0)
out(f"  TRIM  Temizlenebilir               : {tr_f:>4} / {scanned}  ({tr_f/max(1,scanned)*100:.1f}%)")
out(f"  RISK  Riskli (kesince <50 ch)      : {ts_f:>4} / {scanned}  ({ts_f/max(1,scanned)*100:.1f}%)")
out(f"  KORU  Korunan (inline, no signal)  : {nc_f:>4} / {scanned}  ({nc_f/max(1,scanned)*100:.1f}%)")

if trim_gains:
    tg = sorted(trim_gains)
    n  = len(tg)
    out(f"\n  Kesilen karakter dağılımı (ne kadar kısaldı):")
    out(f"    min={tg[0]}  p25={tg[n//4]}  p50={tg[n//2]}  p75={tg[3*n//4]}  max={tg[-1]}")
    out(f"    Toplam temizlenen: {sum(tg):,} char  ({sum(tg)//max(1,n)} char/kayıt ortalama)")

out()
out("=" * 72)
out("ONAY NOTU")
out("=" * 72)
out("  Onaylıyorsanız → kub_indications_decontam_apply.py çalıştırın.")
out("  DB'ye HİÇBİR yazma yapılmadı.")

with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
    f.write("\n".join(lines_out) + "\n")

print(f"\nRapor: {OUTPUT_PATH}")
