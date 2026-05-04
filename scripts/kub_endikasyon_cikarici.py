#!/usr/bin/env python3
"""
BiTanı - KÜB Endikasyon Çıkarıcı
TİTCK KÜB PDF'lerinden "4.1 Terapötik Endikasyonlar" bölümünü çıkarır
ve conditions_catalog ile anahtar kelime eşleştirmesi yaparak condition_medications tablosunu doldurur.

Çalıştırma:
  cd scripts && python -m venv .venv && source .venv/bin/activate
  pip install -r requirements-kub.txt
  cp .env.example .env   # Supabase anahtarlarını doldur
  python kub_endikasyon_cikarici.py

İsteğe bağlı hata ayıklama: .env veya ortamda KUB_DEBUG=1
  - 4.1 bulunamazsa PDF metninin ilk 500 karakteri yazdırılır.
  - 4.1 bulunur ama hastalık eşleşmezse endikasyon metni yazdırılır.

Gerekli: Supabase service_role (RLS bypass).
"""

from __future__ import annotations

import os
import re
import tempfile
import time
from pathlib import Path

import requests
from dotenv import load_dotenv
from pypdf import PdfReader
from supabase import create_client

load_dotenv(Path(__file__).resolve().parent / ".env")


def _env(key: str) -> str:
    """Ortam değişkeni: baş/son boşluk ve yanlışlıkla eklenen tırnakları temizle."""
    v = os.environ.get(key, "")
    return v.strip().strip('"').strip("'")


# ── Ayarlar ────────────────────────────────────────────────────────────────
SUPABASE_URL = _env("SUPABASE_URL").rstrip("/")
SUPABASE_KEY = _env("SUPABASE_SERVICE_ROLE_KEY")

BATCH_SIZE = 10  # İleride paralel iş için ayrıldı; şu an sıralı işlenir
SLEEP_BETWEEN = 1.0
_max_raw = _env("MAX_MEDICATIONS")
MAX_MEDICATIONS: int | None = int(_max_raw) if _max_raw.isdigit() else None
_MEDICATIONS_PAGE = 500  # PostgREST URL sınırı; NOT IN yerine sayfalama + filtre
# ───────────────────────────────────────────────────────────────────────────

_PLACEHOLDER_SERVICE = "your_service_role_key_here"
_DEBUG_PREVIEW_LEN = 500

# 4.1 başlığı: 4 / 4. / 4 . 1 / 4.1. vb. + "terapötik" (büyük/küçük harf, çoklu boşluk)
_SECTION_41_HEADER = re.compile(r"4[\.\s]*1[\s\.]+" + "terapötik", re.IGNORECASE)

# PDF başında geçerse KÜB değil, hasta broşürü (Kullanma Talimatı)
_BROSUR_HEAD_CHARS = 4000


def _debug_kub() -> bool:
    return _env("KUB_DEBUG").lower() in ("1", "true", "yes", "on")


def text_for_match(s: str) -> str:
    """Türkçe uyumlu küçük harf + alt dize araması için normalize et."""
    if not s:
        return ""
    t = s.replace("İ", "i").replace("I", "ı")
    return t.lower()


# Uzundan kısaya — sondan eşleşen ilk ek kırpılır (enfeksiyonun → enfeksiyon vb.)
_SUFFIXES_LONGEST_FIRST: tuple[str, ...] = (
    "lerinden",
    "larından",
    "lerimize",
    "larımıza",
    "larının",
    "lerinin",
    "larına",
    "lerine",
    "larında",
    "lerinde",
    "larıyla",
    "leriyle",
    "ımızda",
    "imizde",
    "unuzda",
    "ünüzde",
    "lığında",
    "liğinde",
    "lığı",
    "liği",
    "luğu",
    "lüğü",
    "ımızı",
    "inizi",
    "undaki",
    "ündeki",
    "ununuz",
    "ününüz",
    "larım",
    "lerim",
    "ınız",
    "iniz",
    "ımız",
    "imiz",
    "unun",
    "ünün",
    "ının",
    "inin",
    "nın",
    "nin",
    "nun",
    "nün",
    "ları",
    "leri",
    "sinde",
    "sında",
    "sine",
    "sına",
    "inden",
    "ından",
    "imize",
    "ınıza",
    "sı",
    "si",
    "su",
    "sü",
    "da",
    "de",
    "ta",
    "te",
    "dan",
    "den",
    "tan",
    "ten",
    "la",
    "le",
    "na",
    "ne",
    "ya",
    "ye",
    "ın",
    "in",
    "un",
    "ün",
    "a",
    "e",
    "ı",
    "i",
    "u",
    "ü",
)


