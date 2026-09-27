import Foundation
import Observation

/// A capture on its way to the server.
public struct PendingUpload: Codable, Hashable, Identifiable, Sendable {
    public enum Status: String, Codable, Sendable { case queued, uploading, uploaded, failed }

    public var id: String { localId }
    public var localId: String
    /// Idempotency key sent as `x-upload-id`, stable across retries.
    public var uploadId: UUID
    public var projectId: String
    public var projectKind: ProjectKind
    public var kind: MediaKind
    /// File name inside the user's media directory.
    public var fileName: String
    public var posterFileName: String?
    public var mimeType: String
    public var width: Int?
    public var height: Int?
    public var durationMs: Int?
    public var capturedAt: Date
    public var status: Status
    public var attempts: Int
    public var retryAt: Date?
    public var error: String?
    public var remote: MediaItem?
    /// Description typed in the camera ("Add notes…").
    public var note: String?
    /// Drawings made in the photo editor.
    public var annotations: AnnotationDocument?
    /// Kept on the device until the camera's Done, so notes and edits come first.
    public var held: Bool?
    /// Revision ids reused on retries so the server can recognise a replay.
    public var detailsRevision: UUID?
    public var annotationsRevision: UUID?
    /// Note and drawings have reached the server.
    public var detailsSaved: Bool?
    /// Last revisions the server accepted; the next edit must name them.
    public var savedDetailsRevision: UUID?
    public var savedAnnotationsRevision: UUID?

    public var isHeld: Bool { held == true }
    var needsDetails: Bool {
        detailsSaved != true && (!(note ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !(annotations?.isEmpty ?? true))
    }
}

/// A photo or video just captured, handed to the queue.
public struct CapturedMedia: Sendable {
    public var fileURL: URL
    public var posterURL: URL?
    public var kind: MediaKind
    public var mimeType: String
    public var width: Int?
    public var height: Int?
    public var durationMs: Int?
    public var capturedAt: Date

    public init(fileURL: URL, posterURL: URL? = nil, kind: MediaKind, mimeType: String, width: Int? = nil,
                height: Int? = nil, durationMs: Int? = nil, capturedAt: Date) {
        self.fileURL = fileURL
        self.posterURL = posterURL
        self.kind = kind
        self.mimeType = mimeType
        self.width = width
        self.height = height
        self.durationMs = durationMs
        self.capturedAt = capturedAt
    }
}

/// Uploads captures one at a time. The queue and the captured files are kept
/// on disk, so nothing is lost when the app is closed or the person leaves the
/// screen; unfinished uploads resume on the next launch.
@MainActor
@Observable
public final class MediaUploadQueue {
    public static let maxAttempts = 3
    static let retryDelays: [TimeInterval] = [1, 3]

    public private(set) var items: [PendingUpload] = []
    /// Called with each uploaded row, so open screens can show it immediately.
    @ObservationIgnored public var onUploaded: ((MediaItem, PendingUpload) -> Void)?
    /// Saves an uploaded capture's note and drawings on the server.
    @ObservationIgnored public var saveDetails: ((MediaItem, PendingUpload) async throws -> Void)?

    private let client: MediaClient
    private let directory: URL
    private let store: JSONFileStore<[PendingUpload]>
    private let uploaderName: String
    @ObservationIgnored private var worker: Task<Void, Never>?

    public init(client: MediaClient, storage: UserStorage, uploaderName: String) {
        self.client = client
        directory = storage.mediaDirectory
        store = storage.store("media-uploads")
        self.uploaderName = uploaderName
        items = (store.load() ?? []).compactMap { item in
            var item = item
            guard item.status != .uploaded else { return nil }
            if item.status == .uploading { item.status = .queued }
            // A capture held for the camera's Done uploads after a relaunch.
            item.held = false
            return item
        }
        persist()
        pump()
    }

    public func items(for projectId: String, kind: ProjectKind) -> [PendingUpload] {
        items.filter { $0.projectId == projectId && $0.projectKind == kind }
    }

    public func fileURL(for item: PendingUpload) -> URL { directory.appendingPathComponent(item.fileName) }
    public func posterURL(for item: PendingUpload) -> URL? { item.posterFileName.map { directory.appendingPathComponent($0) } }

