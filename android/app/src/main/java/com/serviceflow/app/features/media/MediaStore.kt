package com.serviceflow.app.features.media

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.serviceflow.app.LocalSession
import com.serviceflow.app.PhotoRevisions
import com.serviceflow.app.SessionContext
import com.serviceflow.app.backend.media
import com.serviceflow.app.savePhotoEdits
import com.serviceflow.core.AnnotationDocument
import com.serviceflow.core.MediaClientError
import com.serviceflow.core.MediaItem
import com.serviceflow.core.PendingUpload
import com.serviceflow.core.Project
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.io.File

/**
 * Photos and videos of one job or lead, plus its captures still uploading.
 * Observable from Compose (state-backed properties); use it on the main thread.
 *
 * Uploads finished by the shared queue are merged in as soon as they land,
 * without refetching, by collecting the queue's items (the queue's single
 * `onUploaded` hook is left alone so several stores can coexist). Call
 * [close] when done, or create it with [rememberMediaStore], which does.
 */
class MediaStore(val project: Project, private val session: SessionContext, private val includeLinkedLead: Boolean) {
    var items by mutableStateOf<List<MediaItem>>(emptyList())
        private set
    var isLoading by mutableStateOf(false)
        private set
    var hasLoaded by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
    var deletingId by mutableStateOf<String?>(null)
        private set

    /** The queue's items, mirrored so Compose sees changes. */
    private var queued by mutableStateOf<List<PendingUpload>>(emptyList())
    private var loadToken = 0
    /** Uploads merged from the queue, kept when a reload races them. */
    private val absorbed = mutableSetOf<String>()
    private val observer: Job?

    val uploaderName: String get() = session.displayName

    /** Captures of this project that aren't in [items] yet. */
    val pending: List<PendingUpload>
        get() {
            val known = items.map { it.id }.toSet()
            return queued.filter { upload ->
                upload.projectId == project.id && upload.projectKind == project.kind &&
                    (upload.status != PendingUpload.Status.Uploaded || upload.remote?.id?.let { it !in known } ?: true)
            }
        }

    /** Uploaded media, newest first (the lightbox order). */
    val sortedItems: List<MediaItem>
        get() = items.sortedByDescending { it.timestamp?.toEpochMilli() ?: 0L }

    data class PendingCounts(
        /** Waiting or uploading. */
        val active: Int = 0,
        val failed: Int = 0,
    )

    val pendingCounts: PendingCounts
        get() {
            val list = pending
            return PendingCounts(
                active = list.count { it.status == PendingUpload.Status.Queued || it.status == PendingUpload.Status.Uploading },
                failed = list.count { it.status == PendingUpload.Status.Failed },
            )
        }

    // MARK: Loading

    suspend fun load() {
        if (project.id.isEmpty()) {
            items = emptyList()
            error = "This job is missing its project id."
            hasLoaded = true
            return
        }
        if (session.mediaClient == null) {
            error = "Project media is not configured."
            hasLoaded = true
            return
        }
        loadToken += 1
        val token = loadToken
        isLoading = true
        try {
            val linkedLead = if (includeLinkedLead && !project.isLead) project.linkedLeadId else null
            val loaded = session.api.media(projectId = project.id, kind = project.kind, linkedLeadId = linkedLead)
            if (token != loadToken) return
            val loadedIds = loaded.map { it.id }.toSet()
            // Keep uploads that landed while the list was loading.
            items = items.filter { it.id in absorbed && it.id !in loadedIds } + loaded
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (token != loadToken) return
            items = emptyList()
            error = message(e) ?: "Unable to load project media."
        } finally {
            if (token == loadToken) {
                isLoading = false
                hasLoaded = true
            }
        }
    }

    // MARK: Delete

    /** Moves the item to the project's trash. Returns whether it worked. */
    suspend fun delete(item: MediaItem): Boolean {
        if (deletingId != null) return false
        val client = session.mediaClient
        if (client == null) {
            error = "Project media is not configured."
            return false
        }
        deletingId = item.id
        error = null
        return try {
            client.delete(mediaId = item.id)
            items = items.filter { it.id != item.id }
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = message(e) ?: "Unable to delete this media."
            false
        } finally {
            deletingId = null
        }
    }

    // MARK: Edit

