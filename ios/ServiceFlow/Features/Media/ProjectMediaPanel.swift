import ServiceFlowCore
import SwiftUI

/// Project Detail's Media tab: upload progress, then every photo and video
/// grouped by the day it was taken, three to a row.
struct ProjectMediaPanel: View {
    let store: MediaStore
    let project: Project

    @Environment(SessionContext.self) private var session
    @State private var lightbox: LightboxTarget?
    @State private var confirmRemove: PendingUpload?

    private static let columns = Array(repeating: GridItem(.flexible(), spacing: 7), count: 3)

    init(store: MediaStore, project: Project) {
        self.store = store
        self.project = project
    }

    var body: some View {
        let entries = MediaEntry.all(in: store)

        VStack(alignment: .leading, spacing: 0) {
            uploadBanner
            if let error = store.error { errorRow(error) }

            if store.isLoading && store.items.isEmpty {
                loadingState
            } else if entries.isEmpty {
                emptyState
            } else {
                header(count: entries.count)
                ForEach(DaySection.group(entries)) { section in
                    daySection(title: section.title, entries: section.entries)
                }
            }
        }
        .padding(.top, 18)
        .padding(.bottom, 42)
        .fullScreenCover(item: $lightbox) { target in
            MediaLightbox(store: store, startId: target.id) { lightbox = nil }
                .environment(session)
                .presentationBackground(.clear)
        }
        .confirmationDialog("Remove pending upload?", isPresented: Binding(
            get: { confirmRemove != nil }, set: { if !$0 { confirmRemove = nil } }
        ), titleVisibility: .visible, presenting: confirmRemove) { upload in
            Button("Remove", role: .destructive) { store.discard(upload.localId) }
            Button("Keep", role: .cancel) {}
        } message: { _ in
            Text("This removes the local capture from the upload queue.")
        }
    }

    // MARK: Sections

    private func daySection(title: String, entries: [MediaEntry]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                Text(title).text(15, .black, DetailPalette.navy).frame(maxWidth: .infinity, alignment: .leading)
                Text("\(entries.count)").text(12, .bold, DetailPalette.muted).padding(.leading, 12)
            }
            .padding(.bottom, 8)
            .overlay(alignment: .bottom) { Rectangle().fill(Color(hex: 0xdfe5e8)).frame(height: 1) }
            .padding(.bottom, 9)

