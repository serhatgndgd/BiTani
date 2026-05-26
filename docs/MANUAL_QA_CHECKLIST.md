# BiTani Manual QA Checklist

Bu dokuman production oncesi manuel test senaryolarini listeler.

## WelcomeScreen

### Senaryo 1: Ilk acilista normal giris akisi
- [ ] Uygulamayi temiz kurulumla ac.
- [ ] Welcome ekraninda logo, animasyon ve butonlari kontrol et.
- [ ] "Giris Yap" ve "Kayit Ol" butonlarina tek tek bas.
- [ ] Beklenen sonuc: Ekranlar dogru yonlenir, UI kesilmez, crash olmaz.

### Senaryo 2: Edge case - hizli ardarda tiklama
- [ ] Welcome ekraninda ayni butona hizli sekilde 5-10 kez tikla.
- [ ] Geri donup tekrar ayni deneyi yap.
- [ ] Beklenen sonuc: Cift navigation olmaz, ekran stack bozulmaz.

### Senaryo 3: Error case - network kapaliyken gecis
- [ ] Cihazi offline moda al.
- [ ] Welcome'dan Login/Register ekranina gec.
- [ ] Beklenen sonuc: Ekran acilir, sonradan yapilan API isteklerinde anlasilir hata mesaji gorulur.

## LoginScreen / RegisterScreen / OtpScreen

### Senaryo 1: Happy path - kayit + OTP + giris
- [ ] Register ile gecerli e-posta/sifre gir.
- [ ] OTP kodunu e-postadan alip dogru sekilde gir.
- [ ] Session olustuktan sonra app akisini kontrol et.
- [ ] Beklenen sonuc: Kullanici dogrulanir, onboarding veya ana akisa yonlenir.

### Senaryo 2: Edge case - OTP alanlari ve paste davranisi
- [ ] OTP kutularina tek tek rakam gir.
- [ ] Panodan 6 haneli kod yapistir.
- [ ] Backspace ile geri silme/focus davranisini kontrol et.
- [ ] Beklenen sonuc: Focus dogru ilerler, 6 hane disi kabul edilmez.

### Senaryo 3: Error case - yanlis sifre / gecersiz OTP
- [ ] Login'de yanlis sifre gir.
- [ ] OTP ekraninda gecersiz veya suresi gecmis kod dene.
- [ ] Beklenen sonuc: Türkce, kisa, aksiyon odakli hata mesaji gorulur.

### Senaryo 4: Error case - token/session sorunlari
- [ ] Kayit/login sonrasi uygulamayi kapatip ac.
- [ ] Session restore davranisini kontrol et.
- [ ] Beklenen sonuc: Gecerli session korunur, bozuk sessionda yeniden giris istenir.

## OnboardingScreen

### Senaryo 1: Happy path - 4 adim tamamlama
- [ ] Adim 1: Kisisel bilgileri doldur.
- [ ] Adim 2: Boy/kilo gecerli aralikta gir.
- [ ] Adim 3: Hastalik sec.
- [ ] Adim 4: Ilac secip "Tamamla" bas.
- [ ] Beklenen sonuc: Bilgiler kaydolur, onboarding tamamlanir.

### Senaryo 2: Edge case - secim degistirme ve geri/ileri
- [ ] Hastalik secip geri don, degistir, tekrar ileri git.
- [ ] Ilac seciminde arama yap, secimi kaldir, yeniden sec.
- [ ] Beklenen sonuc: State tutarli kalir, secimler kaybolmaz.

### Senaryo 3: Error case - offline kaydetme
- [ ] Son adimda interneti kapat.
- [ ] Tamamla butonuna bas.
- [ ] Beklenen sonuc: "Internet baglantinizi kontrol edin" benzeri mesaj gorulur, app kilitlenmez.

### Senaryo 4: Error case - server/supabase kaydetme hatasi
- [ ] Gecici backend hatasi simule et (mümkünse).
- [ ] Tamamla islemini tekrar dene.
- [ ] Beklenen sonuc: Ham hata detayi yerine "Bilgileriniz kaydedilemedi. Tekrar deneyin" gorulur.

## HomeScreen

### Senaryo 1: Happy path - ana icerik goruntuleme
- [ ] Home ekranini ac.
- [ ] Profil/hastalik/ilac ozetlerini kontrol et.
- [ ] Beklenen sonuc: Kartlar ve metinler dogru gorunur.

