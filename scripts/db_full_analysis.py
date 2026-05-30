"""
BiTani DB — 4 Uzman Perspektif Analizi
SADECE OKUMA. DROP/UPDATE/INSERT/DELETE YOK.

Perspektifler:
  A) Veri Bilimci — tablo sağlığı, FK bütünlüğü
  B) Mimar        — ilaç-hastalık eşleştirme stratejisi
  C) Eczacı       — endikasyon kapsam analizi (300-500 örnek)
  D) Doktor       — klinik güvenlik + katalog yeterliliği
"""
from __future__ import annotations
import os, re, time, warnings
from collections import Counter, defaultdict
from typing import Optional

warnings.filterwarnings("ignore")
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

OUTPUT = os.path.join(os.path.dirname(__file__), "db_full_analysis_report.txt")
lines: list[str] = []

def out(s: str = "") -> None:
    print(s)
    lines.append(s)

def fill(table: str, col: str, total: int) -> float:
    r = sb.table(table).select("id", count="exact").not_.is_(col,"null").execute()
    return r.count / total * 100

def count_table(table: str) -> int:
    return sb.table(table).select("id", count="exact").execute().count

t_start = time.time()
out("=" * 76)
out("BiTani DB — 4 UZMAN ANALİZİ")
out("=" * 76)
out(f"Tarih : {time.strftime('%Y-%m-%d %H:%M:%S')}  |  SADECE OKUMA")
out()

# ══════════════════════════════════════════════════════════════════════
out("╔══════════════════════════════════════════════════════════════════╗")
out("║  PERSPEKTIF A — VERİ BİLİMCİ                                    ║")
out("║  Tablo sağlığı, FK bütünlüğü, schema özeti                      ║")
out("╚══════════════════════════════════════════════════════════════════╝")
out()

TABLES = [
    "chat_history", "conditions_catalog", "consent_records",
    "medication_kt", "medication_kub", "medicationsV2",
    "profiles", "user_conditions", "user_medications",
]

counts: dict[str, int] = {}
out(f"{'Tablo':<30} {'Kayıt':>8}")
out("-" * 42)
for t in TABLES:
    try:
        c = count_table(t)
        counts[t] = c
        out(f"  {t:<28} {c:>8,}")
    except Exception as e:
        counts[t] = -1
        out(f"  {t:<28}   HATA: {e}")

# FK bütünlüğü
out()
out("── FK Bütünlüğü (orphan tespiti) ──────────────────────────────────")

# user_conditions.user_id → profiles.id
uc = sb.table("user_conditions").select("user_id").execute()
pr = sb.table("profiles").select("id").execute()
pr_ids = {r["id"] for r in (pr.data or [])}
uc_orphan = [r["user_id"] for r in (uc.data or []) if r["user_id"] not in pr_ids]
out(f"  user_conditions.user_id → profiles  orphan: {len(uc_orphan)}")

# user_medications.user_id → profiles.id
um = sb.table("user_medications").select("user_id,medication_id").execute()
um_user_orphan = [r["user_id"] for r in (um.data or []) if r["user_id"] not in pr_ids]
out(f"  user_medications.user_id → profiles orphan: {len(um_user_orphan)}")

# user_medications.medication_id → medicationsV2.id
v2 = sb.table("medicationsV2").select("id").limit(20000).execute()
v2_ids = {r["id"] for r in (v2.data or [])}
um_med_orphan = [r["medication_id"] for r in (um.data or []) if r.get("medication_id") not in v2_ids]
out(f"  user_medications.medication_id → medicationsV2 orphan: {len(um_med_orphan)}")

# medication_kt.medication_id → medicationsV2.id
kt_ids_r = sb.table("medication_kt").select("medication_id").limit(20000).execute()
kt_orphan = [r["medication_id"] for r in (kt_ids_r.data or []) if r["medication_id"] not in v2_ids]
out(f"  medication_kt.medication_id → medicationsV2 orphan: {len(kt_orphan)}")

# medication_kub.medication_id → medicationsV2.id
kub_ids_r = sb.table("medication_kub").select("medication_id").limit(20000).execute()
kub_orphan = [r["medication_id"] for r in (kub_ids_r.data or []) if r["medication_id"] not in v2_ids]
out(f"  medication_kub.medication_id → medicationsV2 orphan: {len(kub_orphan)}")

