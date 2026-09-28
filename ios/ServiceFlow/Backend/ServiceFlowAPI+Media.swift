import Foundation
import ServiceFlowCore
import Supabase

/// Photo and video listings, descriptions and drawings. The bytes themselves
/// go through the media Worker (`MediaClient`).
extension ServiceFlowAPI {
    /// A project's media, newest first, with each uploader's name filled in.
    /// A job also shows the photos taken while it was still a lead.
    func media(projectId: String, kind: ProjectKind, linkedLeadId: String?) async throws -> [MediaItem] {
        var query = client.from("job_media").select("*")
        switch (kind, linkedLeadId) {
        case (.lead, _): query = query.eq("lead_id", value: projectId)
        case (.job, let lead?): query = query.or("job_id.eq.\(projectId),lead_id.eq.\(lead)")
        case (.job, nil): query = query.eq("job_id", value: projectId)
        }
        var items = try await rows(
            query.order("captured_at", ascending: false, nullsFirst: false).order("created_at", ascending: false)
        ).compactMap(MediaItem.init(row:))
        let names = await uploaderNames(Set(items.compactMap(\.uploadedBy)))
        for index in items.indices { items[index].uploaderName = items[index].uploadedBy.flatMap { names[$0] } }
        return items
    }

    /// Full names (else the email's local part) by employee id. Best effort.
    private func uploaderNames(_ ids: Set<String>) async -> [String: String] {
        guard !ids.isEmpty,
              let people = try? await rows(client.from("employees").select("id,email,full_name").in("id", values: Array(ids))) else { return [:] }
        return people.reduce(into: [:]) { names, person in
            guard let id = person["id"]?.nonEmptyString else { return }
            names[id] = person["full_name"]?.nonEmptyString ?? person["email"]?.nonEmptyString?.split(separator: "@").first.map(String.init)
        }
    }

    /// Sets a photo's description (`edit_photo_details`). Uploaders can edit their own photos.
    func editPhotoDetails(projectId: String, mediaId: String, expectedRevision: String?, revision: UUID, description: String) async throws {
        _ = try await rpc("edit_photo_details", [
            "requested_project_id": .string(projectId), "requested_media_id": .string(mediaId),
            "expected_revision": JSONValue(expectedRevision), "requested_revision": .string(revision.uuidString.lowercased()),
            "requested_description": .string(description), "requested_tags": .array([]),
        ])
    }

    /// Stores a photo's drawings (`save_photo_annotations`), the same format the web editor uses.
    func savePhotoAnnotations(projectId: String, mediaId: String, expectedRevision: String?, revision: UUID,
                              document: AnnotationDocument) async throws {
        _ = try await rpc("save_photo_annotations", [
            "requested_project_id": .string(projectId), "requested_media_id": .string(mediaId),
            "expected_revision": JSONValue(expectedRevision), "requested_revision": .string(revision.uuidString.lowercased()),
            "requested_document": try JSONValue(encoding: document),
        ])
    }
}
