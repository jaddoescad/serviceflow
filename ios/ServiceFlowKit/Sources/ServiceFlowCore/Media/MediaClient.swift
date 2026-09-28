import Foundation

/// A capture ready to upload.
public struct MediaUploadRequest: Sendable {
    public var uploadId: UUID
    public var projectId: String
    public var projectKind: ProjectKind
    public var fileURL: URL
    public var fileName: String
    public var mimeType: String
    public var width: Int?
    public var height: Int?
    public var durationMs: Int?
    public var capturedAt: Date

    public init(uploadId: UUID, projectId: String, projectKind: ProjectKind, fileURL: URL, fileName: String,
                mimeType: String, width: Int?, height: Int?, durationMs: Int?, capturedAt: Date) {
        self.uploadId = uploadId
        self.projectId = projectId
        self.projectKind = projectKind
        self.fileURL = fileURL
        self.fileName = fileName
        self.mimeType = mimeType
        self.width = width
        self.height = height
        self.durationMs = durationMs
        self.capturedAt = capturedAt
    }
}

public struct MediaClientError: Error, LocalizedError, Equatable {
    public var message: String
    public var status: Int?

    public init(_ message: String, status: Int? = nil) {
        self.message = message
        self.status = status
    }

    public var errorDescription: String? {
        status.map { "\(message) (HTTP \($0))" } ?? message
    }

    /// Client errors other than timeouts and rate limits won't succeed on retry.
    public var isPermanent: Bool {
        guard let status else { return false }
        return (400..<500).contains(status) && status != 408 && status != 429 && status != 401
    }
}

/// HTTP client for the project media Worker. Bytes only ever go through the
/// Worker; it checks access against Supabase with the caller's token.
public struct MediaClient: Sendable {
    public let baseURL: URL
    private let session: URLSession
    private let token: @Sendable () async throws -> String

    public init(baseURL: URL, session: URLSession = .shared, token: @escaping @Sendable () async throws -> String) {
        self.baseURL = baseURL
        self.session = session
        self.token = token
    }

    public func originalURL(_ mediaId: String) -> URL {
        baseURL.appendingPathComponent("v1/media/\(mediaId)")
    }

    public func thumbnailURL(_ mediaId: String) -> URL {
        baseURL.appendingPathComponent("v1/media/\(mediaId)/thumbnail")
    }

    /// Headers to load media; fetch per request so an expired token is never reused.
    public func authorizationHeaders() async throws -> [String: String] {
        ["Authorization": "Bearer \(try await token())"]
    }

    // MARK: Upload

    public func upload(_ request: MediaUploadRequest) async throws -> MediaItem {
        guard let kind = MediaRules.kind(ofMime: request.mimeType) else {
            throw MediaClientError("Unsupported file type. Use JPEG, PNG, WebP, HEIC photos or MP4/MOV videos.")
        }
        let size = (try? request.fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize).map(Int64.init) ?? 0
        guard size > 0 else { throw MediaClientError("The selected file is empty or cannot be read.") }
        let limit = kind == .image ? MediaRules.maxImageBytes : MediaRules.maxVideoBytes
        guard size <= limit else {
            throw MediaClientError("This \(kind.rawValue) is too large. The limit is \(limit / 1024 / 1024) MB.")
        }
        if kind == .video, size > MediaRules.multipartThreshold {
            do {
                return try await uploadMultipart(request, size: size)
            } catch {
                guard size <= MediaRules.maxSingleVideoBytes else { throw error }
            }
        }
        return try await uploadSingle(request, kind: kind, size: size)
    }

    private func uploadSingle(_ upload: MediaUploadRequest, kind: MediaKind, size: Int64) async throws -> MediaItem {
        let url = baseURL.appendingPathComponent("v1/\(upload.projectKind.mediaPathSegment)/\(upload.projectId)/media")
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.timeoutInterval = 300
        request.setValue("Bearer \(try await token())", forHTTPHeaderField: "Authorization")
        request.setValue(upload.mimeType, forHTTPHeaderField: "Content-Type")
        request.setValue(kind.rawValue, forHTTPHeaderField: "x-media-type")
        request.setValue(String(size), forHTTPHeaderField: "Content-Length")
        // Same id on every retry: the Worker returns the existing row instead
        // of storing the file twice when an earlier response was lost.
        request.setValue(upload.uploadId.uuidString.lowercased(), forHTTPHeaderField: "x-upload-id")
        request.setValue(ISODate.string(upload.capturedAt), forHTTPHeaderField: "x-captured-at")
        if let name = MediaRules.sanitizedFilename(upload.fileName) { request.setValue(name, forHTTPHeaderField: "x-original-filename") }
        if let width = upload.width, width > 0, width <= 100_000 { request.setValue(String(width), forHTTPHeaderField: "x-media-width") }
        if let height = upload.height, height > 0, height <= 100_000 { request.setValue(String(height), forHTTPHeaderField: "x-media-height") }
        if kind == .video, let duration = upload.durationMs, duration > 0, duration <= 86_400_000 {
            request.setValue(String(duration), forHTTPHeaderField: "x-media-duration-ms")
        }
        let (data, response) = try await session.upload(for: request, fromFile: upload.fileURL)
        let row = try decode(data, response, fallback: "Upload failed")
        guard let item = MediaItem(row: row) else { throw MediaClientError("Upload failed") }
        return item
    }