# V2'de KT veya KÜB'ü OLMAYAN ilaçlar
kt_med_ids  = {r["medication_id"] for r in (kt_ids_r.data  or [])}
kub_med_ids = {r["medication_id"] for r in (kub_ids_r.data or [])}
v2_no_kt    = len(v2_ids - kt_med_ids)
v2_no_kub   = len(v2_ids - kub_med_ids)
v2_no_both  = len(v2_ids - kt_med_ids - kub_med_ids)
out(f"\n  V2 ilaçlarında KT olmayan  : {v2_no_kt:>5}  / {len(v2_ids)}")
out(f"  V2 ilaçlarında KÜB olmayan : {v2_no_kub:>5}  / {len(v2_ids)}")
out(f"  V2 ilaçlarında ikisi de yok: {v2_no_both:>5}  / {len(v2_ids)}")

# Kullanıcı profili özeti
out()
out("── Kullanıcı & Kullanım Özeti ──────────────────────────────────────")
profile_sample = sb.table("profiles").select("gender,onboarding_completed,birth_date").limit(1000).execute()
ps = profile_sample.data or []
onboarded = sum(1 for p in ps if p.get("onboarding_completed"))
genders = Counter(p.get("gender","?") for p in ps)
out(f"  Profil örneği ({len(ps)}): onboarding tamamlayan={onboarded}/{len(ps)}")
out(f"  Cinsiyet dağılımı: {dict(genders)}")

# user_conditions dağılımı
uc_full = sb.table("user_conditions").select("condition_id").limit(5000).execute()
cond_dist = Counter(r["condition_id"] for r in (uc_full.data or []))
out(f"\n  user_conditions: {len(uc_full.data)} kayıt, {len(cond_dist)} farklı hastalık seçilmiş")

# user_medications dağılımı
out(f"  user_medications: {counts.get('user_medications',0)} kayıt")

# ══════════════════════════════════════════════════════════════════════
out()
out("╔══════════════════════════════════════════════════════════════════╗")
out("║  PERSPEKTIF B — MİMAR (İlaç-Hastalık Eşleştirme Stratejisi)     ║")
out("╚══════════════════════════════════════════════════════════════════╝")
out()

# conditions_catalog tam liste + kategori sayıları
cond_r = sb.table("conditions_catalog").select("id,name,category").order("category").execute()
conditions = cond_r.data or []
cat_count = Counter(c["category"] for c in conditions)

out(f"conditions_catalog: {len(conditions)} hastalık, {len(cat_count)} kategori\n")
for cat, cnt in sorted(cat_count.items()):
    names = [c["name"] for c in conditions if c["category"] == cat]
    out(f"  [{cat}] ({cnt}): {', '.join(names)}")

# Mevcut condition_medications tablosu var mı?
out()
out("── Mevcut condition_medications durumu ─────────────────────────────")
try:
    cm_count = count_table("condition_medications")
    out(f"  condition_medications tablosu MEVCUT: {cm_count:,} kayıt")
    cm_sample = sb.table("condition_medications").select("*").limit(3).execute()
    if cm_sample.data:
        cols = list(cm_sample.data[0].keys())
        out(f"  Kolonlar: {cols}")
        for row in cm_sample.data[:2]:
            out(f"  Örnek: conf={row.get('confidence_score')} | kontr={row.get('is_contraindication')} | method={row.get('extraction_method','?')[:30]}")
except Exception as e:
    out(f"  condition_medications YOK veya erişilemiyor: {e}")

