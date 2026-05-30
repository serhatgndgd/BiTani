"""
synonyms.json üreteci — conditions_catalog id'lerini canlı DB'den çeker,
aşağıdaki eczacı-küratörlü sinonim haritasıyla birleştirip yazar.

Tasarım ilkesi (sağlık uygulaması → PRECISION öncelikli):
  • Aşırı genel tek-kelimeler ELENDİ: "ağrı", "iltihap", "mikrop",
    "tansiyon", "kanser", "tümör", "virüs", "şeker" — bunlar endikasyon
    metinlerinde alakasız bağlamlarda yüzlerce kez geçer → false-positive.
  • Klinik/Latince terimler ve >=3 harf kısaltmalar EKLENDİ.
  • 2 harfli kısaltmalar (MS, AF, TB, RA, AS, UC, HT) bilinçli atıldı —
    hem matcher 3-harf-altını eler hem de Türkçe kelimelerle çakışır.
  • Sıfır-eşleşme 4 hastalığa (Koroner Bypass, Diyabet Tip 1,
    Metabolik Sendrom, Böbrek Taşı) ekstra varyant eklendi.

Çalıştır:  .venv/bin/python build_synonyms.py
Çıktı:     scripts/synonyms.json   { "<uuid>": {"name","synonyms"} }
"""
from __future__ import annotations
import json, os, sys, warnings
warnings.filterwarnings("ignore")
from dotenv import load_dotenv
from supabase import create_client

HERE = os.path.dirname(__file__)
load_dotenv(os.path.join(HERE, ".env"))
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