### Senaryo 2: Edge case - bos veri durumu
- [ ] Yeni hesap veya hic veri olmayan hesapla giris yap.
- [ ] Beklenen sonuc: Empty state metinleri anlamli sekilde gorunur.

### Senaryo 3: Error case - veri yukleme sorunu
- [ ] Network kapali iken Home ekranina gir.
- [ ] Beklenen sonuc: Uygun fallback/uyari gorulur, crash olmaz.

## SearchScreen

### Senaryo 1: Happy path - ilac arama ve detay
- [ ] En az 2 karakter ile arama yap.
- [ ] Sonuclardan ilac sec, detay modalini ac.
- [ ] KUB/KT linklerine tikla.
- [ ] Beklenen sonuc: Sonuclar listelenir, detay modali dogru calisir.

### Senaryo 2: Edge case - hizli yazarak debounce testi
- [ ] Arama kutusuna hizli sekilde farkli ifadeler yaz.
- [ ] Listeyi asagi kaydirip pagination tetikle.
- [ ] Beklenen sonuc: Eski sorgu sonucu yeniyi ezmez, liste stabil kalir.

### Senaryo 3: Error case - arama servis hatasi
- [ ] Arama sirasinda interneti kapat veya servis hatasi simule et.
- [ ] Beklenen sonuc: Empty state yerine "Arama yapilamadi. Tekrar deneyin." gorulur.

## NearbyScreen

### Senaryo 1: Happy path - konumdan eczane/hastane listeleme
- [ ] Konum iznini ver.
- [ ] Nöbetci Eczane ve Yakin Hastane sekmelerini ac.
- [ ] Harita yonlendirme ve telefon aramayi dene.
- [ ] Beklenen sonuc: Liste dolu gelir, harita/arama aksiyonlari calisir.

### Senaryo 2: Edge case - konum izni reddi
- [ ] Konum iznini reddet.
- [ ] Tekrar Dene butonunu test et.
- [ ] Beklenen sonuc: Konum ayari yonlendirmesi ve anlasilir mesaj gorunur.

### Senaryo 3: Error case - API/network hatalari
- [ ] Network kapali iken ekrani ac.
- [ ] Sekmeler arasi gecis yapip tekrar dene.
- [ ] Beklenen sonuc: Asagidaki mesajlardan uygun olani gorulur:
- [ ] "Nöbetci eczaneler su an yuklenemiyor"
- [ ] "Yakin hastaneler su an yuklenemiyor"
- [ ] "Internet baglantinizi kontrol edin"

## ChatScreen

### Senaryo 1: Happy path - normal sohbet
- [ ] Chat ekranina girip bir soru gonder.
- [ ] Asistan cevabinin listede gorundugunu kontrol et.
- [ ] Beklenen sonuc: Mesaj akisi sirali, yaziyor gostergesi ve cevap gorunur.

### Senaryo 2: Edge case - acil anahtar kelime
- [ ] "nefes alamiyorum" gibi acil ifade gonder.
- [ ] Beklenen sonuc: Acil yonlendirme butonu gorunur ve Nearby ekranina gider.

### Senaryo 3: Error case - network/server
- [ ] Mesaj gonderirken interneti kapat.
- [ ] Sonra interneti acip tekrar dene.
- [ ] Beklenen sonuc: Uygun sanitize mesajlar gorunur:
- [ ] "Internet baglantinizi kontrol edin"
- [ ] "Asistan su an yanit veremiyor"
- [ ] "Bir sorun olustu, tekrar deneyin"

## ProfileScreen

### Senaryo 1: Happy path - profil guncelleme
- [ ] Profil duzenleye girip ad, dogum tarihi, boy/kilo guncelle.
- [ ] Kaydet butonuna bas.
- [ ] Beklenen sonuc: Bilgiler kaydolur ve ekranda guncel gorunur.

### Senaryo 2: Edge case - ilac/hastalik ekle-cikar
- [ ] Hastalik modalindan secim yapip kaldir.
- [ ] Ilac ekleyip "Birak", sonra "Yeniden basla" dene.
- [ ] Beklenen sonuc: Durumlar dogru degisir, liste tutarli kalir.

### Senaryo 3: Error case - supabase hatalari
- [ ] Kaydetme veya ekleme esnasinda network kes.
- [ ] Beklenen sonuc: Ham hata yerine sanitize mesajlar gorunur:
- [ ] "Bilgileriniz yuklenemedi"
- [ ] "Bilgileriniz kaydedilemedi. Tekrar deneyin"
- [ ] "Hastalik eklenemedi. Tekrar deneyin"
- [ ] "Ilac eklenemedi. Tekrar deneyin"