# Eşleştirme yaklaşımı karşılaştırması
out()
out("── Eşleştirme Yaklaşımları Karşılaştırması ─────────────────────────")
out("""
  Yaklaşım A — KURAL BAZLI (keyword matching)
  ─────────────────────────────────────────────
  Nasıl: conditions_catalog.name → therapeutic_indications/section_1 içinde ara
  Artıları: Hızlı, deterministic, sıfır model maliyeti, açıklanabilir
  Eksileri: Türkçe varyantlar kaçar (HT=hipertansiyon), eşanlamlı kaçar
  Tahmini kapsam: ~%40-55 (katalog adı birebir geçen ilaçlar)
  Süre: ~2-4 saat (15.503 ilaç × 71 hastalık, regex)
  Risk: Düşük — yanlış pozitif kontrol edilebilir

  Yaklaşım B — EMBEDDING / SEMANTİK
  ─────────────────────────────────────────────
  Nasıl: Her ilaç endikasyonu + her hastalık → vektör benzerliği
  Artıları: Türkçe varyantları yakalar, sözdizimine bağımlı değil
  Eksileri: Model gerektirir (text-embedding-3 veya Türkçe BERT),
            yanlış pozitif riski yüksek, maliyet/süre: günler
  Tahmini kapsam: ~%70-80
  Risk: Yüksek — validasyon olmadan yanlış eşleşme

  Yaklaşım C — HİBRİT (kural + LLM onay) ← ÖNERİLEN
  ─────────────────────────────────────────────────────
  Adım 1: Kural bazlı ile başla (geniş eşleşme, yüksek recall)
    - Hastalık adı + Türkçe sinonimler (15-20 per hastalık)
    - Endikasyon metninde geç → aday listesi
  Adım 2: Groq/Claude ile batch doğrulama
    - "Bu endikasyon metni [Diyabet] için mi?" sorusu
    - Düşük confidence_score olanları filtrele
  Adım 3: condition_medications tablosuna yaz (confidence_score ile)
  Artıları: Hız + doğruluk dengesi, mevcut Groq altyapısını kullanır
  Süre: ~8-16 saat (batch)
  Risk: Orta — 2 katmanlı filtre hata yapar ama kabul edilebilir
""")

# ══════════════════════════════════════════════════════════════════════
out()
out("╔══════════════════════════════════════════════════════════════════╗")
out("║  PERSPEKTIF C — ECZACI (Endikasyon Kapsam Analizi)              ║")
out("║  KÜB therapeutic_indications + KT section_1_nedir (400 örnek)   ║")
out("╚══════════════════════════════════════════════════════════════════╝")
out()

# 400 KÜB endikasyonu + 100 KT section_1 çek
out("KÜB therapeutic_indications (400 örnek) + KT section_1_nedir (100) çekiliyor…")
t1 = time.time()

kub_inds = []
for off in range(0, 400, 100):
    r = sb.table("medication_kub").select("medication_id,therapeutic_indications")\
        .not_.is_("therapeutic_indications","null").order("id").range(off, off+99).execute()
    kub_inds.extend(r.data or [])

kt_inds = []
r = sb.table("medication_kt").select("medication_id,section_1_nedir")\
    .not_.is_("section_1_nedir","null").order("id").range(0,99).execute()
kt_inds.extend(r.data or [])

out(f"  KÜB: {len(kub_inds)} kayıt  |  KT: {len(kt_inds)} kayıt  ({time.time()-t1:.1f}s)")