            LazyVGrid(columns: Self.columns, spacing: 7) {
                ForEach(entries) { entry in tile(entry) }
            }
        }
        .padding(.bottom, 24)
    }

    private func header(count: Int) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 0) {
                Text("PROJECT RECORD").text(9.5, .black, DetailPalette.brand, tracking: 1.1)
                Text("Photos & Videos").text(22, .black, DetailPalette.ink, tracking: -0.5).padding(.top, 2)
            }
            Spacer()
            Text("\(count)")
                .text(13, .black, DetailPalette.brand)
                .padding(.horizontal, 10)
                .frame(minWidth: 34, minHeight: 34)
                .background(Color(hex: 0xedf4f5), in: Capsule())
        }
        .padding(.bottom, 18)
    }

    // MARK: Tiles

    private func tile(_ entry: MediaEntry) -> some View {
        let upload = entry.pendingUpload

        return VStack(spacing: 0) {
            MediaTileImage(entry: entry, store: store, style: .grid)

            HStack(spacing: 5) {
                Icon("person", 13, DetailPalette.muted)
                VStack(alignment: .leading, spacing: 1) {
                    Text(sourceName(entry)).text(8.5, .heavy, DetailPalette.ink).lineLimit(1)
                    Text(subtitle(entry)).text(8, .bold, DetailPalette.muted).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 6)
            .frame(minHeight: 42)
            .background(Color.white)
        }
        .bordered(11, border: upload == nil ? DetailPalette.border : Color(hex: 0xb9d9df))
        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        .contentShape(Rectangle())
        .onTapGesture { open(entry) }
        .onLongPressGesture {
            if let upload, upload.status != .uploading { confirmRemove = upload }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel(entry))
        .accessibilityAddTraits(.isButton)
    }

    private func open(_ entry: MediaEntry) {
        switch entry {
        case .pending(let upload):
            if upload.status == .failed { store.retry(upload.localId) }
        case .remote(let item):
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) { lightbox = LightboxTarget(id: item.id) }
        }
    }

    private func sourceName(_ entry: MediaEntry) -> String {
        switch entry {
        case .pending: return store.uploaderName
        case .remote(let item): return item.sourceName
        }
    }

    private func subtitle(_ entry: MediaEntry) -> String {
        switch entry {
        case .pending(let upload): return upload.status == .failed ? "Upload failed" : "Just captured"
        case .remote(let item): return DateText.canadianTime(item.timestamp)
        }
    }

    private func accessibilityLabel(_ entry: MediaEntry) -> String {
        let noun = entry.kind == .video ? "Video" : "Photo"
        switch entry {
        case .pending(let upload): return "\(noun) \(upload.status.rawValue)"
        case .remote: return "Open \(noun.lowercased())"
        }
    }

    // MARK: States

    @ViewBuilder
    private var uploadBanner: some View {
        let counts = store.pendingCounts
        let total = counts.active + counts.failed
        if total > 0 {
            let failed = counts.failed > 0
            HStack(spacing: 8) {
                if failed {
                    Icon("exclamationmark.circle.fill", 18, Color(hex: 0xa6402d))
                } else {
                    Spinner(color: DetailPalette.brand)
                }
                VStack(alignment: .leading, spacing: 0) {
                    Text(failed
                         ? "\(counts.failed) \(counts.failed == 1 ? "upload needs" : "uploads need") attention"
                         : "Uploading \(total) \(total == 1 ? "item" : "items")")
                        .text(12, .heavy, DetailPalette.brand)
                    Text("Uploads continue after you close the camera.")
                        .text(10.5, .semibold, DetailPalette.muted)
                        .padding(.top, 2)
                }
                Spacer(minLength: 0)
                if failed {
                    Button("Retry all") { store.retryAllFailed() }
                        .font(.app(13, .heavy))
                        .foregroundStyle(DetailPalette.brand)
                }
            }
            .padding(.horizontal, 13)
            .padding(.vertical, 11)
            .background(failed ? Color(hex: 0xfbecea) : Color(hex: 0xeaf4f6), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .padding(.bottom, 14)
        }
    }

    private func errorRow(_ message: String) -> some View {
        HStack(spacing: 8) {
            Icon("exclamationmark.circle", 20, Color(hex: 0xa6402d))
            Text(message).text(12, .semibold, Color(hex: 0x873523)).lineSpacing(3)
            Spacer(minLength: 0)
            Button("Retry") { Task { await store.load() } }
                .font(.app(13, .heavy))
                .foregroundStyle(DetailPalette.brand)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color(hex: 0xfbecea), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .padding(.bottom, 14)
    }

    private var loadingState: some View {
        VStack(spacing: 10) {
            ProgressView().tint(DetailPalette.brand)
            Text("Loading project media").text(12, .semibold, DetailPalette.muted)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 58)
    }

    private var emptyState: some View {
        VStack(spacing: 0) {
            Circle()
                .fill(Color(hex: 0xeef6f8))
                .frame(width: 88, height: 88)
                .overlay { Icon("photo.on.rectangle", 34, DetailPalette.brand) }
                .padding(.bottom, 14)
            Text("No photos or videos yet").text(15, .bold, DetailPalette.ink)
            Text("Capture the site before, during, and after the work to build the project record.")
                .text(12, .medium, DetailPalette.muted)
                .lineSpacing(3)
                .multilineTextAlignment(.center)
                .padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 20)
        .padding(.top, 40)
    }
}

private struct LightboxTarget: Identifiable {
    var id: String
}

/// Entries taken on one local day.
private struct DaySection: Identifiable {
    var id: String
    var title: String
    var entries: [MediaEntry]

    /// Newest day first, newest entry first within a day.
    static func group(_ entries: [MediaEntry]) -> [DaySection] {
        MediaRules.sections(entries, timestamp: { $0.timestamp })
            .map { DaySection(id: $0.key, title: $0.title, entries: $0.items) }
    }
}
