// Platform-independent logic of the ServiceFlow crew app: models, the
// time-tracking state machine, offline queues and presentation rules. Plain
// Kotlin/JVM, so its checks run without a device:
//
//     ./gradlew :core:test
plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

kotlin { jvmToolchain(17) }

dependencies {
    api(libs.kotlinx.coroutines.core)
    api(libs.kotlinx.serialization.json)
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}