# ── Küratörlü sinonimler (canonical ad matcher tarafından otomatik eklenir) ──
SYN: dict[str, list[str]] = {
    # ── Ağrı ──────────────────────────────────────────────────────────
    "Kronik Ağrı": ["kronik ağrı", "uzun süreli ağrı", "süreğen ağrı",
        "kronik ağrı sendromu", "devamlı ağrı", "kronik ağrı tedavisi",
        "şiddetli kronik ağrı"],
    "Nöropatik Ağrı": ["nöropatik ağrı", "sinir ağrısı", "nöropati ağrısı",
        "diyabetik nöropati", "diyabetik periferik nöropati",
        "postherpetik nevralji", "postherpetik nöralji", "nevralji",
        "trigeminal nevralji", "periferik nöropati"],

    # ── Dermatoloji ───────────────────────────────────────────────────
    "Egzama": ["egzama", "egzema", "ekzama", "atopik dermatit", "dermatit",
        "kontakt dermatit", "seboreik dermatit"],
    "Akne": ["akne", "akne vulgaris", "akne vulgariz", "sivilce",
        "yüz sivilcesi", "komedonal akne", "inflamatuar akne"],
    "Ürtiker": ["ürtiker", "kurdeşen", "kronik ürtiker", "anjiyoödem",
        "kronik spontan ürtiker", "ürtikeri"],
    "Sedef Hastalığı": ["sedef", "sedef hastalığı", "psoriazis", "psöriazis",
        "psoriasis", "psoriyazis", "plak psoriazis", "plak sedef",
        "psoriatik artrit"],

    # ── Enfeksiyon ────────────────────────────────────────────────────
    "Tüberküloz": ["tüberküloz", "verem", "akciğer veremi",
        "mycobacterium tuberculosis", "latent tüberküloz",
        "tüberküloz tedavisi", "antitüberküloz"],
    "HIV/AIDS": ["hiv enfeksiyonu", "hiv-1", "aids", "edinsel immün yetmezlik",
        "insan immün yetmezlik virüsü", "hiv pozitif", "antiretroviral"],
    "Bakteriyel Enfeksiyon": ["bakteriyel enfeksiyon", "bakteriyel enfeksiyonlar",
        "bakteri enfeksiyonu", "bakteriyel hastalık", "duyarlı mikroorganizma"],
    "Viral Enfeksiyon": ["viral enfeksiyon", "viral enfeksiyonlar",
        "virüs enfeksiyonu", "viral hastalık", "antiviral"],
    "Üriner Sistem Enfeksiyonu": ["üriner sistem enfeksiyonu",
        "idrar yolu enfeksiyonu", "idrar yolu iltihabı", "üriner enfeksiyon",
        "sistit", "üretrit", "piyelonefrit", "pyelonefrit"],
    "Pnömoni": ["pnömoni", "zatürre", "zatürree", "akciğer iltihabı",
        "akciğer enfeksiyonu", "pnömokokal pnömoni", "toplum kökenli pnömoni",
        "alt solunum yolu enfeksiyonu"],
    "Mantar Enfeksiyonu": ["mantar enfeksiyonu", "fungal enfeksiyon", "kandida",
        "kandidiyaz", "kandidiyazis", "dermatofitoz", "mikoz", "tinea",
        "ayak mantarı", "vajinal kandidiyaz", "onikomikoz"],

    # ── Gastroenteroloji ──────────────────────────────────────────────
    "Hepatit B": ["hepatit b", "hbv", "kronik hepatit b", "b hepatiti"],
    "Hepatit C": ["hepatit c", "hcv", "kronik hepatit c", "c hepatiti"],
    "Peptik Ülser": ["peptik ülser", "mide ülseri", "duodenal ülser",
        "duodenum ülseri", "gastrik ülser", "gastroduodenal ülser",
        "ülser tedavisi"],
    "Karaciğer Yetmezliği": ["karaciğer yetmezliği", "hepatik yetmezlik",
        "siroz", "karaciğer sirozu", "hepatik ensefalopati",
        "karaciğer hastalığı"],

    # ── Göz ───────────────────────────────────────────────────────────
    "Katarakt": ["katarakt", "katarakt cerrahisi", "lens opasitesi"],
    "Konjunktivit": ["konjunktivit", "konjonktivit", "alerjik konjunktivit",
        "bakteriyel konjunktivit", "göz iltihabı", "konjonktiva iltihabı"],
    "Maküler Dejenerasyon": ["maküler dejenerasyon", "maküla dejenerasyonu",
        "yaşa bağlı maküler dejenerasyon", "sarı nokta hastalığı",
        "neovasküler", "yaş tip maküler"],
    "Glokom": ["glokom", "göz tansiyonu", "açık açılı glokom",
        "göz içi basıncı", "intraoküler basınç", "oküler hipertansiyon"],

    # ── Hematoloji ────────────────────────────────────────────────────
    "Demir Eksikliği Anemisi": ["demir eksikliği anemisi", "demir eksikliği",
        "demir eksikliğine bağlı anemi", "kansızlık", "anemi tedavisi"],

    # ── Kardiyovasküler ───────────────────────────────────────────────
    "Kalp Yetmezliği": ["kalp yetmezliği", "konjestif kalp yetmezliği",
        "kalp yetersizliği", "konjestif kalp yetersizliği", "kronik kalp yetmezliği"],
    "Derin Ven Trombozu": ["derin ven trombozu", "dvt", "derin venöz tromboz",
        "venöz tromboz", "derin ven tıkanıklığı"],
    "Atriyal Fibrilasyon": ["atriyal fibrilasyon", "atriyal fibrilasyonu",
        "afib", "atriyum fibrilasyonu", "atriyal flutter"],
    "Koroner Arter Hastalığı": ["koroner arter hastalığı",
        "koroner kalp hastalığı", "iskemik kalp hastalığı", "anjina pektoris",
        "angina pektoris", "angina", "miyokard enfarktüsü", "miyokart enfarktüsü",
        "kararlı angina", "kararsız angina"],
    "Hipertansiyon": ["hipertansiyon", "yüksek tansiyon", "yüksek kan basıncı",
        "esansiyel hipertansiyon", "arteriyel hipertansiyon",
        "kan basıncı yüksekliği", "pulmoner hipertansiyon"],
    "Tromboemboli": ["tromboemboli", "pulmoner emboli", "akciğer embolisi",
        "tromboembolik", "venöz tromboembolizm", "pulmoner embolizm",
        "tromboembolik olay"],
    # ── ZERO-MATCH HEDEF ──
    "Koroner Bypass": ["koroner bypass", "koroner baypas", "bypass ameliyatı",
        "koroner arter bypass", "koroner arter baypas", "aortokoroner bypass",
        "cabg", "kalp bypass", "kalp baypas", "baypas cerrahisi",
        "koroner arter bypass greft", "bypass cerrahisi", "bypass greft",
        "koroner revaskülarizasyon"],

    # ── KBB ───────────────────────────────────────────────────────────
    "Tonsillit": ["tonsillit", "bademcik iltihabı", "farenjit",
        "tonsillofarenjit", "boğaz iltihabı", "boğaz enfeksiyonu",
        "farengotonsillit"],
    "Sinüzit": ["sinüzit", "sinüs iltihabı", "akut sinüzit", "kronik sinüzit",
        "rinosinüzit", "sinüs enfeksiyonu"],
    "Orta Kulak Enfeksiyonu": ["orta kulak enfeksiyonu", "otitis media",
        "orta kulak iltihabı", "akut otitis media", "kulak iltihabı",
        "kulak enfeksiyonu"],

    # ── Metabolik ─────────────────────────────────────────────────────
    "Hiperkolesterolemi": ["hiperkolesterolemi", "yüksek kolesterol",
        "ldl yüksekliği", "kolesterol yüksekliği", "hiperlipidemi",
        "dislipidemi", "hiperkolesterol"],
    "Obezite": ["obezite", "obez", "aşırı kilo", "şişmanlık", "kilo yönetimi",
        "kilo kontrolü", "vücut ağırlığı kontrolü"],
    "Hipertrigliseridemi": ["hipertrigliseridemi", "yüksek trigliserid",
        "trigliserid yüksekliği", "trigliserit yüksekliği", "hiperlipidemi"],
    # ── ZERO-MATCH HEDEF ──
    "Diyabet Tip 1": ["diyabet tip 1", "tip 1 diyabet", "tip i diyabet",
        "tip 1 diabetes", "tip 1 diabetes mellitus", "t1dm",
        "insüline bağımlı diyabet", "insülin bağımlı diabetes",
        "juvenil diyabet", "çocukluk çağı diyabeti", "iddm"],
    # ── ZERO-MATCH HEDEF ──
    "Metabolik Sendrom": ["metabolik sendrom", "sendrom x", "metabolik sendrom x",
        "insülin direnci sendromu", "metabolik risk"],
    "Diyabet Tip 2": ["diyabet tip 2", "tip 2 diyabet", "tip ii diyabet",
        "tip 2 diabetes", "tip 2 diabetes mellitus", "diabetes mellitus tip 2",
        "t2dm", "niddm", "insüline bağımlı olmayan diyabet", "şeker hastalığı",
        "aşikar diyabet"],

    # ── Nöroloji ──────────────────────────────────────────────────────
    "Parkinson Hastalığı": ["parkinson", "parkinson hastalığı",
        "idiopatik parkinson", "parkinsonizm"],
    "Multipl Skleroz": ["multipl skleroz", "multiple skleroz",
        "relapsing remitting", "yineleyici multipl skleroz"],
    "Vertigo": ["vertigo", "baş dönmesi", "bppv", "vestibüler", "meniere",
        "menière", "vestibüler vertigo"],
    "Migren": ["migren", "migren atağı", "auralı migren", "aurasız migren",
        "hemikrani", "migren profilaksisi", "migren baş ağrısı"],
    "Alzheimer Hastalığı": ["alzheimer", "alzheimer hastalığı", "demans",
        "demansı", "bunama", "alzheimer tipi demans"],
    "Epilepsi": ["epilepsi", "sara hastalığı", "epileptik nöbet",
        "parsiyel nöbet", "jeneralize nöbet", "konvülsiyon", "konvulsiyon",
        "antiepileptik", "epileptik"],

    # ── Onkoloji ──────────────────────────────────────────────────────
    "Kolon Kanseri": ["kolon kanseri", "kolorektal kanser", "rektum kanseri",
        "kalın bağırsak kanseri", "metastatik kolorektal kanser", "kolon tümörü"],
    "Akciğer Kanseri": ["akciğer kanseri", "küçük hücreli akciğer kanseri",
        "küçük hücreli dışı akciğer kanseri", "khdak", "khak", "bronş kanseri",
        "akciğer karsinomu", "akciğer tümörü"],
    "Meme Kanseri": ["meme kanseri", "meme karsinomu", "metastatik meme kanseri",
        "her2 pozitif meme", "meme tümörü", "erken evre meme kanseri"],
    "Prostat Kanseri": ["prostat kanseri", "prostat karsinomu",
        "metastatik prostat kanseri", "kastrasyona dirençli prostat",
        "prostat tümörü"],
    "Lösemi": ["lösemi", "lökemi", "kan kanseri", "akut lösemi", "kronik lösemi",
        "akut miyeloid lösemi", "kronik lenfositik lösemi",
        "akut lenfoblastik lösemi", "kronik miyeloid lösemi"],
    "Lenfoma": ["lenfoma", "hodgkin lenfoma", "non-hodgkin lenfoma",
        "lenf kanseri", "b hücreli lenfoma", "lenf bezi kanseri",
        "hodgkin hastalığı"],
    "Tiroid Kanseri": ["tiroid kanseri", "papiller tiroid kanseri",
        "foliküler tiroid kanseri", "medüller tiroid kanseri", "tiroid karsinomu",
        "tiroid tümörü"],

    # ── Psikiyatri ────────────────────────────────────────────────────
    "Bipolar Bozukluk": ["bipolar bozukluk", "bipolar", "manik depresif",
        "bipolar afektif bozukluk", "iki uçlu bozukluk", "manik epizod",
        "mani epizodu"],
    "Şizofreni": ["şizofreni", "şizofrenik", "şizoaffektif", "şizofreni tedavisi"],
    "DEHB": ["dehb", "dikkat eksikliği hiperaktivite", "dikkat eksikliği",
        "hiperaktivite", "adhd", "dikkat eksikliği hiperaktivite bozukluğu"],
    "Depresyon": ["depresyon", "major depresif bozukluk", "majör depresyon",
        "majör depresif bozukluk", "depresif bozukluk", "depresif epizod",
        "depresif dönem"],
    "Anksiyete Bozukluğu": ["anksiyete bozukluğu", "anksiyete", "kaygı bozukluğu",
        "panik bozukluğu", "yaygın anksiyete bozukluğu", "panik atak",
        "sosyal anksiyete", "anksiyete bozuklukları"],
    "Psikoz": ["psikoz", "psikotik bozukluk", "psikotik", "psikotik atak",
        "akut psikoz"],

    # ── Romatoloji ────────────────────────────────────────────────────
    "Romatoid Artrit": ["romatoid artrit", "romatizma", "eklem iltihabı",
        "inflamatuar artrit", "romatoid artriti", "juvenil idiopatik artrit"],
    "Gut Hastalığı": ["gut", "gut artriti", "gut hastalığı", "ürik asit",
        "hiperürisemi", "damla hastalığı", "akut gut atağı"],
    "Osteoporoz": ["osteoporoz", "kemik erimesi", "osteopeni",
        "postmenopozal osteoporoz", "kemik kaybı", "kemik yoğunluğu azalması"],
    "Ankilozan Spondilit": ["ankilozan spondilit", "aksiyel spondiloartrit",
        "spondilit", "spondiloartrit", "ankilozan spondilitis"],

    # ── Sindirim ──────────────────────────────────────────────────────
    "Reflü (GÖRH)": ["reflü", "gastroözofageal reflü", "görh",
        "gastroözofageal reflü hastalığı", "reflü özofajiti", "özofajit",
        "mide yanması", "gastro-özofageal reflü"],
    "İrritabl Bağırsak Sendromu": ["irritabl bağırsak sendromu", "ibs",
        "irritabl kolon", "spastik kolon", "huzursuz bağırsak sendromu"],
    "Ülseratif Kolit": ["ülseratif kolit", "ülseratif colitis", "kolit"],
    "Crohn Hastalığı": ["crohn", "crohn hastalığı",
        "inflamatuar bağırsak hastalığı", "iltihabi bağırsak hastalığı"],

    # ── Solunum ───────────────────────────────────────────────────────
    "Astım": ["astım", "bronşiyal astım", "alerjik astım", "astım bronşiale",
        "bronkospazm", "astım tedavisi"],
    "KOAH": ["koah", "kronik obstrüktif akciğer hastalığı", "amfizem",
        "kronik bronşit", "kronik obstrüktif"],
    "Alerjik Rinit": ["alerjik rinit", "saman nezlesi", "alerjik nezle",
        "mevsimsel alerjik rinit", "perennial rinit", "alerjik rinokonjunktivit"],

    # ── Üroloji ───────────────────────────────────────────────────────
    # ── ZERO-MATCH HEDEF ──
    "Böbrek Taşı": ["böbrek taşı", "böbrek taşları", "nefrolitiyazis",
        "ürolitiyazis", "renal taş", "renal kolik", "üreter taşı",
        "idrar yolu taşı", "üriner sistem taş hastalığı", "böbrek taşı oluşumu",
        "kalsiyum okzalat taşı", "ürik asit taşı"],
    "Kronik Böbrek Hastalığı": ["kronik böbrek hastalığı", "kbh",
        "kronik böbrek yetmezliği", "böbrek yetmezliği", "renal yetmezlik",
        "son dönem böbrek hastalığı", "böbrek fonksiyon bozukluğu", "diyaliz"],
    "Prostat Hiperplazisi": ["prostat hiperplazisi", "bph",
        "benign prostat hiperplazisi", "iyi huylu prostat büyümesi",
        "prostat büyümesi", "alt üriner sistem semptomları", "benign prostat hipertrofisi"],
}

# ── id eşle + doğrula ───────────────────────────────────────────────────
rows = sb.table("conditions_catalog").select("id,name").execute().data
name_to_id = {r["name"]: r["id"] for r in rows}

missing_in_syn = [n for n in name_to_id if n not in SYN]
extra_in_syn   = [n for n in SYN if n not in name_to_id]
if missing_in_syn:
    sys.exit(f"HATA: SYN'de eksik hastalıklar: {missing_in_syn}")
if extra_in_syn:
    sys.exit(f"HATA: SYN'de fazla (DB'de yok) hastalıklar: {extra_in_syn}")

out: dict[str, dict] = {}
for name, cid in name_to_id.items():
    syns = sorted(set(s.strip().lower() for s in SYN[name] if s.strip()))
    out[cid] = {"name": name, "synonyms": syns}

path = os.path.join(HERE, "synonyms.json")
with open(path, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

total_syn = sum(len(v["synonyms"]) for v in out.values())
print(f"✅ synonyms.json yazıldı: {path}")
print(f"   {len(out)} hastalık, toplam {total_syn} sinonim "
      f"(ort. {total_syn/len(out):.1f}/hastalık)")
