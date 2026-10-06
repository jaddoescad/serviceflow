package com.serviceflow.core

import kotlinx.serialization.KSerializer
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/**
 * A serializable value persisted as one JSON file, written atomically.
 * Reads are synchronous so state can be restored before the first frame.
 */
class JSONFileStore<T>(val file: File, private val serializer: KSerializer<T>) {
    private val lock = Any()

    fun load(): T? = synchronized(lock) {
        if (!file.exists()) return null
        runCatching { JSONCoding.json.decodeFromString(serializer, file.readText()) }.getOrNull()
    }

    fun save(value: T) = synchronized(lock) {
        runCatching {
            file.parentFile?.mkdirs()
            val temp = File(file.parentFile, "${file.name}.tmp")
            temp.writeText(JSONCoding.json.encodeToString(serializer, value))
            Files.move(temp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
        }
        Unit
    }

    fun delete() = synchronized(lock) {
        file.delete()
        Unit
    }
}

/**
 * Where each signed-in person's data lives. Everything a user records is kept
 * under their own directory, so a different account on the same device never
 * sees or inherits it.
 */
class UserStorage(val userId: String, root: File) {
    val directory: File = File(File(root, "users"), userId.replace(Regex("[^A-Za-z0-9-]"), "_"))

    fun <T> store(name: String, serializer: KSerializer<T>): JSONFileStore<T> =
        JSONFileStore(File(directory, "$name.json"), serializer)

    /** Directory for captured photos and videos waiting to upload. */
    val mediaDirectory: File get() = File(directory, "media")

    fun removeAll() {
        directory.deleteRecursively()
    }

    companion object {
        /** `<filesDir>/ServiceFlow` on Android. */
        fun defaultRoot(filesDir: File): File = File(filesDir, "ServiceFlow")
    }
}
