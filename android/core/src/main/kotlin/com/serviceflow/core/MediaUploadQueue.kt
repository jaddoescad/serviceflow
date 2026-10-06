package com.serviceflow.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import java.io.File
import java.nio.file.Files
import java.time.Instant
import java.util.UUID
import kotlin.math.max
import kotlin.math.min

/** A capture on its way to the server. */
@Serializable
data class PendingUpload(
    val localId: String,
    /** Idempotency key sent as `x-upload-id`, stable across retries. */
    @Serializable(with = UUIDSerializer::class) val uploadId: UUID,
    val projectId: String,
    val projectKind: ProjectKind,
    val kind: MediaKind,
    /** File name inside the user's media directory. */
    val fileName: String,
    val posterFileName: String? = null,
    val mimeType: String,
    val width: Int? = null,
    val height: Int? = null,
    val durationMs: Int? = null,
    @Serializable(with = InstantSerializer::class) val capturedAt: Instant,
    val status: Status,
    val attempts: Int,
    @Serializable(with = InstantSerializer::class) val retryAt: Instant? = null,
    val error: String? = null,
    val remote: MediaItem? = null,
    /** Description typed in the camera ("Add notes…"). */
    val note: String? = null,
    /** Drawings made in the photo editor. */
    val annotations: AnnotationDocument? = null,
    /** Kept on the device until the camera's Done, so notes and edits come first. */
    val held: Boolean? = null,
    /** Revision ids reused on retries so the server can recognise a replay. */
    @Serializable(with = UUIDSerializer::class) val detailsRevision: UUID? = null,
    @Serializable(with = UUIDSerializer::class) val annotationsRevision: UUID? = null,
    /** Note and drawings have reached the server. */
    val detailsSaved: Boolean? = null,
    /** Last revisions the server accepted; the next edit must name them. */
    @Serializable(with = UUIDSerializer::class) val savedDetailsRevision: UUID? = null,
    @Serializable(with = UUIDSerializer::class) val savedAnnotationsRevision: UUID? = null,
) {
    @Serializable
    enum class Status(val rawValue: String) {
        @SerialName("queued") Queued("queued"),
        @SerialName("uploading") Uploading("uploading"),
        @SerialName("uploaded") Uploaded("uploaded"),
        @SerialName("failed") Failed("failed");

        companion object {
            fun fromRaw(value: String?): Status? = entries.firstOrNull { it.rawValue == value }
        }
    }

    val id: String get() = localId
    val isHeld: Boolean get() = held == true
    internal val hasNote: Boolean get() = (note ?: "").trim().isNotEmpty()
    internal val hasDrawings: Boolean get() = !(annotations?.isEmpty ?: true)
    internal val needsDetails: Boolean get() = detailsSaved != true && (hasNote || hasDrawings)

    /** The note or drawings changed: send them (again), with fresh revisions. */
    internal fun markingDetailsChanged(): PendingUpload =
        if (status == Status.Uploaded) copy(detailsSaved = false, status = Status.Queued, attempts = 0) else copy(detailsSaved = false)
}

/** A photo or video just captured, handed to the queue. */
data class CapturedMedia(
    val fileURL: File,
    val posterURL: File? = null,
    val kind: MediaKind,
    val mimeType: String,
    val width: Int? = null,
    val height: Int? = null,
    val durationMs: Int? = null,
    val capturedAt: Instant,
)

/**
 * Uploads captures one at a time. The queue and the captured files are kept
 * on disk, so nothing is lost when the app is closed or the person leaves the
 * screen; unfinished uploads resume on the next launch.
 *
 * Like the Swift `@MainActor` class, it is used from one thread: create it and
 * call it on the main thread, and pass a [scope] that runs on the main
 * dispatcher (the upload worker is launched there).
 */
