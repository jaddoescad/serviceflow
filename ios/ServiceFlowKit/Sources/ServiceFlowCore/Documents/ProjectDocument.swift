import Foundation

public enum ProjectDocumentKind: String, Codable, Sendable {
    /// An uploaded file (PDF, image, spreadsheet…).
    case file
    /// A page written in the web admin's editor.
    case page
}

/// A file or written page on a job's Documents tab (`project_documents` row).
/// Managers add them on the web; the crew reads them in the app.
public struct ProjectDocument: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var projectId: String
    public var name: String
    public var kind: ProjectDocumentKind
    public var folderId: String?
    /// Where an uploaded file's bytes are in the `project-documents` bucket.
    public var storagePath: String?
    public var mimeType: String?
    public var byteSize: Int64
    public var updatedAt: Date?

    public init(id: String, projectId: String, name: String, kind: ProjectDocumentKind, folderId: String? = nil,
                storagePath: String? = nil, mimeType: String? = nil, byteSize: Int64 = 0, updatedAt: Date? = nil) {
        self.id = id
        self.projectId = projectId
        self.name = name
        self.kind = kind
        self.folderId = folderId
        self.storagePath = storagePath
        self.mimeType = mimeType
        self.byteSize = byteSize
        self.updatedAt = updatedAt
    }

    public init?(row: JSONValue) {
        guard let id = row["id"]?.nonEmptyString, let projectId = row["project_id"]?.nonEmptyString else { return nil }
        let kind: ProjectDocumentKind = row["kind"]?.stringValue == "page" ? .page : .file
        let storagePath = row["storage_path"]?.nonEmptyString
        // A file without its bytes can't be opened.
        if kind == .file, storagePath == nil { return nil }
        self.init(
            id: id,
            projectId: projectId,
            name: row["name"]?.nonEmptyString ?? "Untitled",
            kind: kind,
            folderId: row["folder_id"]?.nonEmptyString,
            storagePath: storagePath,
            mimeType: row["mime_type"]?.nonEmptyString,
            byteSize: Int64(row["byte_size"]?.doubleValue ?? 0),
            updatedAt: row["updated_at"]?.dateValue
        )
    }

    /// "PDF", "Image", "Word", "Spreadsheet", "Page", or the file's extension.
    public var typeLabel: String {
        if kind == .page { return "Page" }
        let mime = mimeType?.lowercased() ?? ""
        let ext = (name as NSString).pathExtension.lowercased()
        if mime == "application/pdf" || ext == "pdf" { return "PDF" }
        if mime.hasPrefix("image/") || ["jpg", "jpeg", "png", "heic", "gif", "webp"].contains(ext) { return "Image" }
        if mime.contains("wordprocessing") || mime == "application/msword" || ["doc", "docx"].contains(ext) { return "Word" }
        if mime.contains("spreadsheet") || mime.contains("excel") || mime == "text/csv" || ["xls", "xlsx", "csv"].contains(ext) {
            return "Spreadsheet"
        }
        return ext.isEmpty ? "File" : ext.uppercased()
    }

    /// The row's second line: "PDF · 19 KB · Oct 27, 2026", "Page · Oct 28, 2026".
    public var detail: String {
        var parts = [typeLabel]
        if kind == .file, byteSize > 0 { parts.append(ProjectDocuments.sizeLabel(byteSize)) }
        let date = DateText.canadianShortDate(updatedAt)
        if !date.isEmpty { parts.append(date) }
        return parts.joined(separator: " · ")
    }
}

/// A folder on a job's Documents tab (`project_document_folders` row).
public struct ProjectDocumentFolder: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }

    public init?(row: JSONValue) {
        guard let id = row["id"]?.nonEmptyString else { return nil }
        self.init(id: id, name: row["name"]?.nonEmptyString ?? "Folder")
    }
}

public enum ProjectDocuments {
    public static let bucket = "project-documents"

    /// Documents under one heading: a folder, or none for those in no folder.
    public struct Section: Hashable, Sendable {
        public var folder: ProjectDocumentFolder?
        public var documents: [ProjectDocument]

