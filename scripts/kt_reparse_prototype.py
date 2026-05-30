"""
KT (Kullanma Talimatı) yeniden parse PROTOTİPİ — yalnızca okuma + dosyaya rapor.

Hiçbir veri DB'ye yazılmaz. Sadece medication_kt.raw_text'i çeker,
5 standart bölüme ayırmayı dener, başarı oranı + sorunları raporlar.

KT Bölüm Şablonu:
  1. [İlaç] nedir ve ne için kullanılır?
  2. [İlaç] kullanmadan önce dikkat edilmesi gerekenler
  3. [İlaç] nasıl kullanılır?
  4. Olası yan etkiler nelerdir?
  5. [İlaç]'in saklanması

Strateji: ilaç adına güvenme (OCR'da bozuluyor). Yalnızca sayı + anahtar
kelimelerle anchor bul, aynı bölüm için son occurrence'ı al (TOC değil,
gerçek başlık).
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

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "kt_reparse_report.txt")
SAMPLE_SIZE = 100
BATCH = 25

# Anahtar kelimeler — OCR-toleranslı (Türkçe noktalı/noktasız varyantlar)
# Tüm karşılaştırmalar lower() üzerinde, noktalama temizlenmiş halde yapılır.
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

# Satır başı numara: 1-5 + opsiyonel nokta/parantez + boşluk + içerik
HEAD_RX = re.compile(r"^\s*([1-5])\s*[\.\)]?\s+(\S.*)$")


def normalize_for_match(s: str) -> str:
    """Anahtar kelime matching için: lowercase + noktalama temizle."""
    s = s.lower()
    s = s.replace("'", " ").replace("’", " ").replace("`", " ")
    s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def classify_header(line_content: str) -> Optional[int]:
    """Satırın hangi bölüm başlığı olduğunu döndür (1-5) veya None."""
    norm = normalize_for_match(line_content)
    # En spesifik bölümden başla — örtüşmeleri önle (örn. 1 ve 3 ikisinde de "kullan")
    for sec_id in (1, 2, 4, 5, 3):  # 3 en sona, çünkü en jenerik
        for pat in SECTION_PATTERNS[sec_id]:
            if re.search(pat, norm):
                return sec_id
    return None


def parse_kt(raw: str) -> dict:
    """raw_text'i 5 bölüme ayır. Bulamadığı bölümler için None döner."""
    lines = raw.split("\n")
    # Tüm aday başlıkları topla: (line_idx, section_id, header_text)
    candidates: list[tuple[int, int, str]] = []
    for idx, line in enumerate(lines):
        m = HEAD_RX.match(line)
        if not m:
            continue
        num_digit = int(m.group(1))
        rest = m.group(2)
        sec = classify_header(rest)
        if sec is None:
            continue
        # Numara ile anahtar kelime uyuşmalı (örn. "3. EMULİD nedir" → sahte; sec=1 ama num=3)
        if sec != num_digit:
            continue
        candidates.append((idx, sec, line.strip()))

    if not candidates:
        return {"sections": {i: None for i in range(1, 6)}, "headers": {}, "candidate_count": 0}

    # Her bölüm için SON occurrence'ı al (TOC üstte, gerçek başlık altta)
    headers: dict[int, tuple[int, str]] = {}
    for idx, sec, text in candidates:
        headers[sec] = (idx, text)

    # Bölüm sınırlarını sıraya diz
    ordered = sorted(headers.items(), key=lambda kv: kv[1][0])
    sections: dict[int, Optional[str]] = {i: None for i in range(1, 6)}
    for i, (sec, (start_idx, _header)) in enumerate(ordered):
        end_idx = ordered[i + 1][1][0] if i + 1 < len(ordered) else len(lines)
        content = "\n".join(lines[start_idx + 1:end_idx]).strip()
        sections[sec] = content if content else None

    return {
        "sections": sections,
        "headers": {sec: text for sec, (_, text) in headers.items()},
        "candidate_count": len(candidates),
    }


