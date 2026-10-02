// AnMaCha Cast für Android: native Kotlin/Compose-App (kein WebView, kein Capacitor).
// Reine Handy-Engine (Mixer, MP3-Encoder, Icecast-Quelle) liegt in engine/src bzw. native/ als
// eigenständiges Java ohne Android-Bezug und wird vom :app-Modul direkt als Quellverzeichnis
// eingebunden (siehe app/build.gradle.kts) - eine Kopie an Build-Zeit ist nicht mehr nötig.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}