        public init(folder: ProjectDocumentFolder?, documents: [ProjectDocument]) {
            self.folder = folder
            self.documents = documents
        }
    }

    /// Documents in no folder first, then each folder by name, newest first
    /// within each. Empty folders are left out.
    public static func sections(documents: [ProjectDocument], folders: [ProjectDocumentFolder]) -> [Section] {
        let known = Set(folders.map(\.id))
        let newestFirst = documents.sorted {
            let left = $0.updatedAt ?? .distantPast, right = $1.updatedAt ?? .distantPast
            return left != right ? left > right : $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
        }
        var sections: [Section] = []
        let loose = newestFirst.filter { $0.folderId.map { !known.contains($0) } ?? true }
        if !loose.isEmpty { sections.append(Section(folder: nil, documents: loose)) }
        let sortedFolders = folders.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        for folder in sortedFolders {
            let inside = newestFirst.filter { $0.folderId == folder.id }
            if !inside.isEmpty { sections.append(Section(folder: folder, documents: inside)) }
        }
        return sections
    }

    /// "820 B", "19 KB", "4.2 MB".
    public static func sizeLabel(_ bytes: Int64) -> String {
        if bytes < 1024 { return "\(bytes) B" }
        if bytes < 1024 * 1024 { return "\(Int((Double(bytes) / 1024).rounded())) KB" }
        let megabytes = (Double(bytes) / (1024 * 1024) * 10).rounded() / 10
        return megabytes == megabytes.rounded() ? "\(Int(megabytes)) MB" : "\(megabytes) MB"
    }

    // MARK: Pages

    private static let imageSource = try! NSRegularExpression(
        pattern: "/api/jobs/([0-9a-fA-F-]{36})/documents/([0-9a-fA-F-]{36})/images/([0-9a-fA-F-]{36})"
    )

    /// A page's images point at the web admin
    /// (`/api/jobs/<job>/documents/<page>/images/<image>`). Returns each such
    /// address in the page's HTML with its storage key, so the app can swap in
    /// a signed link. Images of another page are left alone.
    public static func pageImages(html: String, document: ProjectDocument) -> [String: String] {
        var images: [String: String] = [:]
        let range = NSRange(html.startIndex..., in: html)
        for match in imageSource.matches(in: html, range: range) {
            guard let whole = Range(match.range, in: html),
                  let job = Range(match.range(at: 1), in: html),
                  let page = Range(match.range(at: 2), in: html),
                  let image = Range(match.range(at: 3), in: html) else { continue }
            guard html[job].lowercased() == document.projectId.lowercased(),
                  html[page].lowercased() == document.id.lowercased() else { continue }
            images[String(html[whole])] = "\(document.projectId)/pages/\(document.id)/\(html[image].lowercased())"
        }
        return images
    }

    /// The page's HTML with each image address replaced by its link.
    public static func replacingImageSources(in html: String, with links: [String: String]) -> String {
        links.reduce(html) { result, link in result.replacingOccurrences(of: link.key, with: link.value) }
    }

    /// The page as a document for a web view: system font, images and tables
    /// fit the screen, and dark mode follows the phone.
    public static func pageDocument(body: String) -> String {
        """
        <!doctype html>
        <html><head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
        :root { color-scheme: light dark; }
        body { margin: 0; padding: 16px 20px 40px; font: 17px/1.5 -apple-system, system-ui, Roboto, sans-serif;
          color: #1c1c1e; background: #ffffff; overflow-wrap: anywhere; }
        @media (prefers-color-scheme: dark) { body { color: #f2f2f7; background: #000000; } a { color: #64a8ff; } }
        h1, h2, h3 { line-height: 1.25; margin: 1.2em 0 0.4em; }
        h1:first-child, h2:first-child, h3:first-child, p:first-child { margin-top: 0; }
        img { max-width: 100%; height: auto; border-radius: 8px; }
        table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; }
        th, td { border: 1px solid rgba(128, 128, 128, 0.35); padding: 6px 8px; text-align: left; }
        blockquote { margin: 0; padding-left: 12px; border-left: 3px solid rgba(128, 128, 128, 0.5); }
        </style>
        </head><body>\(body)</body></html>
        """
    }
}