    /// Moves the capture into the queue's directory and starts uploading.
    @discardableResult
    public func enqueue(_ capture: CapturedMedia, projectId: String, projectKind: ProjectKind, held: Bool = false) -> PendingUpload? {
        guard !projectId.isEmpty else { return nil }
        let localId = "capture-\(UUID().uuidString.lowercased())"
        let ext = capture.kind == .video ? "mp4" : "jpg"
        let fileName = "\(localId).\(ext)"
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try FileManager.default.moveItem(at: capture.fileURL, to: directory.appendingPathComponent(fileName))
        } catch {
            return nil
        }
        var posterName: String?
        if let posterURL = capture.posterURL {
            let name = "\(localId)-poster.jpg"
            if (try? FileManager.default.moveItem(at: posterURL, to: directory.appendingPathComponent(name))) != nil {
                posterName = name
            }
        }
        let item = PendingUpload(
            localId: localId, uploadId: UUID(), projectId: projectId, projectKind: projectKind, kind: capture.kind,
            fileName: fileName, posterFileName: posterName, mimeType: capture.mimeType, width: capture.width,
            height: capture.height, durationMs: capture.durationMs, capturedAt: capture.capturedAt,
            status: .queued, attempts: 0, held: held
        )
        items.append(item)
        persist()
        pump()
        return item
    }

    /// Starts uploading held captures (the camera's Done).
    public func release(projectId: String? = nil) {
        for item in items where item.isHeld && (projectId == nil || item.projectId == projectId) {
            update(item.localId) { $0.held = false }
        }
        pump()
    }

    public func setNote(_ localId: String, _ note: String) {
        update(localId) { item in
            guard item.note != note else { return }
            item.note = note
            item.detailsSaved = false
            item.detailsRevision = nil
            if item.status == .uploaded { item.status = .queued; item.attempts = 0 }
        }
        pump()
    }

    public func setAnnotations(_ localId: String, _ document: AnnotationDocument) {
        update(localId) { item in
            item.annotations = document.sanitized()
            item.detailsSaved = false
            item.annotationsRevision = nil
            if item.status == .uploaded { item.status = .queued; item.attempts = 0 }
        }
        pump()
    }

    /// Replaces a photo that hasn't uploaded yet (rotated, cropped or adjusted).
    public func replacePhoto(_ localId: String, with fileURL: URL, width: Int?, height: Int?) {
        guard let item = items.first(where: { $0.localId == localId }), item.remote == nil, item.status != .uploading else { return }
        let target = self.fileURL(for: item)
        do {
            try? FileManager.default.removeItem(at: target)
            try FileManager.default.moveItem(at: fileURL, to: target)
        } catch {
            return
        }
        update(localId) { item in
            item.width = width
            item.height = height
            // A different file needs a fresh idempotency key.
            item.uploadId = UUID()
        }
    }

    public func retry(_ localId: String) {
        update(localId) { item in
            item.status = .queued
            item.attempts = 0
            item.retryAt = nil
            item.error = nil
        }
        pump()
    }

    public func retryAllFailed(projectId: String? = nil) {
        for item in items where item.status == .failed && (projectId == nil || item.projectId == projectId) {
            retry(item.localId)
        }
    }

    /// Removes a capture that hasn't uploaded yet, and its file.
    public func discard(_ localId: String) {
        guard let item = items.first(where: { $0.localId == localId }), item.status != .uploading else { return }
        removeFiles(of: item)
        items.removeAll { $0.localId == localId }
        persist()
    }

    public func clearCompleted() {
        items.removeAll { $0.status == .uploaded }
        persist()
    }

    /// Restarts uploads that were waiting, e.g. when the app is opened again.
    public func resume() { pump() }

    // MARK: Worker

    private func pump() {
        guard worker == nil else { return }
        worker = Task { [weak self] in
            await self?.run()
            self?.worker = nil
        }
    }

    private func run() async {
        while true {
            let current = Date()
            guard let next = items.first(where: { $0.status == .queued && !$0.isHeld && ($0.retryAt ?? .distantPast) <= current }) else {
                guard let wake = items.filter({ $0.status == .queued && !$0.isHeld }).compactMap(\.retryAt).min() else { return }
                try? await Task.sleep(nanoseconds: UInt64(max(0.1, wake.timeIntervalSinceNow) * 1_000_000_000))
                continue
            }
            await upload(next)
        }
    }

