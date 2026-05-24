#!/usr/bin/env python3
"""
BiTanı - KÜB + KT Endikasyon Çıkarıcı
TİTCK KÜB ve KT PDF'lerinden endikasyonları çıkarır:
  - KÜB: "4.1 Terapötik Endikasyonlar" bölümü
  - KÜB: "4.3 Kontrendikasyonlar" bölümü  → is_contraindication = True
  - KT : "Ne için kullanılır" / "Neyin için kullanılır" bölümü

Her iki kaynaktan gelen eşleşmeler condition_medications tablosuna yazılır.
Yeni kolonlar: confidence_score, is_contraindication, extraction_method,
               evidence_snippet, source, annotation_version

Çalıştırma:
  cd scripts && python -m venv .venv && source .venv/bin/activate
  pip install -r requirements-kub.txt
  cp .env.example .env   # Supabase anahtarlarını doldur
  python kub_endikasyon_cikarici.py

İsteğe bağlı bayraklar (.env veya ortam):
  KUB_DEBUG=1       — bölüm bulunamazsa PDF önizleme, eşleşme yoksa metin yazdırılır
  REPROCESS_ALL=1   — daha önce işlenmiş ilaçları da yeniden işle
  MAX_MEDICATIONS=N — test koşusu için ilaç sayısını sınırla

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
_MEDICATIONS_PAGE = 500  # PostgREST URL sınırı; sayfalama + filtre
PIPELINE_VERSION = "v2.0.0"  # confidence_score + is_contraindication + evidence_snippet
# ───────────────────────────────────────────────────────────────────────────

_PLACEHOLDER_SERVICE = "your_service_role_key_here"
_DEBUG_PREVIEW_LEN = 500

# KÜB: 4 / 4. / 4 . 1 / 4.1. vb. + "terapötik" (büyük/küçük harf, çoklu boşluk)
_SECTION_41_HEADER = re.compile(r"4[\.\s]*1[\s\.]+" + "terapötik", re.IGNORECASE)

# KÜB: 4.3 Kontrendikasyonlar bölümü
_SECTION_43_HEADER = re.compile(
    r"4[\.\s]*3[\s\.]+(kontr(?:a)?endikasyon|kontrendike)",
    re.IGNORECASE,
)

# KT: "Ne için kullanılır" veya "Neyin için kullanılır" (her türlü boşluk, büyük/küçük)
_KT_SECTION_HEADER = re.compile(
    r"ne(?:yin)?\s+için\s+kullan[ıi]l[ıi]r",
    re.IGNORECASE,
)

# PDF başında bu kalıp varsa hasta broşürü (KT) — başlık tespiti için
_BROSUR_HEAD_CHARS = 4000


def _debug_kub() -> bool:
    return _env("KUB_DEBUG").lower() in ("1", "true", "yes", "on")


def _reprocess_all() -> bool:
    return _env("REPROCESS_ALL").lower() in ("1", "true", "yes", "on")


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


def match_conditions_by_keywords(
    endikasyon_text: str,
    conditions: list,
) -> list[dict]:
    """Endikasyon metninde katalog anahtar kelimelerini ara.

    Döndürür: [{"condition_id": str, "confidence_score": float, "evidence_snippet": str}]
    confidence_score = eşleşen_keyword_sayısı / sqrt(section_uzunluğu / 100)
    0.0–1.0 aralığına normalize edilir.
    """
    hay = text_for_match(endikasyon_text)
    section_len = max(len(endikasyon_text), 1)
    matched: list[dict] = []

    for c in conditions:
        cid = c.get("id")
        name = c.get("name") or ""
        if not cid or not name:
            continue

        hit_count = 0
        first_snippet = ""
        for nkw in normalized_keywords_for_condition(name):
            for variant in _strip_turkish_suffix_chain(nkw):
                if len(variant) >= 2 and variant in hay:
                    hit_count += 1
                    if not first_snippet:
                        # Eşleşen yerin çevresinden 120 karakter al
                        idx = hay.find(variant)
                        start = max(0, idx - 40)
                        end = min(len(endikasyon_text), idx + 80)
                        first_snippet = endikasyon_text[start:end].strip()
                    break  # Bu keyword için ilk eşleşme yeterli

        if hit_count > 0:
            # Kısa metinde 1 hit = daha güvenilir; uzun metinde normalize et
            import math
            raw_score = hit_count / (1 + math.log(section_len / 100 + 1))
            confidence = min(round(raw_score, 3), 1.0)
            matched.append({
                "condition_id": cid,
                "confidence_score": confidence,
                "evidence_snippet": first_snippet[:200],
            })

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
    """kub_url VEYA kt_url dolu olan ilaçları çek; işlenmiş olanları atla.

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
            .select("id, ilac_adi, kub_url, kt_url")
            .or_("kub_url.not.is.null,kt_url.not.is.null")
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
    """Metnin başında 'Kullanma Talimatı' varsa hasta broşürü (KT) sayılır."""
    head = text_for_match(full_text.lstrip()[:_BROSUR_HEAD_CHARS])
    return bool(head) and ("kullanma talimatı" in head or "kullanma talimati" in head)


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
    """KÜB metninden 4.1 Terapötik Endikasyonlar bölümünü kes."""
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


