package com.serviceflow.app.backend

import com.serviceflow.core.BackendError
import com.serviceflow.core.ProjectDocument
import com.serviceflow.core.ProjectDocumentFolder
import com.serviceflow.core.ProjectDocuments
import com.serviceflow.core.get
import com.serviceflow.core.nonEmptyString
import com.serviceflow.core.stringValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonPrimitive
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

// A job's Documents tab: files and pages managers add on the web. Every
// company member can read them and managers can edit pages; their bytes are in the private
// `project-documents` bucket, reached through short-lived signed links.

/** A project's documents (without page bodies) and folders. */
suspend fun ServiceFlowAPI.projectDocuments(projectId: String): Pair<List<ProjectDocument>, List<ProjectDocumentFolder>> =
    coroutineScope {
        val documentRows = async {
            rows("project_documents", "id,project_id,folder_id,name,kind,storage_path,mime_type,byte_size,updated_at") {
                filter { eq("project_id", projectId) }
            }
        }
        val folderRows = async { rows("project_document_folders", "id,name") { filter { eq("project_id", projectId) } } }
        documentRows.await().mapNotNull { ProjectDocument.fromRow(it) } to folderRows.await().mapNotNull { ProjectDocumentFolder.fromRow(it) }
    }

/** A page as the app shows it: its body (images on signed links), those links, and the version it was loaded at. */
data class ProjectDocumentPage(val body: String, val links: Map<String, String>, val updatedAt: String)

/** A page's body ready for a web view, its images swapped for signed links. */
suspend fun ServiceFlowAPI.pageDocument(document: ProjectDocument): ProjectDocumentPage {
    val row = rows("project_documents", "body_html,updated_at") {
        filter { eq("id", document.id) }
        limit(1)
    }.firstOrNull()
    val html = row["body_html"].stringValue.orEmpty()
    val links = mutableMapOf<String, String>()
    for ((source, path) in ProjectDocuments.pageImages(html = html, document = document)) {
        // An image that can't be signed shows as missing; the text still reads.
        runCatching { signedDocumentURL(path) }.getOrNull()?.let { links[source] = it }
    }
    return ProjectDocumentPage(ProjectDocuments.replacingImageSources(html, links), links, row["updated_at"].stringValue.orEmpty())
}

/** Saves a manager's edit over the version they opened. Returns the new version, or null when someone else saved first. */
suspend fun ServiceFlowAPI.savePageDocument(document: ProjectDocument, page: ProjectDocumentPage, body: String): String? =
    rpc(
        "save_page_document",
        mapOf(
            "requested_document_id" to JsonPrimitive(document.id),
            "requested_body" to JsonPrimitive(ProjectDocuments.restoringImageSources(body, page.links)),
            "expected_updated_at" to JsonPrimitive(page.updatedAt),
        ),
    ).nonEmptyString

/**
 * Downloads an uploaded file into [destination], reporting progress from 0
 * to 1 (null while the size is unknown).
 */
suspend fun ServiceFlowAPI.downloadDocument(document: ProjectDocument, destination: File, onProgress: (Float?) -> Unit) {
    val path = document.storagePath ?: throw BackendError.Server(code = null, message = "This file is missing.", status = 404)
    val link = signedDocumentURL(path)
    run {
        withContext(Dispatchers.IO) {
            val connection = URL(link).openConnection() as HttpURLConnection
            try {
                connection.connectTimeout = 30_000
                connection.readTimeout = 60_000
                val status = connection.responseCode
                if (status !in 200 until 300) {
                    throw BackendError.Server(code = null, message = "The file didn't download.", status = status)
                }
                val total = connection.contentLengthLong.takeIf { it > 0 } ?: document.byteSize.takeIf { it > 0 }
                destination.parentFile?.mkdirs()
                val partial = File(destination.parentFile, destination.name + ".part")
                connection.inputStream.use { input ->
                    partial.outputStream().use { output ->
                        val buffer = ByteArray(64 * 1024)
                        var received = 0L
                        var reported = -1
                        while (true) {
                            ensureActive()
                            val count = input.read(buffer)
                            if (count < 0) break
                            output.write(buffer, 0, count)
                            received += count
                            // Whole percents only, so the row doesn't redraw per chunk.
                            val percent = total?.let { (received * 100 / it).toInt().coerceIn(0, 100) } ?: continue
                            if (percent != reported) {
                                reported = percent
                                onProgress(percent / 100f)
                            }
                        }
                    }
                }
                if (!partial.renameTo(destination)) {
                    partial.copyTo(destination, overwrite = true)
                    partial.delete()
                }
            } finally {
                connection.disconnect()
            }
        }
    }
}

/** A link to a `project-documents` object, valid for [expiresIn] seconds. */
suspend fun ServiceFlowAPI.signedDocumentURL(path: String, expiresIn: Int = 300): String {
    val token = accessToken()
    return run {
        withContext(Dispatchers.IO) {
            val key = path.split('/').joinToString("/") { URLEncoder.encode(it, "UTF-8").replace("+", "%20") }
            val storage = "${client.supabaseHttpUrl.trimEnd('/')}/storage/v1"
            val connection = URL("$storage/object/sign/${ProjectDocuments.bucket}/$key").openConnection() as HttpURLConnection
            try {
                connection.requestMethod = "POST"
                connection.connectTimeout = 30_000
                connection.readTimeout = 30_000
                connection.doOutput = true
                connection.setRequestProperty("apikey", client.supabaseKey)
                connection.setRequestProperty("Authorization", "Bearer $token")
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write("{\"expiresIn\":$expiresIn}".toByteArray()) }
                val status = connection.responseCode
                val stream = if (status in 200 until 300) connection.inputStream else connection.errorStream
                val body = ServiceFlowAPI.parse(stream?.bufferedReader()?.use { it.readText() }.orEmpty())
                val signed = body["signedURL"].nonEmptyString ?: body["signedUrl"].nonEmptyString
                if (status !in 200 until 300 || signed == null) {
                    throw BackendError.Server(code = null, message = body["message"].nonEmptyString ?: "The file couldn't be opened.",
                                              status = status)
                }
                if (signed.startsWith("http")) signed else storage + signed
            } finally {
                connection.disconnect()
            }
        }
    }
}
