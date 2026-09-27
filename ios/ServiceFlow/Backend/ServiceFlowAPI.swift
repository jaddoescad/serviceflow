import Foundation
import ServiceFlowCore
import Supabase

/// Every Supabase call the app makes. Row-level security scopes all reads to
/// the companies the signed-in person belongs to.
final class ServiceFlowAPI: TimeTrackingBackend, @unchecked Sendable {
    let client: SupabaseClient

    init(config: AppConfig) {
        client = SupabaseClient(
            supabaseURL: config.supabaseURL,
            supabaseKey: config.supabaseKey,
            options: SupabaseClientOptions(auth: .init(autoRefreshToken: true, emitLocalSessionAsInitialSession: true))
        )
    }

    // MARK: Errors

    /// Classifies an error for the offline queues. Anything that isn't a
    /// definite refusal from the database is treated as worth retrying, so a
    /// time record is never thrown away because of a flaky connection.
    static func classify(_ error: Error) -> BackendError {
        if let error = error as? BackendError { return error }
        if error is URLError || (error as NSError).domain == NSURLErrorDomain {
            return .offline(error.localizedDescription)
        }
        if let error = error as? PostgrestError {
            guard let code = error.code else { return .offline(error.message) }
            if code.hasPrefix("PGRST3") { return .unauthorized(error.message) }
            let definite = code == "P0001" || code == "P0002" || code == "42501" || code.hasPrefix("22")
                || code.hasPrefix("23") || code == "42883" || code.hasPrefix("PGRST1") || code.hasPrefix("PGRST2")
            return definite ? .server(code: code, message: error.message, status: 400) : .offline(error.message)
        }
        if error is AuthError { return .unauthorized(error.localizedDescription) }
        return .offline(error.localizedDescription)
    }

    private func run<T>(_ work: () async throws -> T) async throws -> T {
        do { return try await work() } catch { throw Self.classify(error) }
    }

    private func rows(_ query: PostgrestTransformBuilder) async throws -> [JSONValue] {
        try await run { try await query.execute().value }
    }

    private func rpc(_ name: String, _ params: [String: JSONValue]) async throws -> JSONValue {
        try await run { try await client.rpc(name, params: params).execute().value }
    }

    // MARK: Auth

    var currentUser: User? { client.auth.currentUser }

    func signIn(email: String, password: String) async throws {
        _ = try await client.auth.signIn(email: email, password: password)
    }

    /// Sends a 6-digit code that creates the account when verified.
    func sendSignUpCode(email: String, name: String) async throws {
        try await client.auth.signInWithOTP(email: email, shouldCreateUser: true, data: ["full_name": .string(name)])
    }

    /// Sends a 6-digit sign-in code to an existing account.
    func sendSignInCode(email: String) async throws {
        try await client.auth.signInWithOTP(email: email, shouldCreateUser: false)
    }

    func verifyEmailCode(email: String, code: String) async throws {
        _ = try await client.auth.verifyOTP(email: email, token: code, type: .email)
    }

    /// Sends a password-reset code.
    func sendPasswordResetCode(email: String) async throws {
        try await client.auth.resetPasswordForEmail(email)
    }

    func verifyPasswordResetCode(email: String, code: String) async throws {
        _ = try await client.auth.verifyOTP(email: email, token: code, type: .recovery)
    }

    func updateAccount(password: String? = nil, name: String? = nil) async throws {
        var data: [String: AnyJSON]?
        if let name { data = ["full_name": .string(name)] }
        _ = try await client.auth.update(user: UserAttributes(password: password, data: data))
    }

    func signOut() async {
        try? await client.auth.signOut()
    }

    /// A valid access token (refreshed if needed), for the media Worker.
    func accessToken() async throws -> String {
        try await client.auth.session.accessToken
    }

    /// Deletes the signed-in person's account through the `delete-account` function.
    func deleteAccount() async throws -> AccountDeletionResult {
        do {
            let response: JSONValue = try await client.functions.invoke(
                "delete-account", options: FunctionInvokeOptions(method: .post)
            )
            return response["ok"]?.boolValue == true ? .deleted : .failed("Your account couldn't be deleted. Try again.")
        } catch let FunctionsError.httpError(code, data) {
            let body = (try? JSONCoding.decoder.decode(JSONValue.self, from: data)) ?? .null
            if code == 409 { return .blocked(body["message"]?.nonEmptyString ?? "Make someone else an admin first.") }
            return .failed(body["error"]?.nonEmptyString ?? "Your account couldn't be deleted. Try again.")
        } catch {
            throw Self.classify(error)
        }
    }

