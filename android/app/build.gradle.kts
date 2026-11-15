import java.util.Properties

plugins {
    id("com.android.application")
}

// Versie volgt package.json van de Schrijfkamer: 1.8.3 wordt versionCode 10803.
val appVersion: String = Regex(""""version"\s*:\s*"([^"]+)"""")
    .find(rootProject.file("../package.json").readText())!!.groupValues[1]
val (vMajor, vMinor, vPatch) = appVersion.split(".").map { it.toInt() }

// De signeersleutel staat NIET in git: android/keystore/ en android/keystore.properties.
// Altijd dezelfde sleutel gebruiken, anders installeert een nieuwe APK niet als update
// en klopt assetlinks.json niet meer (dan verschijnt er een adresbalk).
val keyProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "be.robin.schrijfkamer"
    compileSdk = 37

    defaultConfig {
        applicationId = "be.robin.schrijfkamer"
        minSdk = 24
        targetSdk = 37
        versionCode = vMajor * 10000 + vMinor * 100 + vPatch
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
            signingConfig = signingConfigs.getByName("schrijfkamer")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.7.4")
}