    private func uploadMultipart(_ upload: MediaUploadRequest, size: Int64) async throws -> MediaItem {
        let base = baseURL.appendingPathComponent("v1/\(upload.projectKind.mediaPathSegment)/\(upload.projectId)/media/multipart")
        var start = URLRequest(url: base)
        start.httpMethod = "POST"
        start.setValue("Bearer \(try await token())", forHTTPHeaderField: "Authorization")
        start.setValue(upload.mimeType, forHTTPHeaderField: "x-media-content-type")
        start.setValue(String(size), forHTTPHeaderField: "x-file-size")
        if let name = MediaRules.sanitizedFilename(upload.fileName) { start.setValue(name, forHTTPHeaderField: "x-original-filename") }
        let started = try decode(try await session.data(for: start), fallback: "Upload failed")
        guard let uploadId = started["uploadId"]?.nonEmptyString, let objectKey = started["objectKey"]?.nonEmptyString else {
            throw MediaClientError("Upload failed")
        }
        let partSize = started["partSize"]?.intValue.flatMap { $0 > 0 ? Int64($0) : nil } ?? 8 * 1024 * 1024
        let partsURL = baseURL.appendingPathComponent("v1/media-uploads/\(uploadId)/parts")

        do {
            let handle = try FileHandle(forReadingFrom: upload.fileURL)
            defer { try? handle.close() }
            var parts: [JSONValue] = []
            var offset: Int64 = 0
            var number = 1
            while offset < size {
                try handle.seek(toOffset: UInt64(offset))
                guard let chunk = try handle.read(upToCount: Int(min(partSize, size - offset))), !chunk.isEmpty else {
                    throw MediaClientError("Could not read the video from storage.")
                }
                let etag = try await sendPart(chunk, number: number, objectKey: objectKey, url: partsURL)
                parts.append(["partNumber": .number(Double(number)), "etag": .string(etag)])
                offset += Int64(chunk.count)
                number += 1
            }

            var complete = URLRequest(url: baseURL.appendingPathComponent("v1/media-uploads/\(uploadId)/complete"))
            complete.httpMethod = "POST"
            complete.setValue("Bearer \(try await token())", forHTTPHeaderField: "Authorization")
            complete.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let body: JSONValue = [
                "objectKey": .string(objectKey),
                "parts": .array(parts),
                "mimeType": .string(upload.mimeType),
                "byteSize": .number(Double(size)),
                "originalFilename": JSONValue(MediaRules.sanitizedFilename(upload.fileName)),
                "width": JSONValue(upload.width),
                "height": JSONValue(upload.height),
                "durationMs": JSONValue(upload.durationMs),
                "capturedAt": .number((upload.capturedAt.timeIntervalSince1970 * 1000).rounded()),
            ]
            complete.httpBody = try JSONCoding.encoder.encode(body)
            let result = try decode(try await session.data(for: complete), fallback: "Upload failed")
            guard let item = MediaItem(row: result["media"] ?? .null) else { throw MediaClientError("Upload failed") }
            return item
        } catch {
            var abort = URLRequest(url: baseURL.appendingPathComponent("v1/media-uploads/\(uploadId)"))
            abort.httpMethod = "DELETE"
            abort.setValue(objectKey, forHTTPHeaderField: "x-object-key")
            if let token = try? await token() { abort.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
            _ = try? await session.data(for: abort)
            throw error
        }
    }

    private func sendPart(_ chunk: Data, number: Int, objectKey: String, url: URL) async throws -> String {
        var lastError: Error = MediaClientError("Upload failed")
        for _ in 0..<3 {
            var request = URLRequest(url: url)
            request.httpMethod = "PUT"
            request.timeoutInterval = 300
            // A fresh token per part: a long upload can outlive one token.
            request.setValue("Bearer \(try await token())", forHTTPHeaderField: "Authorization")
            request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
            request.setValue(objectKey, forHTTPHeaderField: "x-object-key")
            request.setValue(String(number), forHTTPHeaderField: "x-part-number")
            do {
                let (data, response) = try await session.upload(for: request, from: chunk)
                let result = try decode(data, response, fallback: "Upload failed")
                guard let etag = result["etag"]?.nonEmptyString else { throw MediaClientError("Upload failed") }
                return etag
            } catch let error as MediaClientError where error.isPermanent {
                throw error
            } catch {
                lastError = error
            }
        }
        throw lastError
    }

    /// Stores a JPEG still for a video so the grid never has to generate one.
    public func uploadPoster(mediaId: String, fileURL: URL) async throws {
        var request = URLRequest(url: thumbnailURL(mediaId))
        request.httpMethod = "PUT"
        request.timeoutInterval = 15
        request.setValue("Bearer \(try await token())", forHTTPHeaderField: "Authorization")
        request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        let (data, response) = try await session.upload(for: request, fromFile: fileURL)
        _ = try decode(data, response, fallback: "Upload failed")
    }

    // MARK: Delete

    /// Moves a photo or video to the project's trash.
    public func delete(mediaId: String) async throws {
        var request = URLRequest(url: originalURL(mediaId))
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(try await token())", forHTTPHeaderField: "Authorization")
        let (data, response) = try await session.data(for: request)
        _ = try decode(data, response, fallback: "Delete failed")
    }

    // MARK: Helpers

    private func decode(_ result: (Data, URLResponse), fallback: String) throws -> JSONValue {
        try decode(result.0, result.1, fallback: fallback)
    }

    private func decode(_ data: Data, _ response: URLResponse, fallback: String) throws -> JSONValue {
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let body = (try? JSONCoding.decoder.decode(JSONValue.self, from: data)) ?? .null
        guard (200..<300).contains(status) else {
            throw MediaClientError(body["error"]?.nonEmptyString ?? fallback, status: status)
        }
        return body
    }
}
