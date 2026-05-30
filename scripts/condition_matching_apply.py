"""
ADIM 3 — APPLY.  condition_medications tablosuna YAZAR.

ÖN KOŞUL: migration çalıştırılmış olmalı (tablo var olmalı).
  supabase/migrations/20260529190000_condition_medications.sql

Akış (dry-run ile BİREBİR aynı eşleştirme mantığı):
  1) KÜB + KT endikasyon metinleri çekilir.
  2) condition_matcher ile eşleştirilir.
  3) condition_medications'a BATCH upsert (on_conflict ile UNIQUE güvenli).

Güvenlik:
  • Yalnız condition_medications'a yazar; başka tabloya DOKUNMAZ.
  • upsert(on_conflict="condition_id,medication_id") → tekrar çalıştırma
    güvenli (idempotent), çift satır oluşmaz.
  • CONFIRM=1 ortam değişkeni olmadan ÇALIŞMAZ.

Çalıştır:  CONFIRM=1 .venv/bin/python condition_matching_apply.py
"""
from __future__ import annotations
import os, sys, time, warnings
from collections import defaultdict

warnings.filterwarnings("ignore")
from dotenv import load_dotenv
from supabase import create_client
from condition_matcher import Matcher

HERE = os.path.dirname(__file__)
load_dotenv(os.path.join(HERE, ".env"))

if os.environ.get("CONFIRM") != "1":
    sys.exit("GÜVENLİK: Bu script DB'ye YAZAR. Çalıştırmak için: "
             "CONFIRM=1 .venv/bin/python condition_matching_apply.py")

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
PAGE = 1000
BATCH = 500


def fetch_all(table: str, col: str) -> dict[str, str]:
    acc: dict[str, str] = {}
    offset = 0
    while True:
        r = (sb.table(table).select(f"medication_id,{col}")
             .not_.is_(col, "null").order("medication_id")
             .range(offset, offset + PAGE - 1).execute())
        rows = r.data or []
        if not rows:
            break
        for row in rows:
            if row.get("medication_id") and row.get(col):
                acc[row["medication_id"]] = row[col]
        offset += PAGE
    return acc


print("=" * 60)
print("APPLY — condition_medications doldurma")
print("=" * 60)

# Tablo var mı?
try:
    sb.table("condition_medications").select("id").limit(1).execute()
except Exception as e:
    sys.exit(f"HATA: condition_medications tablosu yok. Önce migration çalıştırın.\n{e}")

print("Kaynak metinler çekiliyor…")
kub = fetch_all("medication_kub", "therapeutic_indications")
kt  = fetch_all("medication_kt", "section_1_nedir")
all_mids = set(kub) | set(kt)
print(f"  KÜB={len(kub)}  KT={len(kt)}  birleşik={len(all_mids)}")

print("Eşleştiriliyor…")
matcher = Matcher()
records: list[dict] = []
per_condition: dict[str, int] = defaultdict(int)
t1 = time.time()
for i, mid in enumerate(all_mids, 1):
    for cid, (conf, ev) in matcher.match(kt.get(mid), kub.get(mid)).items():
        records.append({
            "condition_id": cid,
            "medication_id": mid,
            "confidence_score": conf,
            "evidence": ev[:2000],
        })
        per_condition[cid] += 1
    if i % 1000 == 0:
        print(f"  {i}/{len(all_mids)}  ({time.time()-t1:.0f}s)", end="\r", flush=True)
print(f"\n  Toplam eşleşme: {len(records)}")

print("DB'ye yazılıyor (upsert)…")
written = 0
t2 = time.time()
for off in range(0, len(records), BATCH):
    batch = records[off:off + BATCH]
    sb.table("condition_medications").upsert(
        batch, on_conflict="condition_id,medication_id").execute()
    written += len(batch)
    print(f"  {written}/{len(records)}  ({time.time()-t2:.0f}s)", end="\r", flush=True)
print()

final = sb.table("condition_medications").select("id", count="exact").limit(1).execute().count
print("=" * 60)
print(f"TAMAMLANDI — yazılan: {written}  |  tablodaki satır: {final}")
print("=" * 60)