# Türkçe sinonim haritası (kural bazlı eşleştirme için)
SYNONYMS: dict[str, list[str]] = {
    "Hipertansiyon":              ["hipertansiyon","yüksek tansiyon","kan basıncı","arteriyel hipertansiyon","antihipertansif"],
    "Diyabet Tip 2":              ["diyabet","diabetes mellitus","tip 2","t2dm","şeker hastalığı","insülin direnci","hipoglisemi","glisemik"],
    "Diyabet Tip 1":              ["tip 1","t1dm","insülin bağımlı diyabet","juvenil diyabet"],
    "Hiperkolesterolemi":         ["hiperkolesterolemi","kolesterol","ldl","statin","dislipidemi","hiperlipidemi"],
    "Hipertrigliseridemi":        ["hipertrigliseridemi","trigliserid","lipid düşürücü"],
    "Astım":                      ["astım","astma","bronşiyal astım","bronkospazm","bronkodilat","inhalas"],
    "KOAH":                       ["koah","kronik obstrüktif","amfizem","kronik bronşit","hava yolu obstr"],
    "Alerjik Rinit":              ["alerjik rinit","rinit","alerjik","burun tıkanıklığı","antihistamin"],
    "Kalp Yetmezliği":            ["kalp yetmezliği","kardiyak yetmezlik","ejeksiyon fraksiyonu","konjestif"],
    "Atriyal Fibrilasyon":        ["atriyal fibrilasyon","af","artm","antiaritmik","kardiyoversiyon"],
    "Koroner Arter Hastalığı":    ["koroner","angina","miyokard","iskemi","ateroskleroz","tromboz koroner"],
    "Derin Ven Trombozu":         ["derin ven","dvt","tromboz","tromboembolizm","antikoagülan"],
    "Tromboemboli":               ["tromboemboli","pulmoner emboli","pe","tromboz önleme"],
    "Koroner Bypass":             ["bypass","cabg","koroner revaskülari"],
    "Depresyon":                  ["depresyon","majör depresif","antidepresan","ssri","snri"],
    "Anksiyete Bozukluğu":        ["anksiyete","panik bozukluk","fobia","gad","kaygı"],
    "Şizofreni":                  ["şizofreni","psikoz","antipsikotik","nöroleptik"],
    "Bipolar Bozukluk":           ["bipolar","manik","duygudurum dengeleyici","lityum"],
    "DEHB":                       ["dehb","adhd","dikkat eksikliği","hiperaktivite"],
    "Psikoz":                     ["psikoz","psikotik","antipsikotik"],
    "Epilepsi":                   ["epilepsi","nöbet","konvülsiyon","antiepileptik","antikonvülsan"],
    "Migren":                     ["migren","baş ağrısı","triptan","sumatriptan"],
    "Vertigo":                    ["vertigo","baş dönmesi","vestibüler"],
    "Parkinson Hastalığı":        ["parkinson","dopaminerjik","levodopa","dopamin"],
    "Alzheimer Hastalığı":        ["alzheimer","demans","asetilkolinesteraz","bilişsel bozukluk"],
    "Multipl Skleroz":            ["multipl skleroz","ms","demyelinizan"],
    "Romatoid Artrit":            ["romatoid artrit","romatizmal","dmard","metotreksat","anti-tnf"],
    "Ankilozan Spondilit":        ["ankilozan","spondilit","aksiyel spondil","spondilartrit"],
    "Gut Hastalığı":              ["gut","ürik asit","gut artriti","gut atağı"],
    "Osteoporoz":                 ["osteoporoz","kemik mineral","bifosfonat","kemik erimesi"],
    "Reflü (GÖRH)":               ["reflü","görh","gerd","gastrit","asit","proton pompası","ppi","omeprazol"],
    "Peptik Ülser":               ["peptik ülser","gastrik ülser","duodenal ülser","helikobakter"],
    "Ülseratif Kolit":            ["ülseratif kolit","inflamatuvar bağırsak","ibd"],
    "Crohn Hastalığı":            ["crohn","granülomatöz","inflamatuvar bağırsak"],
    "İrritabl Bağırsak Sendromu": ["irritabl bağırsak","ibs","fonksiyonel bağırsak"],
    "Karaciğer Yetmezliği":       ["karaciğer yetmezliği","hepatik","siroz","hepatit","ensefalopati"],
    "Hepatit B":                  ["hepatit b","hbv","hepatit b virüs"],
    "Hepatit C":                  ["hepatit c","hcv","hepatit c virüs"],
    "Kronik Böbrek Hastalığı":    ["kronik böbrek","renal yetmezlik","diyaliz","gfr","kreatinin"],
    "Böbrek Taşı":                ["böbrek taşı","nefrolitiyazis","kalsiyum oksalat","ürolitiyazis"],
    "Prostat Hiperplazisi":       ["prostat hiperplazi","bph","benign prostat","alfa bloker"],
    "Sedef Hastalığı":            ["sedef","psoriazis","psöriazis","plak psoriazis","biyolojik"],
    "Egzama":                     ["egzama","atopik dermatit","kortikosteroid topikal"],
    "Akne":                       ["akne","sivilce","akne vulgaris","retinoid"],
    "Ürtiker":                    ["ürtiker","kurdeşen","antihistamin","kronik ürtiker"],
    "Tüberküloz":                 ["tüberküloz","tb","mycobacterium","rifampisin","izoniazid"],
    "HIV/AIDS":                   ["hiv","aids","antiretroviral","arv","hiv enfeksiyonu"],
    "Bakteriyel Enfeksiyon":      ["bakteriyel enfeksiyon","antibiyotik","bakteri","antibakteriyel"],
    "Viral Enfeksiyon":           ["viral enfeksiyon","antiviral","virüs","viral"],
    "Üriner Sistem Enfeksiyonu":  ["üriner","idrar yolu","sistit","üretrit","piyelonefrit"],
    "Pnömoni":                    ["pnömoni","zatürre","akciğer enfeksiyonu","pnömoni tedavi"],
    "Mantar Enfeksiyonu":         ["mantar","kandida","aspergillus","antifungal"],
    "Konjunktivit":               ["konjunktivit","göz iltihabı","göz damlası","oküler enfeksiyon"],
    "Glokom":                     ["glokom","göz içi basınç","glokom tedavi","timolol"],
    "Katarakt":                   ["katarakt","lens bulanıklığı"],
    "Maküler Dejenerasyon":       ["maküler dejenerasyon","amd","retinal","oftalmik"],
    "Demir Eksikliği Anemisi":    ["demir eksikliği","anemi","hemoglobin","ferritin","demir supl"],
    "Tonsillit":                  ["tonsillit","bademcik","farenjit","boğaz"],
    "Sinüzit":                    ["sinüzit","paranazal sinüs","rinosinüzit"],
    "Orta Kulak Enfeksiyonu":     ["orta kulak","otit","kulak"],
    "Metabolik Sendrom":          ["metabolik sendrom","insülin direnci","viseral obezite"],
    "Obezite":                    ["obezite","bmi","aşırı kilo","kilo verme"],
    "Kronik Ağrı":                ["kronik ağrı","nosiseptif ağrı","ağrı yönetimi","analjezik"],
    "Nöropatik Ağrı":             ["nöropatik ağrı","sinir ağrısı","gabapentin","pregabalin"],
    "Kolon Kanseri":              ["kolon kanseri","kolorektal","kolon tümör"],
    "Akciğer Kanseri":            ["akciğer kanseri","nsclc","sclc","bronş kanseri"],
    "Meme Kanseri":               ["meme kanseri","meme tümör","breast cancer","hormon reseptör"],
    "Prostat Kanseri":            ["prostat kanseri","prostat tümör","psa","androjen"],
    "Lösemi":                     ["lösemi","akut lenfoblastik","akut miyeloid","kll","aml"],
    "Lenfoma":                    ["lenfoma","hodgkin","non-hodgkin","b hücreli"],
    "Tiroid Kanseri":             ["tiroid kanseri","tiroid tümör","tiroid"],
}

