export type LegalDocumentId =
  | 'kvkk_aydinlatma'
  | 'acik_riza'
  | 'sorumluluk_reddi'
  | 'gizlilik_politikasi';

export type LegalDocument = {
  id: LegalDocumentId;
  title: string;
  markdown: string;
};

export const LEGAL_DOCUMENTS: Record<LegalDocumentId, LegalDocument> = {
  kvkk_aydinlatma: {
    id: 'kvkk_aydinlatma',
    title: 'KVKK Aydınlatma Metni',
    markdown: `# KVKK Aydınlatma Metni

## 1. Veri Sorumlusu

BiTanı, bir üniversite bitirme projesi olarak geliştirilmiş bir mobil sağlık bilgi rehberi uygulamasıdır. Bu uygulama Yetkin Ersin Örün ve Serhat Gündoğdu tarafından akademik amaçlarla geliştirilmektedir. Ticari bir hizmet değildir.

İletişim: bitani.proje@gmail.com

## 2. İşlenen Kişisel Veriler

### Kimlik Bilgileri

- Ad, soyad
- E-posta adresi
- Doğum tarihi (yaş kontrolü için)
- Cinsiyet

### Özel Nitelikli Kişisel Veriler (KVKK md. 6)

- Boy, kilo (BMI hesabı için)
- Kronik hastalık bilgileri
- Kullandığınız ilaçlar
- Sohbet geçmişi (sağlık verisi içerebilir)

## 3. Veri İşleme Amacı

- Size kişiselleştirilmiş prospektüs bilgisi sunmak
- Kullandığınız ilaçlar arasında etkileşim uyarısı vermek
- Acil durumlarda doğru yönlendirme yapmak
- Hizmet kalitesini iyileştirmek

## 4. Veri İşleme Hukuki Sebebi

KVKK md. 6/3 gereği özel nitelikli kişisel veriler yalnızca AÇIK RIZA ile işlenir. Uygulamayı kullanmak başlı başına açık rıza vermek anlamına gelmez. Sağlık verilerinizin işlenmesi için ayrı bir açık rıza formu sunulacaktır.

## 5. Veri Aktarımı

### Yurt İçi

- Supabase (veritabanı sağlayıcı) — Bulut altyapısı

### Yurt Dışı

- ABD merkezli yapay zeka servis sağlayıcıları (sohbet işlevi için)
- Bu aktarım için AYRI açık rıza alınır

## 6. Veri Saklama Süresi

- Hesap aktif olduğu sürece + 6 ay
- Hesap silindiğinde tüm veriler 30 gün içinde silinir

## 7. Haklarınız (KVKK md. 11)

Aşağıdaki haklara sahipsiniz:

- Kişisel verilerinizin işlenip işlenmediğini öğrenme
- İşlenmişse bilgi talep etme
- İşlenme amacını öğrenme
- Düzeltme talep etme
- Silme talep etme ("unutulma hakkı")
- İşlemeye itiraz etme
- Zarar halinde tazminat talep etme

Bu hakları kullanmak için: bitani.proje@gmail.com

## 8. Güvenlik Önlemleri

- Şifreleriniz hash'lenerek saklanır
- İletişim TLS ile şifrelenir
- Oturum token'ları cihazda güvenli depolanır (expo-secure-store / Keychain)
- Veritabanı erişimi Row Level Security (RLS) ile kullanıcı bazında izole edilir

## 9. Veri İhlali Bildirimi

Veri güvenliği ihlali halinde 72 saat içinde sizi ve Kişisel Verileri Koruma Kurulu'nu bilgilendireceğiz.

## 10. Çerez ve Tracking

Bu mobil uygulamada üçüncü taraf reklam veya analitik takip çerezi kullanılmaz.

## 11. Önemli Uyarı

BU UYGULAMA TIBBİ TAVSİYE VERMEZ, doktor veya eczacı yerine geçmez. Akademik bir bitirme projesidir.
`,
  },
  acik_riza: {
    id: 'acik_riza',
    title: 'Açık Rıza Beyanı',
    markdown: `# Açık Rıza Beyanı

Aşağıdaki konularda açık rıza vermenizi rica ederiz:

Bu rızaları istediğiniz zaman uygulama ayarlarından geri alabilirsiniz. Rızanızı geri çekmeniz, geri çekme tarihinden önceki işlemleri etkilemez.

## RIZA 1: Sağlık Verilerinin İşlenmesi

[ ] BiTanı uygulamasında **boy, kilo, kronik hastalıklar, kullandığım ilaçlar** dahil sağlık verilerimin KVKK md. 6/3 kapsamında işlenmesine açık rıza veriyorum.

## RIZA 2: Yapay Zeka Servisine Veri Aktarımı

[ ] Sohbet özelliğini kullandığımda mesajlarımın ve ilaç/hastalık bilgilerimin **ABD merkezli yapay zeka servis sağlayıcılarına** (sohbet cevabı üretmek amacıyla) aktarılmasına açık rıza veriyorum.

ÖNEMLİ: Bu aktarım olmadan sohbet özelliği çalışmaz. Diğer uygulama özelliklerini bu rızayı vermeden de kullanabilirsiniz.

Bu rızayı vermemeniz veya sonradan geri almanız halinde sadece sohbet özelliği devre dışı kalır, diğer tüm özellikler kullanılabilir.

## RIZA 3: Sohbet Geçmişi Saklanması

[ ] Sohbet geçmişimin daha iyi yardım sunabilmek amacıyla saklanmasına açık rıza veriyorum.

## RIZA 4: 18 Yaş Onayı

[ ] 18 yaşından büyük olduğumu beyan ederim.
`,
  },
  sorumluluk_reddi: {
    id: 'sorumluluk_reddi',
    title: 'Sorumluluk Reddi Beyanı',
    markdown: `# Sorumluluk Reddi Beyanı

## 1. Tıbbi Tavsiye Değildir

BiTanı, sağlık bilgi rehberi olarak işlev gören **akademik bir bitirme projesidir**. Sağlık Bakanlığı tarafından onaylanmış bir tıbbi cihaz DEĞİLDİR.

Sunulan bilgiler:

- Türkiye İlaç ve Tıbbi Cihaz Kurumu (TİTCK) tarafından yayımlanmış kamuya açık prospektüs bilgilerine dayanır
- Yalnızca genel bilgilendirme amaçlıdır
- Tıbbi tanı, tedavi veya ilaç önerisi NİTELİĞİ TAŞIMAZ

## 2. Sağlık Profesyoneliyle Görüşme

Her türlü sağlık sorununuz için mutlaka:

- Doktorunuza
- Eczacınıza
- Yetkili sağlık profesyonellerine danışın

## 3. Acil Durumlar

Acil sağlık durumlarında **HEMEN 112'yi arayın**. Bu uygulama acil durumlar için TASARLANMAMIŞTIR.

## 4. Sorumluluk Sınırlaması

Uygulama geliştiricileri, hafif kusur halinde, uygulamanın kullanımından doğan dolaylı zararlardan sorumlu tutulamaz. Kasıt veya ağır kusur halleri saklıdır.

## 5. Yapay Zeka Sınırları

Bu uygulamada kullanılan yapay zeka teknolojisi hata yapabilir, yanlış veya eksik bilgi verebilir. Hayati önem taşıyan kararlarda mutlaka uzman görüşü alın.

## 6. Akademik Kullanım

Bu bir bitirme projesidir ve geliştirme aşamasındadır. Hizmet kalitesi ve sürekliliği garanti edilmez.
`,
  },
  gizlilik_politikasi: {
    id: 'gizlilik_politikasi',
    title: 'Gizlilik Politikası',
    markdown: `# Gizlilik Politikası

(Kısa özet — detaylar için aydınlatma metnine bakınız)

## Ne Topluyoruz?

- Hesap bilgileri (ad, e-posta, doğum tarihi)
- Sağlık verileri (boy, kilo, hastalık, ilaç)
- Sohbet geçmişi

## Nasıl Kullanıyoruz?

- Size kişiselleştirilmiş bilgi sunmak için
- İlaç etkileşim uyarısı için
- Acil durum yönlendirmesi için

## Nereye Gönderiyoruz?

- Veritabanımız: Supabase (bulut altyapı)
- Sohbet yapay zekası: ABD merkezli servis sağlayıcı

## Verilerinizi Nasıl Koruyoruz?

- Şifreler hash'lenir
- İletişim TLS ile şifrelenir
- Veritabanı erişimi RLS ile izole
- Cihazda güvenli depolama (Keychain/Secure Store)

## Verilerinizi Nasıl Silersiniz?

- Profil → Hesabımı Sil
- veya bitani.proje@gmail.com'a e-posta

Silme talebiniz 30 gün içinde işleme alınır.
`,
  },
};
