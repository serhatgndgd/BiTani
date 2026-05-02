import pandas as pd
from supabase import create_client

SUPABASE_URL = "https://jabggkqjiwctwdbiipho.supabase.co"
SUPABASE_KEY = "sb_publishable_A4qJLjOri9XlTmDRMdItPw_TDYTae2X"

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Excel'i oku
df = pd.read_excel("e482026131674.xlsx", header=1)

# NaN değerleri temizle
df = df.fillna("")

# Veriyi Supabase'e aktar (100'er 100'er)
basarili = 0
hatali = 0

for i in range(0, len(df), 100):
    batch = df.iloc[i:i+100]
    rows = []
    for _, row in batch.iterrows():
        rows.append({
            "ilac_adi": str(row["skrs_ilac_adi"]),
            "barkod": str(row["skrs_barkod"]),
            "firma": str(row["skrs_firma"]),
            "recete_turu": str(row["skrs_recet_turu"]),
            "durum": str(row["skrs_durum"])
        })
    try:
        supabase.table("ilaclar").insert(rows).execute()
        basarili += len(rows)
        print(f"{basarili} / {len(df)} aktarıldı...")
    except Exception as e:
        hatali += len(rows)
        print(f"Hata: {e}")

print(f"\nTamamlandı! {basarili} başarılı, {hatali} hatalı.")