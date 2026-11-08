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

/// A written page. Managers tap Edit to edit it right here, and it saves as
/// they type like the web's editor; everyone else reads it.
struct ProjectDocumentPageScreen: View {
    let document: ProjectDocument

    @Environment(SessionContext.self) private var session
    @State private var page: ProjectDocumentPage?
    @State private var editing: PageEditing?
    @State private var failed = false

    var body: some View {
        Group {
            if let page {
                ProjectDocumentWebView(html: ProjectDocuments.pageDocument(body: page.body, editable: editing != nil), editing: editing)
                    .id(page.updatedAt)
                    .ignoresSafeArea(edges: .bottom)
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
        .toolbar {
            if let editing {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if let status = editing.statusText {
                        Text(status)
                            .font(.footnote)
                            .foregroundStyle(editing.status == .failed ? Color(hex: 0xb42318) : .secondary)
                    }
                    Button(editing.active ? "Done" : "Edit") { editing.edit(!editing.active) }
                        .fontWeight(editing.active ? .semibold : .regular)
                }
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if editing?.status == .conflict {
                HStack {
                    Text("Someone else changed this page.").font(.footnote)
                    Spacer()
                    Button("Reload") { Task { await load() } }.font(.footnote.weight(.semibold))
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(Color(hex: 0xfef3f2))
            }
        }
        .task { if page == nil { await load() } }
        // Leaving keeps the last few keystrokes too.
        .onDisappear { if let editing { Task { await editing.flush() } } }
    }

    private func load() async {
        failed = false
        do {
            let loaded = try await session.api.pageDocument(document)
            editing = session.isManager ? PageEditing(api: session.api, document: document, page: loaded) : nil
            page = loaded
        } catch {
            failed = true
        }
    }
}

/// A manager's editing of a page: Edit/Done, what the format bar shows, and
/// saving each change a second after typing stops, over the version they
/// have open.
@MainActor
@Observable
final class PageEditing {
    enum Status { case idle, saving, saved, failed, conflict }

    /// The selection's formatting, as the page editor script reports it.
    struct Format: Equatable {
        var block = "p"
        var bold = false, italic = false, underline = false
        var bullets = false, numbers = false, checklist = false
    }

    private(set) var active = false
    private(set) var status = Status.idle
    private(set) var format = Format()
    @ObservationIgnored weak var view: WKWebView?
    @ObservationIgnored private let api: ServiceFlowAPI
    @ObservationIgnored private let document: ProjectDocument
    @ObservationIgnored private var page: ProjectDocumentPage
    @ObservationIgnored private var pending: String?
    @ObservationIgnored private var saving = false
    @ObservationIgnored private var timer: Task<Void, Never>?

    init(api: ServiceFlowAPI, document: ProjectDocument, page: ProjectDocumentPage) {
        self.api = api
        self.document = document
        self.page = page
    }

    var statusText: String? {
        switch status {
        case .idle, .conflict: nil
        case .saving: "Saving…"
        case .saved: "Saved"
        case .failed: "Not saved"
        }
    }

    /// Edit makes the page editable where it is; Done stops and saves.
    func edit(_ on: Bool) {
        active = on
        view?.evaluateJavaScript("serviceFlowPage.edit(\(on))", in: nil, in: .defaultClient)
        if !on {
            hideKeyboard()
            Task { await flush() }
        }
    }

    /// Runs a formatting command in the page (see page-editor.js).
    func run(_ command: String, _ value: String? = nil) {
        let arguments = [command, value].compactMap { $0 }
        guard let data = try? JSONSerialization.data(withJSONObject: arguments), let list = String(data: data, encoding: .utf8) else { return }
        view?.evaluateJavaScript("serviceFlowPage.run(...\(list))", in: nil, in: .defaultClient)
    }

    func hideKeyboard() {
        view?.endEditing(true)
    }

    /// A message from page-editor.js.
    func received(_ text: String) {
        guard let data = text.data(using: .utf8),
              let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        switch message["kind"] as? String {
        case "changed":
            if let html = message["html"] as? String { changed(html) }
        case "state":
            format = Format(
                block: message["block"] as? String ?? "p",
                bold: message["bold"] as? Bool ?? false,
                italic: message["italic"] as? Bool ?? false,
                underline: message["underline"] as? Bool ?? false,
                bullets: message["bullets"] as? Bool ?? false,
                numbers: message["numbers"] as? Bool ?? false,
                checklist: message["checklist"] as? Bool ?? false
            )
        default:
            break
        }
    }

    /// Saves whatever hasn't been saved yet, now.
    func flush() async {
        timer?.cancel()
        await save()
    }

    private func changed(_ html: String) {
        guard status != .conflict, html != (pending ?? page.body) else { return }
        pending = html
        later(seconds: 1)
    }

    private func later(seconds: Double) {
        timer?.cancel()
        timer = Task { [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled else { return }
            await self?.save()
        }
    }

    private func save() async {
        guard !saving, status != .conflict, let body = pending else { return }
        saving = true
        pending = nil
        status = .saving
        do {
            if let version = try await api.savePageDocument(document, page: page, body: body) {
                page.body = body
                page.updatedAt = version
                status = .saved
            } else {
                status = .conflict
            }
        } catch {
            if pending == nil { pending = body }
            status = .failed
            later(seconds: 4)
        }
        saving = false
        if status == .saved, pending != nil { await save() }
    }
}

/// The bar above the keyboard while a manager edits a page: the web editor's
/// text styles, colours and lists.
private struct PageFormatBar: View {
    let editing: PageEditing

    private static let blocks = [("h1", "Heading 1"), ("h2", "Heading 2"), ("h3", "Heading 3"), ("p", "Paragraph")]
    private static let colors: [(String, UInt32)] = [
        ("Default", 0x101725), ("Gray", 0x6b7688), ("Red", 0xd3453e), ("Orange", 0xd9730d),
        ("Yellow", 0xb7770f), ("Green", 0x17935a), ("Blue", 0x2f6bff), ("Purple", 0x7c3aed),
    ]

    var body: some View {
        let format = editing.format
        HStack(spacing: 0) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 2) {
                    Menu {
                        ForEach(Self.blocks, id: \.0) { tag, label in
                            Button(label) { editing.run("formatBlock", "<\(tag)>") }
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Text(Self.blocks.first { $0.0 == format.block }?.1 ?? "Paragraph")
                            Image(systemName: "chevron.down").font(.system(size: 11, weight: .semibold))
                        }
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Color.primary)
                        .padding(.horizontal, 10)
                        .frame(height: 36)
                    }
                    .accessibilityLabel("Text style")
                    button("bold", "Bold", active: format.bold) { editing.run("bold") }
                    button("italic", "Italic", active: format.italic) { editing.run("italic") }
                    button("underline", "Underline", active: format.underline) { editing.run("underline") }
                    Menu {
                        ForEach(Self.colors, id: \.0) { name, hex in
                            Button {
                                editing.run("foreColor", String(format: "#%06x", hex))
                            } label: {
                                Label {
                                    Text(name)
                                } icon: {
                                    Image(uiImage: UIImage(systemName: "circle.fill")!
                                        .withTintColor(UIColor(Color(hex: hex)), renderingMode: .alwaysOriginal))
                                }
                            }
                        }
                    } label: {
                        icon("paintpalette", active: false)
                    }
                    .accessibilityLabel("Text colour")
                    Divider().frame(height: 20).padding(.horizontal, 6)
                    button("list.bullet", "Bulleted list", active: format.bullets) { editing.run("bullets") }
                    button("list.number", "Numbered list", active: format.numbers) { editing.run("numbers") }
                    button("checklist", "Checklist", active: format.checklist) { editing.run("checklist") }
                    Divider().frame(height: 20).padding(.horizontal, 6)
                    button("arrow.uturn.backward", "Undo", active: false) { editing.run("undo") }
                    button("arrow.uturn.forward", "Redo", active: false) { editing.run("redo") }
                }
                .padding(.horizontal, 8)
            }
            Divider().frame(height: 20)
            button("keyboard.chevron.compact.down", "Hide keyboard", active: false) { editing.hideKeyboard() }
                .padding(.horizontal, 4)
        }
        .padding(.vertical, 6)
        .background(.bar)
        .overlay(alignment: .top) { Divider() }
    }

