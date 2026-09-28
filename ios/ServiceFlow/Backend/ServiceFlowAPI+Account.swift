import Foundation
import ServiceFlowCore
import Supabase

/// Sign-in, sign-up, companies and app configuration.
extension ServiceFlowAPI {
    // MARK: Auth

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
        let data: [String: AnyJSON]? = name.map { ["full_name": .string($0)] }
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
        let fallback = "Your account couldn't be deleted. Try again."
        do {
            let response: JSONValue = try await client.functions.invoke(
                "delete-account", options: FunctionInvokeOptions(method: .post)
            )
            return response["ok"]?.boolValue == true ? .deleted : .failed(fallback)
        } catch let FunctionsError.httpError(code, data) {
            let body = (try? JSONCoding.decoder.decode(JSONValue.self, from: data)) ?? .null
            if code == 409 { return .blocked(body["message"]?.nonEmptyString ?? "Make someone else an admin first.") }
            return .failed(body["error"]?.nonEmptyString ?? fallback)
        } catch {
            throw Self.classify(error)
        }
    }

    // MARK: Profile and companies

    func profile(userId: String) async throws -> JSONValue? {
        try await rows(client.from("employees").select("id,email,full_name,role,is_active").eq("id", value: userId).limit(1)).first
    }

    func memberships(userId: String) async throws -> [CompanyMembership] {
        try await rows(
            client.from("org_members")
                .select("org_id,role,organization:organizations(id,name,trade,status)")
                .eq("user_id", value: userId)
                .eq("is_active", value: true)
                .order("created_at", ascending: true)
        ).compactMap(CompanyMembership.init(row:))
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

    // MARK: App

    func maintenanceMode() async -> Bool {
        let result = try? await rows(client.from("app_config").select("maintenance_mode").eq("id", value: "default").limit(1))
        return result?.first?["maintenance_mode"]?.boolValue == true
    }

    /// Native installs have no Expo token; the APNs token, prefixed, keeps the
    /// server's upsert key (`expo_push_token`) stable per device.
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
}
