import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Git-ignored machine settings: the Google Maps key and release signing.
val localProperties = Properties().apply {
    rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use(::load)
}
fun local(name: String): String? = localProperties.getProperty(name) ?: System.getenv(name)

android {
    namespace = "com.serviceflow.app"
    compileSdk = 36

    defaultConfig {
        // Same listing as the React Native build it replaces on Google Play.
        applicationId = "com.ottawapainters.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 102
        versionName = "2.0.1"

        // Public by design: the publishable key only allows what row-level security permits.
        buildConfigField("String", "SUPABASE_URL", "\"https://bwbckdkouqghdadpkjvn.supabase.co\"")
        buildConfigField("String", "SUPABASE_PUBLISHABLE_KEY", "\"sb_publishable_SYrZ-1VL2W7xYczfcYapow_03a_4Pdu\"")
        buildConfigField("String", "PROJECT_MEDIA_API_URL", "\"https://project-media-worker.jadslim-fai.workers.dev\"")
        buildConfigField("boolean", "LOCATION_TRACKING_ENABLED", "true")
        manifestPlaceholders["mapsApiKey"] = local("GOOGLE_MAPS_API_KEY_ANDROID") ?: local("GOOGLE_MAPS_API_KEY") ?: ""
    }

    signingConfigs {
        local("SERVICEFLOW_UPLOAD_STORE_FILE")?.let { storePath ->
            create("release") {
                storeFile = rootProject.file(storePath)
                storePassword = local("SERVICEFLOW_UPLOAD_STORE_PASSWORD")
                keyAlias = local("SERVICEFLOW_UPLOAD_KEY_ALIAS")
                keyPassword = local("SERVICEFLOW_UPLOAD_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        // Installs beside the Play build on the same phone.
        debug {
            applicationIdSuffix = ".debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

kotlin { jvmToolchain(17) }

dependencies {
    implementation(project(":core"))
    implementation(libs.kotlinx.coroutines.android)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)
    implementation(libs.androidx.core.ktx)
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.lifecycle.process)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.navigation.compose)

    implementation(platform(libs.supabase.bom))
    implementation(libs.supabase.auth)
    implementation(libs.supabase.postgrest)
    implementation(libs.supabase.realtime)
    implementation(libs.supabase.functions)
    implementation(libs.ktor.client.okhttp)

    implementation(libs.camerax.core)
    implementation(libs.camerax.camera2)
    implementation(libs.camerax.lifecycle)
    implementation(libs.camerax.video)
    implementation(libs.camerax.view)
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.ui)
    implementation(libs.coil.compose)
    implementation(libs.coil.network)
    implementation(libs.coil.video)
    implementation(libs.play.location)
    implementation(libs.maps.compose)
}
