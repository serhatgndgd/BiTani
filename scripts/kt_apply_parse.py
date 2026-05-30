"""
medication_kt yeniden-parse UPDATE pipeline'ı.

KESİN KURALLAR:
  - SADECE şu kolonlar yazılır:
      section_1_nedir, section_2_kullanmadan_once,
      section_3_nasil_kullanilir, section_4_yan_etkiler,
      section_5_saklanmasi, parse_quality_score, parse_version
  - raw_text VE TÜM eski kolonlar (what_is_it, before_using, do_not_use,
    use_carefully, food_and_drink, pregnancy, breastfeeding,
    driving_and_machine_use, important_excipients, drug_interactions,
    how_to_use, possible_side_effects, storage_information,
    health_personnel_info) DOKUNULMAZ
  - INSERT yok, DELETE yok — sadece UPDATE
  - IDEMPOTENT: aynı raw_text → aynı çıktı → aynı UPDATE değerleri

KULLANIM:
  Dry-run (varsayılan, hiçbir şey yazmaz):
      python scripts/kt_apply_parse.py
  Tam tabloda UYGULA (50 kayıt yerine hepsi, gerçekten UPDATE):
      python scripts/kt_apply_parse.py --apply
  Sadece N kayıtta dry-run:
      python scripts/kt_apply_parse.py --limit 50
  Tam tabloda UYGULA (ekstra onay):
      python scripts/kt_apply_parse.py --apply --confirm-i-understand
"""
from __future__ import annotations

import argparse
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

# ── parser sabitleri (prototip ile aynı) ─────────────────────────────
PARSE_VERSION = "kt-v2"
SECTION_PATTERNS = {
    1: [r"nedir.*ne.{0,3}i.in.*kullan", r"ne.{0,3}i.in.*kullan"],
    2: [r"kullanmadan.{0,5}.nce", r"dikkat.{0,5}edilmesi"],
    3: [r"nas.l.{0,5}kullan"],
    4: [r"olas.\s*yan.{0,5}etki", r"yan.{0,5}etkiler.{0,5}nelerdir"],
    5: [r"saklan"],
}
HEAD_SINGLE_RX = re.compile(r"^\s*([1-5])\s*[\.\)]?\s+(\S.*)$")
HEAD_COMBO_RX = re.compile(
    r"^\s*([1-5])\s*(?:[-–~/,]|\s+ve\s+)\s*([1-5])\s*[\.\)]?\s+(\S.*)$",
    re.IGNORECASE,
)
WRITE_COLS = (
    "section_1_nedir",
    "section_2_kullanmadan_once",
    "section_3_nasil_kullanilir",
    "section_4_yan_etkiler",
    "section_5_saklanmasi",
    "parse_quality_score",
    "parse_version",
)
SECTION_COL = {
    1: "section_1_nedir",
    2: "section_2_kullanmadan_once",
    3: "section_3_nasil_kullanilir",
    4: "section_4_yan_etkiler",
    5: "section_5_saklanmasi",
}


def normalize_for_match(s: str) -> str:
    s = s.lower()
    s = s.replace("'", " ").replace("’", " ").replace("`", " ")
    s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def classify_header(line_content: str) -> Optional[int]:
    norm = normalize_for_match(line_content)
    for sec_id in (1, 2, 4, 5, 3):
        for pat in SECTION_PATTERNS[sec_id]:
            if re.search(pat, norm):
                return sec_id
    return None


