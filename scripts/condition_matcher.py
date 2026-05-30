"""
Kural bazlı ilaç ↔ hastalık eşleştirici — PAYLAŞILAN ÇEKİRDEK.
dryrun ve apply scriptleri bunu import eder. DB'ye YAZMAZ, sadece eşleştirir.

Kaynak metinler:
  • medication_kub.therapeutic_indications  (klinik endikasyon — gold)
  • medication_kt.section_1_nedir            (hasta dili "ne için kullanılır")

Eşleştirme kuralları:
  • conditions_catalog adı + synonyms.json sinonimleri aranır.
  • Türkçe-duyarlı küçültme (İ→i, I→ı) + tek-boşluğa normalize.
  • Türkçe-duyarlı kelime sınırı (\b yerine lookaround) — kısmi
    kelime eşleşmesini engeller ("gut" ↔ "gutta" değil).
  • Terim sonunda sınırlı Türkçe çekim eki toleransı vardır
    ("astımın", "lösemisi", "astımda" gibi); başlangıç sınırı strict kalır.
  • <3 harf terimler atlanır (2 harfli kısaltmalar zaten elendi).
  • KÜB 4.1 therapeutic_indications kaynaklı eşleşmeler yüksek güvenlidir.
  • KT section_1_nedir kaynaklı eşleşmelerde eşleşen cümle/pencerede
    endikasyon sinyali zorunludur; semptom listesi/açıklama bağlamı elenir.
  • NEGASYON: eşleşme ±45 karakterinde "kontrendik..." varsa o
    eşleşme SAYILMAZ (örn. "diyabette kontrendike").
  • Bir çift hem KÜB hem KT'den gelirse KÜB eşleşmesi esas alınır.

confidence_score (0.50–0.97):
  • canonical ad eşleşmesi          → 0.90 taban
  • sinonim, uzunluğa göre          → 14+ch:0.88 / 9+:0.80 / 5+:0.70 / 3-4:0.62
  • KÜB endikasyonunda eşleşme      → +0.05 (klinik kaynak güveni)
"""
from __future__ import annotations
import json, os, re
from typing import Optional

HERE = os.path.dirname(__file__)


def tr_lower(s: str) -> str:
    """Türkçe-duyarlı küçültme. İ→i, I→ı, sonra standart lower."""
    return s.replace("İ", "i").replace("I", "ı").lower()


def normalize(s: str) -> str:
    """Küçült + tüm boşluk dizilerini tek boşluğa indir.
    NOT: tr_lower 1:1 karakter koruduğu için indeksler ORİJİNAL ile hizalı
    KALMAZ (boşluk daraltma uzunluğu değiştirir) → evidence için ayrı
    işlenir. Burada yalnız arama metni üretilir."""
    return re.sub(r"\s+", " ", tr_lower(s)).strip()


# kontrendikasyon / kontrendike / kontraendikasyon …
_KONTR_RX = re.compile(r"kontr[ae]?endik")
NEG_WINDOW = 45

# KT section_1 bazen "ne için kullanılır" bilgisinin yanında hedef hastalığın
# semptom listesini de anlatır. Bu liste içindeki hastalık/semptom adları
# endikasyon değildir; yalnız KT kaynaklı eşleşmelerde aşağıdaki gate uygulanır.
_KT_INDICATION_RX = re.compile(
    r"endike(?:dir)?|endikasyon(?:u|lar[ıi])?|endike\s+oldu[ğg]u"
    r"|tedavisinde|tedavisine|tedavisi\s+i[çc]in|tedavi\s+etmek"
    r"|tedavi\s+amac[ıi]yla|hastal[ıi]klar[ıi]n\s+tedavisi"
    r"|kullan\s*[ıi]l[ıi]r|kullan\s*[ıi]lmaktad[ıi]r|kullan\s*[ıi]labilir"
    r"|yard[ıi]mc[ıi]\s+olur|kontrol\s+alt[ıi]na\s+al[ıi]n"
    r"|giderir|giderilmesi|verilmi[şs]\s+bulun"
)
_KT_SYMPTOM_CONTEXT_RX = re.compile(
    r"belirti(?:si|leri)?|semptom(?:u|lar[ıi])?|g[öo]r[üu]lebilir"
    r"|yer\s+al[ıi]r|yer\s+almaktad[ıi]r|aras[ıi]nda"
    r"|e[şs]lik\s+eden|[şs]ikayet(?:i|leri)?|bulgu(?:su|lar[ıi])?"
)
KT_CONTEXT_WINDOW = 180

