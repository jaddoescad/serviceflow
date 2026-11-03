import Observation
import ServiceFlowCore
import SwiftUI

/// Team time and budget for one job.
@MainActor
@Observable
final class ProjectDetailModel {
    let project: Project
    /// Everyone's entries on the job from the server.
    private(set) var serverEntries: [TimeEntry] = []
    private(set) var budget: BudgetProgress?
    private(set) var budgetLoading = true
    private(set) var budgetFailed = false
    /// The job's description ("" when it has none); nil until loaded.
    private(set) var jobDescription: String?
    /// Entries deleted on this device; hidden even if a refresh lands before the delete syncs.
    @ObservationIgnored private var deletedKeys = Set<String>()

    init(project: Project) {
        self.project = project
        budget = project.budget
        // Shown with the job straight away; the refresh picks up later edits.
        jobDescription = project.isLead ? nil : (project.description ?? "")
    }

    var jobId: String { project.id }

    /// Someone is clocked into the job right now (the live clock needs ticking).
    var hasRunningEntry: Bool { serverEntries.contains(where: \.isActive) }

    /// Server entries merged with this device's entries for the job. The local
    /// copy wins for the same entry, so the running shift and unsynced edits count.
    func entries(local: [TimeEntry]) -> [TimeEntry] {
        let mine = local.filter { $0.project.id == jobId }
        var result = mine
        for entry in serverEntries where !mine.contains(where: { $0.isSameEntry(as: entry) })
            && deletedKeys.isDisjoint(with: entry.identityKeys) {
            result.append(entry)
        }
        return result.sorted { $0.startedAt > $1.startedAt }
    }

    /// Reloads team entries, the budget and the description together.
    func refresh(api: ServiceFlowAPI) async {
        async let budget: Void = refreshBudget(api: api)
        async let team: Void = refreshEntries(api: api)
        async let description: Void = refreshDescription(api: api)
        _ = await (budget, team, description)
    }

    func refreshDescription(api: ServiceFlowAPI) async {
        guard !project.isLead, !jobId.isEmpty else { return }
        if let text = try? await api.jobDescription(jobId: jobId) { jobDescription = text }
    }

    /// Saves the description; throws when the server refuses or is unreachable.
    func saveDescription(api: ServiceFlowAPI, text: String) async throws {
        jobDescription = try await api.setJobDescription(jobId: jobId, body: text)
    }

    func refreshEntries(api: ServiceFlowAPI) async {
        guard !project.isLead, !jobId.isEmpty else { return }
        if let entries = try? await api.jobTimeEntries(jobId: jobId) { serverEntries = entries }
    }

    func refreshBudget(api: ServiceFlowAPI) async {
        guard !project.isLead, !jobId.isEmpty else { return }
        do {
            if let progress = try await api.budgets(jobIds: [jobId])[jobId] {
                // Keep the budget hours the list row carried.
                var next = progress
                if next.budgetHours == nil { next.budgetHours = budget?.budgetHours }
                budget = next
            }
            budgetFailed = false
        } catch {
            budgetFailed = budget == nil
        }
        budgetLoading = false
    }

    func removeLocally(_ entry: TimeEntry) {
        deletedKeys.formUnion(entry.identityKeys)
        serverEntries.removeAll { $0.isSameEntry(as: entry) }
    }

    /// The budget to show; `unavailable` when it could not be loaded at all.
    var shownBudget: BudgetProgress? {
        if budget == nil, budgetFailed {
            return BudgetProgress(jobId: jobId, percentUsed: nil, hoursUsed: nil, status: .unavailable)
        }
        return budget
    }
}