def _strip_turkish_suffix_chain(word: str, max_steps: int = 6) -> frozenset[str]:
    """Kelimenin sondan Türkçe ek kırpılmış varyantları (min 4 karakter)."""
    out: set[str] = {word}
    cur = word
    for _ in range(max_steps):
        nxt = cur
        for suf in _SUFFIXES_LONGEST_FIRST:
            if cur.endswith(suf) and len(cur) - len(suf) >= 4:
                nxt = cur[: -len(suf)]
                break
        if nxt == cur:
            break
        out.add(nxt)
        cur = nxt
    return frozenset(out)


# Katalog `name` normalize edilmiş halinde bu alt dizgilerden biri geçerse ek arama terimleri.
# (endikasyon metninde case-insensitive alt dize aranır.)
# Önce daha uzun / spesifik anahtarlar (hepatit b / c ayrımı vb.).
_CATALOG_SUBSTRING_TO_EXTRAS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("hepatit b", ("hepatit b", "hbv", "kronik hepatit b", "anti-hbv", "anti hbv", "hbsag", "hepatit")),
    ("hepatit c", ("hepatit c", "hcv", "kronik hepatit c", "anti-hcv", "anti hcv", "hepatit")),
    ("demir eksikliği", ("demir eksikliği", "demir yetersizliği", "demir yetersizligi", "sideropenik", "sideropenk", "sideropeni", "fe eksikliği", "fe eksikligi", "iron deficiency", "anemi")),
    ("demir eksikligi", ("demir eksikliği", "demir yetersizliği", "sideropenik", "sideropenk", "anemi")),
    ("bakteri", ("bakteriyel", "bakteri", "antibiyotik", "antibiyotik endikasyon", "gram negatif", "gram pozitif", "mikroorganizma", "sepsis", "septisemi")),
    ("bakteriyel", ("bakteriyel", "bakteri", "antibiyotik", "sepsis")),
    ("viral enfeksiyon", ("viral", "virüs", "virus", "antiviral", "viral enfeksiyon")),
    ("akne", ("akne", "sivilce", "propionibacterium", "akne vulgaris", "ak vulgaris", "komedon", "comedon")),
    ("tüberküloz", ("tüberküloz", "tuberkuloz", "tuberculosis", "tbc", "mikobakter", "mantoux", "ppd")),
    ("tuberkuloz", ("tüberküloz", "tbc", "mikobakter")),
    ("hiv", ("hiv", "aids", "antiretrovir", "antiretroviral", "art tedav", "cd4", "acquired immunodeficiency")),
    ("aids", ("hiv", "aids", "antiretrovir", "antiretroviral")),
    ("sinüzit", ("sinüzit", "sinus", "sinüs", "sinusitis", "paranazal", "maksiller sinüs", "maksiller sinus")),
    ("sinuzit", ("sinüzit", "sinüs", "paranazal")),
    ("diyabet", ("diabet", "tip 2", "tip 1", "tip ii", "tip i", "şeker hastalığı", "şeker", "seker", "glisemi", "hiperglisemi", "hipoglisemi", "insülin", "insulin", "dm")),
    ("diabet", ("tip 2", "tip 1", "glisemi")),
    ("hipertansiyon", ("yüksek tansiyon", "yüksek kan basıncı", "arteriyel hipertansiyon", "hipertansif", "kan basıncı")),
    ("astım", ("astim", "bronş", "brons", "bronşial", "bronsiyal", "öksürük", "oksuruk")),
    ("depresyon", ("depresif", "majör depresyon", "major depresyon", "antidepresan")),
    ("anksiyete", ("anksiyete bozukluğu", "endişe", "panik", "gad")),
    ("epilepsi", ("nöbet", "nobet", "konvülziyon", "konvulsiyon", "antiepileptik")),
    ("migren", ("migrain", "baş ağrısı", "bas agrisi", "hemikrania")),
    ("artroz", ("osteoartrit", "dejeneratif eklem", "kireçlenme")),
    ("romatoid", ("romatoid artrit", "ra ", " romatizma")),
    ("fibromiyalji", ("fibromiyalgia", "yaygın ağrı")),
    ("reflü", ("reflu", "gerd", "mide yanması", "özofajit", "ozofajit")),
    ("gastrit", ("mide iltihabı", "mide iltihabi")),
    ("ülser", ("ulser", "peptik ülser", "peptik ulser", "duodenit")),
    ("böbrek", ("bobrek", "renal", "nefro", "kronik böbrek", "kronik bobrek", "ckd")),
    ("kalp yetmezliği", ("kalp yetmezligi", "kardiyak yetmezlik", "konjestif", "hfref", "hfpef")),
    ("aritmi", ("çarpıntı", "carpinti", "taşikardi", "tasikardi", "bradikardi", "fibrilasyon")),
    ("ishal", ("diyare", "gastroenterit")),
    ("kabızlık", ("kabizlik", "konstipasyon", "kabız", "kabiz")),
    ("tiroid", ("hipotiroidi", "hipertiroidi", "guatr", "hashimoto")),
    ("osteoporoz", ("kemik erimesi", "kemik kırığı riski", "kemik kirigi")),
    ("kolesterol", ("hiperkolesterolemi", "dislipidemi", "dışlipidemi", "ldl", "hdl", "trigliserid")),
    ("demans", ("alzheimer", "bilişsel", "bilissel", "bunama")),
    ("parkinson", ("parkinsonizm", "bazal ganglion")),
    ("skleroz", ("ms ", "multipl skleroz", "multıpl skleroz")),
    ("hepatit", ("hepatit", "viral hepatit", "karaciğer iltihabı", "karaciger iltihabi", "otoimmün hepatit", "otoimmun hepatit")),
    ("siroz", ("karaciğer sirozu", "karaciger sirozu", "hepatik yetmezlik")),
    (
        "pnömoni",
        ("pnonomi", "pnömoni", "pneumonia", "akciğer enfeksiyonu", "akciger enfeksiyonu", "zatürre", "zaturre", "lobar pnömoni"),
    ),
    ("enfeksiyon", ("antibiyotik", "bakteri", "enfeksiyon", "sepsis", "septisemi", "septik")),
    ("alerji", ("allergik", "anafilaksi", "urtiker", "kaşıntı", "kasinti")),
    ("psoriasis", ("sedef hastalığı", "sedef hastaligi", "plak psoriasis")),
    ("egzema", ("ekzema", "atopik dermatit", "dermatit")),
    ("vertigo", ("baş dönmesi", "bas donmesi", "vestibüler", "vestibuler")),
    ("uykusuzluk", ("insomni", "uyku bozukluğu", "uyku bozuklugu")),
    ("obezite", ("obez", "kilolu", "şişman", "sisman", "bmi")),
    ("poliartrit", ("juvenil artrit", "çocuk romatizması", "cocuk romatizmasi")),
    ("anemi", ("anemi", "anemisi", "anemisinin", "demir eksikliği", "sideropenik", "hemoglobin", "hemoglobin düşüklüğü")),
)