_KUB_ADVERSE_CONTEXT_RX = re.compile(
    r"olu[şs]abilir|olu[şs]abilece[ğg]i|g[öo]r[üu]lebilir"
    r"|bildirilmi[şs]tir|advers|yan\s+etki|istenmeyen\s+etki"
    r"|(?:olu[şs]ma|olu[şs]mas[ıi]|geli[şs]me|geli[şs]mes[ıi]"
    r"|g[öo]r[üu]lme|g[öo]r[üu]lmes[ıi])\s+risk(?:i|ini|inin)?"
)
_KUB_LAB_INTERACTION_CONTEXT_RX = re.compile(
    r"tayin(?:i|ler[ıi]?)?|[öo]l[çc][üu]m(?:[üu])?|testi|d[üu]zey(?:i)?"
    r"|etkile[şs]im|giri[şs]im"
)
_KUB_QUALIFIED_PREFIXES = {
    "depresyon": re.compile(
        r"(?:solunum|kemik\s+ili[ğg]i|miyokard|sss"
        r"|santral\s+sinir\s+sistemi|merkezi\s+sinir\s+sistemi"
        r"|med[üu]ller)\s+$"
    ),
    "hiperaktivite": re.compile(r"(?:ya[ğg]\s+bezlerin(?:in|de))\s+$"),
}
KUB_CONTEXT_WINDOW = 140
KT_CONTEXTUAL_FALSE_POSITIVES = {
    "yüksek kolesterol": re.compile(
        r"kolestiramin|emili\s*min|emilim|etkilili[ğg]ini\s+azalt"
    ),
}

_TR_WORD_CHARS = "a-zçğıiöşü0-9"
_OCR_SPACE = r"\s*"
_TR_SUFFIX_GROUP = (
    r"(?:lar|ler)?"
    + _OCR_SPACE +
    r"(?:"
    r"[ıiuüae]"
    r"|[ıiuü]n"
    r"|n[ıiuü]n"
    r"|s[ıiuü]"
    r"|l[ıiuü]"
    r"|[dt][ae]"
    r"|[dt][ae]n"
    r")?"
    + _OCR_SPACE +
    r"(?:"
    r"[ıiuü]"
    r"|[ıiuü]n"
    r"|n[ıiuü]n"
    r"|s[ıiuü]"
    r"|[dt][ae]"
    r"|[dt][ae]n"
    r")?"
)
_TR_OPTIONAL_SUFFIX_RX = rf"(?:{_TR_SUFFIX_GROUP})?"


def term_variants(term: str) -> list[str]:
    """Generate conservative final-word stem variants for possessed compounds."""
    variants = [term]
    last = term.rsplit(" ", 1)[-1]
    # "mantar enfeksiyonu" should also catch "mantar enfeksiyonları".
    if last.endswith("iyonu") and len(last) > 6:
        variants.append(term[:-1])
    return variants


def term_regex(term: str, allow_suffix: bool = True) -> re.Pattern:
    """Strict prefix boundary + limited Turkish suffix tolerance at term end."""
    suffix = _TR_OPTIONAL_SUFFIX_RX if allow_suffix else ""
    term_part = "|".join(re.escape(variant) for variant in term_variants(term))
    return re.compile(
        rf"(?<![{_TR_WORD_CHARS}])"
        + rf"(?:{term_part})"
        + suffix
        + rf"(?![{_TR_WORD_CHARS}])"
    )


