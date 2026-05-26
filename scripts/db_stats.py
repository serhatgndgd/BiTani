"""
condition_medications tablosundan v3.8.0 istatistiklerini çeker.
"""
import os, sys
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))
supabase = create_client(os.getenv("SUPABASE_URL",""), os.getenv("SUPABASE_SERVICE_ROLE_KEY",""))

# 1. Toplam satır sayısı ve annotation_version dağılımı
resp = supabase.table("condition_medications").select("annotation_version", count="exact").execute()
total = resp.count
print(f"\nToplam satır: {total:,}")

# annotation_version bazında sayım (paginated)
versions: dict[str, int] = {}
PAGE = 1000
offset = 0
while True:
    batch = supabase.table("condition_medications").select("annotation_version, is_contraindication").range(offset, offset + PAGE - 1).execute().data or []
    for row in batch:
        v = row.get("annotation_version") or "null"
        versions[v] = versions.get(v, 0) + 1
    if len(batch) < PAGE:
        break
    offset += PAGE

print("\n--- annotation_version dağılımı ---")
for v, cnt in sorted(versions.items(), key=lambda x: -x[1]):
    print(f"  {v:30s}: {cnt:>7,}")

# 2. v3.8.0 ENDİ / KONTRA
v38 = supabase.table("condition_medications").select("is_contraindication", count="exact").eq("annotation_version", "v3.8.0").execute()
v38_rows: list[dict] = []
off2 = 0
while True:
    batch = supabase.table("condition_medications").select("is_contraindication").eq("annotation_version","v3.8.0").range(off2, off2+PAGE-1).execute().data or []
    v38_rows.extend(batch)
    if len(batch) < PAGE: break
    off2 += PAGE
endi   = sum(1 for r in v38_rows if not r["is_contraindication"])
kontra = sum(1 for r in v38_rows if r["is_contraindication"])
print(f"\n--- v3.8.0 ({len(v38_rows):,} satır) ---")
print(f"  Endikasyon       : {endi:,}")
print(f"  Kontrendikasyon  : {kontra:,}")

# 3. Şişmiş hastalıkların yeni sayıları (tüm tabloda)
hedef = ["Orta Kulak Enfeksiyonu", "Kronik Ağrı", "Üriner Sistem Enfeksiyonu"]
print("\n--- Hedef hastalıklar (tüm tablo) ---")

# Condition ID'leri çek
cats = supabase.table("conditions_catalog").select("id, name").execute().data or []
cid_map = {c["name"]: c["id"] for c in cats}

for hname in hedef:
    cid = cid_map.get(hname)
    if not cid:
        print(f"  {hname}: katalogda bulunamadı")
        continue
    rows_h: list[dict] = []
    off3 = 0
    while True:
        batch = supabase.table("condition_medications").select("is_contraindication, annotation_version").eq("condition_id", cid).range(off3, off3+PAGE-1).execute().data or []
        rows_h.extend(batch)
        if len(batch) < PAGE: break
        off3 += PAGE
    v38_h = [r for r in rows_h if r.get("annotation_version") == "v3.8.0"]
    print(f"  {hname}:")
    print(f"    Toplam        : {len(rows_h):,}  (eski v3.5.0 dahil)")
    print(f"    v3.8.0        : {len(v38_h):,}  (ENDİ={sum(1 for r in v38_h if not r['is_contraindication'])}, KONTRA={sum(1 for r in v38_h if r['is_contraindication'])})")