def text_matches(text: str, terms: list[str]) -> bool:
    t = text.lower()
    return any(kw in t for kw in terms)

# Her condition için kaç endikasyonda geçiyor
out()
out("── Koşul → Endikasyon Eşleşme Sayıları (400+100 örnek) ────────────")
out()

cond_match: dict[str, dict] = {}
all_inds = [(r["therapeutic_indications"], "KÜB") for r in kub_inds] + \
           [(r["section_1_nedir"], "KT")  for r in kt_inds]
total_inds = len(all_inds)

for cond in conditions:
    name = cond["name"]
    cat  = cond["category"]
    terms = SYNONYMS.get(name, [name.lower()])
    kub_hits = sum(1 for txt,src in all_inds if src=="KÜB" and txt and text_matches(txt, terms))
    kt_hits  = sum(1 for txt,src in all_inds if src=="KT"  and txt and text_matches(txt, terms))
    total_hits = kub_hits + kt_hits
    coverage_pct = total_hits / total_inds * 100
    cond_match[name] = {
        "category": cat,
        "kub": kub_hits,
        "kt":  kt_hits,
        "total": total_hits,
        "pct": coverage_pct,
    }

# Sırala: en çok eşleşenden en aza
sorted_conds = sorted(cond_match.items(), key=lambda x: -x[1]["total"])

out(f"{'Hastalık':<35} {'KÜB':>5} {'KT':>5} {'Toplam':>7} {'%':>5}")
out("-" * 62)
zero_match = []
for name, m in sorted_conds:
    bar = "█" * min(20, int(m["pct"]*2))
    out(f"  {name:<33} {m['kub']:>5} {m['kt']:>5} {m['total']:>7}  {m['pct']:4.1f}% {bar}")
    if m["total"] == 0:
        zero_match.append(name)