## Biometric Auth Senaryolari

### Senaryo 1: Happy path - biometrik basarili
- [ ] MainTabs'e girecek bir hesapla login ol.
- [ ] Biometrik dogrulamayi basariyla tamamla.
- [ ] Beklenen sonuc: Uygulamaya girilir.

### Senaryo 2: Edge case - cihazda biometrik yok
- [ ] Biometrik destegi olmayan cihaz/emulator ile dene.
- [ ] Beklenen sonuc: Uygulama fallback ile devam eder, kilitlenmez.

### Senaryo 3: Error case - biometrik hata/throw
- [ ] Biometrik API hatasi simule et (mümkünse).
- [ ] Beklenen sonuc: Fail-closed davranis; kullanici iceri alinmaz, "Tekrar Dene" gorunur.

## Network Offline Senaryolari

### Senaryo 1: Uygulama acilisinda offline
- [ ] Uygulamayi tamamen kapat, offline ac.
- [ ] Beklenen sonuc: Kritik ekranlarda anlasilir hata/fallback gorunur.

### Senaryo 2: Islem ortasinda offline
- [ ] Arama, kaydetme, chat gonderme esnasinda interneti kapat.
- [ ] Beklenen sonuc: Aksiyon odakli hata mesaji + tekrar dene davranisi calisir.

### Senaryo 3: Offline -> online geri donus
- [ ] Offline hatasi aldiktan sonra interneti ac.
- [ ] Tekrar Dene veya ayni aksiyonu tekrar calistir.
- [ ] Beklenen sonuc: Islem basariyla devam eder.

## Token Expired Senaryolari

### Senaryo 1: Session suresi dolmus durum
- [ ] Eski/gecersiz token ile API cagrisi tetikle (mümkünse).
- [ ] Beklenen sonuc: Yetkisiz erisim engellenir, yeniden login akisi tetiklenir.

### Senaryo 2: Edge case - token refresh
- [ ] Uygulama arkaplanda bekletilip geri acilir.
- [ ] Beklenen sonuc: Refresh basariliysa session devam eder.

### Senaryo 3: Error case - refresh basarisiz
- [ ] Refresh hata senaryosu simule et.
- [ ] Beklenen sonuc: Kullanici guvenli sekilde cikisa dusurulur ve login ister.

## KVKK / Privacy Senaryolari

### Senaryo 1: Happy path - izin ve acik metinler
- [ ] Register akisinda KVKK/onay metinlerini kontrol et.
- [ ] Beklenen sonuc: Metinler gorunur, onay olmadan ilerleme engellenir (tasarima gore).

### Senaryo 2: Edge case - paylasim minimum veri
- [ ] Chat ve diger ekranlarda sadece gerekli verinin kullanildigini dogrula.
- [ ] Beklenen sonuc: Gereksiz PII gosterimi yoktur.

### Senaryo 3: Error case - hata mesajlarinda gizlilik
- [ ] Sunucu/network hatalari tetikle.
- [ ] Beklenen sonuc: Stack trace, SQL detay, token vb. hassas bilgi UI'da gorunmez.

## Pre-release Checklist

- [ ] `npm run typecheck` temiz.
- [ ] `npm run lint` temiz.
- [ ] Tum kritik ve orta bug fix commitleri push edildi.
- [ ] App icon/splash dogru (dark theme ile uyumlu).
- [ ] Versiyon/build numarasi guncel.
- [ ] Crash-free temel smoke test tamamlandi.
- [ ] Offline/online temel akislar test edildi.
- [ ] Biometric auth smoke test tamamlandi.
- [ ] JWT/session akislari test edildi.
- [ ] Supabase Edge Function chat smoke testi tamamlandi.

## App Store / Play Store Hazirlik

- [ ] Gizlilik politikasi linki guncel ve erisilebilir.
- [ ] KVKK/Privacy metinleri yayin surumu ile uyumlu.
- [ ] Store screenshot seti guncel (TR dil, dark theme).
- [ ] Store aciklamalari, anahtar kelimeler, kategori kontrol edildi.
- [ ] Destek e-postasi ve iletisim bilgileri guncel.
- [ ] Izinlar (konum vb.) store formlarinda dogru aciklandi.
- [ ] TestFlight/Internal testing dagitimi ile son smoke test yapildi.
- [ ] Release notes hazirlandi.
