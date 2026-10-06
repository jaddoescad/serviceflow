package com.serviceflow.app

import com.serviceflow.app.backend.editPhotoDetails
import com.serviceflow.app.backend.savePhotoAnnotations
import com.serviceflow.app.backend.ServiceFlowAPI
import com.serviceflow.core.AnnotationDocument
import java.util.UUID

/**
 * Revisions of a photo's description and drawings; an edit must name the
 * current ones so it can't silently overwrite a change made elsewhere.
 */
data class PhotoRevisions(val details: String? = null, val annotations: String? = null)

/** The revisions an edit will write; reused when retrying, so a replay is recognised. */
data class PhotoRevisionIds(val details: UUID, val annotations: UUID)

/**
 * Saves a photo's description and drawings. The original image is never
 * changed; this is the same data (and the same server functions) the web
 * admin edits, so a photo edited on either side looks the same on both.
 * Pass null to leave a part unchanged.
 */
suspend fun SessionContext.savePhotoEdits(projectId: String, mediaId: String, description: String?,
                                          annotations: AnnotationDocument?, expected: PhotoRevisions): PhotoRevisions =
    savePhotoEdits(api, projectId, mediaId, description, annotations, expected,
                   PhotoRevisionIds(UUID.randomUUID(), UUID.randomUUID()))

/** An empty part is only sent when it clears something already saved. */
suspend fun savePhotoEdits(api: ServiceFlowAPI, projectId: String, mediaId: String, description: String?,
                           annotations: AnnotationDocument?, expected: PhotoRevisions,
                           next: PhotoRevisionIds): PhotoRevisions {
    var saved = expected
    if (description != null) {
        val text = description.trim()
        if (text.isNotEmpty() || expected.details != null) {
            api.editPhotoDetails(projectId = projectId, mediaId = mediaId, expectedRevision = expected.details,
                                 revision = next.details, description = text)
            saved = saved.copy(details = next.details.toString().lowercase())
        }
    }
    if (annotations != null) {
        val document = annotations.sanitized()
        if (!document.isEmpty || expected.annotations != null) {
            api.savePhotoAnnotations(projectId = projectId, mediaId = mediaId, expectedRevision = expected.annotations,
                                     revision = next.annotations, document = document)
            saved = saved.copy(annotations = next.annotations.toString().lowercase())
        }
    }
    return saved
}