    private func button(_ symbol: String, _ label: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) { icon(symbol, active: active) }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
            .accessibilityAddTraits(active ? .isSelected : [])
    }

    private func icon(_ symbol: String, active: Bool) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 17, weight: .medium))
            .frame(width: 40, height: 36)
            .foregroundStyle(active ? DetailPalette.brand : Color.primary)
            .background(active ? DetailPalette.brand.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

/// Shows a page's HTML with its scripts off; links open in Safari. With
/// `editing`, the page editor script (in the app's own script world) edits it,
/// the keyboard carries the format bar, and dragging the page down hides it.
private struct ProjectDocumentWebView: UIViewRepresentable {
    let html: String
    var editing: PageEditing?

    private static let editorScript = Bundle.main.url(forResource: "page-editor", withExtension: "js")
        .flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> PageWebView {
        let configuration = WKWebViewConfiguration()
        // Only the page's own scripts; the app's still run.
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        if let editing {
            let scripts = WKUserContentController()
            scripts.addUserScript(WKUserScript(source: Self.editorScript, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: .defaultClient))
            scripts.add(PageMessages(editing), contentWorld: .defaultClient, name: "page")
            configuration.userContentController = scripts
        }
        let view = PageWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = .white
        if let editing {
            editing.view = view
            let bar = UIHostingController(rootView: PageFormatBar(editing: editing))
            bar.view.backgroundColor = .clear
            let accessory = UIView(frame: CGRect(x: 0, y: 0, width: 0, height: 49))
            accessory.autoresizingMask = .flexibleWidth
            bar.view.frame = accessory.bounds
            bar.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            accessory.addSubview(bar.view)
            context.coordinator.bar = bar
            view.useAccessory(accessory)
            let drag = UIPanGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.dragged))
            drag.delegate = context.coordinator
            view.scrollView.addGestureRecognizer(drag)
        }
        context.coordinator.html = html
        view.loadHTMLString(html, baseURL: nil)
        return view
    }

    func updateUIView(_ view: PageWebView, context: Context) {
        guard context.coordinator.html != html else { return }
        context.coordinator.html = html
        view.loadHTMLString(html, baseURL: nil)
    }

    static func dismantleUIView(_ view: PageWebView, coordinator: Coordinator) {
        view.configuration.userContentController.removeAllScriptMessageHandlers()
    }

    final class Coordinator: NSObject, WKNavigationDelegate, UIGestureRecognizerDelegate {
        var html = ""
        var bar: UIHostingController<PageFormatBar>?

        /// Scrolling with the finger moving down puts the keyboard away.
        @MainActor @objc func dragged(_ drag: UIPanGestureRecognizer) {
            guard drag.state == .changed, let scrollView = drag.view as? UIScrollView, scrollView.isDragging,
                  drag.translation(in: scrollView).y > 24 else { return }
            scrollView.superview?.endEditing(true)
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url else { return .allow }
            await UIApplication.shared.open(url)
            return .cancel
        }
    }
}