def _split_name_fragments(name: str) -> set[str]:
    parts = re.split(r"[,;/\(\)\[\]]+", name)
    out: set[str] = set()
    for p in parts:
        q = text_for_match(p.strip())
        if len(q) >= 3:
            out.add(q)
    return out


def _word_fragment_keywords(normalized_name: str) -> set[str]:
    """Katalog adındaki sözcüklerden kısa kökler (ör. hepatit, demir); min 4 karakter."""
    frag: set[str] = set()
    for tok in re.split(r"\s+", normalized_name):
        tok = tok.strip()
        if len(tok) < 4:
            continue
        frag.add(tok)
        if len(tok) >= 5 and len(tok[:-1]) >= 4:
            frag.add(tok[:-1])
        if len(tok) >= 6 and len(tok[:-2]) >= 4:
            frag.add(tok[:-2])
        if len(tok) >= 7 and len(tok[:-3]) >= 4:
            frag.add(tok[:-3])
    return frag


def keywords_for_condition(catalog_name: str) -> set[str]:
    """Katalog adı + parçaları + tanımlı ek anahtar kelimeler."""
    raw = catalog_name.strip()
    if not raw:
        return set()

    n = text_for_match(raw)
    terms: set[str] = {raw.strip(), n}

    for frag in _split_name_fragments(raw):
        terms.add(frag)

    terms |= _word_fragment_keywords(n)

    for sub, extras in _CATALOG_SUBSTRING_TO_EXTRAS:
        if sub in n:
            terms.update(extras)

    # Ham ve normalize edilmiş tüm anlamlı alt dizgiler
    return {t for t in terms if isinstance(t, str) and len(text_for_match(t)) >= 2}


