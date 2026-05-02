from supabase import create_client

SUPABASE_URL = "https://jabggkqjiwctwdbiipho.supabase.co"
SUPABASE_KEY = "sb_publishable_A4qJLjOri9XlTmDRMdItPw_TDYTae2X"

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# İlaç adına göre arama
aranan = "aspirin"

sonuclar = supabase.table("ilaclar")\
    .select("ilac_adi, barkod, firma, recete_turu")\
    .ilike("ilac_adi", f"%{aranan}%")\
    .limit(10)\
    .execute()

print(f"'{aranan}' için {len(sonuclar.data)} sonuç bulundu:\n")
for ilac in sonuclar.data:
    print(f"- {ilac['ilac_adi']} | {ilac['firma']} | {ilac['recete_turu']}")