import ServiceFlowCore
import SwiftUI

/// "Change Job": pick another active job (or search jobs and leads).
struct ProjectSwitcherSheet: View {
    var currentProject: Project?
    var switching: Bool
    var error: String?
    var onPick: (Project) -> Void

    @Environment(SessionContext.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var search = Debouncer()
    @State private var results: [Project] = []
    @State private var searching = false
    @State private var searchError: String?
    @FocusState private var focused: Bool

    private var hasQuery: Bool { !search.text.trimmingCharacters(in: .whitespaces).isEmpty }

    private var options: [Project] {
        var seen = Set<String>()
        let source = hasQuery ? results : session.mappedProjects
        return source.filter { !$0.id.isEmpty && $0.id != currentProject?.id && !$0.isArchived && seen.insert($0.id).inserted }
            .prefix(hasQuery ? 50 : 40).map { $0 }
    }

    var body: some View {
        @Bindable var search = search
        VStack(alignment: .leading, spacing: 0) {
            Capsule().fill(Color(hex: 0xd7ddda)).frame(width: 42, height: 5).frame(maxWidth: .infinity).padding(.bottom, 12)
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Change Job").text(22, .black, Palette.ink, tracking: -0.4)
                    Text("Currently at \(currentProject?.name ?? "selected job")").text(12.5, .semibold, Palette.muted).lineLimit(1)
                }
                Spacer(minLength: 0)
                Button { dismiss() } label: {
                    Icon("xmark", 22, Palette.navy).frame(width: 38, height: 38).background(Color(hex: 0xedf2ef), in: Circle())
                }
                .disabled(switching)
                .accessibilityLabel("Close job selector")
            }

            HStack(spacing: 9) {
                Icon("magnifyingglass", 19, Palette.muted)
                TextField("", text: $search.text, prompt: Text("Search all jobs").foregroundColor(Palette.muted))
                    .font(.app(15, .bold))
                    .foregroundStyle(Palette.ink)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focused)
                    .disabled(switching)
                if searching {
                    Spinner(color: Palette.teal)
                } else if !search.text.isEmpty {
                    Button { search.clear() } label: { Icon("xmark.circle.fill", 20, Palette.muted) }
                }
            }
            .padding(.horizontal, 13)
            .frame(height: 48)
            .bordered(15, border: Color(hex: 0xdfe7e3), background: Color(hex: 0xf4f7f5))
            .padding(.top, 16)

            Text((hasQuery ? "Search results" : "Active projects").uppercased())
                .text(11, .black, Palette.muted, tracking: 0.6)
                .padding(.top, 16)
                .padding(.bottom, 7)

            ScrollView {
                LazyVStack(spacing: 0) {
                    if options.isEmpty, !searching {
                        Text(searchError ?? (hasQuery ? "No matching jobs found." : "No other active projects are available."))
                            .text(13, .bold, Palette.muted)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 24)
                    }
                    ForEach(options) { project in
                        Button { onPick(project) } label: { row(project) }
                            .buttonStyle(.pressable(opacity: 0.85, scale: 0.99))
                            .disabled(switching)
                            .opacity(switching ? 0.6 : 1)
                            .accessibilityLabel("Switch to \(project.name)")
                    }
                }
            }
            .scrollDismissesKeyboard(.interactively)

            if switching {
                HStack(spacing: 8) {
                    Spinner(color: Palette.teal)
                    Text("Changing jobs…").text(13, .heavy, Palette.navy)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 12)
            } else if let error {
                Text(error).text(12.5, .bold, Palette.red).padding(.top, 10)
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 10)
        .padding(.bottom, 18)
        .background(Color.white)
        .onAppear { focused = true }
        .task(id: search.committed) {
            let query = search.committed
            guard !query.isEmpty else { return }
            do {
                let found = try await session.api.searchProjects(query)
                if query == search.committed { results = found; searchError = nil }
            } catch {
                if query == search.committed { results = []; searchError = (error as? BackendError)?.message }
            }
            searching = false
        }
        .onChange(of: search.text) { _, value in
            searching = !value.trimmingCharacters(in: .whitespaces).isEmpty
            if !searching { results = []; searchError = nil }
        }
    }

    private func row(_ project: Project) -> some View {
        HStack(spacing: 11) {
            Icon(switching ? "mappin" : "briefcase", 18, Palette.teal)
                .frame(width: 38, height: 38)
                .background(Color(hex: 0xe9f3ee), in: RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 2) {
                Text(project.name).text(14.5, .black, Palette.ink).lineLimit(1)
                Text(project.cardAddress ?? "No address on file").text(12, .semibold, Palette.muted).lineLimit(1)
            }
            Spacer(minLength: 0)
            Icon("chevron.right", 19, Palette.muted)
        }
        .frame(minHeight: 64)
        .padding(.vertical, 9)
        .overlay(alignment: .bottom) { Rectangle().fill(Color(hex: 0xedf0ee)).frame(height: 1) }
    }
}