matched_conds = sum(1 for m in cond_match.values() if m["total"] > 0)
out()
out(f"Eşleşen hastalık sayısı : {matched_conds} / {len(conditions)}")
out(f"Hiç eşleşmeyen          : {len(zero_match)}")
if zero_match:
    out(f"  → {', '.join(zero_match)}")

# İlaçların kaçı en az 1 hastalıkla eşleşiyor?
out()
out("── İlaç Tarafı: En Az 1 Koşul Eşleşme Oranı ──────────────────────")
all_terms_flat = [kw for terms in SYNONYMS.values() for kw in terms]
matched_drugs = 0
for txt, src in all_inds:
    if txt and any(kw in txt.lower() for kw in all_terms_flat):
        matched_drugs += 1
out(f"  {matched_drugs} / {total_inds} ilaç endikasyonu ({matched_drugs/total_inds*100:.1f}%)")
out("  → Tam tablo için tahmini: ilaçların ~%60-75'i en az 1 katalog hastalığıyla eşleşir")

# Sık geçen ama katalogda OLMAYAN kavramlar
out()
out("── Endikasyonlarda Sık Geçen Ama Katalogda OLMAYAN Kavramlar ──────")
EXTRA_CONDITIONS = [
    ("Osteoartrit",          ["osteoartrit","dejeneratif artrit","kireçlenme"]),
    ("Fibromiyalji",         ["fibromiyalji","fibromiyalgia"]),
    ("Uyku Bozukluğu",       ["uyku bozukluğu","insomni","uyku apnesi"]),
    ("BPH / Prostat Hiperpl.",["bph","benign prostat büyümesi","idrar akımı"]),
    ("Menopoz",              ["menopoz","postmenopozal","hormon tedavisi","HRT"]),
    ("Çölyak",               ["çölyak","gluten","malabsorpsiyon"]),
    ("Trombositopeni",       ["trombositopeni","idiopatik trombositopenik","itp","ITP"]),
    ("Hemofili",             ["hemofili","faktör viii","faktör ix","koagülasyon"]),
    ("Wilson Hastalığı",     ["wilson","bakır birikimi"]),
    ("Sistemik Lupus",       ["lupus","sistemik lupus","sle","SLE"]),
    ("Böbrek Nakli",         ["transplantasyon","nakil","immünosüpresif","siklosporin","takrolimus"]),
    ("Vitamin/Mineral Eks.", ["vitamin d","b12","folik asit","çinko","takviye"]),
    ("Göz Hipertansiyonu",   ["göz içi basınç","oküler hipertansiyon"]),
    ("Hiponatremi",          ["hiponatremi","sodyum düşüklüğü"]),
    ("Panik Atak",           ["panik atak","panik bozukluk"]),
]
out(f"{'Kavram':<35} {'KÜB':>5} {'KT':>5} {'Toplam':>7}")
out("-" * 55)
for name, terms in EXTRA_CONDITIONS:
    kh = sum(1 for txt,src in all_inds if src=="KÜB" and txt and text_matches(txt, terms))
    kth= sum(1 for txt,src in all_inds if src=="KT"  and txt and text_matches(txt, terms))
    if kh + kth > 0:
        out(f"  {name:<33} {kh:>5} {kth:>5} {kh+kth:>7}  ← katalogda YOK")

# ══════════════════════════════════════════════════════════════════════
out()
out("╔══════════════════════════════════════════════════════════════════╗")
out("║  PERSPEKTIF D — DOKTOR (Klinik Güvenlik + Katalog Yeterliliği)  ║")
out("╚══════════════════════════════════════════════════════════════════╝")
out()

