import QuickLook
import ServiceFlowCore
import SwiftUI
import WebKit

/// A written page, pushed from the Documents tab.
struct ProjectDocumentRoute: Hashable {
    let document: ProjectDocument
}

/// Project Detail's Documents tab: the files and pages managers add to the
/// job on the web. Pages open in the app; files open in Quick Look.
struct ProjectDocumentsTab: View {
    let project: Project

    @Environment(SessionContext.self) private var session
    @State private var sections: [ProjectDocuments.Section]?
    @State private var loadError = false
    @State private var opening: String?
    @State private var preview: URL?
    @State private var openError: String?

    var body: some View {
        List {
            if let sections {
                if sections.isEmpty {
                    ContentUnavailableView {
                        Label("No documents yet", systemImage: "doc.text")
                    } description: {
                        Text("Documents your manager adds to this job on the web show up here.")
                    }
                } else {
                    ForEach(sections, id: \.folder?.id) { section in
                        Section {
                            ForEach(section.documents) { document in row(document) }
                        } header: {
                            if let folder = section.folder { Label(folder.name, systemImage: "folder") }
                        }
                    }
                }
            } else if loadError {
                ContentUnavailableView {
                    Label("Couldn't load documents", systemImage: "wifi.exclamationmark")
                } description: {
                    Text("Check your connection and try again.")
                } actions: {
                    Button("Try Again") { Task { await load() } }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40).listRowBackground(Color.clear)
            }

            // Room above the floating camera button.
            Color.clear.frame(height: 60).listRowBackground(Color.clear)
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(16)
        .refreshable { await load() }
        .task { await load() }
        .quickLookPreview($preview)
        .alert("Couldn't open the file", isPresented: Binding(get: { openError != nil }, set: { if !$0 { openError = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(openError ?? "")
        }
    }

    @ViewBuilder
    private func row(_ document: ProjectDocument) -> some View {
        if document.kind == .page {
            NavigationLink(value: ProjectDocumentRoute(document: document)) {
                ProjectDocumentRow(document: document, opening: false)
            }
        } else {
            Button { open(document) } label: {
                ProjectDocumentRow(document: document, opening: opening == document.id)
            }
            .foregroundStyle(.primary)
            .disabled(opening != nil)
        }
    }

    private func load() async {
        do {
            let loaded = try await session.api.projectDocuments(projectId: project.id)
            sections = ProjectDocuments.sections(documents: loaded.documents, folders: loaded.folders)
            loadError = false
        } catch {
            // Keep what's on screen if a refresh fails.
            if sections == nil { loadError = true }
        }
    }

    /// Downloads the file under its own name (Quick Look goes by the
    /// extension) and shows it.
    private func open(_ document: ProjectDocument) {
        opening = document.id
        Task {
            defer { opening = nil }
            do {
                let data = try await session.api.documentFile(document)
                let folder = FileManager.default.temporaryDirectory
                    .appendingPathComponent("documents/\(document.id)", isDirectory: true)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                let file = folder.appendingPathComponent(Self.fileName(document))
                try data.write(to: file, options: .atomic)
                preview = file
            } catch {
                openError = "\(document.name) didn't download. Check your connection and try again."
            }
        }
    }

    private static func fileName(_ document: ProjectDocument) -> String {
        var name = document.name.replacingOccurrences(of: "/", with: "-")
        let stored = (document.storagePath.map { ($0 as NSString).pathExtension } ?? "")
        if (name as NSString).pathExtension.isEmpty, !stored.isEmpty { name += ".\(stored)" }
        return name
    }
}

/// One document: its type icon, name, and type · size · date.
struct ProjectDocumentRow: View {
    let document: ProjectDocument
    let opening: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 36, height: 36)
                .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(document.name).font(.app(15, .semibold)).lineLimit(1)
                Text(document.detail).font(.app(13)).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 0)
            if opening {
                ProgressView().controlSize(.small)
            } else if document.kind == .file {
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var symbol: String {
        switch document.typeLabel {
        case "Page": return "doc.text"
        case "PDF": return "doc.richtext"
        case "Image": return "photo"
        case "Spreadsheet": return "tablecells"
        default: return "doc"
        }
    }

    private var tint: Color {
        switch document.typeLabel {
        case "Page": return DetailPalette.brand
        case "PDF": return Palette.red
        case "Image": return Palette.teal
        case "Spreadsheet": return Color(hex: 0x27ae60)
        default: return DetailPalette.navy
        }
    }
}

/// A written page, read-only.
struct ProjectDocumentPageScreen: View {
    let document: ProjectDocument

    @Environment(SessionContext.self) private var session
    @State private var html: String?
    @State private var failed = false

    var body: some View {
        Group {
            if let html {
                ProjectDocumentWebView(html: html).ignoresSafeArea(edges: .bottom)
            } else if failed {
                ContentUnavailableView {
                    Label("Couldn't load this page", systemImage: "wifi.exclamationmark")
                } description: {
                    Text("Check your connection and try again.")
                } actions: {
                    Button("Try Again") { Task { await load() } }
                }
            } else {
                ProgressView()
            }
        }
        .navigationTitle(document.name)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        failed = false
        do {
            html = try await session.api.pageDocument(document)
        } catch {
            failed = true
        }
    }
}

/// Shows a page's HTML with scripts off; links open in Safari.
private struct ProjectDocumentWebView: UIViewRepresentable {
    let html: String

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = .systemBackground
        view.loadHTMLString(html, baseURL: nil)
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url else { return .allow }
            await UIApplication.shared.open(url)
            return .cancel
        }
    }
}