    // MARK: Profile and companies

    func profile(userId: String) async throws -> JSONValue? {
        try await rows(client.from("employees").select("id,email,full_name,role,is_active").eq("id", value: userId).limit(1)).first
    }

    func memberships(userId: String) async throws -> [CompanyMembership] {
        let result = try await rows(
            client.from("org_members")
                .select("org_id,role,organization:organizations(id,name,trade,status)")
                .eq("user_id", value: userId)
                .eq("is_active", value: true)
                .order("created_at", ascending: true)
        )
        return result.compactMap(CompanyMembership.init(row:))
    }

    func createCompany(name: String, trade: String?) async throws -> JSONValue {
        try await rpc("create_company", ["requested_name": .string(name), "requested_trade": JSONValue(trade)])
    }

    func acceptInvitation(code: String) async throws -> JSONValue {
        try await rpc("accept_invitation", ["code": .string(code)])
    }

    /// Creates an invite code for the person's company (managers only).
    func createInvitation(role: String, email: String?, orgId: String) async throws -> JSONValue {
        try await rpc("create_invitation", [
            "requested_role": .string(role), "requested_email": JSONValue(email), "requested_org_id": .string(orgId),
        ])
    }

    func maintenanceMode() async -> Bool {
        let result = try? await rows(client.from("app_config").select("maintenance_mode").eq("id", value: "default").limit(1))
        return result?.first?["maintenance_mode"]?.boolValue == true
    }

    func registerPushToken(deviceToken: String, appVersion: String) async {
        _ = try? await rpc("register_push_token", [
            "payload": [
                "expo_push_token": .string("apns:\(deviceToken)"),
                "platform": "ios",
                "device_push_token": .string(deviceToken),
                "app_version": .string(appVersion),
            ],
        ])
    }

    // MARK: Jobs

    private func jobFeed() -> PostgrestFilterBuilder {
        client.from("job_feed").select("*").eq("is_feed_visible", value: true)
    }

    /// Every scheduled or active job with coordinates (for the map and suggestions).
    func mappedProjects() async throws -> [Project] {
        var all: [Project] = []
        var from = 0
        while true {
            let page = try await rows(
                jobFeed().in("status", values: ["scheduled", "active"]).order("updated_at", ascending: false).range(from: from, to: from + 999)
            )
            all += page.compactMap(Project.init(jobRow:)).filter { $0.isListable && $0.coordinate != nil }
            if page.count < 1000 { break }
            from += 1000
        }
        return all
    }

    /// One page of active jobs, optionally limited to `ids`.
    func activeProjects(page: Int, pageSize: Int, ids: [String]?) async throws -> [Project] {
        if let ids, ids.isEmpty { return [] }
        var query = jobFeed().in("status", values: ["scheduled", "active"])
        if let ids { query = query.in("id", values: ids) }
        let result = try await rows(query.order("updated_at", ascending: false).range(from: page * pageSize, to: page * pageSize + pageSize - 1))
        return result.compactMap(Project.init(jobRow:)).filter(\.isListable)
    }

    /// The most recently updated active job.
    func latestActiveProject() async throws -> Project? {
        let result = try await rows(jobFeed().in("status", values: ["scheduled", "active"]).order("updated_at", ascending: false).limit(5))
        return result.compactMap(Project.init(jobRow:)).first(where: \.isListable)
    }

    func project(id: String) async throws -> Project? {
        try await rows(jobFeed().eq("id", value: id).limit(1)).first.flatMap(Project.init(jobRow:))
    }

    /// Jobs and unconverted leads matching `text` (name, contact, address, phone).
    func searchProjects(_ text: String, limit: Int = 50) async throws -> [Project] {
        let cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "[,()]", with: " ", options: .regularExpression)
            .replacingOccurrences(of: "%", with: "\\%").replacingOccurrences(of: "_", with: "\\_")
        guard !cleaned.isEmpty else { return [] }
        let match = "%\(cleaned)%"
        let digits = cleaned.filter(\.isNumber)