def ocr_noise_score(raw: str, headers: dict[int, str]) -> tuple[int, list[str]]:
    """
    Heuristic OCR gürültü skoru. Yüksek = gürültülü.
    İşaretler:
     - Wingdings/PUA karakterler (U+E000-U+F8FF) raw_text'te
     - Başlıkta beklenmeyen küçük-büyük harf karışımı (REFLoR vs REFLOR)
     - Başlıkta gereksiz apostrof (RgrloR'tın gibi)
    """
    reasons: list[str] = []
    score = 0
    pua_count = len(re.findall(r"[-]", raw))
    if pua_count > 5:
        score += 2
        reasons.append(f"PUA karakter ({pua_count})")
    # Başlıkta küçük harf burrows
    for sec, h in headers.items():
        # Drug name part: digit . (drug_name) keyword...
        m = re.match(r"^\s*[1-5]\s*[\.\)]?\s+([^\s]+(?:\s+[^\s]+){0,3})\s+(?:nedir|kullanmadan|nas[ıi]l|olas[ıi]|yan|saklan)", h, re.IGNORECASE)
        if not m:
            continue
        name = m.group(1)
        # Saf büyük harfler dışında küçük harf bulunması (örn. REFLoR)
        if re.match(r"^[A-ZÇĞIİÖŞÜ]+$", name):
            continue
        # Sadece bir kez baş harf büyük olabilir (örn. Plavix) — normal kabul
        if re.match(r"^[A-ZÇĞIİÖŞÜ][a-zçğıiöşü]+$", name):
            continue
        # Karışık vaka (REFLoR) veya apostrof içeri sızmış
        if re.search(r"[a-z][A-Z]|[A-Z][a-z][A-Z]|['’][a-z]", name):
            score += 1
            reasons.append(f"başlık-{sec}: '{name}' karışık vaka")
            break
    return score, reasons


# ─────────────────────────────────────────────────────────────────────
# 1) DB'den 100 kayıt çek
# ─────────────────────────────────────────────────────────────────────
print(f"medication_kt.raw_text örnekleri çekiliyor ({SAMPLE_SIZE} kayıt, batch={BATCH})…")
samples: list[dict] = []
t0 = time.time()
for offset in range(0, SAMPLE_SIZE, BATCH):
    res = (
        sb.table("medication_kt")
        .select("id,medication_id,raw_text")
        .order("id")
        .range(offset, offset + BATCH - 1)
        .execute()
    )
    samples.extend(res.data or [])
    print(f"  offset={offset:>3} … {len(samples)} kayıt toplandı  ({time.time()-t0:.1f}s)")
samples = samples[:SAMPLE_SIZE]
print(f"\nToplam {len(samples)} kayıt {time.time()-t0:.1f}s'de geldi.\n")


# ─────────────────────────────────────────────────────────────────────
# 2) Hepsini parse et
# ─────────────────────────────────────────────────────────────────────
results: list[dict] = []
for s in samples:
    raw = s.get("raw_text") or ""
    parsed = parse_kt(raw)
    noise_score, noise_reasons = ocr_noise_score(raw, parsed["headers"])
    results.append({
        "id": s["id"],
        "medication_id": s["medication_id"],
        "raw_len": len(raw),
        "parsed": parsed,
        "noise_score": noise_score,
        "noise_reasons": noise_reasons,
    })


# ─────────────────────────────────────────────────────────────────────
# 3) Raporu üret
# ─────────────────────────────────────────────────────────────────────
report_lines: list[str] = []


def emit(line: str = "") -> None:
    report_lines.append(line)
    print(line)


def section(title: str) -> None:
    emit("\n" + "=" * 72)
    emit(title)
    emit("=" * 72)


section("KT RE-PARSE PROTOTİPİ RAPORU")
emit(f"Örneklem: {len(results)} kayıt (medication_kt.raw_text, id sıralı)")
emit(f"Üretim tarihi: {time.strftime('%Y-%m-%d %H:%M:%S')}")
emit("Veri tabanına HİÇBİR yazma yapılmadı.")

