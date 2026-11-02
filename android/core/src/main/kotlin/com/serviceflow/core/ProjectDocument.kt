package com.serviceflow.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.io.File
import java.text.Collator
import java.time.Instant

@Serializable
enum class ProjectDocumentKind(val rawValue: String) {
    /** An uploaded file (PDF, image, spreadsheet…). */
    @SerialName("file") File("file"),

    /** A page written in the web admin's editor. */
    @SerialName("page") Page("page"),
}

/**
 * A file or written page on a job's Documents tab (`project_documents` row).
 * Managers add them on the web; the crew reads them in the app.
 */
@Serializable
data class ProjectDocument(
    val id: String,
    val projectId: String,
    val name: String,
    val kind: ProjectDocumentKind,
    val folderId: String? = null,
    /** Where an uploaded file's bytes are in the `project-documents` bucket. */
    val storagePath: String? = null,
    val mimeType: String? = null,
    val byteSize: Long = 0,
    @Serializable(with = InstantSerializer::class) val updatedAt: Instant? = null,
) {
    /** "PDF", "Image", "Word", "Spreadsheet", "Page", or the file's extension. */
    val typeLabel: String
        get() {
            if (kind == ProjectDocumentKind.Page) return "Page"
            val mime = mimeType?.lowercase().orEmpty()
            val ext = File(name).extension.lowercase()
            if (mime == "application/pdf" || ext == "pdf") return "PDF"
            if (mime.startsWith("image/") || ext in listOf("jpg", "jpeg", "png", "heic", "gif", "webp")) return "Image"
            if ("wordprocessing" in mime || mime == "application/msword" || ext in listOf("doc", "docx")) return "Word"
            if ("spreadsheet" in mime || "excel" in mime || mime == "text/csv" || ext in listOf("xls", "xlsx", "csv")) {
                return "Spreadsheet"
            }
            return if (ext.isEmpty()) "File" else ext.uppercase()
        }

    /** The row's second line: "PDF · 19 KB · Oct 27, 2026", "Page · Oct 28, 2026". */
    val detail: String
        get() {
            val parts = mutableListOf(typeLabel)
            if (kind == ProjectDocumentKind.File && byteSize > 0) parts.add(ProjectDocuments.sizeLabel(byteSize))
            val date = DateText.canadianShortDate(updatedAt)
            if (date.isNotEmpty()) parts.add(date)
            return parts.joinToString(" · ")
        }

    companion object {
        fun fromRow(row: JSONValue?): ProjectDocument? {
            val id = row["id"].nonEmptyString ?: return null
            val projectId = row["project_id"].nonEmptyString ?: return null
            val kind = if (row["kind"].stringValue == "page") ProjectDocumentKind.Page else ProjectDocumentKind.File
            val storagePath = row["storage_path"].nonEmptyString
            // A file without its bytes can't be opened.
            if (kind == ProjectDocumentKind.File && storagePath == null) return null
            return ProjectDocument(
                id = id,
                projectId = projectId,
                name = row["name"].nonEmptyString ?: "Untitled",
                kind = kind,
                folderId = row["folder_id"].nonEmptyString,
                storagePath = storagePath,
                mimeType = row["mime_type"].nonEmptyString,
                byteSize = (row["byte_size"].doubleValue ?: 0.0).toLong(),
                updatedAt = row["updated_at"].dateValue,
            )
        }
    }
}

/** A folder on a job's Documents tab (`project_document_folders` row). */
@Serializable
data class ProjectDocumentFolder(val id: String, val name: String) {
    companion object {
        fun fromRow(row: JSONValue?): ProjectDocumentFolder? {
            val id = row["id"].nonEmptyString ?: return null
            return ProjectDocumentFolder(id = id, name = row["name"].nonEmptyString ?: "Folder")
        }
    }
}

object ProjectDocuments {
    const val bucket = "project-documents"

    /** Documents under one heading: a folder, or none for those in no folder. */
    data class Section(val folder: ProjectDocumentFolder?, val documents: List<ProjectDocument>)

