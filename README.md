# Galibiyet Masası – Android

Galibiyet Masası sayfasının Android uygulaması. Uygulama, sayfayı telefonun içine gömülü olarak açar. Veriler uygulamanın içindedir, internet yalnızca yazı tipleri için kullanılır.

Minimum Android sürümü: 8.0 (API 26).

## Yol 1: Bilgisayar olmadan, GitHub ile APK alma

1. github.com'da yeni bir depo oluşturun.
2. Bu klasördeki her şeyi depoya yükleyin. `.github` klasörü de dahil olmalı.
3. "APK derle" işi her yüklemede kendiliğinden başlar ve birkaç dakika sürer. Durumunu **Actions** sekmesinden izleyebilirsiniz.
4. İş bitince deponun **Releases** bölümünde yeni bir sürüm çıkar. Oradaki `GalibiyetMasasi.apk` dosyasını telefona indirip kurun. Android "bilinmeyen kaynaklardan yükleme" izni isteyebilir.

## Yol 2: Android Studio ile

1. Android Studio'da **Open** seçeneğiyle bu klasörü açın.
2. Gradle eşitlemesi bitince telefonu USB ile bağlayın ve **Run** düğmesine basın.
3. Dağıtmak için **Build → Build App Bundle(s) / APK(s) → Build APK(s)** menüsünü kullanın.

## Verileri güncelleme

Uygulamadaki veriler 14 Ekim 2026 tarihlidir ve kendiliğinden güncellenmez. Yeni bir sürüm için güncel sayfayı `app/src/main/assets/index.html` dosyasının yerine koyun. Ardından `app/build.gradle.kts` içindeki `versionCode` değerini bir artırıp yeniden derleyin.

## Web sayfasındaki verilerin otomatik güncellenmesi

Web sayfası (GitHub Pages) her 3 saatte bir kendiliğinden yenilenir. Premier League, La Liga, Serie A, Bundesliga, Ligue 1 ve Şampiyonlar Ligi için puan durumu, devre golleri ve önümüzdeki 10 günün fikstürü football-data.org'dan çekilir. Süper Lig ve MLS bu ücretsiz kaynakta olmadığı için sayfadaki verileriyle kalır.

Bir kere yapılacak kurulum:

1. football-data.org/client/register adresinden ücretsiz hesap açın. API anahtarı e-postanıza gelir.
2. GitHub'da depoda **Settings → Secrets and variables → Actions → New repository secret** yolunu izleyin.
3. Ad olarak `FOOTBALL_DATA_TOKEN` yazın, değer olarak e-postadaki anahtarı yapıştırın ve kaydedin.
4. **Actions** sekmesinde "Web uygulamasını yayınla" işini seçip **Run workflow** düğmesine basın. Birkaç dakika sonra sayfanın üstündeki tarih güncellenir.

### Ev sahibi avantajı, sakat ve cezalı oyuncular

Her güncellemede şunlar da yeniden hesaplanır:

- **Ev sahibi avantajı:** Her ligde bu sezon ev sahiplerinin attığı gollerin payı ölçülür ve maç tahminine katılır.
- **Gol katkısı:** Oyuncuların bu sezonki gol ve asistleri football-data.org'dan alınır. Eksik bir oyuncunun takıma etkisi bu katkıyla ölçülür.
- **Sakat ve cezalı oyuncular:** `scripts/absences-seed.json` listesinden gelir. Bu liste her sabah zamanlanmış bir görevle herkese açık sakatlık listelerinden yenilenir ve depoya yüklenir; yükleme web sayfasını da yeniden yayınlar. Dönüş tarihi geçen oyuncular her güncellemede listeden kendiliğinden düşer. Liste elle düzenlenirse `node scripts/check-seed.mjs` ile denetlenebilir.
- **API-Football (isteğe bağlı):** `API_FOOTBALL_KEY` eklenirse ve paket bu sezonu kapsıyorsa eksik oyuncular her 3 saatte bir buradan gelir, Süper Lig maçları da otomatik güncellenir. Ücretsiz paket yalnızca eski sezonları kapsadığı için bu kaynak şu an kullanılamıyor; bu durumda betik tek istekte durur ve yedek listeye geçer.

API-Football kurulumu (ücretli paket gerekir):

1. dashboard.api-football.com adresinden ücretsiz hesap açın ve panelde görünen API anahtarını kopyalayın.
2. GitHub'da **Settings → Secrets and variables → Actions → New repository secret** yolunu izleyin.
3. Ad olarak `API_FOOTBALL_KEY` yazın, değer olarak anahtarı yapıştırın ve kaydedin.

Ücretsiz paket günde 100 istek verir; her güncelleme yaklaşık 8 istek kullanır, yani günde 8 güncelleme sınırın altında kalır.

### Günün kuponu

Her sabah (İstanbul saatiyle 08:00'den sonraki ilk güncellemede) The Odds API'den önümüzdeki 48 saatin bahis oranları çekilir. Ardından sayfadaki modelle, önümüzdeki 36 saatin maçlarından (önceki kuponlarda yer almayanlar) en fazla 6 seçimlik bir kupon hazırlanır (`scripts/coupon.mjs`, sayfayı başsız tarayıcıda açar). Kriter: oran en az 1,80, model olasılığı en az %55. Seçimler, modelle piyasanın ortalaması olan birleşik tahmine göre sıralanır. Kuponlar ve sonuçları önceki yayından devralınarak `couponHistory` içinde tutulur ve sayfada "Kupon karnesi" olarak görünür.

Kurulum: the-odds-api.com adresinden ücretsiz anahtar alın (ayda 500 kredi) ve GitHub'a `ODDS_API_KEY` adıyla ekleyin. Günde yaklaşık 7-9 kredi harcanır. Kuponu hemen yeniden hazırlamak için Actions sekmesinde "Web uygulamasını yayınla" işini "Oranları şimdi yeniden çek" seçeneğiyle çalıştırın.

Notlar:
- İş saatleri UTC'ye göredir ve GitHub yoğunken birkaç dakika gecikebilir.
- GitHub, 60 gün boyunca hiç değişiklik yapılmayan depolarda zamanlanmış işleri durdurur. Bu olursa e-posta gelir; Actions sekmesinden işi yeniden etkinleştirin.
- Veri alınamazsa yayın değişmez, sayfa son başarılı verilerle açılmaya devam eder.
- Sayfada adları farklı görünen bir takım olursa `scripts/update-data.mjs` içindeki `ALIASES` listesine eklenebilir.

## Play Store

Play Store'a yüklemek için imzalı bir sürüm gerekir. Android Studio'da **Build → Generate Signed Bundle / APK** adımlarını izleyin.