        var contactFilters = ["name.ilike.\(match)", "email.ilike.\(match)"]
        if digits.count >= 3 { contactFilters.append("phone.ilike.%\(digits)%") }
        let contactIds = try await rows(client.from("contacts").select("id").or(contactFilters.joined(separator: ",")).limit(1000))
            .compactMap { $0["id"]?.nonEmptyString }

        var leadFilters = ["address", "city", "province", "postal_code", "source", "pipeline_stage_raw"].map { "\($0).ilike.\(match)" }
        if !contactIds.isEmpty { leadFilters.append("contact_id.in.(\(contactIds.joined(separator: ",")))") }
        let leadRows = try await rows(
            client.from("leads").select("*,contact:contacts(id,name,email,phone),jobs(id)")
                .or(leadFilters.joined(separator: ",")).order("updated_at", ascending: false).limit(1000)
        )
        let leadJobIds = leadRows.flatMap { $0["jobs"]?.arrayValue ?? [] }.compactMap { $0["id"]?.nonEmptyString }

        var jobFilters = ["name", "formatted_address", "city", "province", "postal_code"].map { "\($0).ilike.\(match)" }
        if !leadJobIds.isEmpty { jobFilters.append("id.in.(\(leadJobIds.joined(separator: ",")))") }
        let jobRows = try await rows(
            jobFeed().neq("status", value: "archived").neq("status", value: "cancelled")
                .or(jobFilters.joined(separator: ",")).order("updated_at", ascending: false).limit(1000)
        )