section("1) BAŞARI ORANI")
full = sum(1 for r in results if all(r["parsed"]["sections"][i] for i in range(1, 6)))
partial = sum(1 for r in results if any(r["parsed"]["sections"][i] for i in range(1, 6)) and not all(r["parsed"]["sections"][i] for i in range(1, 6)))
empty = len(results) - full - partial
emit(f"  5/5 bölüm bulundu     : {full:>3} / {len(results)}  ({100*full/len(results):.0f}%)")
emit(f"  Kısmi (1-4 bölüm)     : {partial:>3} / {len(results)}  ({100*partial/len(results):.0f}%)")
emit(f"  Hiçbir bölüm yok      : {empty:>3} / {len(results)}  ({100*empty/len(results):.0f}%)")

section("2) HANGİ BÖLÜMLER EKSİK?")
missing_by_sec = Counter()
for r in results:
    for i in range(1, 6):
        if not r["parsed"]["sections"][i]:
            missing_by_sec[i] += 1
for i in range(1, 6):
    n = missing_by_sec.get(i, 0)
    pct = 100 * n / len(results)
    bar = "█" * int(pct / 5)
    emit(f"  Bölüm {i} ({SECTION_NAMES[i]:30s}) eksik: {n:>3}  {pct:5.1f}%  {bar}")

# Eksik bölüm desenleri
missing_combos = Counter()
for r in results:
    miss_tuple = tuple(i for i in range(1, 6) if not r["parsed"]["sections"][i])
    if miss_tuple:
        missing_combos[miss_tuple] += 1
emit("\n  En sık eksik kombinasyonlar:")
for combo, cnt in missing_combos.most_common(5):
    emit(f"    eksik={list(combo)}  →  {cnt} kayıt")

section("3) OCR GÜRÜLTÜ TESPİTİ")
noisy = [r for r in results if r["noise_score"] > 0]
clean = [r for r in results if r["noise_score"] == 0]
emit(f"  Temiz görünen kayıt        : {len(clean):>3} / {len(results)}  ({100*len(clean)/len(results):.0f}%)")
emit(f"  OCR-gürültülü görünen kayıt : {len(noisy):>3} / {len(results)}  ({100*len(noisy)/len(results):.0f}%)")
emit("\n  Gürültü sinyali dağılımı (ilk 5 örnek):")
for r in noisy[:5]:
    emit(f"    id={r['id'][:8]}…  score={r['noise_score']}  reasons={r['noise_reasons']}")

# OCR gürültüsü vs başarı korelasyonu
noisy_full = sum(1 for r in noisy if all(r["parsed"]["sections"][i] for i in range(1, 6)))
clean_full = sum(1 for r in clean if all(r["parsed"]["sections"][i] for i in range(1, 6)))
emit(f"\n  Temiz kayıtlarda 5/5 başarı : {clean_full}/{len(clean)}  ({100*clean_full/max(len(clean),1):.0f}%)")
emit(f"  Gürültülülerde 5/5 başarı   : {noisy_full}/{len(noisy)}  ({100*noisy_full/max(len(noisy),1):.0f}%)")

section("4) ORTALAMA BÖLÜM UZUNLUKLARI (karakter)")
lens_by_sec: dict[int, list[int]] = {i: [] for i in range(1, 6)}
for r in results:
    for i in range(1, 6):
        content = r["parsed"]["sections"][i]
        if content:
            lens_by_sec[i].append(len(content))
for i in range(1, 6):
    arr = lens_by_sec[i]
    if arr:
        avg = sum(arr) // len(arr)
        emit(f"  Bölüm {i} ({SECTION_NAMES[i]:30s}): n={len(arr):>3}  ort={avg:>5}  min={min(arr):>4}  max={max(arr):>5}")
    else:
        emit(f"  Bölüm {i}: hiç çıkarılamadı")

section("5) 3 ÖRNEK BÖLÜM ÇIKTI (her bölüm ilk 200 char)")
# Tam 5/5 olan ilk 3 örnek
full_examples = [r for r in results if all(r["parsed"]["sections"][i] for i in range(1, 6))][:3]
for n, r in enumerate(full_examples, 1):
    emit(f"\n── ÖRNEK {n}  id={r['id']}  med_id={r['medication_id'][:8]}…  raw={r['raw_len']} char ──")
    for i in range(1, 6):
        h = r["parsed"]["headers"].get(i, "—")
        body = (r["parsed"]["sections"][i] or "")[:200].replace("\n", " ⏎ ")
        emit(f"  [{i}] HEADER: {h}")
        emit(f"      BODY  : {body}")