/// Hands page-editor.js messages to the editing without WebKit keeping it alive.
private final class PageMessages: NSObject, WKScriptMessageHandler {
    weak var editing: PageEditing?

    init(_ editing: PageEditing) { self.editing = editing }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let text = message.body as? String else { return }
        MainActor.assumeIsolated { editing?.received(text) }
    }
}

/// A web view for editing a page. Its keyboard carries our bar instead of
/// WebKit's (arrows and Done), and the keyboard comes up when Edit focuses the
/// page: WebKit only raises it for focus from a tap in the page, and Edit is a
/// tap too. WebKit's text input view is a private class, so it is given a
/// subclass that does both.
final class PageWebView: WKWebView {
    private var accessory: UIView?

    func useAccessory(_ accessory: UIView) {
        self.accessory = accessory
        guard let content = scrollView.subviews.first(where: { String(describing: type(of: $0)).hasPrefix("WKContent") }),
              let base: AnyClass = object_getClass(content) else { return }
        let name = "\(NSStringFromClass(base))_PageAccessory"
        var subclass: AnyClass? = NSClassFromString(name)
        if subclass == nil, let made = objc_allocateClassPair(base, name, 0) {
            let accessoryView: @convention(block) (UIView) -> UIView? = { content in
                var parent = content.superview
                while let view = parent, !(view is PageWebView) { parent = view.superview }
                return (parent as? PageWebView)?.accessory
            }
            class_addMethod(made, #selector(getter: UIResponder.inputAccessoryView), imp_implementationWithBlock(accessoryView), "@@:")
            Self.focusAsTapped(made, base: base)
            objc_registerClassPair(made)
            subclass = made
        }
        if let subclass { object_setClass(content, subclass) }
    }

    /// Passes WebKit's focus handling on with "the user is interacting" set.
    /// If a WebKit version renames it, Edit still works and the first tap in
    /// the page brings the keyboard up.
    private static func focusAsTapped(_ subclass: AnyClass, base: AnyClass) {
        let selector = NSSelectorFromString("_elementDidFocus:userIsInteracting:blurPreviousNode:activityStateChanges:userObject:")
        guard let method = class_getInstanceMethod(base, selector) else { return }
        typealias Focus = @convention(c) (AnyObject, Selector, UnsafeRawPointer?, Bool, Bool, UInt, AnyObject?) -> Void
        let original = unsafeBitCast(method_getImplementation(method), to: Focus.self)
        let focus: @convention(block) (AnyObject, UnsafeRawPointer?, Bool, Bool, UInt, AnyObject?) -> Void = { view, element, _, blur, changes, object in
            original(view, selector, element, true, blur, changes, object)
        }
        class_addMethod(subclass, selector, imp_implementationWithBlock(focus), method_getTypeEncoding(method))
    }
}