def extract_section_43_from_text(full_text: str) -> str | None:
    """KÜB metninden 4.3 Kontrendikasyonlar bölümünü kes.

    Bu bölümden gelen eşleşmeler is_contraindication=True olarak işaretlenir.
    """
    markers_end = [
        "4.4 Özel",
        "4.4. Özel",
        "4.4 ÖZEL",
        "4.4 ozel",
        "4.5 Diğer",
        "4.5. Diğer",
    ]

    m = _SECTION_43_HEADER.search(full_text)
    if not m:
        return None
    start_idx = m.end()

    end_idx = len(full_text)
    for marker in markers_end:
        idx = full_text.find(marker, start_idx)
        if idx == -1:
            idx = full_text.lower().find(marker.lower(), start_idx)
        if idx != -1 and idx < end_idx:
            end_idx = idx

    section = full_text[start_idx:end_idx].strip()
    return section[:2000] if section else None


def extract_kt_section_from_text(full_text: str) -> str | None:
    """KT metninden 'Ne için kullanılır' / 'Neyin için kullanılır' bölümünü kes."""
    # KT belgesinde bu başlıktan sonraki bölüm bir sonraki ana başlığa kadar alınır
    markers_end = [
        "kullanmadan önce",
        "nasıl kullanılır",
        "nasil kullanilir",
        "olası yan etkiler",
        "olasi yan etkiler",
        "dikkat edilmesi gereken",
    ]

    m = _KT_SECTION_HEADER.search(full_text)
    if not m:
        return None
    start_idx = m.end()

    ft_lower = full_text.lower()
    end_idx = len(full_text)
    for marker in markers_end:
        idx = ft_lower.find(marker, start_idx)
        if idx != -1 and idx < end_idx:
            end_idx = idx

    section = full_text[start_idx:end_idx].strip()
    return section[:2000] if section else None


