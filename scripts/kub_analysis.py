"""
medication_kub kalite analizi + reparse prototipi — SADECE OKUMA, DB'ye yazma yok.

Analiz edilen kolonlar:
  therapeutic_indications, contraindications, drug_interactions,
  side_effects, composition, product_name

Kontroller:
  1) NULL / çok-kısa (<50 char) / çöp değer sayıları
  2) Kontaminasyon: indications içinde "kontrendike", contraindications içinde saf "endikasyon"
  3) Metin kirliliği: harf-arası boşluk (PDF font sorunu: "L İDODEKS", "dü şürmektedir")
  4) raw_text'ten REPARSE — KÜB bölüm numaralarıyla (1., 2., 4.1, 4.3, 4.5, 4.8)
  5) Reparse vs mevcut karşılaştırma: iyileşiyor mu, bozuluyor mu?
  6) Tavsiye: hedefli düzeltme mi yoksa full reparse mi?
"""
from __future__ import annotations

import os
import re
import sys
import time
import warnings
from collections import Counter
from typing import Optional

warnings.filterwarnings("ignore")
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "kub_analysis_report.txt")
SAMPLE_SIZE = 200   # reparse için örneklem
FULL_PASS   = True  # NULL/kirlilik istatistikleri için tüm tablo
BATCH       = 50

# ─── Çöp değer listesi ────────────────────────────────────────────────
GARBAGE_VALUES = {
    "ve", "veya", "ile", "bir", "bu", "da", "de", "yok", "var",
    "hayır", "evet", "—", "-", ".", ",", ":", " ",
    "uygulanabilir değildir", "uygulanamaz", "bilinmemektedir",
    "veri yok", "veri bulunmamaktadır",
}

# ─── KÜB reparse için bölüm anchor'ları ──────────────────────────────
# KÜB numaralandırma: 1 (ürün adı), 2 (bileşim), 4.1 (endikasyon),
# 4.3 (kontrendikasyon), 4.5 (etkileşim), 4.8 (advers/istenmeyen)
# OCR toleransı: "4.1" → "4,1" / "4. 1" / "4 .1" / "4.l" (küçük L)
# Ayrıca: hem başlık satırı ("4.1 Terapötik…") hem yalın numara satırı

_NUM = r"(?:4[\.,\s]?[lL1]|4\s*\.\s*1)"      # 4.1 varyantları
_N43 = r"(?:4[\.,\s]?3|4\s*\.\s*3)"
_N45 = r"(?:4[\.,\s]?5|4\s*\.\s*5)"
_N48 = r"(?:4[\.,\s]?8|4\s*\.\s*8)"
_N2  = r"(?:2[\.,]?\s)"
_N1  = r"(?:1[\.,]?\s)"

KUB_SECTION_PATTERNS: dict[str, list[str]] = {
    "product_name": [
        rf"^\s*{_N1}be[şs]er[iı].{{0,25}}ürün",
        r"^\s*1[\.\s].*?be[şs]er[iı]",
        r"kısa\s+ürün\s+bil",    # başlık bloğu
    ],
    "composition": [
        rf"^\s*{_N2}kalitatif.*?bile",
        rf"^\s*{_N2}bile[şs]im",
        r"kalitatif\s+ve\s+kantitatif\s+bile[şs]im",
        r"etkin\s+madde(ler)?[\s:]+",              # "Etkin madde:" direkt içerik
    ],
    "therapeutic_indications": [
        rf"^\s*{_NUM}\s*terapötik",
        rf"^\s*{_NUM}\s*endikasyon",
        rf"^\s*{_NUM}\s*kullan.m\s+alan",
        r"terapötik\s+endikasyon",
        r"endikasyon(lar)?[\s:]",
    ],
    "contraindications": [
        rf"^\s*{_N43}\s*kontrend",
        r"^\s*4[\.,\s]?3\s+kontrend",
        r"kontrendikasyon(lar)?[\s:]",
    ],
    "drug_interactions": [
        rf"^\s*{_N45}\s*di[ğg]er\s+tıbb[iı]",
        rf"^\s*{_N45}\s*etki[lş]e[şs]im",
        r"di[ğg]er\s+tıbb[iı]\s+ürünler?\s+ile\s+etki[lş]e[şs]im",
        r"ilaç\s+etki[lş]e[şs]im",
    ],
    "side_effects": [
        rf"^\s*{_N48}\s*istenmeyen",
        rf"^\s*{_N48}\s*advers",
        rf"^\s*{_N48}\s*yan\s+etki",
        r"istenmeyen\s+etkiler?",
        r"advers\s+etkiler?",
        r"yan\s+etki(ler)?[\s:]",
    ],
}

