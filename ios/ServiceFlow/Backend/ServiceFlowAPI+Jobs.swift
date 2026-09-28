import Foundation
import ServiceFlowCore
import Supabase

/// Jobs, leads, budgets and assignments.
extension ServiceFlowAPI {
    private static let activeStatuses = ["scheduled", "active"]
    private static let pageLimit = 1000

    /// Visible jobs (`job_feed` applies each job's own visibility flag).
    private func jobFeed() -> PostgrestFilterBuilder {
        scoped(client.from("job_feed").select("*").eq("is_feed_visible", value: true))
    }

    private func activeJobs() -> PostgrestFilterBuilder {
        jobFeed().in("status", values: Self.activeStatuses)
    }

    /// Every scheduled or active job with coordinates (for the map and suggestions).
    func mappedProjects() async throws -> [Project] {
        var all: [Project] = []
        var from = 0
        while true {
            let page = try await rows(
                activeJobs().order("updated_at", ascending: false).range(from: from, to: from + Self.pageLimit - 1)
            )
            all += page.compactMap(Project.init(jobRow:)).filter { $0.isListable && $0.coordinate != nil }
            if page.count < Self.pageLimit { return all }
            from += Self.pageLimit
        }
    }

    /// One page of active jobs, optionally limited to `ids`.
    func activeProjects(page: Int, pageSize: Int, ids: [String]?) async throws -> [Project] {
        if let ids, ids.isEmpty { return [] }
        var query = activeJobs()
        if let ids { query = query.in("id", values: ids) }
        let start = page * pageSize
        return try await rows(query.order("updated_at", ascending: false).range(from: start, to: start + pageSize - 1))
            .compactMap(Project.init(jobRow:)).filter(\.isListable)
    }

    /// The most recently updated active job.
    func latestActiveProject() async throws -> Project? {
        try await rows(activeJobs().order("updated_at", ascending: false).limit(5))
            .compactMap(Project.init(jobRow:)).first(where: \.isListable)
    }

    // MARK: Search

    /// Jobs and unconverted leads matching `text` (name, contact, address, phone).
    func searchProjects(_ text: String, limit: Int = 50) async throws -> [Project] {
        guard let pattern = Self.likePattern(text) else { return [] }
        let contactIds = try await matchingContactIds(pattern, digits: text.filter(\.isNumber))
        let leadRows = try await matchingLeadRows(pattern, contactIds: contactIds)
        let leadJobIds = leadRows.flatMap { $0["jobs"]?.arrayValue ?? [] }.compactMap { $0["id"]?.nonEmptyString }
        let jobRows = try await matchingJobRows(pattern, alsoIds: leadJobIds)

        let jobs = jobRows.compactMap(Project.init(jobRow:))
        // A lead with a job shows as that job.
        let leads = leadRows.filter { ($0["jobs"]?.arrayValue ?? []).isEmpty }.compactMap(Project.init(leadRow:))
        return (jobs + leads)
            .filter { !$0.isHiddenTestProject }
            .sorted { ($0.updatedAt ?? $0.createdAt ?? .distantPast) > ($1.updatedAt ?? $1.createdAt ?? .distantPast) }
            .prefix(limit).map { $0 }
    }

    /// `%text%` for `ilike`, with the characters PostgREST filters treat
    /// specially neutralised; nil for an empty query.
    static func likePattern(_ text: String) -> String? {
        let cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "[,()]", with: " ", options: .regularExpression)
            .replacingOccurrences(of: "%", with: "\\%")
            .replacingOccurrences(of: "_", with: "\\_")
        return cleaned.isEmpty ? nil : "%\(cleaned)%"
    }

    private static func ilike(_ columns: [String], _ pattern: String) -> [String] {
        columns.map { "\($0).ilike.\(pattern)" }
    }

    private func matchingContactIds(_ pattern: String, digits: String) async throws -> [String] {
        var filters = Self.ilike(["name", "email"], pattern)
        // Phone numbers are stored in many formats, so match on digits only.
        if digits.count >= 3 { filters.append("phone.ilike.%\(digits)%") }
        return try await rows(scoped(client.from("contacts").select("id")).or(filters.joined(separator: ",")).limit(Self.pageLimit))
            .compactMap { $0["id"]?.nonEmptyString }
    }

    private func matchingLeadRows(_ pattern: String, contactIds: [String]) async throws -> [JSONValue] {
        var filters = Self.ilike(["address", "city", "province", "postal_code", "source", "pipeline_stage_raw"], pattern)
        if !contactIds.isEmpty { filters.append("contact_id.in.(\(contactIds.joined(separator: ",")))") }
        return try await rows(
            scoped(client.from("leads").select("*,contact:contacts(id,name,email,phone),jobs(id)"))
                .or(filters.joined(separator: ",")).order("updated_at", ascending: false).limit(Self.pageLimit)
        )
    }

    private func matchingJobRows(_ pattern: String, alsoIds: [String]) async throws -> [JSONValue] {
        var filters = Self.ilike(["name", "formatted_address", "city", "province", "postal_code"], pattern)
        if !alsoIds.isEmpty { filters.append("id.in.(\(alsoIds.joined(separator: ",")))") }
        // Completed jobs are searchable too; archived and cancelled ones aren't.
        return try await rows(
            jobFeed().neq("status", value: "archived").neq("status", value: "cancelled")
                .or(filters.joined(separator: ",")).order("updated_at", ascending: false).limit(Self.pageLimit)
        )
    }

    // MARK: Budgets and assignments

    func budgets(jobIds: [String]) async throws -> [String: BudgetProgress] {
        var result: [String: BudgetProgress] = [:]
        // Keep each request's URL short: 100 ids at a time.
        for chunk in stride(from: 0, to: jobIds.count, by: 100).map({ Array(jobIds[$0..<min($0 + 100, jobIds.count)]) }) {
            let page = try await rows(
                client.from("job_feed").select("id,status,budget_minutes,used_minutes,budget_percent_used,budget_status,updated_at")
                    .in("id", values: chunk)
            )
            for progress in page.compactMap({ BudgetProgress(jobFeedRow: $0) }) { result[progress.jobId] = progress }
        }
        return result
    }

    func assignedJobIds(userId: String) async throws -> [String] {
        try await rows(scoped(client.from("job_assignments").select("job_id")).eq("employee_id", value: userId).eq("status", value: "active"))
            .compactMap { $0["job_id"]?.nonEmptyString }
    }
}
