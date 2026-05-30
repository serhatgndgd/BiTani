# KVKK Aydınlatma Metni

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
