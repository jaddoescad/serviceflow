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

    /**
     * An edited page's HTML with each link put back to the image address it
     * stood for, so the saved page points at the web admin again.
     */
    fun restoringImageSources(html: String, links: Map<String, String>): String =
        links.entries.fold(html) { result, link ->
            result.replace(link.value.replace("&", "&amp;"), link.key).replace(link.value, link.key)
        }

    private const val editPolicy =
        "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src https: data:; style-src 'unsafe-inline'\">\n"

    private val pageStyle = """
        <style>
        :root { color-scheme: light; }
        html { touch-action: manipulation; }
        body[contenteditable="true"] { min-height: 100vh; box-sizing: border-box; outline: none; caret-color: #2f6bff; }
        body { margin: 0; padding: 16px 20px 40px; font: 17px/1.5 -apple-system, system-ui, Roboto, sans-serif;
          color: #1c1c1e; background: #ffffff; overflow-wrap: anywhere; }
        h1, h2, h3 { line-height: 1.25; margin: 1.2em 0 0.4em; }
        h1:first-child, h2:first-child, h3:first-child, p:first-child { margin-top: 0; }
        img { max-width: 100%; height: auto; border-radius: 8px; }
        table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; }
        th, td { border: 1px solid rgba(128, 128, 128, 0.35); padding: 6px 8px; text-align: left; }
        blockquote { margin: 0; padding-left: 12px; border-left: 3px solid rgba(128, 128, 128, 0.5); }
        ul[data-checklist] { list-style: none; padding-left: 2px; }
        ul[data-checklist] > li { position: relative; padding-left: 30px; }
        ul[data-checklist] > li::before { content: ""; position: absolute; left: 0; top: 4px; width: 18px; height: 18px;
          border: 1.5px solid #9aa3b2; border-radius: 4px; background: #fff; }
        ul[data-checklist] > li[data-checked="true"]::before { border-color: #2f6bff; background: #2f6bff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='white' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m5 10.5 3.2 3L15 6.5'/%3E%3C/svg%3E") center / 13px no-repeat; }
        </style>
        </head>
    """.trimIndent()

    /**
     * The page as a document for a web view: system font, images and tables
     * fit the screen, checklists show their boxes, and it stays light like
     * the web's (text colours there are picked on white). An editable page
     * runs none of its own scripts; the app's page editor script turns
     * editing on when the manager taps Edit.
     */
    fun pageDocument(body: String, editable: Boolean = false): String =
        "<!doctype html>\n<html><head>\n<meta charset=\"utf-8\">\n" +
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" +
            (if (editable) editPolicy else "") + pageStyle +
            (if (editable) "<body contenteditable=\"false\">" else "<body>") + body + "</body></html>"
}
