"""
condition_medications tablosunun tam CSV yedeğini alır.
Çalıştır: .venv\Scripts\python.exe backup_condition_medications.py
"""
import csv
import os
import sys
import datetime
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    sys.exit("SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY eksik.")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

TABLE = "condition_medications"
PAGE  = 1000

print(f"\n{'='*60}")
print(f"  condition_medications → CSV Yedek")
print(f"{'='*60}\n")

rows: list[dict] = []
offset = 0
while True:
    resp = (
        supabase.table(TABLE)
        .select("*")
        .range(offset, offset + PAGE - 1)
        .execute()
    )
    batch = resp.data or []
    rows.extend(batch)
    print(f"  Çekilen satır: {len(rows)}", end="\r")
    if len(batch) < PAGE:
        break
    offset += PAGE

print(f"\n  Toplam satır: {len(rows)}")

if not rows:
    sys.exit("Tablo boş veya bağlantı hatası.")

ts       = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
out_path = os.path.join(os.path.dirname(__file__), f"backup_condition_medications_{ts}.csv")

fieldnames = list(rows[0].keys())
with open(out_path, "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)

print(f"  Yedek dosyası: {out_path}")
print(f"\n{'='*60}")
print(f"  Yedekleme tamamlandı — {len(rows):,} satır")
print(f"{'='*60}\n")