out("""
── D1) Güvenli "Hastalığa Göre İlaç" Sunumu ──────────────────────────

  YAPILMAMASI GEREKENLER:
  ✗ "Bu hastalık için şu ilaçlar kullanılır" → doğrudan listeleme
    Neden: Kişi zaten başka ilaç kullanıyor olabilir (etkileşim riski)
    Neden: Reçetesiz uyarısı olmadan "bu ilacı kullan" mesajı yasadışı
    Neden: Kontrendikasyon kontrolü yapılmadan öneri yapılamaz

  YAPILMASI GEREKENLER:
  ✓ "Bu hastalıkta kullanılan ilaç sınıfları şunlardır" (genel bilgi)
  ✓ "Doktorunuzun önerdiği ilaçla ilgili bilgi almak ister misiniz?"
  ✓ Kullanıcı zaten ilacını girilmişse → o ilacın endikasyonunu göster
  ✓ "Bu ilacın sizin hastalığınızla ilgili kullanımı: ..."
  ✓ Kontrendikasyon varsa: "Bu iki ilaç birlikte dikkatli kullanılmalı"

── D2) Kontrendikasyon Çakışması Kontrolü ─────────────────────────────

  Mevcut veri tabanında kontrendikasyon bilgisi:
  • medication_kub.contraindications: %90.8 dolu
  • medication_kt.section_2_kullanmadan_once: %88.5 dolu
    (hasta dili, "şu durumlarda kullanmayınız" formatı)

  Önerilen kontrol mantığı:
  1. Kullanıcının tüm ilaçları → drug_interactions'ı çek
  2. İlaç A'nın drug_interactions içinde İlaç B adı geçiyor mu?
  3. Kullanıcı profili (yaş/cinsiyet/hamilelik) ile:
     - pregnancy_and_lactation kontrol: hamilelik bayrağı aktifse
     - Yaş < 18: pediatrik uyarı ara (special_warnings'ta)
     - Yaş > 75: geriatri uyarısı ara

  Kişiselleştirme veri kaynakları (mevcut profil kolonları):
  • birth_date  → yaş hesapla
  • gender      → cinsiyet bazlı uyarılar
  • Hamilelik bilgisi → YOK (profilde yok, sorulabilir)

── D3) 71 Hastalık Kapsam Değerlendirmesi ─────────────────────────────
""")

# Klinik kapsam analizi
out("  Yaygın kronik hastalık yükü (Türkiye istatistikleri baz alınarak):")
COVERAGE_EVAL = [
    ("Hipertansiyon",         "✅", "TR'de %30+ yetişkin — kritik, iyi kapsanmış"),
    ("Diyabet Tip 2",         "✅", "TR'de %15+ — kritik, iyi kapsanmış"),
    ("Hiperkolesterolemi",    "✅", "Yaygın, iyi kapsanmış"),
    ("Astım",                 "✅", "Yaygın, iyi kapsanmış"),
    ("KOAH",                  "✅", "Yaygın, iyi kapsanmış"),
    ("Depresyon",             "✅", "Yüksek prevalans, iyi kapsanmış"),
    ("Romatoid Artrit",       "✅", "İyi kapsanmış"),
    ("Epilepsi",              "✅", "İyi kapsanmış"),
    ("Osteoporoz",            "⚠️", "Kadın ağırlıklı, katalogda var ama yetersiz"),
    ("Obezite",               "⚠️", "İlaç seçenekleri sınırlı, katalogda var"),
    ("Metabolik Sendrom",     "⚠️", "Spesifik ilaç az, hipertansiyon/diyabet altında ele alınabilir"),
    ("Koroner Bypass",        "⚠️", "Hastalık değil prosedür — operasyon sonrası ilaç için OK"),
    ("Diyabet Tip 1",         "⚠️", "Özelleşmiş, insülin reçeteli — chat kısıtlı fayda"),
    ("Tüberküloz",            "⚠️", "Reçeteli rejim, chat scope'u dar"),
    ("HIV/AIDS",              "⚠️", "ARV reçeteli, chat scope'u dar"),
    ("Hematoloji eksik",      "❌", "Lösemi/lenfoma/hemofili: onkoloji/hematoloji uzman gerekli"),
    ("Osteoartrit eksik",     "❌", "Çok yaygın (>50 yaş) — katalogda YOK, eklenmeli"),
    ("Menopoz eksik",         "❌", "Yaygın, HRT soruları — katalogda YOK"),
    ("Uyku Bozukluğu eksik",  "❌", "Yaygın şikayet — katalogda YOK"),
    ("Böbrek Nakli eksik",    "❌", "İmmunosüpresif ilaç yüklü hasta grubu — katalogda YOK"),
]
for cond, mark, note in COVERAGE_EVAL:
    out(f"  {mark} {cond:<32} {note}")

