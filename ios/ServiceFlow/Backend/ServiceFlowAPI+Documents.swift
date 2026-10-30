import Foundation
import ServiceFlowCore
import Supabase

/// A job's Documents tab: files and pages managers add on the web. Every
/// company member can read them.
extension ServiceFlowAPI {
    func projectDocuments(projectId: String) async throws -> (documents: [ProjectDocument], folders: [ProjectDocumentFolder]) {
        async let documentRows = rows(
            client.from("project_documents")
                .select("id,project_id,folder_id,name,kind,storage_path,mime_type,byte_size,updated_at")
                .eq("project_id", value: projectId)
        )
        async let folderRows = rows(
            client.from("project_document_folders").select("id,name").eq("project_id", value: projectId)
        )
        return try await (documentRows.compactMap(ProjectDocument.init(row:)),
                          folderRows.compactMap(ProjectDocumentFolder.init(row:)))
    }

    /// A page ready for a web view, its images swapped for signed links.
    func pageDocument(_ document: ProjectDocument) async throws -> String {
        let row = try await rows(
            client.from("project_documents").select("body_html").eq("id", value: document.id).limit(1)
        ).first
        let html = row?["body_html"]?.stringValue ?? ""
        var links: [String: String] = [:]
        for (source, path) in ProjectDocuments.pageImages(html: html, document: document) {
            // An image that can't be signed shows as missing; the text still reads.
            if let url = try? await run({ try await client.storage.from(ProjectDocuments.bucket).createSignedURL(path: path, expiresIn: 600) }) {
                links[source] = url.absoluteString
            }
        }
        return ProjectDocuments.pageDocument(body: ProjectDocuments.replacingImageSources(in: html, with: links))
    }

    /// An uploaded file's bytes.
    func documentFile(_ document: ProjectDocument) async throws -> Data {
        guard let path = document.storagePath else { throw BackendError.offline("This file is missing.") }
        return try await run { try await client.storage.from(ProjectDocuments.bucket).download(path: path) }
    }
}
