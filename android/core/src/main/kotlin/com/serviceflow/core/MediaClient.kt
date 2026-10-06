package com.serviceflow.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import java.io.File
import java.io.InputStream
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.util.UUID

/** A capture ready to upload. */
data class MediaUploadRequest(
    val uploadId: UUID,
    val projectId: String,
    val projectKind: ProjectKind,
    val fileURL: File,
    val fileName: String,
    val mimeType: String,
    val width: Int?,
    val height: Int?,
    val durationMs: Int?,
    val capturedAt: Instant,
)

/**
 * A refused or failed media request. [message] is the server's (or a local)
 * message; [errorDescription] adds the HTTP status for display.
 */
data class MediaClientError(override val message: String, val status: Int? = null) : Exception(message) {
    val errorDescription: String get() = status?.let { "$message (HTTP $it)" } ?: message

    /** Client errors other than timeouts and rate limits won't succeed on retry. */
    val isPermanent: Boolean
        get() {
            val status = status ?: return false
            return status in 400 until 500 && status != 408 && status != 429 && status != 401
        }
}

/**
 * HTTP client for the project media Worker. Bytes only ever go through the
 * Worker; it checks access against Supabase with the caller's token.
 *
 * Connection failures surface as `IOException`s, which `BackendError.from`
 * classifies as offline.
 */
class MediaClient(val baseURL: String, private val token: suspend () -> String) {
    private fun url(path: String): String = baseURL.trimEnd('/') + "/" + path

    fun originalURL(mediaId: String): String = url("v1/media/$mediaId")

    fun thumbnailURL(mediaId: String): String = url("v1/media/$mediaId/thumbnail")

    /** Headers to load media; fetch per request so an expired token is never reused. */
    suspend fun authorizationHeaders(): Map<String, String> = mapOf("Authorization" to "Bearer ${token()}")

    // MARK: Upload

    suspend fun upload(request: MediaUploadRequest): MediaItem {
        val kind = MediaRules.kind(ofMime = request.mimeType)
            ?: throw MediaClientError("Unsupported file type. Use JPEG, PNG, WebP, HEIC photos or MP4/MOV videos.")
        val size = runCatching { request.fileURL.length() }.getOrDefault(0L)
        if (size <= 0) throw MediaClientError("The selected file is empty or cannot be read.")
        val limit = if (kind == MediaKind.Image) MediaRules.maxImageBytes else MediaRules.maxVideoBytes
        if (size > limit) {
            throw MediaClientError("This ${kind.rawValue} is too large. The limit is ${limit / 1024 / 1024} MB.")
        }
        if (kind == MediaKind.Video && size > MediaRules.multipartThreshold) {
            try {
                return uploadMultipart(request, size)
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                if (size > MediaRules.maxSingleVideoBytes) throw error
            }
        }
        return uploadSingle(request, kind, size)
    }

    private suspend fun uploadSingle(upload: MediaUploadRequest, kind: MediaKind, size: Long): MediaItem {
        val headers = linkedMapOf(
            "Authorization" to "Bearer ${token()}",
            "Content-Type" to upload.mimeType,
            "x-media-type" to kind.rawValue,
            // Same id on every retry: the Worker returns the existing row instead
            // of storing the file twice when an earlier response was lost.
            "x-upload-id" to upload.uploadId.toString().lowercase(),
            "x-captured-at" to ISODate.string(upload.capturedAt),
        )
        MediaRules.sanitizedFilename(upload.fileName)?.let { headers["x-original-filename"] = it }
        upload.width?.takeIf { it in 1..100_000 }?.let { headers["x-media-width"] = it.toString() }
        upload.height?.takeIf { it in 1..100_000 }?.let { headers["x-media-height"] = it.toString() }
        if (kind == MediaKind.Video) {
            upload.durationMs?.takeIf { it in 1..86_400_000 }?.let { headers["x-media-duration-ms"] = it.toString() }
        }
        val row = send(
            "PUT", url("v1/${upload.projectKind.mediaPathSegment}/${upload.projectId}/media"), headers,
            Body.FromFile(upload.fileURL, size), timeoutSeconds = 300, fallback = "Upload failed",
        )
        return MediaItem.fromRow(row) ?: throw MediaClientError("Upload failed")
    }

