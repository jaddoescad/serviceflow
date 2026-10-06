# kotlinx.serialization keeps generated serializers.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class com.serviceflow.**$$serializer { *; }
-keepclassmembers class com.serviceflow.** { *** Companion; }
-keepclasseswithmembers class com.serviceflow.** { kotlinx.serialization.KSerializer serializer(...); }
# Ktor / supabase-kt
-dontwarn org.slf4j.**
-dontwarn io.ktor.**