def normalized_keywords_for_condition(catalog_name: str) -> frozenset[str]:
    return frozenset(text_for_match(k) for k in keywords_for_condition(catalog_name) if k)


def _keyword_matches_haystack(hay: str, nkw: str) -> bool:
    """Alt dize + Türkçe ek kırpılmış varyantlarla eşleşme."""
    if len(nkw) < 2:
        return False
    for v in _strip_turkish_suffix_chain(nkw):
        if len(v) >= 2 and v in hay:
            return True
    return False


def match_conditions_by_keywords(endikasyon_text: str, conditions: list) -> list[str]:
    """Endikasyon metninde katalog anahtar kelimelerini ara; eşleşen condition id'lerini döndür."""
    hay = text_for_match(endikasyon_text)
    matched: list[str] = []
    for c in conditions:
        cid = c.get("id")
        name = c.get("name") or ""
        if not cid or not name:
            continue
        for nkw in normalized_keywords_for_condition(name):
            if _keyword_matches_haystack(hay, nkw):
                matched.append(cid)
                break
    return matched


def _require_env() -> None:
    missing = [k for k, v in (("SUPABASE_URL", SUPABASE_URL), ("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_KEY)) if not v]
    if missing:
        raise SystemExit(f"Eksik ortam değişkeni: {', '.join(missing)} — scripts/.env dosyasını doldur.")
    if SUPABASE_KEY.lower() == _PLACEHOLDER_SERVICE:
        raise SystemExit(
            "scripts/.env içinde SUPABASE_SERVICE_ROLE_KEY hâlâ örnek metin. "
            "Supabase → Settings → API → service_role (secret) ile değiştir."
        )


_require_env()
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def fetch_processed_medication_id_set() -> set[str]:
    """condition_medications'ta en az bir satırı olan ilaç id'leri (sayfalı)."""
    ids: set[str] = set()
    offset = 0
    while True:
        res = (
            supabase.table("condition_medications")
            .select("medication_id")
            .order("medication_id")
            .order("condition_id")
            .range(offset, offset + _MEDICATIONS_PAGE - 1)
            .execute()
        )
        rows = res.data or []
        for row in rows:
            mid = row.get("medication_id")
            if isinstance(mid, str) and mid:
                ids.add(mid)
        if len(rows) < _MEDICATIONS_PAGE:
            break
        offset += _MEDICATIONS_PAGE
    return ids


def fetch_medications(processed_ids: set[str] | None = None) -> list:
    """kub_url dolu ve henüz condition_medications'ta olmayan ilaçları çek.

    Çok sayıda işlenmiş id için PostgREST `not.in` URL sınırına takılmaması adına
    ilaçlar id sırasıyla sayfalanır, işlenmiş olanlar yerelde elenir.
    """
    if processed_ids is None:
        processed_ids = fetch_processed_medication_id_set()

    out: list = []
    offset = 0
    while True:
        q = (
            supabase.table("medications")
            .select("id, ilac_adi, kub_url")
            .not_.is_("kub_url", "null")
            .order("id")
            .range(offset, offset + _MEDICATIONS_PAGE - 1)
        )
        result = q.execute()
        rows = result.data or []
        for med in rows:
            mid = med.get("id")
            if not mid or mid in processed_ids:
                continue
            out.append(med)
            if MAX_MEDICATIONS is not None and len(out) >= MAX_MEDICATIONS:
                return out
        if len(rows) < _MEDICATIONS_PAGE:
            break
        offset += _MEDICATIONS_PAGE
    return out


def fetch_conditions():
    """conditions_catalog'daki tüm hastalıkları çek."""
    result = supabase.table("conditions_catalog").select("id, name, category").execute()
    return result.data or []


def download_pdf(url: str) -> str | None:
    """PDF'yi indir, geçici dosyaya yaz, yolu döndür."""
    try:
        headers = {"User-Agent": "Mozilla/5.0 BiTani/1.0"}
        resp = requests.get(url, headers=headers, timeout=60)
        if resp.status_code != 200:
            return None

        tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
        tmp.write(resp.content)
        tmp.close()
        return tmp.name
    except Exception as e:
        print(f"  PDF indirme hatası: {e}")
        return None


def looks_like_hasta_brosuru(full_text: str) -> bool:
    """Metnin başında 'Kullanma Talimatı' varsa hasta broşürü sayılır (KÜB değil)."""
    head = full_text.lstrip()[:_BROSUR_HEAD_CHARS]
    if not head:
        return False
    h = text_for_match(head)
    return "kullanma talimatı" in h or "kullanma talimati" in h


def read_pdf_text(pdf_path: str) -> str | None:
    """PDF'den düz metin çıkar; hata olursa None."""
    try:
        reader = PdfReader(pdf_path)
        full_text = ""
        for page in reader.pages:
            full_text += page.extract_text() or ""
        return full_text
    except Exception as e:
        print(f"  PDF okuma hatası: {e}")
        return None


def extract_section_41_from_text(full_text: str) -> str | None:
    """Çıkarılmış PDF metninden 4.1 Terapötik … bölümünü kes (başlık regex ile)."""
    markers_end = [
        "4.2 Pozoloji",
        "4.2. Pozoloji",
        "4.2 POZOLOJİ",
        "4.3 Kontrendikasyonlar",
    ]

    m = _SECTION_41_HEADER.search(full_text)
    if not m:
        return None
    start_idx = m.end()

    end_idx = len(full_text)
    for marker in markers_end:
        idx = full_text.find(marker, start_idx)
        if idx != -1 and idx < end_idx:
            end_idx = idx

    section = full_text[start_idx:end_idx].strip()
    return section[:2000] if section else None


def save_condition_medications(medication_id: str, condition_ids: list[str]) -> int:
    """condition_medications tablosuna kaydet (duplicate'leri atla)."""
    if not condition_ids:
        return 0

    rows = [
        {
            "medication_id": medication_id,
            "condition_id": cid,
            "notes": "KÜB anahtar kelime eşleştirme",
        }
        for cid in condition_ids
    ]

    try:
        supabase.table("condition_medications").upsert(
            rows,
            on_conflict="medication_id,condition_id",
        ).execute()
        return len(rows)
    except Exception as e:
        print(f"  Kayıt hatası: {e}")
        return 0


def main() -> None:
    _ = BATCH_SIZE  # gelecekte batch/paralel iş için
    print("BiTanı KÜB Endikasyon Çıkarıcı başlıyor...")
    if _debug_kub():
        print("KUB_DEBUG=1 — 4.1 yoksa PDF önizleme, eşleşme yoksa endikasyon metni yazdırılır.\n")
    else:
        print()

    processed_ids = fetch_processed_medication_id_set()
    medications = fetch_medications(processed_ids)
    conditions = fetch_conditions()

    print(f"Zaten eşlemesi olan (atlanan): {len(processed_ids)} ilaç")
    print(f"Bu koşuda işlenecek ilaç: {len(medications)}")
    print(f"Hastalık sayısı: {len(conditions)}\n")

    stats = {
        "toplam": len(medications),
        "pdf_indirildi": 0,
        "bolum_bulundu": 0,
        "eslestirme_yapildi": 0,
        "kayit_eklendi": 0,
        "hata": 0,
        "brosur_atlandi": 0,
    }

    for i, med in enumerate(medications):
        name = (med.get("ilac_adi") or "")[:50]
        print(f"[{i + 1}/{len(medications)}] {name}...")

        pdf_path = download_pdf(med["kub_url"])
        if not pdf_path:
            print("  ✗ PDF indirilemedi")
            stats["hata"] += 1
            continue
        stats["pdf_indirildi"] += 1

        try:
            full_text = read_pdf_text(pdf_path)
            if full_text is None:
                print("  ✗ PDF metni okunamadı")
                stats["hata"] += 1
                continue

            if looks_like_hasta_brosuru(full_text):
                print("  KÜB değil, hasta broşürü")
                stats["brosur_atlandi"] += 1
                continue

            section = extract_section_41_from_text(full_text)
            if not section:
                print("  ✗ 4.1 bölümü bulunamadı")
                if _debug_kub():
                    preview = full_text[:_DEBUG_PREVIEW_LEN]
                    print(f"  [DEBUG] PDF metninin ilk {len(preview)} karakteri (başlık formatı):")
                    print(preview)
                    print("  [DEBUG] — önizleme sonu —")
                stats["hata"] += 1
                continue
            stats["bolum_bulundu"] += 1
            print(f"  ✓ Endikasyon bulundu ({len(section)} karakter)")

            matched_ids = match_conditions_by_keywords(section, conditions)

            if matched_ids:
                stats["eslestirme_yapildi"] += 1
                count = save_condition_medications(med["id"], matched_ids)
                stats["kayit_eklendi"] += count
                print(f"  ✓ {len(matched_ids)} hastalık eşleşti, {count} kayıt eklendi")
            else:
                print("  - Eşleşen hastalık bulunamadı")
                if _debug_kub():
                    print("  [DEBUG] Endikasyon metni:")
                    print(section)
                    print("  [DEBUG] — endikasyon sonu —")

        finally:
            try:
                os.unlink(pdf_path)
            except OSError:
                pass

        time.sleep(SLEEP_BETWEEN)

    print("\n── Özet ──────────────────────────────")
    print(f"Toplam ilaç       : {stats['toplam']}")
    print(f"PDF indirildi     : {stats['pdf_indirildi']}")
    print(f"Bölüm bulundu     : {stats['bolum_bulundu']}")
    print(f"Eşleştirme yapıldı: {stats['eslestirme_yapildi']}")
    print(f"Kayıt eklendi     : {stats['kayit_eklendi']}")
    print(f"Hata              : {stats['hata']}")
    print(f"Hasta broşürü atla: {stats['brosur_atlandi']}")
    print("──────────────────────────────────────")


if __name__ == "__main__":
    main()
