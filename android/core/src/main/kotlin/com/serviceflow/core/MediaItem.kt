package com.serviceflow.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.io.File
import java.time.Instant
import java.time.ZoneId

@Serializable
enum class MediaKind(val rawValue: String) {
    @SerialName("image") Image("image"),
    @SerialName("video") Video("video");

    companion object {
        fun fromRaw(value: String?): MediaKind? = entries.firstOrNull { it.rawValue == value }
    }
}

/** A photo or video on a job or lead (`job_media` row). */
@Serializable
data class MediaItem(
    val id: String,
    val jobId: String? = null,
    val leadId: String? = null,
    val kind: MediaKind,
    val mimeType: String? = null,
    @Serializable(with = InstantSerializer::class) val capturedAt: Instant? = null,
    @Serializable(with = InstantSerializer::class) val createdAt: Instant? = null,
    val uploadedBy: String? = null,
    val sourceProvider: String? = null,
    val creatorName: String? = null,
    /** Filled in after listing from the uploader's employee profile. */
    val uploaderName: String? = null,
    val mediaDescription: String? = null,
    val annotations: AnnotationDocument? = null,
    /** Revisions the next edit of the description or drawings must name. */
    val detailsRevision: String? = null,
    val annotationsRevision: String? = null,
) {
    /** When it was taken, for sorting and grouping. */
    val timestamp: Instant? get() = capturedAt ?: createdAt

    /** "Taken by" name: the original creator for imported media, else the uploader. */
    val sourceName: String
        get() = creatorName ?: (if (sourceProvider == "companycam") "CompanyCam" else null) ?: uploaderName ?: "Team member"

    fun canDelete(userId: String): Boolean = uploadedBy == userId

    companion object {
        fun fromRow(row: JSONValue?): MediaItem? {
            val id = row["id"].nonEmptyString ?: return null
            val metadata = row["source_metadata"]
            return MediaItem(
                id = id,
                jobId = row["job_id"].nonEmptyString,
                leadId = row["lead_id"].nonEmptyString,
                kind = if (row["media_type"].stringValue == "video") MediaKind.Video else MediaKind.Image,
                mimeType = row["mime_type"].nonEmptyString,
                capturedAt = row["captured_at"].dateValue,
                createdAt = row["created_at"].dateValue,
                uploadedBy = row["uploaded_by"].nonEmptyString,
                sourceProvider = row["source_provider"].nonEmptyString,
                creatorName = metadata["creator_name"].nonEmptyString,
                mediaDescription = metadata["description"].nonEmptyString,
                annotations = metadata["annotations"]?.let {
                    runCatching { JSONCoding.decode(AnnotationDocument.serializer(), it) }.getOrNull()
                }?.takeIf { !it.isEmpty },
                detailsRevision = metadata["photo_revision"].nonEmptyString,
                annotationsRevision = metadata["annotation_revision"].nonEmptyString,
            )
        }
    }
}

/** Photos and videos grouped by one local day. */
data class MediaSection<Item>(val key: String, val title: String, val items: List<Item>)

object MediaRules {
    const val maxImageBytes: Long = 25L * 1024 * 1024
    const val maxSingleVideoBytes: Long = 95L * 1024 * 1024
    const val maxVideoBytes: Long = 1024L * 1024 * 1024
    const val multipartThreshold: Long = 16L * 1024 * 1024
    const val maxVideoSeconds = 600

    internal val imageTypes = setOf("image/jpeg", "image/png", "image/webp", "image/heic", "image/heif")
    internal val videoTypes = setOf("video/mp4", "video/quicktime")

    fun kind(ofMime: String): MediaKind? = when (ofMime) {
        in imageTypes -> MediaKind.Image
        in videoTypes -> MediaKind.Video
        else -> null
    }

    /** MIME type from a declared type, else the file extension. */
    fun mimeType(declared: String?, fileName: String): String? {
        val type = declared?.lowercase()?.split(";")?.firstOrNull()?.trim()
        if (type != null && kind(ofMime = type) != null) return type
        return when (File(fileName).extension.lowercase()) {
            "jpg", "jpeg" -> "image/jpeg"
            "png" -> "image/png"
            "webp" -> "image/webp"
            "heic" -> "image/heic"
            "heif" -> "image/heif"
            "mp4", "m4v" -> "video/mp4"
            "mov", "qt" -> "video/quicktime"
            else -> null
        }
    }

    /** Filename for the `x-original-filename` header. */
    fun sanitizedFilename(name: String?): String? {
        name ?: return null
        var base = name.trimEnd('/').substringAfterLast('/')
        base = base.replace(Regex("[^A-Za-z0-9._-]+"), "_")
        base = base.trimStart('.', '-', '_')
        val trimmed = base.take(120)
        return trimmed.ifEmpty { null }
    }

    /** Photos and videos grouped by local day, newest first. */
    fun <Item> sections(items: List<Item>, timestamp: (Item) -> Instant?, zone: ZoneId = ZoneId.systemDefault()): List<MediaSection<Item>> {
        // A stable sort keeps the original order for equal timestamps.
        val sorted = items.sortedByDescending { timestamp(it)?.timeIntervalSince1970 ?: 0.0 }
        val order = mutableListOf<String>()
        val groups = mutableMapOf<String, MutableList<Item>>()
        val titles = mutableMapOf<String, String>()
        for (item in sorted) {
            val date = timestamp(item)
            val key = date?.let { DayKey.of(it, zone) } ?: "recent"
            if (key !in groups) {
                order.add(key)
                titles[key] = DateText.canadianLongDate(date)
            }
            groups.getOrPut(key) { mutableListOf() }.add(item)
        }
        return order.map { MediaSection(it, titles[it] ?: "Recently", groups[it] ?: emptyList()) }
    }
}
