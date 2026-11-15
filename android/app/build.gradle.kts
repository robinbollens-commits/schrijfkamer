import java.util.Properties

plugins {
    id("com.android.application")
}

// Versie volgt package.json van de Schrijfkamer. versionCode = (1.8.4 -> 10804) * 100 + ANDROID_REV,
// zodat een nieuwe APK ook bij dezelfde webversie als update installeert (verhoog dan ANDROID_REV).
val ANDROID_REV = 1
val appVersion: String = Regex(""""version"\s*:\s*"([^"]+)"""")
    .find(rootProject.file("../package.json").readText())!!.groupValues[1]
val (vMajor, vMinor, vPatch) = appVersion.split(".").map { it.toInt() }

// De signeersleutel staat NIET in git: android/keystore/ en android/keystore.properties
// (kopie op \RBNas\Apps And Projects\Schrijfkamer\Signeersleutel Android).
// Altijd dezelfde sleutel gebruiken, anders installeert een nieuwe APK niet als update.
val keyProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "be.robin.schrijfkamer"
    compileSdk = 37

    defaultConfig {
        applicationId = "be.robin.schrijfkamer"
        minSdk = 29
        targetSdk = 36
        versionCode = (vMajor * 10000 + vMinor * 100 + vPatch) * 100 + ANDROID_REV
        versionName = appVersion
    }

    signingConfigs {
        create("schrijfkamer") {
            storeFile = rootProject.file(keyProps.getProperty("storeFile", "keystore/schrijfkamer.keystore"))
            storePassword = keyProps.getProperty("storePassword")
            keyAlias = keyProps.getProperty("keyAlias", "schrijfkamer")
            keyPassword = keyProps.getProperty("keyPassword")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Alleen voor tests (gradlew assembleRelease -PskDebuggable=true): webinhoud inspecteerbaar.
            isDebuggable = project.findProperty("skDebuggable") == "true"
            signingConfig = signingConfigs.getByName("schrijfkamer")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.13.0")
    implementation("androidx.core:core-ktx:1.19.1")
    implementation("androidx.webkit:webkit:1.14.0")
}
