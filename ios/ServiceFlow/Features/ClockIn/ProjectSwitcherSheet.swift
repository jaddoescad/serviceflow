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

    private var hasQuery: Bool { !search.text.trimmingCharacters(in: .whitespaces).isEmpty }

    private var options: [Project] {
        var seen = Set<String>()
        let source = hasQuery ? results : session.mappedProjects
        return source.filter { !$0.id.isEmpty && $0.id != currentProject?.id && !$0.isArchived && seen.insert($0.id).inserted }
            .prefix(hasQuery ? 50 : 40).map { $0 }
    }

    var body: some View {
        @Bindable var search = search
        NavigationStack {
            List {
                if let error {
                    Section { Text(error).foregroundStyle(Palette.red) }
                }
                Section {
                    if options.isEmpty {
                        if searching {
                            HStack { Spacer(); ProgressView(); Spacer() }
                        } else {
                            Text(searchError ?? (hasQuery ? "No matching jobs found." : "No other active jobs are available."))
                                .foregroundStyle(.secondary)
                        }
                    }
                    ForEach(options) { project in
                        Button { onPick(project) } label: { ProjectListRow(project: project) }
                            .foregroundStyle(.primary)
                            .disabled(switching)
                            .accessibilityLabel("Switch to \(project.name)")
                    }
                } header: {
                    Text(hasQuery ? "Search results" : "Active jobs")
                } footer: {
                    if let currentProject { Text("Currently at \(currentProject.name).") }
                }
            }
            .navigationTitle("Change Job")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $search.text, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search all jobs")
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(switching)
                }
                if switching {
                    ToolbarItem(placement: .confirmationAction) { ProgressView() }
                }
            }
        }
        .tint(Palette.teal)
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
}