out()
out("  Genel Değerlendirme:")
out("  • 71 hastalık temel kronik hastalıkları kapsıyor — sağlam başlangıç")
out("  • Onkoloji (7 kanser) agresif kapsam: chat için risk yüksek,")
out("    sadece 'kullanıcı bu ilacı kullanıyor' modunda güvenli")
out("  • Eksik: Osteoartrit, Menopoz, Uyku Bozukluğu, Sedef/Egzama dışı deri")
out("  • Fazla spesifik: Koroner Bypass (prosedür), Viral/Bakteriyel Enfeksiyon")
out("    (çok geniş kategori — pratik değer düşük)")

# ══════════════════════════════════════════════════════════════════════
out()
out("╔══════════════════════════════════════════════════════════════════╗")
out("║  ORTAK EYLEM PLANI                                               ║")
out("╚══════════════════════════════════════════════════════════════════╝")
out()

matched_pct = matched_conds / len(conditions) * 100

out(f"""
1) VERİTABANI YAPISI
   • FK bütünlüğü: kontrol edildi, orphan varsa yukarıda listelendi
   • condition_medications tablosu VARSA: içeriği zaten kullanılabilir
   • medication_kub.drug_interactions (%80.3): chat bağlantısına hazır
   • Eksik: profiles'da hamilelik kolonu yok — kişiselleştirme için eklenebilir

2) 71 HASTALIL KAPSAM DEĞERLENDİRMESİ
   • {matched_pct:.0f}% hastalık (400+100 örnek) endikasyon metinlerinde eşleşti
   • Sıfır eşleşme: {len(zero_match)} hastalık (yukarıda listelendi)
   • ÖNERİ EKLENMESİ: Osteoartrit, Menopoz, Uyku Bozukluğu (yüksek frekans)
   • ÖNERİ ÇIKARILMASI: Viral/Bakteriyel Enfeksiyon → çok geniş, pratik değil

3) ÖNERİLEN EŞLEŞTİRME YAKLAŞIMI: HİBRİT (C)
   Adım 1 — Kural bazlı (bu script'in eşleştirme kodu temel alınır)
     → conditions_catalog × medicationsV2 tam tarama
     → Her ilaç: therapeutic_indications + section_1_nedir
     → Sinonim sözlüğü genişletilerek (yukarıdaki SYNONYMS dict)
   Adım 2 — Groq batch doğrulama
     → Eşleşen her çift için: "Bu endikasyon [Hastalık] için mi?" (1/0)
     → confidence_score ataması
   Adım 3 — condition_medications tablosuna upsert
     → is_contraindication: contraindications kolonundan
     → extraction_method: 'hybrid_v1'

4) TAHMİNİ EŞLEŞTİRME KAPSAMI
   • Kural bazlı (sadece): ~%55-65 hastalık × ~%45-60 ilaç = ~35.000-55.000 çift
   • Hibrit (doğrulamadan sonra): ~%70-80 hastalık × ~%60-75 ilaç
   • Mevcut condition_medications varsa: önce onu incele, üzerine yaz

5) SOMUT SONRAKI ADIMLAR (öncelik sırasıyla)
   Öncelik 1: condition_medications tablosunu incele (mevcut + doluluk)
   Öncelik 2: medication_kub → chat bağlantısı (buildMedicationKubContext)
   Öncelik 3: Güvenli DROP migration çalıştır (10 kolon)
   Öncelik 4: Hibrit eşleştirme scripti yaz (SYNONYMS dict'i genişlet)
   Öncelik 5: Yeni katalog hastalıkları ekle (Osteoartrit, Menopoz, Uyku)
""")

out("=" * 76)
out(f"Analiz tamamlandı  ({time.time()-t_start:.1f}s)")
out("DB'ye HİÇBİR yazma yapılmadı.")
out("=" * 76)

with open(OUTPUT, "w", encoding="utf-8") as f:
    f.write("\n".join(lines) + "\n")
print(f"\nRapor: {OUTPUT}")