if len(full_examples) < 3:
    section("5b) BAŞARISIZLIK ÖRNEKLERİ (eksik bölümleri var)")
    fail_examples = [r for r in results if not all(r["parsed"]["sections"][i] for i in range(1, 6))][:3]
    for n, r in enumerate(fail_examples, 1):
        miss = [i for i in range(1, 6) if not r["parsed"]["sections"][i]]
        emit(f"\n── KIRIK {n}  id={r['id']}  eksik={miss}  raw={r['raw_len']} char ──")
        for i in range(1, 6):
            h = r["parsed"]["headers"].get(i, "❌ başlık bulunamadı")
            body = r["parsed"]["sections"][i]
            if body:
                body_str = body[:200].replace("\n", " ⏎ ")
            else:
                body_str = "❌ içerik çıkarılamadı"
            emit(f"  [{i}] HEADER: {h}")
            emit(f"      BODY  : {body_str}")


# ─────────────────────────────────────────────────────────────────────
# 6) SONUÇ + KOLON YAPISI ÖNERİSİ
# ─────────────────────────────────────────────────────────────────────
section("6) SONUÇ VE ÖNERİ")
success_rate = 100 * full / len(results)
emit(f"\n  Bu strateji ile başarı oranı     : %{success_rate:.0f} (tam 5/5)")
emit(f"  Kısmi başarı dahil               : %{100*(full+partial)/len(results):.0f}")

emit("\n  KIRILDIĞI YERLER:")
if missing_combos:
    top_combo, top_cnt = missing_combos.most_common(1)[0]
    emit(f"    • En sık eksik kombinasyon : {list(top_combo)}  ({top_cnt} kayıt)")
emit(f"    • Bölüm-3 ('nasıl kullanılır') eksik    : {missing_by_sec.get(3,0)} kayıt")
emit(f"    • Bölüm-4 ('olası yan etkiler') eksik   : {missing_by_sec.get(4,0)} kayıt")
emit(f"    • OCR-gürültülü kayıtların {100*(len(noisy)-noisy_full)/max(len(noisy),1):.0f}%'i başarısız")

emit("""
  KOLON YAPISI ÖNERİSİ (medication_kt yeniden inşa edilirse):
    - id                          uuid PK
    - medication_id               uuid → medicationsV2(id) NOT NULL
    - raw_text                    text NOT NULL    (orijinal PDF metni — referans)
    - section_1_nedir             text             (1. ... nedir ve ne için kullanılır?)
    - section_2_kullanmadan_once  text             (2. ... kullanmadan önce dikkat edilmesi gerekenler)
    - section_3_nasil_kullanilir  text             (3. ... nasıl kullanılır?)
    - section_4_yan_etkiler       text             (4. olası yan etkiler nelerdir?)
    - section_5_saklanmasi        text             (5. ... saklanması)
    - parse_version               text             ('v2-prototype' gibi)
    - parse_quality_score         int              (5=tam, 4=bir bölüm eksik, ...)
    - source_url                  text
    - parsed_at                   timestamptz default now()
    - created_at                  timestamptz default now()

  Mevcut 14+ kolon yerine 5 anlamlı + raw_text yeterli. LLM'in birden
  fazla bölümü birleştirmesine gerek kalmaz.

  YAYINLAMA ÖNCESİ ÖNERİ:
    1. Burada gözle 3 örneği doğrula.
    2. Tam tabloda kuru-koşum yap (bu script SAMPLE_SIZE=15473 ile).
    3. Başarı %95+ ise gerçek upsert için ayrı script yaz (idempotent,
       sadece eski section_* NULL olan kayıtları doldur).
    4. Bu prototip ASLA UPDATE çağırmıyor — güvenlik açısından commit'le.
""")

# Dosyaya yaz
with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
    f.write("\n".join(report_lines))

print(f"\n📄 Rapor yazıldı: {OUTPUT_PATH}")
print(f"DB'ye HİÇBİR yazma yapılmadı.")