# Bir sonraki KÜB ana bölüm başlangıcı — reparse sınırı için
NEXT_SECTION_RX = re.compile(
    r"^\s*(?:"
    r"4\s*[.,]?\s*[0-9]|"      # 4.x alt bölümleri
    r"[56789][\s.,]|"           # 5, 6, 7, 8, 9
    r"10[\s.,]|11[\s.,]"
    r")",
    re.IGNORECASE,
)

# ─── Kirlilik dedektörü ───────────────────────────────────────────────
# "harf-arası boşluk": tek harf + boşluk + tek harf zinciri (≥3 kez)
# Örn: "L İDODEKS" → "L " + "İ" = harf boşluk harf başlangıcı
_SPLIT_WORD_RX = re.compile(r"(?:[A-ZÇĞIİÖŞÜa-zçğıiöşü]\s){2,}", re.UNICODE)
# Ek: tek büyük harf + boşluk + büyük harf (daha katı)
_SPLIT_UPPER_RX = re.compile(r"[A-ZÇĞIİÖŞÜ]\s[A-ZÇĞIİÖŞÜ]\s[A-ZÇĞIİÖŞÜ]", re.UNICODE)


def split_word_density(text: str) -> float:
    """Metindeki harf-arası boşluk oranı (0-1). ≥0.02 → kirli kabul."""
    if not text or len(text) < 10:
        return 0.0
    matches = _SPLIT_WORD_RX.findall(text)
    hit_chars = sum(len(m) for m in matches)
    return hit_chars / len(text)


def is_dirty(text: str) -> bool:
    return split_word_density(text) >= 0.015 or bool(_SPLIT_UPPER_RX.search(text or ""))


# ─── Kontaminasyon dedektörü ──────────────────────────────────────────
# indications'ta "kontrendike" veya "kontrendikasyon"
_KONTR_RX   = re.compile(r"kontrend", re.IGNORECASE)
# contraindications'ta "endikasyon" ama NOT "kontrendikasyon"
# Yani: "endikasyon" var AMA "kontr" yoksa →  saf false-positive
_ENDIK_PURE = re.compile(r"(?<!kontr)endikasyon", re.IGNORECASE)


def contaminated_indications(text: str) -> bool:
    return bool(_KONTR_RX.search(text or ""))


def contaminated_contraindications(text: str) -> bool:
    """'endikasyon' var ama 'kontrendikasyon' alt-dize ile korunan değil."""
    t = (text or "").lower()
    # Tüm "endikasyon" pozisyonlarını bul, her biri için 10 char öncesine bak
    for m in re.finditer(r"endikasyon", t):
        start = m.start()
        prefix = t[max(0, start - 10): start]
        if "kontr" not in prefix:
            return True
    return False


# ─── KÜB reparse ──────────────────────────────────────────────────────
def normalize_line(line: str) -> str:
    return re.sub(r"\s+", " ", line.lower().replace("'", " ").replace("'", " ")).strip()


def find_anchor(lines: list[str], patterns: list[str]) -> Optional[int]:
    """Verilen pattern listesinden herhangi birine uyan son satır indeksini döndür."""
    found = None
    for i, raw_line in enumerate(lines):
        norm = normalize_line(raw_line)
        for pat in patterns:
            if re.search(pat, norm, re.IGNORECASE):
                found = i
                break
    return found