    /**
     * The person who took it, or a manager, can change its description and
     * drawings (the server enforces the same rule).
     */
    fun canEdit(item: MediaItem): Boolean = item.uploadedBy == session.user.id || session.isManager

    sealed interface EditOutcome {
        data object Saved : EditOutcome
        /** Someone else changed it first; the list was reloaded. */
        data object Conflict : EditOutcome
        data class Failed(val message: String) : EditOutcome
    }

    /**
     * Saves a new description and/or drawings (null leaves a part unchanged).
     * The original image is never touched.
     */
    suspend fun saveEdits(item: MediaItem, description: String?, annotations: AnnotationDocument?): EditOutcome {
        val projectId = item.jobId ?: item.leadId ?: return EditOutcome.Failed("This photo is missing its project.")
        return try {
            val saved = session.savePhotoEdits(
                projectId = projectId, mediaId = item.id, description = description, annotations = annotations,
                expected = PhotoRevisions(details = item.detailsRevision, annotations = item.annotationsRevision),
            )
            var updated = item
            if (description != null) {
                updated = updated.copy(mediaDescription = description.trim().ifEmpty { null })
            }
            if (annotations != null) {
                updated = updated.copy(annotations = annotations.sanitized().takeIf { !it.isEmpty })
            }
            replace(updated.copy(detailsRevision = saved.details, annotationsRevision = saved.annotations))
            EditOutcome.Saved
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            val text = message(e) ?: "Couldn't save your changes. Try again."
            if (text.contains("changed elsewhere", ignoreCase = true)) {
                load()
                EditOutcome.Conflict
            } else {
                EditOutcome.Failed(text)
            }
        }
    }

    private fun replace(item: MediaItem) {
        val index = items.indexOfFirst { it.id == item.id }
        if (index < 0) return
        items = items.toMutableList().also { it[index] = item }
    }

    // MARK: Upload queue

    fun retry(localId: String) { session.uploads?.retry(localId) }
    fun retryAllFailed() { session.uploads?.retryAllFailed(projectId = project.id) }
    fun discard(localId: String) { session.uploads?.discard(localId) }

    fun fileURL(upload: PendingUpload): File? = session.uploads?.fileURL(upload)
    fun posterURL(upload: PendingUpload): File? = session.uploads?.posterURL(upload)

    /** Stops following the upload queue. */
    fun close() {
        observer?.cancel()
    }

    private fun absorbUploads() {
        for (upload in queued) {
            if (upload.projectId != project.id || upload.projectKind != project.kind) continue
            if (upload.status != PendingUpload.Status.Uploaded) continue
            var remote = upload.remote ?: continue
            if (remote.id in absorbed) continue
            absorbed.add(remote.id)
            if (remote.uploaderName == null) remote = remote.copy(uploaderName = session.displayName)
            // The note and drawings were saved with the upload.
            val note = upload.note?.trim()
            if (remote.mediaDescription == null && !note.isNullOrEmpty()) {
                remote = remote.copy(mediaDescription = note,
                                     detailsRevision = upload.savedDetailsRevision?.toString()?.lowercase())
            }
            val document = upload.annotations
            if (remote.annotations == null && document != null && !document.isEmpty) {
                remote = remote.copy(annotations = document,
                                     annotationsRevision = upload.savedAnnotationsRevision?.toString()?.lowercase())
            }
            items = listOf(remote) + items.filter { it.id != remote.id }
            if (error != null && hasLoaded) error = null
        }
    }

    init {
        val uploads = session.uploads
        observer = uploads?.let { queue ->
            session.scope.launch {
                queue.items.collect {
                    queued = it
                    absorbUploads()
                }
            }
        }
    }

    companion object {
        fun message(error: Throwable): String? {
            val text = (error as? MediaClientError)?.errorDescription ?: error.message
            return text?.trim()?.ifEmpty { null }
        }
    }
}

/** A [MediaStore] for [project], closed when it leaves the composition. */
@Composable
fun rememberMediaStore(project: Project, includeLinkedLead: Boolean): MediaStore {
    val session = LocalSession.current
    val store = remember(project.id, project.kind, includeLinkedLead, session) {
        MediaStore(project, session, includeLinkedLead)
    }
    DisposableEffect(store) { onDispose { store.close() } }
    return store
}
