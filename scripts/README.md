# BiTanı — KÜB+KT Endikasyon Pipeline

TİTCK kaynaklı KÜB (Kısa Ürün Bilgisi) ve KT (Kullanma Talimatı) PDF'lerinden
ilaç–hastalık eşleşmelerini çıkarır; `condition_medications` tablosuna yazar.

**Pipeline versiyonu:** v3.5.0  
**Yöntem:** Keyword matching + cümle bazlı filtreler  
**Süre (15k ilaç):** ~5-6 saat (tek terminal) | ~2 saat (3 paralel terminal)

---

## 1. Kurulum

### 1a. Depoyu klonla

```bash
git clone https://github.com/serhatgndgd/BiTani.git
cd BiTani/scripts
```

### 1b. Python sanal ortamı oluştur (Python 3.9+)

```bash
python3 -m venv .venv
source .venv/bin/activate          # macOS / Linux
# .venv\Scripts\activate           # Windows
```

### 1c. Bağımlılıkları yükle

```bash
pip install -r requirements-kub.txt
```

---

## 2. `.env` Dosyası Oluştur

`scripts/.env` dosyasını aşağıdaki şablondan oluştur:

```dotenv
# ── Zorunlu ──────────────────────────────────────────────────────────────────
SUPABASE_URL=https://<proje-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...          # Supabase > Settings > API > service_role

# ── Paralel Çalıştırma (opsiyonel) ───────────────────────────────────────────
# MEDICATION_OFFSET=0       # Bu terminalde kaçıncı ilaçtan başla (varsayılan: 0)
# MEDICATION_LIMIT=5000     # Bu terminalde en fazla kaç ilaç işle (varsayılan: tümü)

# ── Test & Debug (opsiyonel) ─────────────────────────────────────────────────
# MAX_MEDICATIONS=50        # Hızlı test: sadece N ilaç işle
# REPROCESS_ALL=1           # Daha önce işlenmiş ilaçları da yeniden işle
# KUB_DEBUG=1               # Bölüm bulunamazsa PDF önizleme yazdır
# CONCURRENT_DOWNLOADS=10   # Eş zamanlı PDF indirme sayısı (varsayılan: 10)
```

> **Güvenlik:** `.env` dosyası `.gitignore`'da — asla commit etme.  
> Service role key'i Supabase Dashboard → Settings → API → `service_role` (secret) bölümünden al.

---

## 3. Temel Çalıştırma

```bash
cd BiTani/scripts
source .venv/bin/activate

# Tüm 15.573 ilaç — Mac'in uyumaması için caffeinate
caffeinate -i python kub_endikasyon_cikarici.py
```

Beklenen çıktı:
```
══════════════════════════════════════════════════════════
  BiTanı KÜB+KT Pipeline  v3.5.0
  Yöntem: Keyword Matching
  Paralel İndirme: 10
══════════════════════════════════════════════════════════

📋 Veriler çekiliyor...
  Atlanacak (işlenmiş): 0
  İşlenecek ilaç      : 15573
  Hastalık kataloğu   : 74

[    1/15573]   ✅ ARTROCOL PR 200 MG KAPSÜL: 3 endikasyon + 11 kontrendikasyon
...
```

---

## 4. Paralel Çalıştırma (Önerilen)

15k ilacı 3 terminale bölerek işle (~2 saat):

```bash
# Terminal 1 — ilk 5000 ilaç
MEDICATION_OFFSET=0 MEDICATION_LIMIT=5000 REPROCESS_ALL=1 \
  caffeinate -i python kub_endikasyon_cikarici.py

# Terminal 2 — 5001-10000
MEDICATION_OFFSET=5000 MEDICATION_LIMIT=5000 REPROCESS_ALL=1 \
  caffeinate -i python kub_endikasyon_cikarici.py

# Terminal 3 — 10001-son
MEDICATION_OFFSET=10000 MEDICATION_LIMIT=6000 REPROCESS_ALL=1 \
  caffeinate -i python kub_endikasyon_cikarici.py
```

> **Not:** Paralel çalıştırmada `REPROCESS_ALL=1` kullan.  
> Her terminal kendi DB aralığını işler; `upsert` olduğu için çakışma olmaz.  
> Toplam ilaç sayısını öğrenmek için: Supabase → medications tablosu → row count.

---

## 5. Test Modu

```bash
# Sadece 10 ilaç işle
MAX_MEDICATIONS=10 REPROCESS_ALL=1 python kub_endikasyon_cikarici.py

# İlk 50 ilaçı debug modunda işle
MAX_MEDICATIONS=50 REPROCESS_ALL=1 KUB_DEBUG=1 python kub_endikasyon_cikarici.py
```

---

## 6. Env Değişkenleri Referansı

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `SUPABASE_URL` | — | **Zorunlu.** Supabase proje URL'si |
| `SUPABASE_SERVICE_ROLE_KEY` | — | **Zorunlu.** Service role JWT (secret) |
| `MEDICATION_OFFSET` | `0` | DB'de kaçıncı ilaçtan başlanacak |
| `MEDICATION_LIMIT` | tümü | Bu çalıştırmada işlenecek maksimum ilaç |
| `MAX_MEDICATIONS` | tümü | Test kısıtı (MEDICATION_LIMIT'ten küçükse geçerli) |
| `REPROCESS_ALL` | `0` | `1` = daha önce işlenen ilaçlar da yeniden işlenir |
| `KUB_DEBUG` | `0` | `1` = bölüm bulunamazsa PDF önizleme yaz |
| `CONCURRENT_DOWNLOADS` | `10` | Eş zamanlı PDF indirme sayısı |

---

## 7. Veritabanı Şeması

Pipeline'ın yazdığı tablo: `condition_medications`

| Kolon | Tip | Açıklama |
|---|---|---|
| `medication_id` | uuid | → medications tablosu |
| `condition_id` | uuid | → conditions_catalog tablosu |
| `is_contraindication` | boolean | `false` = endikasyon, `true` = kontrendikasyon |
| `confidence_score` | numeric(4,3) | 0.0–1.0 (keyword hit density) |
| `extraction_method` | text | `'keyword'` |
| `evidence_snippet` | text | Eşleşen bölümden ≤200 karakter kanıt |
| `source` | text | `KUB_4_1+KT`, `KUB_4_3`, `KUB_4_1` |
| `annotation_version` | text | Pipeline versiyonu (ör. `v3.5.0`) |

---

## 8. Sorun Giderme

| Belirti | Çözüm |
|---|---|
| `❌ Eksik ortam değişkeni: SUPABASE_SERVICE_ROLE_KEY` | `.env` dosyasını oluştur / key'i doğru gir |
| `⚠️ PDF okunamadı / OCR kalitesi yetersiz` | Normal; OCR bozuk PDF'ler otomatik atlanır |
| `─ Eşleşme yok` | Antibiyotik / vitamin gibi dar endikasyonlu ilaçlarda olabilir |
| Rate limit / timeout hataları | `CONCURRENT_DOWNLOADS=5` ile azalt |
| Çok yavaş | Paralel çalıştır (bkz. §4) veya hızlı SSD / fiber gerekli |

---

## 9. Bağımlılıklar

```
aiohttp>=3.9.0        # Async PDF indirme
pypdf>=5.0.0          # PDF metin çıkarma
python-dotenv>=1.0.0  # .env okuma
requests>=2.31.0      # (yardımcı)
supabase>=2.0.0       # Supabase Python client
```

---

*Sorularını Yetkin'e sor veya repo'ya PR aç.*