    private suspend fun uploadMultipart(upload: MediaUploadRequest, size: Long): MediaItem {
        val base = url("v1/${upload.projectKind.mediaPathSegment}/${upload.projectId}/media/multipart")
        val startHeaders = linkedMapOf(
            "Authorization" to "Bearer ${token()}",
            "x-media-content-type" to upload.mimeType,
            "x-file-size" to size.toString(),
        )
        MediaRules.sanitizedFilename(upload.fileName)?.let { startHeaders["x-original-filename"] = it }
        val started = send("POST", base, startHeaders, null, fallback = "Upload failed")
        val uploadId = started["uploadId"].nonEmptyString
        val objectKey = started["objectKey"].nonEmptyString
        if (uploadId == null || objectKey == null) throw MediaClientError("Upload failed")
        val partSize = started["partSize"].intValue?.takeIf { it > 0 }?.toLong() ?: (8L * 1024 * 1024)
        val partsURL = url("v1/media-uploads/$uploadId/parts")

        try {
            val parts = mutableListOf<JSONValue>()
            withContext(Dispatchers.IO) { RandomAccessFile(upload.fileURL, "r") }.use { handle ->
                var offset = 0L
                var number = 1
                while (offset < size) {
                    val length = minOf(partSize, size - offset).toInt()
                    val chunk = withContext(Dispatchers.IO) {
                        handle.seek(offset)
                        val buffer = ByteArray(length)
                        val read = handle.read(buffer)
                        if (read <= 0) null else if (read == length) buffer else buffer.copyOf(read)
                    } ?: throw MediaClientError("Could not read the video from storage.")
                    val etag = sendPart(chunk, number, objectKey, partsURL)
                    parts.add(jsonObject("partNumber" to number, "etag" to etag))
                    offset += chunk.size
                    number += 1
                }
            }

            val body = jsonObject(
                "objectKey" to objectKey,
                "parts" to parts,
                "mimeType" to upload.mimeType,
                "byteSize" to size,
                "originalFilename" to MediaRules.sanitizedFilename(upload.fileName),
                "width" to upload.width,
                "height" to upload.height,
                "durationMs" to upload.durationMs,
                "capturedAt" to upload.capturedAt.toEpochMilli(),
            )
            val result = send(
                "POST", url("v1/media-uploads/$uploadId/complete"),
                mapOf("Authorization" to "Bearer ${token()}", "Content-Type" to "application/json"),
                Body.Bytes(body.toString().toByteArray()),
                fallback = "Upload failed",
            )
            return MediaItem.fromRow(result["media"]) ?: throw MediaClientError("Upload failed")
        } catch (error: Throwable) {
            // Abort the unfinished upload, even when the caller was cancelled.
            withContext(NonCancellable) {
                val abortHeaders = mutableMapOf("x-object-key" to objectKey)
                runCatching { token() }.getOrNull()?.let { abortHeaders["Authorization"] = "Bearer $it" }
                runCatching { send("DELETE", url("v1/media-uploads/$uploadId"), abortHeaders, null, fallback = "Upload failed") }
            }
            throw error
        }
    }

    private suspend fun sendPart(chunk: ByteArray, number: Int, objectKey: String, url: String): String {
        var lastError: Exception = MediaClientError("Upload failed")
        repeat(3) {
            // A fresh token per part: a long upload can outlive one token.
            val headers = mapOf(
                "Authorization" to "Bearer ${token()}",
                "Content-Type" to "application/octet-stream",
                "x-object-key" to objectKey,
                "x-part-number" to number.toString(),
            )
            try {
                val result = send("PUT", url, headers, Body.Bytes(chunk), timeoutSeconds = 300, fallback = "Upload failed")
                return result["etag"].nonEmptyString ?: throw MediaClientError("Upload failed")
            } catch (error: MediaClientError) {
                if (error.isPermanent) throw error
                lastError = error
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                lastError = error
            }
        }
        throw lastError
    }

    /** Stores a JPEG still for a video so the grid never has to generate one. */
    suspend fun uploadPoster(mediaId: String, fileURL: File) {
        send(
            "PUT", thumbnailURL(mediaId),
            mapOf("Authorization" to "Bearer ${token()}", "Content-Type" to "image/jpeg"),
            Body.FromFile(fileURL, fileURL.length()), timeoutSeconds = 15, fallback = "Upload failed",
        )
    }

    // MARK: Delete

    /** Moves a photo or video to the project's trash. */
    suspend fun delete(mediaId: String) {
        send("DELETE", originalURL(mediaId), mapOf("Authorization" to "Bearer ${token()}"), null, fallback = "Delete failed")
    }

    // MARK: Helpers

    private sealed class Body {
        class Bytes(val data: ByteArray) : Body()
        class FromFile(val file: File, val size: Long) : Body()
    }

    /**
     * One request; returns the JSON body of a 2xx answer, else throws
     * [MediaClientError] with the server's `error` message. `timeoutSeconds`
     * bounds connecting and each wait for data, like `URLRequest.timeoutInterval`.
     */
    private suspend fun send(
        method: String, url: String, headers: Map<String, String>, body: Body?,
        timeoutSeconds: Int = 60, fallback: String,
    ): JSONValue = withContext(Dispatchers.IO) {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = timeoutSeconds * 1000
            connection.readTimeout = timeoutSeconds * 1000
            connection.useCaches = false
            headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
            when (body) {
                is Body.Bytes -> {
                    connection.doOutput = true
                    connection.setFixedLengthStreamingMode(body.data.size.toLong())
                    connection.outputStream.use { it.write(body.data) }
                }
                is Body.FromFile -> {
                    connection.doOutput = true
                    connection.setFixedLengthStreamingMode(body.size)
                    connection.outputStream.use { output -> body.file.inputStream().use { it.copyTo(output, 64 * 1024) } }
                }
                null -> Unit
            }
            val status = connection.responseCode
            val stream: InputStream? = if (status in 200 until 300) connection.inputStream else connection.errorStream
            val text = stream?.use { it.readBytes().decodeToString() } ?: ""
            val parsed: JSONValue = runCatching { JSONCoding.json.parseToJsonElement(text) }.getOrDefault(kotlinx.serialization.json.JsonNull)
            if (status !in 200 until 300) {
                throw MediaClientError(parsed["error"].nonEmptyString ?: fallback, status = status)
            }
            parsed
        } finally {
            connection.disconnect()
        }
    }
}
