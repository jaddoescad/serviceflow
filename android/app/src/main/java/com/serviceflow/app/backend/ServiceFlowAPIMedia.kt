package com.serviceflow.app.backend

import com.serviceflow.core.AnnotationDocument
import com.serviceflow.core.JSONCoding
import com.serviceflow.core.MediaItem
import com.serviceflow.core.ProjectKind
import com.serviceflow.core.get
import com.serviceflow.core.nonEmptyString
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import java.util.UUID

// Photo and video listings, descriptions and drawings. The bytes themselves
// go through the media Worker (`MediaClient`).

/**
 * A project's media, newest first, with each uploader's name filled in.
 * A job also shows the photos taken while it was still a lead.
 */
suspend fun ServiceFlowAPI.media(projectId: String, kind: ProjectKind, linkedLeadId: String?): List<MediaItem> {
    val items = rows("job_media", "*") {
        filter {
            when {
                kind == ProjectKind.Lead -> eq("lead_id", projectId)
                linkedLeadId != null -> or {
                    eq("job_id", projectId)
                    eq("lead_id", linkedLeadId)
                }
                else -> eq("job_id", projectId)
            }
        }
        order("captured_at", Order.DESCENDING, nullsFirst = false)
        order("created_at", Order.DESCENDING)
    }.mapNotNull { MediaItem.fromRow(it) }
    val names = uploaderNames(items.mapNotNull { it.uploadedBy }.toSet())
    return items.map { item -> item.copy(uploaderName = item.uploadedBy?.let { names[it] }) }
}

/** Full names (else the email's local part) by employee id. Best effort. */
private suspend fun ServiceFlowAPI.uploaderNames(ids: Set<String>): Map<String, String> {
    if (ids.isEmpty()) return emptyMap()
    val people = runCatching {
        rows("employees", "id,email,full_name") { filter { isIn("id", ids.toList()) } }
    }.getOrNull() ?: return emptyMap()
    return people.mapNotNull { person ->
        val id = person["id"].nonEmptyString ?: return@mapNotNull null
        val name = person["full_name"].nonEmptyString ?: person["email"].nonEmptyString?.substringBefore('@')
        name?.let { id to it }
    }.toMap()
}

/** Sets a photo's description (`edit_photo_details`). Uploaders can edit their own photos. */
suspend fun ServiceFlowAPI.editPhotoDetails(projectId: String, mediaId: String, expectedRevision: String?,
                                            revision: UUID, description: String) {
    rpc("edit_photo_details", mapOf(
        "requested_project_id" to JsonPrimitive(projectId),
        "requested_media_id" to JsonPrimitive(mediaId),
        "expected_revision" to (expectedRevision?.let(::JsonPrimitive) ?: JsonNull),
        "requested_revision" to JsonPrimitive(revision.toString().lowercase()),
        "requested_description" to JsonPrimitive(description),
        "requested_tags" to JsonArray(emptyList()),
    ))
}

/** Stores a photo's drawings (`save_photo_annotations`), the same format the web editor uses. */
suspend fun ServiceFlowAPI.savePhotoAnnotations(projectId: String, mediaId: String, expectedRevision: String?,
                                                revision: UUID, document: AnnotationDocument) {
    rpc("save_photo_annotations", mapOf(
        "requested_project_id" to JsonPrimitive(projectId),
        "requested_media_id" to JsonPrimitive(mediaId),
        "expected_revision" to (expectedRevision?.let(::JsonPrimitive) ?: JsonNull),
        "requested_revision" to JsonPrimitive(revision.toString().lowercase()),
        "requested_document" to JSONCoding.encode(AnnotationDocument.serializer(), document),
    ))
}