class MediaUploadQueue(
    private val client: MediaClient,
    storage: UserStorage,
    private val uploaderName: String,
    private val scope: CoroutineScope,
) {
    private val _items = MutableStateFlow<List<PendingUpload>>(emptyList())
    val items: StateFlow<List<PendingUpload>> = _items.asStateFlow()

    /** Called with each uploaded row, so open screens can show it immediately. */
    var onUploaded: ((MediaItem, PendingUpload) -> Unit)? = null

    /** Saves an uploaded capture's note and drawings on the server. */
    var saveDetails: (suspend (MediaItem, PendingUpload) -> Unit)? = null

    private val directory: File = storage.mediaDirectory
    private val store = storage.store("media-uploads", ListSerializer(PendingUpload.serializer()))
    private var worker: Job? = null

    init {
        _items.value = (store.load() ?: emptyList()).mapNotNull { stored ->
            if (stored.status == PendingUpload.Status.Uploaded) return@mapNotNull null
            var item = stored
            if (item.status == PendingUpload.Status.Uploading) item = item.copy(status = PendingUpload.Status.Queued)
            // A capture held for the camera's Done uploads after a relaunch.
            item.copy(held = false)
        }
        persist()
        pruneFiles()
        pump()
    }

    fun items(projectId: String, kind: ProjectKind): List<PendingUpload> =
        _items.value.filter { it.projectId == projectId && it.projectKind == kind }

    fun fileURL(item: PendingUpload): File = File(directory, item.fileName)
    fun posterURL(item: PendingUpload): File? = item.posterFileName?.let { File(directory, it) }

    /** Moves the capture into the queue's directory and starts uploading. */
    fun enqueue(capture: CapturedMedia, projectId: String, projectKind: ProjectKind, held: Boolean = false): PendingUpload? {
        if (projectId.isEmpty()) return null
        val localId = "capture-${UUID.randomUUID().toString().lowercase()}"
        val ext = if (capture.kind == MediaKind.Video) "mp4" else "jpg"
        val fileName = "$localId.$ext"
        try {
            directory.mkdirs()
            Files.move(capture.fileURL.toPath(), File(directory, fileName).toPath())
        } catch (_: Exception) {
            return null
        }
        var posterName: String? = null
        capture.posterURL?.let { posterURL ->
            val name = "$localId-poster.jpg"
            if (runCatching { Files.move(posterURL.toPath(), File(directory, name).toPath()) }.isSuccess) posterName = name
        }
        val item = PendingUpload(
            localId = localId, uploadId = UUID.randomUUID(), projectId = projectId, projectKind = projectKind, kind = capture.kind,
            fileName = fileName, posterFileName = posterName, mimeType = capture.mimeType, width = capture.width,
            height = capture.height, durationMs = capture.durationMs, capturedAt = capture.capturedAt,
            status = PendingUpload.Status.Queued, attempts = 0, held = held,
        )
        _items.value = _items.value + item
        persist()
        pump()
        return item
    }

    /** Starts uploading held captures (the camera's Done). */
    fun release(projectId: String? = null) {
        for (item in _items.value) {
            if (item.isHeld && (projectId == null || item.projectId == projectId)) update(item.localId) { it.copy(held = false) }
        }
        pump()
    }

    fun setNote(localId: String, note: String) {
        update(localId) { item ->
            if (item.note == note) item else item.copy(note = note, detailsRevision = null).markingDetailsChanged()
        }
        pump()
    }

    fun setAnnotations(localId: String, document: AnnotationDocument) {
        update(localId) { item ->
            item.copy(annotations = document.sanitized(), annotationsRevision = null).markingDetailsChanged()
        }
        pump()
    }

    fun retry(localId: String) {
        update(localId) { it.copy(status = PendingUpload.Status.Queued, attempts = 0, retryAt = null, error = null) }
        pump()
    }

    fun retryAllFailed(projectId: String? = null) {
        for (item in _items.value) {
            if (item.status == PendingUpload.Status.Failed && (projectId == null || item.projectId == projectId)) retry(item.localId)
        }
    }

    /** Removes a capture that hasn't uploaded yet, and its file. */
    fun discard(localId: String) {
        val item = _items.value.firstOrNull { it.localId == localId } ?: return
        if (item.status == PendingUpload.Status.Uploading) return
        removeFiles(item)
        _items.value = _items.value.filter { it.localId != localId }
        persist()
    }

    fun clearCompleted() {
        _items.value = _items.value.filter { it.status != PendingUpload.Status.Uploaded }
        persist()
        pruneFiles()
    }

    /** Restarts uploads that were waiting, e.g. when the app is opened again. */
    fun resume() = pump()

    // MARK: Worker

    private fun pump() {
        if (worker != null) return
        // Started after `worker` is set, so an immediate dispatcher can't
        // finish the run before the job is recorded.
        val job = scope.launch(start = CoroutineStart.LAZY) {
            try {
                run()
            } finally {
                worker = null
            }
        }
        worker = job
        job.start()
    }

    private suspend fun run() {
        while (true) {
            val current = Instant.now()
            val next = _items.value.firstOrNull {
                it.status == PendingUpload.Status.Queued && !it.isHeld && (it.retryAt ?: Instant.MIN) <= current
            }
            if (next == null) {
                val wake = _items.value.filter { it.status == PendingUpload.Status.Queued && !it.isHeld }
                    .mapNotNull { it.retryAt }.minOrNull() ?: return
                delay((max(0.1, wake.timeIntervalSince(Instant.now())) * 1000).toLong())
                continue
            }
            upload(next)
        }
    }

    private suspend fun upload(item: PendingUpload) {
        update(item.localId) { it.copy(status = PendingUpload.Status.Uploading, attempts = it.attempts + 1, retryAt = null, error = null) }
        try {
            val remote = uploadedRow(item)
            val current = _items.value.firstOrNull { it.localId == item.localId }
            if (current != null && current.needsDetails) sendDetails(current, remote)
            update(item.localId) { it.copy(status = PendingUpload.Status.Uploaded, remote = remote) }
            removeFiles(item, keepMain = true)
            _items.value.firstOrNull { it.localId == item.localId }?.let { onUploaded?.invoke(remote, it) }
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            val description = (error as? MediaClientError)?.errorDescription ?: error.message
            val message = if (description.isNullOrEmpty()) "Upload failed. Tap to retry." else description
            val permanent = (error as? MediaClientError)?.isPermanent ?: false
            update(item.localId) { failed ->
                if (permanent || failed.attempts >= maxAttempts) {
                    failed.copy(error = message, status = PendingUpload.Status.Failed)
                } else {
                    val delaySeconds = retryDelays[min(failed.attempts - 1, retryDelays.size - 1)]
                    failed.copy(error = message, status = PendingUpload.Status.Queued, retryAt = Instant.now().addingTimeInterval(delaySeconds))
                }
            }
        }
    }

    /**
     * The server row for a capture: uploads the file unless an earlier attempt
     * already did (then only the details are retried).
     */
    private suspend fun uploadedRow(item: PendingUpload): MediaItem {
        item.remote?.let { return it }
        val request = MediaUploadRequest(
            uploadId = item.uploadId, projectId = item.projectId, projectKind = item.projectKind, fileURL = fileURL(item),
            fileName = item.fileName, mimeType = item.mimeType, width = item.width, height = item.height,
            durationMs = item.durationMs, capturedAt = item.capturedAt,
        )
        val remote = client.upload(request).copy(uploaderName = uploaderName)
        val poster = posterURL(item)
        if (remote.kind == MediaKind.Video && poster != null) {
            try {
                client.uploadPoster(remote.id, poster)
            } catch (error: Exception) {
                if (error is CancellationException) throw error
            }
        }
        update(item.localId) { it.copy(remote = remote) }
        return remote
    }

    /**
     * Saves the note and drawings. The revision ids are stored before sending,
     * so a retry after a lost response reuses them and the server sees a replay.
     */
    private suspend fun sendDetails(item: PendingUpload, remote: MediaItem) {
        val saveDetails = saveDetails ?: return
        val ready = item.copy(
            detailsRevision = item.detailsRevision ?: UUID.randomUUID(),
            annotationsRevision = item.annotationsRevision ?: UUID.randomUUID(),
        )
        update(item.localId) { it.copy(detailsRevision = ready.detailsRevision, annotationsRevision = ready.annotationsRevision) }
        saveDetails(remote, ready)
        update(item.localId) { saved ->
            saved.copy(
                detailsSaved = true,
                savedDetailsRevision = if (saved.hasNote) ready.detailsRevision else saved.savedDetailsRevision,
                savedAnnotationsRevision = if (saved.hasDrawings) ready.annotationsRevision else saved.savedAnnotationsRevision,
            )
        }
    }

    // MARK: Helpers

    private fun update(localId: String, change: (PendingUpload) -> PendingUpload) {
        val list = _items.value
        val index = list.indexOfFirst { it.localId == localId }
        if (index < 0) return
        _items.value = list.toMutableList().also { it[index] = change(it[index]) }
        persist()
    }

    /**
     * The photo file stays until the list is cleared, so the filmstrip and
     * grid can keep showing it without a network round trip.
     */
    private fun removeFiles(item: PendingUpload, keepMain: Boolean = false) {
        if (!keepMain) fileURL(item).delete()
        posterURL(item)?.delete()
    }

    private fun persist() {
        store.save(_items.value.filter { it.status != PendingUpload.Status.Uploaded })
    }

    /**
     * Deletes files no item refers to any more (uploaded and cleared, or left
     * behind by an interrupted capture).
     */
    private fun pruneFiles() {
        val keep = _items.value.flatMap { listOfNotNull(it.fileName, it.posterFileName) }.toSet()
        directory.listFiles()?.forEach { file -> if (file.name !in keep) file.deleteRecursively() }
    }

    data class Counts(val queued: Int, val uploading: Int, val failed: Int, val uploaded: Int)

    val counts: Counts
        get() {
            val list = _items.value
            return Counts(
                queued = list.count { it.status == PendingUpload.Status.Queued },
                uploading = list.count { it.status == PendingUpload.Status.Uploading },
                failed = list.count { it.status == PendingUpload.Status.Failed },
                uploaded = list.count { it.status == PendingUpload.Status.Uploaded },
            )
        }

    companion object {
        const val maxAttempts = 3
        internal val retryDelays: List<Double> = listOf(1.0, 3.0)
    }
}