class Matcher:
    def __init__(self, synonyms_path: Optional[str] = None,
                 min_term_len: int = 3):
        path = synonyms_path or os.path.join(HERE, "synonyms.json")
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)

        self.min_term_len = min_term_len
        # condition_id -> {"name", "terms": [(term, compiled_rx, is_canonical)]}
        self.conditions: dict[str, dict] = {}
        for cid, entry in raw.items():
            name = entry["name"]
            terms: list[tuple[str, re.Pattern, bool]] = []
            seen: set[str] = set()
            # canonical ad + sinonimler
            cand = [(normalize(name), True)] + \
                   [(normalize(s), False) for s in entry["synonyms"]]
            for term, is_canon in cand:
                if len(term) < self.min_term_len or term in seen:
                    continue
                seen.add(term)
                # Ön sınır strict; arka sınırda yalnız yaygın Türkçe çekim ekleri var.
                rx = term_regex(term, allow_suffix=len(term) >= 4)
                terms.append((term, rx, is_canon))
            self.conditions[cid] = {"name": name, "terms": terms}

    # ── confidence ────────────────────────────────────────────────────
    @staticmethod
    def _score(term: str, is_canon: bool, source: str) -> float:
        if is_canon:
            base = 0.90
        else:
            L = len(term)
            base = 0.88 if L >= 14 else 0.80 if L >= 9 else \
                   0.70 if L >= 5 else 0.62
        if source == "kub":          # klinik endikasyon kaynağı
            base += 0.05
        return round(min(0.97, base), 2)

    # ── negasyon ──────────────────────────────────────────────────────
    @staticmethod
    def _negated(norm_text: str, start: int, end: int) -> bool:
        lo = max(0, start - NEG_WINDOW)
        hi = min(len(norm_text), end + NEG_WINDOW)
        return bool(_KONTR_RX.search(norm_text[lo:hi]))

    @staticmethod
    def _sentence_around(norm_text: str, start: int, end: int) -> str:
        lo_candidates = [
            norm_text.rfind(mark, 0, start)
            for mark in (".", ";", "!", "?", "\n")
        ]
        hi_candidates = [
            pos for pos in (
                norm_text.find(mark, end)
                for mark in (".", ";", "!", "?", "\n")
            )
            if pos >= 0
        ]
        lo = max(lo_candidates) + 1
        hi = min(hi_candidates) if hi_candidates else len(norm_text)
        return norm_text[lo:hi].strip()

    @staticmethod
    def _context_around(norm_text: str, start: int, end: int) -> str:
        lo = max(0, start - KT_CONTEXT_WINDOW)
        hi = min(len(norm_text), end + KT_CONTEXT_WINDOW)
        return norm_text[lo:hi]

    @staticmethod
    def _looks_like_enumeration(context: str) -> bool:
        return context.count(",") >= 2 or len(re.findall(r"\s[-•]\s|\s[–-]\s", context)) >= 2

    def _kt_indication_context_ok(self, norm_text: str, start: int, end: int) -> bool:
        sentence = self._sentence_around(norm_text, start, end)
        context = self._context_around(norm_text, start, end)
        haystack = f"{sentence} {context}"

        if _KT_SYMPTOM_CONTEXT_RX.search(haystack) and not _KT_INDICATION_RX.search(haystack):
            return False
        if self._looks_like_enumeration(sentence) and not _KT_INDICATION_RX.search(haystack):
            return False
        return bool(_KT_INDICATION_RX.search(haystack))

    @staticmethod
    def _kt_negative_reason(norm_text: str, start: int, end: int,
                            term: str) -> Optional[str]:
        context = norm_text[max(0, start - KT_CONTEXT_WINDOW):min(len(norm_text), end + KT_CONTEXT_WINDOW)]
        for fp_term, fp_rx in KT_CONTEXTUAL_FALSE_POSITIVES.items():
            if term == fp_term and fp_rx.search(context):
                return f"contextual false positive: {fp_term}"
        return None

    @staticmethod
    def _kub_context_around(norm_text: str, start: int, end: int) -> str:
        lo = max(0, start - KUB_CONTEXT_WINDOW)
        hi = min(len(norm_text), end + KUB_CONTEXT_WINDOW)
        return norm_text[lo:hi]

    @staticmethod
    def _kub_qualified_reason(norm_text: str, start: int, term: str) -> Optional[str]:
        before = norm_text[max(0, start - 80):start]
        for qualified_term, prefix_rx in _KUB_QUALIFIED_PREFIXES.items():
            if term == qualified_term and prefix_rx.search(before):
                return f"qualified compound: {qualified_term}"
        return None

    def _kub_negative_reason(self, norm_text: str, start: int, end: int,
                             term: str) -> Optional[str]:
        qualified = self._kub_qualified_reason(norm_text, start, term)
        if qualified:
            return qualified

        context = self._kub_context_around(norm_text, start, end)
        if _KUB_ADVERSE_CONTEXT_RX.search(context):
            return "adverse context"
        if _KUB_LAB_INTERACTION_CONTEXT_RX.search(context):
            return "lab/interaction context"
        return None

    # ── tek kaynakta tek hastalık araması ──────────────────────────────
    def _scan_source(self, norm_text: str, raw_text: str, source: str,
                     cid: str) -> Optional[tuple[float, str]]:
        """Bu kaynak metninde verilen hastalık için en iyi (skor, evidence)."""
        best: Optional[tuple[float, str]] = None
        for term, rx, is_canon in self.conditions[cid]["terms"]:
            for m in rx.finditer(norm_text):
                if self._negated(norm_text, m.start(), m.end()):
                    continue
                if source == "kub" and self._kub_negative_reason(norm_text, m.start(), m.end(), term):
                    continue
                if source == "kt" and self._kt_negative_reason(norm_text, m.start(), m.end(), term):
                    continue
                if source == "kt" and not self._kt_indication_context_ok(norm_text, m.start(), m.end()):
                    continue
                sc = self._score(term, is_canon, source)
                if best is None or sc > best[0]:
                    ev = self._evidence(raw_text, term, source)
                    best = (sc, ev)
                break  # bu terim için ilk geçerli eşleşme yeterli
        return best

    @staticmethod
    def _evidence(raw_text: str, term: str, source: str) -> str:
        """Okunabilir kanıt: orijinal metinde terim çevresinden ~120ch."""
        low = tr_lower(raw_text)
        idx = low.find(term)
        if idx < 0:  # boşluk normalize farkı → ilk kelimeyle dene
            first = term.split(" ")[0]
            idx = low.find(first)
        if idx < 0:
            snippet = raw_text[:160]
        else:
            lo = max(0, idx - 60)
            hi = min(len(raw_text), idx + len(term) + 60)
            snippet = raw_text[lo:hi]
        snippet = re.sub(r"\s+", " ", snippet).strip()
        tag = "KÜB" if source == "kub" else "KT"
        return f"[{tag}|{term}] …{snippet}…"

    # ── ana API ─────────────────────────────────────────────────────────
    def match(self, kt_text: Optional[str], kub_text: Optional[str]) -> dict:
        """Bir ilaç için {condition_id: (confidence, evidence)} döndürür.
        KÜB 4.1 eşleşmeleri önceliklidir; KT-only eşleşmeler gate'ten geçer."""
        out: dict[str, tuple[float, str]] = {}
        has_kub = bool(kub_text and kub_text.strip())
        has_kt = bool(kt_text and kt_text.strip())
        if not has_kub and not has_kt:
            return out

        norm_cache = {}
        if has_kub:
            norm_cache["kub"] = normalize(kub_text or "")
        if has_kt:
            norm_cache["kt"] = normalize(kt_text or "")

        for cid in self.conditions:
            if has_kub:
                kub_res = self._scan_source(norm_cache["kub"], kub_text or "", "kub", cid)
                if kub_res:
                    out[cid] = kub_res
                    continue
            if has_kt:
                kt_res = self._scan_source(norm_cache["kt"], kt_text or "", "kt", cid)
                if kt_res:
                    out[cid] = kt_res
        return out