# KÜB bölümlerinin sıralı çıkarım listesi
ORDERED_SECTIONS = [
    "product_name",
    "composition",
    "therapeutic_indications",
    "contraindications",
    "drug_interactions",
    "side_effects",
]

# Her bölümün "bitiş sinyali" — sıradaki ana KÜB bölümü
SECTION_NEXT: dict[str, list[str]] = {
    "product_name":           ["composition"],
    "composition":            ["therapeutic_indications", "contraindications"],
    "therapeutic_indications":["contraindications", "drug_interactions"],
    "contraindications":      ["drug_interactions", "side_effects"],
    "drug_interactions":      ["side_effects"],
    "side_effects":           [],
}

def extract_between(lines: list[str], start: int, end: Optional[int]) -> str:
    end_idx = end if end is not None else len(lines)
    content = "\n".join(lines[start + 1: end_idx]).strip()
    return content if content else ""


def parse_kub(raw: str) -> dict[str, Optional[str]]:
    """raw_text'ten KÜB bölümlerini çıkar. Hiçbir bölüm bulunamazsa {} döner."""
    lines = raw.split("\n")

    # Her bölüm için anchor bul
    anchors: dict[str, int] = {}
    for sec, patterns in KUB_SECTION_PATTERNS.items():
        idx = find_anchor(lines, patterns)
        if idx is not None:
            anchors[sec] = idx

    if not anchors:
        return {s: None for s in ORDERED_SECTIONS}

    # Bölümleri sıraya göre çıkar, bitiş = bir sonraki bölümün başlangıcı
    sorted_anchors = sorted(anchors.items(), key=lambda kv: kv[1])
    result: dict[str, Optional[str]] = {s: None for s in ORDERED_SECTIONS}

    for i, (sec, start) in enumerate(sorted_anchors):
        if i + 1 < len(sorted_anchors):
            end = sorted_anchors[i + 1][1]
        else:
            end = len(lines)
        content = extract_between(lines, start, end)
        result[sec] = content if content else None

    return result


# ─── Karşılaştırma ─────────────────────────────────────────────────────
def compare_sections(existing: Optional[str], reparsed: Optional[str]) -> str:
    """
    Değerlendirme:
      FILL   : existing None/boş, reparsed dolu
      IMPROVE: ikisi de dolu, reparsed daha uzun (%20+) VE kirlilik azalmış
      DAMAGE : ikisi de dolu, reparsed çok kısa (<%40 mevcut) → kayıp riski
      SAME   : fark yok / ihmal edilebilir
      NODATA : her ikisi de boş
    """
    ex_len = len((existing or "").strip())
    rp_len = len((reparsed or "").strip())

    if ex_len == 0 and rp_len == 0:
        return "NODATA"
    if ex_len == 0 and rp_len > 20:
        return "FILL"
    if ex_len > 0 and rp_len == 0:
        return "DAMAGE"
    ratio = rp_len / ex_len if ex_len else 0
    if ratio < 0.4:
        return "DAMAGE"
    if ratio > 1.2:
        return "IMPROVE"
    return "SAME"


# ═══════════════════════════════════════════════════════════════════════
# ANA AKIŞ
# ═══════════════════════════════════════════════════════════════════════

lines_out: list[str] = []

def out(s: str = "") -> None:
    print(s)
    lines_out.append(s)


out("="*72)
out("KÜB (medication_kub) KALİTE ANALİZİ RAPORU")
out("="*72)
out(f"Üretim tarihi: {time.strftime('%Y-%m-%d %H:%M:%S')}")
out(f"Örneklem (reparse): {SAMPLE_SIZE}  |  Tam tablo istatistikleri: {FULL_PASS}")
out("DB'ye HİÇBİR yazma yapılmadı.")
out()

# ─── BÖLÜM A: Tam tablo NULL / kısa / çöp istatistikleri ─────────────
out("="*72)
out("A) KOLON KALİTESİ  (tüm tablo)")
out("="*72)

TARGET_COLS = [
    "therapeutic_indications",
    "contraindications",
    "drug_interactions",
    "side_effects",
    "composition",
    "product_name",
]

