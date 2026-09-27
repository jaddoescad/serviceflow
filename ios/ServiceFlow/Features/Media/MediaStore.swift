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
    @ObservationIgnored private var absorbed = Set<String>()

    init(project: Project, session: SessionContext, includeLinkedLead: Bool) {
        self.project = project
        self.session = session
        self.includeLinkedLead = includeLinkedLead
        absorbUploads()
        observeUploads()
    }

    var projectId: String { project.id }
    var projectKind: ProjectKind { project.kind }
    var mediaClient: MediaClient? { session.mediaClient }
    var userId: String { session.user.id }
    var uploaderName: String { session.displayName }

    /// Captures of this project that aren't in `items` yet.
    var pending: [PendingUpload] {
        guard let uploads = session.uploads else { return [] }
        let known = Set(items.map(\.id))
        return uploads.items(for: project.id, kind: project.kind).filter { item in
            guard item.status == .uploaded else { return true }
            return !(item.remote.map { known.contains($0.id) } ?? true)
        }
    }

    /// Uploaded media, newest first (the grid and lightbox order).
    var sortedItems: [MediaItem] {
        items.enumerated().sorted { lhs, rhs in
            let l = lhs.element.timestamp?.timeIntervalSince1970 ?? 0
            let r = rhs.element.timestamp?.timeIntervalSince1970 ?? 0
            return l == r ? lhs.offset < rhs.offset : l > r
        }.map(\.element)
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
        do {
            let linkedLead = includeLinkedLead && !project.isLead ? project.linkedLeadId : nil
            let loaded = try await session.api.media(projectId: project.id, kind: project.kind, linkedLeadId: linkedLead)
            guard token == loadToken else { return }
            let loadedIds = Set(loaded.map(\.id))
            // Keep uploads that landed while the list was loading.
            let recent = items.filter { absorbed.contains($0.id) && !loadedIds.contains($0.id) }
            items = recent + loaded
            error = nil
        } catch {
            guard token == loadToken else { return }
            items = []
            self.error = Self.message(error) ?? "Unable to load project media."
        }
        isLoading = false
        hasLoaded = true
    }

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

    // MARK: Upload queue

    func retry(_ localId: String) { session.uploads?.retry(localId) }
    func retryAllFailed() { session.uploads?.retryAllFailed(projectId: project.id) }
    func discard(_ localId: String) { session.uploads?.discard(localId) }
    func clearCompleted() { session.uploads?.clearCompleted() }

    func fileURL(for upload: PendingUpload) -> URL? { session.uploads?.fileURL(for: upload) }
    func posterURL(for upload: PendingUpload) -> URL? { session.uploads?.posterURL(for: upload) }

    var pendingCounts: (active: Int, uploading: Int, failed: Int) {
        pending.reduce(into: (0, 0, 0)) { counts, item in
            switch item.status {
            case .queued: counts.0 += 1
            case .uploading: counts.0 += 1; counts.1 += 1
            case .failed: counts.2 += 1
            case .uploaded: break
            }
        }
    }

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