        let jobs = jobRows.compactMap(Project.init(jobRow:)).filter { !$0.isHiddenTestProject }
        let leads = leadRows.filter { ($0["jobs"]?.arrayValue ?? []).isEmpty }.compactMap(Project.init(leadRow:))
            .filter { !$0.isHiddenTestProject }
        return (jobs + leads)
            .sorted { ($0.updatedAt ?? $0.createdAt ?? .distantPast) > ($1.updatedAt ?? $1.createdAt ?? .distantPast) }
            .prefix(limit).map { $0 }
    }

    func budgets(jobIds: [String]) async throws -> [String: BudgetProgress] {
        var result: [String: BudgetProgress] = [:]
        for chunk in stride(from: 0, to: jobIds.count, by: 100).map({ Array(jobIds[$0..<min($0 + 100, jobIds.count)]) }) {
            let page = try await rows(
                client.from("job_feed").select("id,status,budget_minutes,used_minutes,budget_percent_used,budget_status,updated_at")
                    .in("id", values: chunk)
            )
            for row in page { if let progress = BudgetProgress(jobFeedRow: row) { result[progress.jobId] = progress } }
        }
        return result
    }

    func assignedJobIds(userId: String) async throws -> [String] {
        try await rows(client.from("job_assignments").select("job_id").eq("employee_id", value: userId).eq("status", value: "active"))
            .compactMap { $0["job_id"]?.nonEmptyString }
    }

    // MARK: Time entries

    func recordTimeEntryCommand(action: String, command: JSONValue, nextCommand: JSONValue?) async throws -> JSONValue {
        try await rpc("record_time_entry_command", ["action": .string(action), "command": command, "next_command": nextCommand ?? .null])
    }

    func fetchOwnTimeEntries(userId: String, since: Date?, limit: Int) async throws -> [JSONValue] {
        var query = client.from("time_entries").select("*").eq("employee_id", value: userId)
        if let since { query = query.gte("started_at", value: ISODate.string(since)) }
        return try await rows(query.order("started_at", ascending: false).limit(limit))
    }

    /// Everyone's entries on one job (company members can read them).
    func jobTimeEntries(jobId: String) async throws -> [TimeEntry] {
        let result = try await rows(
            client.from("time_entries").select("*").eq("job_id", value: jobId).neq("status", value: "deleted")
                .order("started_at", ascending: false).limit(1000)
        )
        return result.compactMap { TimeEntry(serverRow: $0) }
    }

    func recordLocationUpdate(point: JSONValue, tracking: JSONValue?) async throws {
        _ = try await rpc("record_location_update", ["point": point, "tracking": tracking ?? .null])
    }

    func ensureLeadClockInJob(leadId: String) async throws -> JSONValue {
        try await rpc("ensure_lead_clock_in_job", ["requested_lead_id": .string(leadId)])
    }

    // MARK: Tasks

    func labourPlan(jobId: String) async throws -> LabourPlan {
        async let tasks = rows(client.from("job_tasks").select("*").eq("job_id", value: jobId).order("sort_order", ascending: true))
        async let budget = rows(
            client.from("job_budgets").select("id,job_id,instructions,budget_minutes,version,status")
                .eq("job_id", value: jobId).in("status", values: ["active", "closed"])
                .order("version", ascending: false).limit(1)
        )
        return LabourPlan(taskRows: try await tasks, budgetRow: try await budget.first, fetchedAt: Date())
    }

    func setTaskStatus(taskId: String, completed: Bool) async throws {
        _ = try await rpc("set_job_task_status", [
            "requested_task_id": .string(taskId), "requested_status": .string(completed ? "completed" : "pending"),
        ])
    }

    /// Calls `onChange` whenever a task on the job changes.
    func watchTasks(jobId: String, onChange: @escaping @Sendable () -> Void) async -> RealtimeChannelV2 {
        let channel = client.realtimeV2.channel("project-labour-task-state:\(jobId):watch-\(UUID().uuidString.prefix(8))")
        let changes = channel.postgresChange(AnyAction.self, schema: "public", table: "job_tasks", filter: .eq("job_id", value: jobId))
        Task {
            for await _ in changes { onChange() }
        }
        try? await channel.subscribeWithError()
        return channel
    }

    func stopWatching(_ channel: RealtimeChannelV2) async {
        await client.realtimeV2.removeChannel(channel)
    }

    // MARK: Media

    func media(projectId: String, kind: ProjectKind, linkedLeadId: String?) async throws -> [MediaItem] {
        var query = client.from("job_media").select("*")
        switch (kind, linkedLeadId) {
        case (.lead, _): query = query.eq("lead_id", value: projectId)
        case (.job, let lead?): query = query.or("job_id.eq.\(projectId),lead_id.eq.\(lead)")
        case (.job, nil): query = query.eq("job_id", value: projectId)
        }
        var items = try await rows(
            query.order("captured_at", ascending: false, nullsFirst: false).order("created_at", ascending: false)
        ).compactMap(MediaItem.init(row:))
        let uploaderIds = Array(Set(items.compactMap(\.uploadedBy)))
        if !uploaderIds.isEmpty,
           let people = try? await rows(client.from("employees").select("id,email,full_name").in("id", values: uploaderIds)) {
            var names: [String: String] = [:]
            for person in people {
                guard let id = person["id"]?.nonEmptyString else { continue }
                names[id] = person["full_name"]?.nonEmptyString ?? person["email"]?.nonEmptyString?.split(separator: "@").first.map(String.init)
            }
            for index in items.indices { items[index].uploaderName = items[index].uploadedBy.flatMap { names[$0] } }
        }
        return items
    }

    // MARK: Team map

    func trackingStatuses() async throws -> [TeamMemberStatus] {
        try await rows(client.from("employee_tracking_status").select("*").order("last_location_at", ascending: false, nullsFirst: false))
            .compactMap(TeamMemberStatus.init(row:))
    }

    /// Location points recorded between `start` and `end`, oldest first.
    func locationPoints(employeeId: String?, from start: Date, to end: Date, ascending: Bool = true, limit: Int = 2000) async throws -> [TeamLocationPoint] {
        var query = client.from("employee_location_points")
            .select("id,client_event_id,employee_id,latitude,longitude,accuracy_meters,event_type,is_on_site,job_id,captured_at")
            .gte("captured_at", value: ISODate.string(start)).lt("captured_at", value: ISODate.string(end))
        if let employeeId { query = query.eq("employee_id", value: employeeId) }
        return try await rows(query.order("captured_at", ascending: ascending).limit(limit)).compactMap(TeamLocationPoint.init(row:))
    }
}

enum AccountDeletionResult: Equatable {
    case deleted
    case blocked(String)
    case failed(String)
}