# İstatistik toplayıcılar
stats: dict[str, dict] = {c: {"null": 0, "short": 0, "garbage": 0, "dirty": 0, "ok": 0, "total": 0} for c in TARGET_COLS}
contamination_indict  = 0   # indications → kontrendike
contamination_contra  = 0   # contraindications → saf endikasyon
total_rows = 0
dirty_any  = 0

out(f"Tüm tablo taranıyor ({BATCH} batch)…")
t0 = time.time()
offset = 0
while True:
    cols = ",".join(["id"] + TARGET_COLS)
    res  = sb.table("medication_kub").select(cols).order("id").range(offset, offset + BATCH - 1).execute()
    rows = res.data or []
    if not rows:
        break

    for row in rows:
        total_rows += 1
        row_dirty = False
        for col in TARGET_COLS:
            val = row.get(col) or ""
            val = val.strip() if isinstance(val, str) else ""
            stats[col]["total"] += 1
            if not val:
                stats[col]["null"] += 1
                continue
            if len(val) < 50:
                stats[col]["short"] += 1
            if val.lower().strip() in GARBAGE_VALUES or len(val) < 10:
                stats[col]["garbage"] += 1
                continue
            if is_dirty(val):
                stats[col]["dirty"] += 1
                row_dirty = True
            stats[col]["ok"] += 1

        # Kontaminasyon
        ind = (row.get("therapeutic_indications") or "")
        if contaminated_indications(ind):
            contamination_indict += 1
        ctr = (row.get("contraindications") or "")
        if contaminated_contraindications(ctr):
            contamination_contra += 1

        if row_dirty:
            dirty_any += 1

    offset += BATCH
    if offset % 500 == 0:
        pct = offset / 15503 * 100
        print(f"  {offset:>6} / ~15503 ({pct:.0f}%)  {time.time()-t0:.0f}s", end="\r", flush=True)
    if not FULL_PASS and offset >= SAMPLE_SIZE:
        break

print()
out(f"\nToplam taranan kayıt: {total_rows}  ({time.time()-t0:.1f}s)")
out()

col_w = 30
out(f"{'Kolon':<{col_w}}  {'Toplam':>7}  {'NULL':>7}  {'<50ch':>6}  {'Çöp':>5}  {'Kirli':>6}  {'NULL%':>6}  {'Kirli%':>6}")
out("-"*80)
for col in TARGET_COLS:
    s = stats[col]
    t = s["total"]
    null_pct  = s["null"] / t * 100 if t else 0
    dirty_pct = s["dirty"] / t * 100 if t else 0
    out(f"{col:<{col_w}}  {t:>7}  {s['null']:>7}  {s['short']:>6}  {s['garbage']:>5}  {s['dirty']:>6}  {null_pct:>5.1f}%  {dirty_pct:>5.1f}%")

out()
out(f"Herhangi bir kolonda kirli metin içeren satır  : {dirty_any:>6} / {total_rows}  ({dirty_any/total_rows*100:.1f}%)")

# ─── BÖLÜM B: Kontaminasyon ───────────────────────────────────────────
out()
out("="*72)
out("B) KONTAMINASYON ANALİZİ")
out("="*72)
out(f"  therapeutic_indications içinde 'kontrend*' geçen  : {contamination_indict:>6}  ({contamination_indict/total_rows*100:.1f}%)")
out(f"  contraindications içinde saf 'endikasyon' geçen   : {contamination_contra:>6}  ({contamination_contra/total_rows*100:.1f}%)")
out()
out("  NOT: contraindications'ta 'kontrendikasyon' içeren normal kabul edildi.")
out("       Yalnızca 'kontr' öneki OLMAYAN 'endikasyon' sayıldı.")

# ─── BÖLÜM C: Kirlilik örnekleri ─────────────────────────────────────
out()
out("="*72)
out("C) METİN KİRLİLİĞİ — ÖRNEKLER")
out("="*72)

