import Foundation

public enum MediaKind: String, Codable, Sendable {
    case image
    case video
}

/// A photo or video on a job or lead (`job_media` row).
public struct MediaItem: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var jobId: String?
    public var leadId: String?
    public var kind: MediaKind
    public var mimeType: String?
    public var capturedAt: Date?
    public var createdAt: Date?
    public var uploadedBy: String?
    public var sourceProvider: String?
    public var creatorName: String?
    /// Filled in after listing from the uploader's employee profile.
    public var uploaderName: String?
    public var mediaDescription: String?
    public var annotations: AnnotationDocument?
    /// Revisions the next edit of the description or drawings must name.
    public var detailsRevision: String?
    public var annotationsRevision: String?

    public init(id: String, jobId: String? = nil, leadId: String? = nil, kind: MediaKind, mimeType: String? = nil,
                capturedAt: Date? = nil, createdAt: Date? = nil, uploadedBy: String? = nil, sourceProvider: String? = nil,
                creatorName: String? = nil, uploaderName: String? = nil) {
        self.id = id
        self.jobId = jobId
        self.leadId = leadId
        self.kind = kind
        self.mimeType = mimeType
        self.capturedAt = capturedAt
        self.createdAt = createdAt
        self.uploadedBy = uploadedBy
        self.sourceProvider = sourceProvider
        self.creatorName = creatorName
        self.uploaderName = uploaderName
    }

    public init?(row: JSONValue) {
        guard let id = row["id"]?.nonEmptyString else { return nil }
        self.init(
            id: id,
            jobId: row["job_id"]?.nonEmptyString,
            leadId: row["lead_id"]?.nonEmptyString,
            kind: row["media_type"]?.stringValue == "video" ? .video : .image,
            mimeType: row["mime_type"]?.nonEmptyString,
            capturedAt: row["captured_at"]?.dateValue,
            createdAt: row["created_at"]?.dateValue,
            uploadedBy: row["uploaded_by"]?.nonEmptyString,
            sourceProvider: row["source_provider"]?.nonEmptyString,
            creatorName: row["source_metadata"]?["creator_name"]?.nonEmptyString
        )
        let metadata = row["source_metadata"]
        mediaDescription = metadata?["description"]?.nonEmptyString
        annotations = (try? metadata?["annotations"]?.decode(AnnotationDocument.self)).flatMap { $0.isEmpty ? nil : $0 }
        detailsRevision = metadata?["photo_revision"]?.nonEmptyString
        annotationsRevision = metadata?["annotation_revision"]?.nonEmptyString
    }

    /// When it was taken, for sorting and grouping.
    public var timestamp: Date? { capturedAt ?? createdAt }

    /// "Taken by" name: the original creator for imported media, else the uploader.
    public var sourceName: String {
        creatorName ?? (sourceProvider == "companycam" ? "CompanyCam" : nil) ?? uploaderName ?? "Team member"
    }

    public func canDelete(userId: String) -> Bool { uploadedBy == userId }
}

public enum MediaRules {
    public static let maxImageBytes: Int64 = 25 * 1024 * 1024
    public static let maxSingleVideoBytes: Int64 = 95 * 1024 * 1024
    public static let maxVideoBytes: Int64 = 1024 * 1024 * 1024
    public static let multipartThreshold: Int64 = 16 * 1024 * 1024
    public static let maxVideoSeconds = 600

    static let imageTypes: Set<String> = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]
    static let videoTypes: Set<String> = ["video/mp4", "video/quicktime"]

    public static func kind(ofMime mime: String) -> MediaKind? {
        if imageTypes.contains(mime) { return .image }
        if videoTypes.contains(mime) { return .video }
        return nil
    }

    /// MIME type from a declared type, else the file extension.
    public static func mimeType(declared: String?, fileName: String) -> String? {
        if let declared = declared?.lowercased().split(separator: ";").first.map({ $0.trimmingCharacters(in: .whitespaces) }),
           kind(ofMime: declared) != nil {
            return declared
        }
        switch (fileName as NSString).pathExtension.lowercased() {
        case "jpg", "jpeg": return "image/jpeg"
        case "png": return "image/png"
        case "webp": return "image/webp"
        case "heic": return "image/heic"
        case "heif": return "image/heif"
        case "mp4", "m4v": return "video/mp4"
        case "mov", "qt": return "video/quicktime"
        default: return nil
        }
    }

    /// Filename for the `x-original-filename` header.
    public static func sanitizedFilename(_ name: String?) -> String? {
        guard let name else { return nil }
        var base = (name as NSString).lastPathComponent
        base = base.replacingOccurrences(of: "[^A-Za-z0-9._-]+", with: "_", options: .regularExpression)
        while let first = base.first, ".-_".contains(first) { base.removeFirst() }
        let trimmed = String(base.prefix(120))
        return trimmed.isEmpty ? nil : trimmed
    }

    /// Photos and videos grouped by local day, newest first.
    public static func sections<Item>(_ items: [Item], timestamp: (Item) -> Date?, calendar: Calendar = .current)
        -> [(key: String, title: String, items: [Item])] {
        let sorted = items.enumerated().sorted { lhs, rhs in
            let l = timestamp(lhs.element)?.timeIntervalSince1970 ?? 0
            let r = timestamp(rhs.element)?.timeIntervalSince1970 ?? 0
            return l == r ? lhs.offset < rhs.offset : l > r
        }.map(\.element)
        var order: [String] = []
        var groups: [String: [Item]] = [:]
        var titles: [String: String] = [:]
        for item in sorted {
            let date = timestamp(item)
            let key = date.map { DayKey.of($0, calendar: calendar) } ?? "recent"
            if groups[key] == nil {
                order.append(key)
                titles[key] = DateText.canadianLongDate(date)
            }
            groups[key, default: []].append(item)
        }
        return order.map { ($0, titles[$0] ?? "Recently", groups[$0] ?? []) }
    }
}