def save_condition_medications(
    medication_id: str,
    matches: list[dict],
    source: str,
    is_contraindication: bool = False,
) -> int:
    """condition_medications tablosuna kaydet.

    matches: [{"condition_id": str, "confidence_score": float, "evidence_snippet": str}]
    Kontrendikasyon eşleşmeleri is_contraindication=True ile ayrı kaydedilir.
    """
    if not matches:
        return 0

    rows = [
        {
            "medication_id": medication_id,
            "condition_id": m["condition_id"],
            "confidence_score": m.get("confidence_score"),
            "evidence_snippet": m.get("evidence_snippet", "")[:200],
            "extraction_method": "keyword",
            "source": source,
            "is_contraindication": is_contraindication,
            "annotation_version": PIPELINE_VERSION,
        }
        for m in matches
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
    print("BiTanı KÜB+KT Endikasyon Çıkarıcı başlıyor...")

    reprocess = _reprocess_all()
    if reprocess:
        print("REPROCESS_ALL=1 — daha önce işlenmiş ilaçlar da yeniden işlenecek.")
    if _debug_kub():
        print("KUB_DEBUG=1 — bölüm yoksa PDF önizleme, eşleşme yoksa endikasyon metni yazdırılır.")
    print()

    processed_ids = set() if reprocess else fetch_processed_medication_id_set()
    medications = fetch_medications(processed_ids)
    conditions = fetch_conditions()

    print(f"Zaten eşlemesi olan (atlanan): {len(processed_ids)} ilaç")
    print(f"Bu koşuda işlenecek ilaç     : {len(medications)}")
    print(f"Hastalık sayısı              : {len(conditions)}\n")

    stats = {
        "toplam": len(medications),
        "kub_pdf_indirildi": 0,
        "kub_bolum_41_bulundu": 0,
        "kub_bolum_43_bulundu": 0,
        "kt_pdf_indirildi": 0,
        "kt_bolum_bulundu": 0,
        "eslestirme_yapildi": 0,
        "kayit_eklendi": 0,
        "kontrendikasyon_eklendi": 0,
        "hata": 0,
    }

    for i, med in enumerate(medications):
        name = (med.get("ilac_adi") or "")[:50]
        print(f"[{i + 1}/{len(medications)}] {name}...")

        # {condition_id: {"confidence_score": float, "evidence_snippet": str}}
        endikasyon_matches: dict[str, dict] = {}
        kontra_matches: dict[str, dict] = {}
        sources_used: list[str] = []

        # ── KÜB PDF ──────────────────────────────────────────────────────────
        kub_url = med.get("kub_url")
        if kub_url:
            pdf_path = download_pdf(kub_url)
            if not pdf_path:
                print("  KÜB ✗ PDF indirilemedi")
                stats["hata"] += 1
            else:
                stats["kub_pdf_indirildi"] += 1
                try:
                    full_text = read_pdf_text(pdf_path)
                    if not full_text:
                        print("  KÜB ✗ PDF metni okunamadı")
                        stats["hata"] += 1
                    elif looks_like_hasta_brosuru(full_text):
                        # kub_url aslında KT belgesi — KT olarak işle
                        print("  KÜB URL'si KT belgesi içeriyor, KT olarak işleniyor")
                        section = extract_kt_section_from_text(full_text)
                        if section:
                            stats["kt_bolum_bulundu"] += 1
                            for m in match_conditions_by_keywords(section, conditions):
                                cid = m["condition_id"]
                                if cid not in endikasyon_matches or \
                                   m["confidence_score"] > endikasyon_matches[cid]["confidence_score"]:
                                    endikasyon_matches[cid] = m
                            sources_used.append("KT")
                            print(f"  KT(kub_url) ✓ {len(section)} karakter, {len(endikasyon_matches)} eşleşme")
                        else:
                            print("  KT(kub_url) ✗ 'Ne için kullanılır' bölümü bulunamadı")
                            if _debug_kub():
                                print(f"  [DEBUG] ilk {_DEBUG_PREVIEW_LEN} karakter:")
                                print(full_text[:_DEBUG_PREVIEW_LEN])
                    else:
                        # ── 4.1 Endikasyonlar ────────────────────────────────
                        section_41 = extract_section_41_from_text(full_text)
                        if section_41:
                            stats["kub_bolum_41_bulundu"] += 1
                            for m in match_conditions_by_keywords(section_41, conditions):
                                cid = m["condition_id"]
                                if cid not in endikasyon_matches or \
                                   m["confidence_score"] > endikasyon_matches[cid]["confidence_score"]:
                                    endikasyon_matches[cid] = m
                            sources_used.append("KUB_4_1")
                            print(f"  KÜB 4.1 ✓ {len(section_41)} karakter, {len(endikasyon_matches)} eşleşme")
                        else:
                            print("  KÜB ✗ 4.1 bölümü bulunamadı")
                            if _debug_kub():
                                print(f"  [DEBUG] KÜB ilk {_DEBUG_PREVIEW_LEN} karakter:")
                                print(full_text[:_DEBUG_PREVIEW_LEN])
                                print("  [DEBUG] — önizleme sonu —")
                            stats["hata"] += 1

                        # ── 4.3 Kontrendikasyonlar ───────────────────────────
                        section_43 = extract_section_43_from_text(full_text)
                        if section_43:
                            stats["kub_bolum_43_bulundu"] += 1
                            contra = match_conditions_by_keywords(section_43, conditions)
                            for m in contra:
                                cid = m["condition_id"]
                                # Kontrendikasyon endikasyon listesinden çıkarılır
                                endikasyon_matches.pop(cid, None)
                                if cid not in kontra_matches or \
                                   m["confidence_score"] > kontra_matches[cid]["confidence_score"]:
                                    kontra_matches[cid] = m
                            print(f"  KÜB 4.3 ✓ {len(section_43)} karakter, {len(kontra_matches)} kontrendikasyon")
                finally:
                    try:
                        os.unlink(pdf_path)
                    except OSError:
                        pass

        # ── KT PDF ───────────────────────────────────────────────────────────
        kt_url = med.get("kt_url")
        if kt_url:
            pdf_path = download_pdf(kt_url)
            if not pdf_path:
                print("  KT ✗ PDF indirilemedi")
            else:
                stats["kt_pdf_indirildi"] += 1
                try:
                    full_text = read_pdf_text(pdf_path)
                    if not full_text:
                        print("  KT ✗ PDF metni okunamadı")
                    else:
                        section = extract_kt_section_from_text(full_text)
                        if section:
                            stats["kt_bolum_bulundu"] += 1
                            for m in match_conditions_by_keywords(section, conditions):
                                cid = m["condition_id"]
                                # Kontrendikasyon olarak işaretlenmişse KT'den ekle ama kontrendike bayrakla
                                if cid in kontra_matches:
                                    continue
                                if cid not in endikasyon_matches or \
                                   m["confidence_score"] > endikasyon_matches[cid]["confidence_score"]:
                                    endikasyon_matches[cid] = m
                            sources_used.append("KT")
                            print(f"  KT ✓ {len(section)} karakter, {len(endikasyon_matches)} toplam eşleşme")
                        else:
                            print("  KT ✗ 'Ne için kullanılır' bölümü bulunamadı")
                            if _debug_kub():
                                print(f"  [DEBUG] KT ilk {_DEBUG_PREVIEW_LEN} karakter:")
                                print(full_text[:_DEBUG_PREVIEW_LEN])
                                print("  [DEBUG] — önizleme sonu —")
                finally:
                    try:
                        os.unlink(pdf_path)
                    except OSError:
                        pass

        # ── Kaydet: Endikasyonlar ────────────────────────────────────────────
        source_label = "+".join(sources_used) if sources_used else "keyword"
        total_saved = 0

        if endikasyon_matches:
            stats["eslestirme_yapildi"] += 1
            count = save_condition_medications(
                med["id"],
                list(endikasyon_matches.values()),
                source=source_label,
                is_contraindication=False,
            )
            stats["kayit_eklendi"] += count
            total_saved += count

        # ── Kaydet: Kontrendikasyonlar ───────────────────────────────────────
        if kontra_matches:
            count = save_condition_medications(
                med["id"],
                list(kontra_matches.values()),
                source="KUB_4_3",
                is_contraindication=True,
            )
            stats["kontrendikasyon_eklendi"] += count
            total_saved += count

        if total_saved > 0:
            print(f"  ✓ {len(endikasyon_matches)} endikasyon + {len(kontra_matches)} kontrendikasyon "
                  f"→ {total_saved} kayıt [{source_label}]")
        else:
            print("  - Eşleşen hastalık bulunamadı")

        time.sleep(SLEEP_BETWEEN)

    print("\n── Özet ──────────────────────────────────────")
    print(f"Pipeline versiyonu     : {PIPELINE_VERSION}")
    print(f"Toplam ilaç            : {stats['toplam']}")
    print(f"KÜB PDF indirildi      : {stats['kub_pdf_indirildi']}")
    print(f"KÜB 4.1 bölüm bulundu  : {stats['kub_bolum_41_bulundu']}")
    print(f"KÜB 4.3 bölüm bulundu  : {stats['kub_bolum_43_bulundu']}")
    print(f"KT PDF indirildi       : {stats['kt_pdf_indirildi']}")
    print(f"KT bölüm bulundu       : {stats['kt_bolum_bulundu']}")
    print(f"Eşleştirme yapıldı     : {stats['eslestirme_yapildi']}")
    print(f"Endikasyon kaydı       : {stats['kayit_eklendi']}")
    print(f"Kontrendikasyon kaydı  : {stats['kontrendikasyon_eklendi']}")
    print(f"Hata                   : {stats['hata']}")
    print("──────────────────────────────────────────────")


if __name__ == "__main__":
    main()