out("İlk 5 kirli therapeutic_indications:")
dirty_examples: list[str] = []
res = sb.table("medication_kub").select("id,therapeutic_indications").order("id").range(0, 999).execute()
for row in (res.data or []):
    val = (row.get("therapeutic_indications") or "").strip()
    if val and is_dirty(val):
        dirty_examples.append(f"  id={str(row['id'])[:8]}…  '{val[:100]}'")
    if len(dirty_examples) >= 5:
        break
for ex in dirty_examples:
    out(ex)
if not dirty_examples:
    out("  (kirli örnek bulunamadı ilk 1000'de)")

# ─── BÖLÜM D: REPARSE prototipi ──────────────────────────────────────
out()
out("="*72)
out(f"D) REPARSE PROTOTİPİ  (örneklem: {SAMPLE_SIZE} kayıt)")
out("="*72)

REPARSE_COLS = [
    "id",
    "raw_text",
    "therapeutic_indications",
    "contraindications",
    "drug_interactions",
    "side_effects",
    "composition",
    "product_name",
]

out(f"Örneklem çekiliyor…")
samples: list[dict] = []
t1 = time.time()
for off in range(0, SAMPLE_SIZE, BATCH):
    r = sb.table("medication_kub").select(",".join(REPARSE_COLS)).order("id").range(off, off + BATCH - 1).execute()
    samples.extend(r.data or [])
samples = samples[:SAMPLE_SIZE]
out(f"  {len(samples)} kayıt  ({time.time()-t1:.1f}s)\n")

REPARSE_SECTIONS = [
    "therapeutic_indications",
    "contraindications",
    "drug_interactions",
    "side_effects",
    "composition",
    "product_name",
]

# Sonuç sayaçları: her bölüm × karar (FILL / IMPROVE / DAMAGE / SAME / NODATA)
result_counts: dict[str, Counter] = {sec: Counter() for sec in REPARSE_SECTIONS}
no_anchor_count = 0

# Reparse başarı
anchor_found = 0

for row in samples:
    raw = (row.get("raw_text") or "").strip()
    if not raw:
        no_anchor_count += 1
        continue

    reparsed = parse_kub(raw)
    has_any = any(v for v in reparsed.values())
    if has_any:
        anchor_found += 1
    else:
        no_anchor_count += 1

    for sec in REPARSE_SECTIONS:
        existing  = (row.get(sec) or "").strip() or None
        rp_val    = (reparsed.get(sec) or "").strip() or None
        decision  = compare_sections(existing, rp_val)
        result_counts[sec][decision] += 1

out(f"Reparse başarısı  : {anchor_found} / {len(samples)}  ({anchor_found/len(samples)*100:.1f}%)")
out(f"Anchor bulunamayan: {no_anchor_count} / {len(samples)}\n")

DECISIONS = ["FILL", "IMPROVE", "SAME", "DAMAGE", "NODATA"]
sec_w = 28
out(f"{'Bölüm':<{sec_w}}  " + "  ".join(f"{d:>8}" for d in DECISIONS))
out("-"*72)
for sec in REPARSE_SECTIONS:
    c = result_counts[sec]
    row_str = "  ".join(f"{c.get(d, 0):>8}" for d in DECISIONS)
    out(f"{sec:<{sec_w}}  {row_str}")

out()
out("Karar açıklamaları:")
out("  FILL   : mevcut NULL/boş → reparse dolu  (kazanç)")
out("  IMPROVE: ikisi dolu, reparse %20+ uzun  (kazanç)")
out("  SAME   : fark ihmal edilebilir          (nötr)")
out("  DAMAGE : reparse çok kısa (%40 altı)    (risk)")
out("  NODATA : her ikisi de boş               (nötr)")

# ─── BÖLÜM E: Örnek FILL ve DAMAGE vakalar ────────────────────────────
out()
out("="*72)
out("E) ÖRNEK REPARSE SONUÇLARI")
out("="*72)

fill_examples  : list[str] = []
damage_examples: list[str] = []