def parse_kt(raw: str) -> dict:
    lines = raw.split("\n")
    candidates: list[tuple[int, int, Optional[int], str]] = []
    for idx, line in enumerate(lines):
        m_combo = HEAD_COMBO_RX.match(line)
        if m_combo:
            n1 = int(m_combo.group(1))
            n2 = int(m_combo.group(2))
            sec = classify_header(m_combo.group(3))
            if sec in (n1, n2):
                candidates.append((idx, n1, n2, line.strip()))
            continue
        m = HEAD_SINGLE_RX.match(line)
        if not m:
            continue
        num = int(m.group(1))
        sec = classify_header(m.group(2))
        if sec is None or sec != num:
            continue
        candidates.append((idx, sec, None, line.strip()))

    sections: dict[int, Optional[str]] = {i: None for i in range(1, 6)}
    if not candidates:
        return {"sections": sections, "score": 0}

    headers: dict[int, tuple[int, str]] = {}
    for idx, primary, secondary, text in candidates:
        headers[primary] = (idx, text)
        if secondary is not None:
            headers[secondary] = (idx, text)

    sorted_starts = sorted({start for (start, _) in headers.values()})
    for sec, (start_idx, _) in headers.items():
        nxt = [s for s in sorted_starts if s > start_idx]
        end_idx = nxt[0] if nxt else len(lines)
        content = "\n".join(lines[start_idx + 1:end_idx]).strip()
        sections[sec] = content if content else None

    score = sum(1 for v in sections.values() if v)
    return {"sections": sections, "score": score}


MIN_TRUSTED_SCORE = 2  # score < 2 → tüm section'lar NULL (TOC-swallow korunması)


def build_payload(parsed: dict) -> dict:
    """UPDATE payload — daima 7 kolon. None değerler de gönderilir (idempotent).

    Güvenlik kemeri: score < MIN_TRUSTED_SCORE ise (yani 0 veya 1 bölüm bulunmuşsa),
    bulunan tek bölüm büyük ihtimalle TOC anchor'ına takılıp doküman gövdesini
    yutmuştur (örn. AVERFLU vakası). Bu durumda tüm section'ları NULL'a zorla,
    parse_quality_score'u olduğu gibi koru → OCR kuyruğu için tespit edilebilsin.
    """
    score = parsed["score"]
    if score < MIN_TRUSTED_SCORE:
        sections: dict[int, Optional[str]] = {i: None for i in range(1, 6)}
    else:
        sections = parsed["sections"]
    payload = {SECTION_COL[i]: sections[i] for i in range(1, 6)}
    payload["parse_quality_score"] = score
    payload["parse_version"] = PARSE_VERSION
    return payload


# ── CLI ──────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(description="medication_kt re-parse pipeline")
parser.add_argument("--apply", action="store_true",
                    help="Gerçek UPDATE yap (varsayılan: dry-run)")
parser.add_argument("--confirm-i-understand", action="store_true",
                    help="--apply ile birlikte tam tabloda yazmayı onayla")
parser.add_argument("--limit", type=int, default=50,
                    help="Kaç kayıt işlensin (varsayılan dry-run: 50, --apply: 0=tüm tablo)")
parser.add_argument("--batch", type=int, default=200,
                    help="Çekme batch boyutu (varsayılan 200)")
parser.add_argument("--progress-every", type=int, default=2000,
                    help="Kaç kayıtta bir ilerleme yazılsın (varsayılan 2000)")
args = parser.parse_args()

DRY = not args.apply
if args.apply and not args.confirm_i_understand and (args.limit == 0 or args.limit > 500):
    print("❌ --apply ile büyük UPDATE için --confirm-i-understand bayrağı zorunlu.")
    print("   Önce --limit 50 ile dry-run inceleyin.")
    sys.exit(1)

# --apply moduna geçildiğinde varsayılan limit yok (tüm tablo)
if args.apply and args.limit == 50:
    print("ℹ  --apply modunda limit=50 olarak ayarlı. Tüm tablo için --limit 0 verin.")

LIMIT = args.limit if args.limit > 0 else 10**9
BATCH = args.batch
PROGRESS = args.progress_every

mode = "DRY-RUN (yazma yok)" if DRY else "APPLY (UPDATE çalıştırılacak)"
print(f"medication_kt re-parse pipeline'ı başlıyor")
print(f"  mod        : {mode}")
print(f"  limit      : {LIMIT if LIMIT < 10**9 else 'tüm tablo'}")
print(f"  batch boyu : {BATCH}")
print(f"  parse_version yazılacak: '{PARSE_VERSION}'")
print()

