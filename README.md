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

## Play Store

Play Store'a yüklemek için imzalı bir sürüm gerekir. Android Studio'da **Build → Generate Signed Bundle / APK** adımlarını izleyin.