    /** Swift's `localizedCaseInsensitiveCompare`. */
    private val nameOrder: Comparator<String> =
        Collator.getInstance().apply { strength = Collator.SECONDARY }.let { collator -> Comparator { a, b -> collator.compare(a, b) } }

    /**
     * Documents in no folder first, then each folder by name, newest first
     * within each. Empty folders are left out.
     */
    fun sections(documents: List<ProjectDocument>, folders: List<ProjectDocumentFolder>): List<Section> {
        val known = folders.map { it.id }.toSet()
        val newestFirst = documents.sortedWith(
            compareByDescending<ProjectDocument> { it.updatedAt ?: Instant.MIN }.thenBy(nameOrder) { it.name },
        )
        val sections = mutableListOf<Section>()
        val loose = newestFirst.filter { document -> document.folderId?.let { it !in known } ?: true }
        if (loose.isNotEmpty()) sections.add(Section(folder = null, documents = loose))
        for (folder in folders.sortedWith(compareBy(nameOrder) { it.name })) {
            val inside = newestFirst.filter { it.folderId == folder.id }
            if (inside.isNotEmpty()) sections.add(Section(folder = folder, documents = inside))
        }
        return sections
    }

    /** "820 B", "19 KB", "4.2 MB". */
    fun sizeLabel(bytes: Long): String {
        if (bytes < 1024) return "$bytes B"
        if (bytes < 1024 * 1024) return "${(bytes / 1024.0).roundedSwift().toInt()} KB"
        val megabytes = (bytes / (1024.0 * 1024) * 10).roundedSwift() / 10
        return if (megabytes == megabytes.roundedSwift()) "${megabytes.toLong()} MB" else "$megabytes MB"
    }

    // MARK: Pages

    private val imageSource =
        Regex("/api/jobs/([0-9a-fA-F-]{36})/documents/([0-9a-fA-F-]{36})/images/([0-9a-fA-F-]{36})")

    /**
     * A page's images point at the web admin
     * (`/api/jobs/<job>/documents/<page>/images/<image>`). Returns each such
     * address in the page's HTML with its storage key, so the app can swap in
     * a signed link. Images of another page are left alone.
     */
    fun pageImages(html: String, document: ProjectDocument): Map<String, String> {
        val images = mutableMapOf<String, String>()
        for (match in imageSource.findAll(html)) {
            val (job, page, image) = match.destructured
            if (job.lowercase() != document.projectId.lowercase() || page.lowercase() != document.id.lowercase()) continue
            images[match.value] = "${document.projectId}/pages/${document.id}/${image.lowercase()}"
        }
        return images
    }

    /** The page's HTML with each image address replaced by its link. */
    fun replacingImageSources(html: String, links: Map<String, String>): String =
        links.entries.fold(html) { result, link -> result.replace(link.key, link.value) }

    private val pageHead = """
        <!doctype html>
        <html><head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
        :root { color-scheme: light dark; }
        body { margin: 0; padding: 16px 20px 40px; font: 17px/1.5 -apple-system, system-ui, Roboto, sans-serif;
          color: #1c1c1e; background: #ffffff; overflow-wrap: anywhere; }
        @media (prefers-color-scheme: dark) { body { color: #f2f2f7; background: #000000; } a { color: #64a8ff; } }
        h1, h2, h3 { line-height: 1.25; margin: 1.2em 0 0.4em; }
        h1:first-child, h2:first-child, h3:first-child, p:first-child { margin-top: 0; }
        img { max-width: 100%; height: auto; border-radius: 8px; }
        table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; }
        th, td { border: 1px solid rgba(128, 128, 128, 0.35); padding: 6px 8px; text-align: left; }
        blockquote { margin: 0; padding-left: 12px; border-left: 3px solid rgba(128, 128, 128, 0.5); }
        </style>
        </head>
    """.trimIndent()

    /**
     * The page as a document for a web view: system font, images and tables
     * fit the screen, and dark mode follows the phone.
     */
    fun pageDocument(body: String): String = "$pageHead<body>$body</body></html>"
}
