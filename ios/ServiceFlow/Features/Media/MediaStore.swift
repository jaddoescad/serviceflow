import Observation
import ServiceFlowCore
import SwiftUI

/// Photos and videos of one job or lead, plus its captures still uploading.
///
/// Uploads finished by the shared queue are merged in as soon as they land,
/// without refetching, by observing the queue's items (the queue's single
/// `onUploaded` hook is left alone so several stores can coexist).
@MainActor
@Observable
final class MediaStore {
    let project: Project
    private let session: SessionContext
    private let includeLinkedLead: Bool

    private(set) var items: [MediaItem] = []
    private(set) var isLoading = false
    private(set) var hasLoaded = false
    var error: String?
    private(set) var deletingId: String?

    @ObservationIgnored private var loadToken = 0
    /// Uploads merged from the queue, kept when a reload races them.
    @ObservationIgnored private var absorbed = Set<String>()

    init(project: Project, session: SessionContext, includeLinkedLead: Bool) {
        self.project = project
        self.session = session
        self.includeLinkedLead = includeLinkedLead
        absorbUploads()
        observeUploads()
    }

    var uploaderName: String { session.displayName }

    /// Captures of this project that aren't in `items` yet.
    var pending: [PendingUpload] {
        guard let uploads = session.uploads else { return [] }
        let known = Set(items.map(\.id))
        return uploads.items(for: project.id, kind: project.kind).filter { upload in
            guard upload.status == .uploaded, let remote = upload.remote else { return true }
            return !known.contains(remote.id)
        }
    }

    /// Uploaded media, newest first (the lightbox order).
    var sortedItems: [MediaItem] {
        items.enumerated().sorted { lhs, rhs in
            let left = lhs.element.timestamp?.timeIntervalSince1970 ?? 0
            let right = rhs.element.timestamp?.timeIntervalSince1970 ?? 0
            return left == right ? lhs.offset < rhs.offset : left > right
        }.map(\.element)
    }

    struct PendingCounts {
        /// Waiting or uploading.
        var active = 0
        var failed = 0
    }

    var pendingCounts: PendingCounts {
        pending.reduce(into: PendingCounts()) { counts, upload in
            switch upload.status {
            case .queued, .uploading: counts.active += 1
            case .failed: counts.failed += 1
            case .uploaded: break
            }
        }
    }

    // MARK: Loading

    func load() async {
        guard !project.id.isEmpty else {
            items = []
            error = "This job is missing its project id."
            hasLoaded = true
            return
        }
        guard session.mediaClient != nil else {
            error = "Project media is not configured."
            hasLoaded = true
            return
        }
        loadToken += 1
        let token = loadToken
        isLoading = true
        defer {
            if token == loadToken {
                isLoading = false
                hasLoaded = true
            }
        }
        do {
            let linkedLead = includeLinkedLead && !project.isLead ? project.linkedLeadId : nil
            let loaded = try await session.api.media(projectId: project.id, kind: project.kind, linkedLeadId: linkedLead)
            guard token == loadToken else { return }
            let loadedIds = Set(loaded.map(\.id))
            // Keep uploads that landed while the list was loading.
            items = items.filter { absorbed.contains($0.id) && !loadedIds.contains($0.id) } + loaded
            error = nil
        } catch {
            guard token == loadToken else { return }
            items = []
            self.error = Self.message(error) ?? "Unable to load project media."
        }
    }

    // MARK: Delete

    /// Moves the item to the project's trash. Returns whether it worked.
    func delete(_ item: MediaItem) async -> Bool {
        guard deletingId == nil else { return false }
        guard let client = session.mediaClient else {
            error = "Project media is not configured."
            return false
        }
        deletingId = item.id
        error = nil
        defer { deletingId = nil }
        do {
            try await client.delete(mediaId: item.id)
            items.removeAll { $0.id == item.id }
            return true
        } catch {
            self.error = Self.message(error) ?? "Unable to delete this media."
            return false
        }
    }

    // MARK: Edit

    /// The person who took it, or a manager, can change its description and
    /// drawings (the server enforces the same rule).
    func canEdit(_ item: MediaItem) -> Bool {
        item.uploadedBy == session.user.id || session.isManager
    }

    enum EditOutcome: Equatable {
        case saved
        /// Someone else changed it first; the list was reloaded.
        case conflict
        case failed(String)
    }

    /// Saves a new description and/or drawings (nil leaves a part unchanged).
    /// The original image is never touched.
    func saveEdits(to item: MediaItem, description: String?, annotations: AnnotationDocument?) async -> EditOutcome {
        guard let projectId = item.jobId ?? item.leadId else { return .failed("This photo is missing its project.") }
        do {
            let saved = try await session.savePhotoEdits(
                projectId: projectId, mediaId: item.id, description: description, annotations: annotations,
                expected: PhotoRevisions(details: item.detailsRevision, annotations: item.annotationsRevision)
            )
            var updated = item
            if let description {
                let text = description.trimmingCharacters(in: .whitespacesAndNewlines)
                updated.mediaDescription = text.isEmpty ? nil : text
            }
            if let annotations {
                let document = annotations.sanitized()
                updated.annotations = document.isEmpty ? nil : document
            }
            updated.detailsRevision = saved.details
            updated.annotationsRevision = saved.annotations
            replace(updated)
            return .saved
        } catch {
            let message = Self.message(error) ?? "Couldn't save your changes. Try again."
            if message.localizedCaseInsensitiveContains("changed elsewhere") {
                await load()
                return .conflict
            }
            return .failed(message)
        }
    }

    private func replace(_ item: MediaItem) {
        guard let index = items.firstIndex(where: { $0.id == item.id }) else { return }
        items[index] = item
    }

    // MARK: Upload queue

    func retry(_ localId: String) { session.uploads?.retry(localId) }
    func retryAllFailed() { session.uploads?.retryAllFailed(projectId: project.id) }
    func discard(_ localId: String) { session.uploads?.discard(localId) }

    func fileURL(for upload: PendingUpload) -> URL? { session.uploads?.fileURL(for: upload) }
    func posterURL(for upload: PendingUpload) -> URL? { session.uploads?.posterURL(for: upload) }

    private func observeUploads() {
        guard let uploads = session.uploads else { return }
        withObservationTracking {
            _ = uploads.items
        } onChange: { [weak self] in
            Task { @MainActor [weak self] in
                self?.absorbUploads()
                self?.observeUploads()
            }
        }
    }

    private func absorbUploads() {
        guard let uploads = session.uploads else { return }
        for upload in uploads.items(for: project.id, kind: project.kind) where upload.status == .uploaded {
            guard var remote = upload.remote, !absorbed.contains(remote.id) else { continue }
            absorbed.insert(remote.id)
            if remote.uploaderName == nil { remote.uploaderName = session.displayName }
            // The note and drawings were saved with the upload.
            if remote.mediaDescription == nil, let note = upload.note?.trimmingCharacters(in: .whitespacesAndNewlines), !note.isEmpty {
                remote.mediaDescription = note
                remote.detailsRevision = upload.savedDetailsRevision?.uuidString.lowercased()
            }
            if remote.annotations == nil, let document = upload.annotations, !document.isEmpty {
                remote.annotations = document
                remote.annotationsRevision = upload.savedAnnotationsRevision?.uuidString.lowercased()
            }
            items.removeAll { $0.id == remote.id }
            items.insert(remote, at: 0)
            if error != nil, hasLoaded { error = nil }
        }
    }

    static func message(_ error: Error) -> String? {
        let text = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