for row in samples:
    raw = (row.get("raw_text") or "").strip()
    if not raw:
        continue
    reparsed = parse_kub(raw)
    for sec in ["drug_interactions", "composition", "product_name"]:
        existing = (row.get(sec) or "").strip() or None
        rp_val   = (reparsed.get(sec) or "").strip() or None
        decision = compare_sections(existing, rp_val)
        if decision == "FILL" and len(fill_examples) < 3:
            fill_examples.append(
                f"  [{sec}]  id={str(row['id'])[:8]}…\n"
                f"    MevCut : NULL\n"
                f"    Reparse: '{(rp_val or '')[:120]}'"
            )
        if decision == "DAMAGE" and len(damage_examples) < 3:
            damage_examples.append(
                f"  [{sec}]  id={str(row['id'])[:8]}…\n"
                f"    Mevcut : '{(existing or '')[:80]}'\n"
                f"    Reparse: '{(rp_val or '')[:80]}'"
            )

out("\nFILL örnekleri (NULL → dolu):")
for ex in fill_examples:
    out(ex)
if not fill_examples:
    out("  (örneklem içinde FILL vakası yok)")

out("\nDAMAGE örnekleri (reparse kısaltıyor):")
for ex in damage_examples:
    out(ex)
if not damage_examples:
    out("  (örneklem içinde DAMAGE vakası yok)")

# ─── BÖLÜM F: TAVSİYE ─────────────────────────────────────────────────
out()
out("="*72)
out("F) TAVSİYE")
out("="*72)

total_fill   = sum(result_counts[s]["FILL"]   for s in REPARSE_SECTIONS)
total_improve= sum(result_counts[s]["IMPROVE"] for s in REPARSE_SECTIONS)
total_damage = sum(result_counts[s]["DAMAGE"]  for s in REPARSE_SECTIONS)
total_same   = sum(result_counts[s]["SAME"]    for s in REPARSE_SECTIONS)

out(f"Tüm bölümler toplam FILL+IMPROVE : {total_fill + total_improve}")
out(f"Tüm bölümler toplam DAMAGE       : {total_damage}")
out(f"Tüm bölümler toplam SAME         : {total_same}")
out()

damage_ratio = total_damage / max(1, total_fill + total_improve + total_damage + total_same)
out(f"Risk oranı (DAMAGE / toplam)     : {damage_ratio:.2%}")
out()

if damage_ratio < 0.05:
    out(">> TAVSİYE: FULL REPARSE — risk düşük, kazanç yüksek.")
    out("   Tüm NULL ve kısa alanları reparse ile doldurabilirsiniz.")
    out("   Kirlilik temizleme (harf-arası boşluk) de eklenebilir.")
elif damage_ratio < 0.15:
    out(">> TAVSİYE: HEDEFLİ REPARSE — orta risk.")
    out("   1) Yalnızca NULL/boş kolonları reparse ile doldur.")
    out("   2) Mevcut dolu alanları sadece kirlilik temizliği için güncelle.")
    out("   3) Kontaminasyonlu 502 endikasyon kaydını hedefli düzelt.")
else:
    out(">> TAVSİYE: HEDEFLİ DÜZELTME — reparse güvenilir değil.")
    out("   1) NULL alanları için reparse dene, sonuçları manuel gözden geçir.")
    out("   2) Kirlilik temizliği (regex tabanlı) daha güvenli.")
    out("   3) Kontaminasyonlu kayıtlar için bölüm sınırını yeniden tanımla.")

out()
out("Kirlilik detayı:")
d_interaction = stats["drug_interactions"]["dirty"]
d_total       = stats["drug_interactions"]["total"]
out(f"  drug_interactions kirli: {d_interaction}/{d_total} ({d_interaction/max(1,d_total)*100:.1f}%)")
null_interactions = stats["drug_interactions"]["null"]
out(f"  drug_interactions NULL : {null_interactions}/{d_total} ({null_interactions/max(1,d_total)*100:.1f}%)")

out()
out("="*72)
out("RAPOR SONU")
out("="*72)

# Dosyaya yaz
with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
    f.write("\n".join(lines_out) + "\n")

print(f"\nRapor yazıldı: {OUTPUT_PATH}")
