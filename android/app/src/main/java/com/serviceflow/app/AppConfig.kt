package com.serviceflow.app

/** Build-time configuration, from the `BuildConfig` fields in `app/build.gradle.kts`. */
data class AppConfig(
    val supabaseURL: String,
    val supabaseKey: String,
    /** Nil when the build has no media Worker configured. */
    val mediaURL: String?,
    val locationTrackingEnabled: Boolean,
    val appVersion: String,
    val buildNumber: String,
) {
    companion object {
        val current: AppConfig? by lazy {
            fun value(raw: String): String? = raw.trim().takeIf { it.isNotEmpty() }
            val url = value(BuildConfig.SUPABASE_URL) ?: return@lazy null
            val key = value(BuildConfig.SUPABASE_PUBLISHABLE_KEY) ?: return@lazy null
            AppConfig(
                supabaseURL = url,
                supabaseKey = key,
                mediaURL = value(BuildConfig.PROJECT_MEDIA_API_URL)?.trim('/'),
                locationTrackingEnabled = BuildConfig.LOCATION_TRACKING_ENABLED,
                appVersion = BuildConfig.VERSION_NAME,
                buildNumber = BuildConfig.VERSION_CODE.toString(),
            )
        }
    }
}
