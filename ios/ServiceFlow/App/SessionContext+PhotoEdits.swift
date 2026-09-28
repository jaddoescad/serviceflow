import Foundation
import ServiceFlowCore

/// Revisions of a photo's description and drawings; an edit must name the
/// current ones so it can't silently overwrite a change made elsewhere.
struct PhotoRevisions: Equatable {
    var details: String?
    var annotations: String?
}

extension SessionContext {
    /// Saves a photo's description and drawings. The original image is never
    /// changed; this is the same data (and the same server functions) the web
    /// admin edits, so a photo edited on either side looks the same on both.
    /// Pass nil to leave a part unchanged.
    func savePhotoEdits(projectId: String, mediaId: String, description: String?, annotations: AnnotationDocument?,
                        expected: PhotoRevisions) async throws -> PhotoRevisions {
        try await Self.savePhotoEdits(api: api, projectId: projectId, mediaId: mediaId, description: description,
                                      annotations: annotations, expected: expected, next: (UUID(), UUID()))
    }

    /// `next` revisions are reused when retrying, so a replay is recognised.
    /// An empty part is only sent when it clears something already saved.
    static func savePhotoEdits(api: ServiceFlowAPI, projectId: String, mediaId: String, description: String?,
                               annotations: AnnotationDocument?, expected: PhotoRevisions,
                               next: (details: UUID, annotations: UUID)) async throws -> PhotoRevisions {
        var saved = expected
        if let description {
            let text = description.trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty || expected.details != nil {
                try await api.editPhotoDetails(projectId: projectId, mediaId: mediaId, expectedRevision: expected.details,
                                               revision: next.details, description: text)
                saved.details = next.details.uuidString.lowercased()
            }
        }
        if let annotations {
            let document = annotations.sanitized()
            if !document.isEmpty || expected.annotations != nil {
                try await api.savePhotoAnnotations(projectId: projectId, mediaId: mediaId, expectedRevision: expected.annotations,
                                                   revision: next.annotations, document: document)
                saved.annotations = next.annotations.uuidString.lowercased()
            }
        }
        return saved
    }
}