t0 = time.time()
processed = 0
updated = 0
quality_dist: Counter[int] = Counter()
update_errors = 0
sample_previews: list[dict] = []  # dry-run için ilk 5 örnek
offset = 0

while processed < LIMIT:
    take = min(BATCH, LIMIT - processed)
    try:
        res = (
            sb.table("medication_kt")
            .select("id,raw_text")
            .order("id")
            .range(offset, offset + take - 1)
            .execute()
        )
        batch = res.data or []
    except Exception as e:
        print(f"  ⚠ fetch offset={offset} timeout, atlanıyor: {str(e)[:80]}")
        offset += take
        continue

    if not batch:
        break

    for rec in batch:
        rid = rec["id"]
        raw = rec.get("raw_text") or ""
        parsed = parse_kt(raw)
        score = parsed["score"]
        quality_dist[score] += 1
        payload = build_payload(parsed)

        if DRY:
            # ilk 5 başarılı ve ilk 5 başarısız örneği topla
            if len(sample_previews) < 10:
                sample_previews.append({
                    "id": rid,
                    "score": score,
                    "payload": payload,
                })
        else:
            try:
                sb.table("medication_kt").update(payload).eq("id", rid).execute()
                updated += 1
            except Exception as e:
                update_errors += 1
                if update_errors <= 5:
                    print(f"  ⚠ UPDATE hatası id={rid}: {str(e)[:120]}")

        processed += 1
        if processed >= LIMIT:
            break

    if len(batch) < take:
        break
    offset += take

    if processed % PROGRESS == 0 or (DRY and processed >= LIMIT):
        elapsed = time.time() - t0
        rate = processed / elapsed if elapsed else 0
        print(f"  ilerleme: {processed:>5} kayıt  ({elapsed:.0f}s, {rate:.0f}/s)  "
              f"score-dağılımı={dict(quality_dist)}")

elapsed = time.time() - t0
print()
print("=" * 64)
print(f"Bitti. {processed} kayıt işlendi, {elapsed:.1f}s "
      f"({processed/elapsed:.0f} kayıt/s)")
print(f"  Mod                  : {mode}")
print(f"  UPDATE edilen kayıt  : {updated if not DRY else 0}")
print(f"  UPDATE hatası        : {update_errors}")
print()
print("Score dağılımı:")
total = max(processed, 1)
for s in range(5, -1, -1):
    n = quality_dist[s]
    pct = 100 * n / total
    bar = "█" * int(pct / 2)
    print(f"  score={s}  →  {n:>5} kayıt  ({pct:5.1f}%)  {bar}")
print()

if DRY and sample_previews:
    print("=" * 64)
    print("YAZILACAK ÖRNEKLER (DRY-RUN — DB değişmedi)")
    print("=" * 64)
    for n, ex in enumerate(sample_previews, 1):
        print(f"\n── ÖRNEK {n}  id={ex['id']}  score={ex['score']} ──")
        p = ex["payload"]
        print(f"  parse_quality_score = {p['parse_quality_score']}")
        print(f"  parse_version       = {p['parse_version']!r}")
        for i in range(1, 6):
            col = SECTION_COL[i]
            v = p[col]
            if v is None:
                print(f"  {col:30s} = NULL")
            else:
                prev = v[:140].replace("\n", " ⏎ ")
                print(f"  {col:30s} ({len(v):>5} char) = {prev}…")

if DRY:
    print()
    print("Bu çıktı yalnızca DRY-RUN — DB değişmedi.")
    print("Gerçek UPDATE için: python scripts/kt_apply_parse.py --apply "
          "--limit 0 --confirm-i-understand")
else:
    print()
    print(f"✅ {updated} kayıt UPDATE edildi.")
    print("Yazılan kolonlar yalnızca: " + ", ".join(WRITE_COLS))
    print("raw_text ve diğer eski kolonlar değiştirilmedi.")