    private func upload(_ item: PendingUpload) async {
        update(item.localId) { item in
            item.status = .uploading
            item.attempts += 1
            item.retryAt = nil
            item.error = nil
        }
        let request = MediaUploadRequest(
            uploadId: item.uploadId, projectId: item.projectId, projectKind: item.projectKind, fileURL: fileURL(for: item),
            fileName: item.fileName, mimeType: item.mimeType, width: item.width, height: item.height,
            durationMs: item.durationMs, capturedAt: item.capturedAt
        )
        do {
            var remote: MediaItem
            if let existing = item.remote {
                remote = existing
            } else {
                remote = try await client.upload(request)
                remote.uploaderName = uploaderName
                if remote.kind == .video, let poster = posterURL(for: item) {
                    try? await client.uploadPoster(mediaId: remote.id, fileURL: poster)
                }
                // Remember the row so a retry only sends the details.
                update(item.localId) { $0.remote = remote }
            }
            if let current = items.first(where: { $0.localId == item.localId }), current.needsDetails, let saveDetails {
                var ready = current
                if ready.detailsRevision == nil { ready.detailsRevision = UUID() }
                if ready.annotationsRevision == nil { ready.annotationsRevision = UUID() }
                update(item.localId) { $0.detailsRevision = ready.detailsRevision; $0.annotationsRevision = ready.annotationsRevision }
                try await saveDetails(remote, ready)
                update(item.localId) { item in
                    item.detailsSaved = true
                    if !(item.note ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { item.savedDetailsRevision = ready.detailsRevision }
                    if !(item.annotations?.isEmpty ?? true) { item.savedAnnotationsRevision = ready.annotationsRevision }
                }
            }
            update(item.localId) { item in
                item.status = .uploaded
                item.remote = remote
            }
            removeFiles(of: item, keepMain: true)
            if let uploaded = items.first(where: { $0.localId == item.localId }) { onUploaded?(remote, uploaded) }
        } catch {
            let message = error.localizedDescription.isEmpty ? "Upload failed. Tap to retry." : error.localizedDescription
            let permanent = (error as? MediaClientError)?.isPermanent ?? false
            update(item.localId) { item in
                item.error = message
                if permanent || item.attempts >= Self.maxAttempts {
                    item.status = .failed
                } else {
                    item.status = .queued
                    item.retryAt = Date().addingTimeInterval(Self.retryDelays[min(item.attempts - 1, Self.retryDelays.count - 1)])
                }
            }
        }
    }

    // MARK: Helpers

    private func update(_ localId: String, _ change: (inout PendingUpload) -> Void) {
        guard let index = items.firstIndex(where: { $0.localId == localId }) else { return }
        change(&items[index])
        persist()
    }

    /// The photo file stays until the list is cleared, so the filmstrip and
    /// grid can keep showing it without a network round trip.
    private func removeFiles(of item: PendingUpload, keepMain: Bool = false) {
        if !keepMain { try? FileManager.default.removeItem(at: fileURL(for: item)) }
        if let poster = posterURL(for: item) { try? FileManager.default.removeItem(at: poster) }
    }

    private func persist() {
        store.save(items.filter { $0.status != .uploaded })
        // Files of uploads that are gone from the list are no longer needed.
        let keep = Set(items.flatMap { [$0.fileName, $0.posterFileName].compactMap { $0 } })
        if let names = try? FileManager.default.contentsOfDirectory(atPath: directory.path) {
            for name in names where !keep.contains(name) {
                try? FileManager.default.removeItem(at: directory.appendingPathComponent(name))
            }
        }
    }

    public var counts: (queued: Int, uploading: Int, failed: Int, uploaded: Int) {
        items.reduce(into: (0, 0, 0, 0)) { counts, item in
            switch item.status {
            case .queued: counts.0 += 1
            case .uploading: counts.1 += 1
            case .failed: counts.2 += 1
            case .uploaded: counts.3 += 1
            }
        }
    }
}
