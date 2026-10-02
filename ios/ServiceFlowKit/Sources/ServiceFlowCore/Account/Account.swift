import Foundation

/// A company the person belongs to (`org_members` joined to `organizations`).
public struct CompanyMembership: Codable, Hashable, Identifiable, Sendable {
    public enum Role: String, Codable, Sendable { case owner, admin, manager, crew }

    public var id: String { orgId }
    public var orgId: String
    public var name: String
    public var role: Role
    public var trade: String?

    public init(orgId: String, name: String, role: Role, trade: String? = nil) {
        self.orgId = orgId
        self.name = name
        self.role = role
        self.trade = trade
    }

    /// Owners, admins and managers run the company: team time.
    public var isManager: Bool { role != .crew }

    public init?(row: JSONValue) {
        guard let orgId = row["org_id"]?.nonEmptyString else { return nil }
        let organization = row["organization"] ?? row["organizations"]
        guard organization?["status"]?.stringValue.map({ $0 == "active" }) ?? true else { return nil }
        self.init(
            orgId: orgId,
            name: organization?["name"]?.nonEmptyString ?? "Company",
            role: Role(rawValue: row["role"]?.stringValue ?? "") ?? .crew,
            trade: organization?["trade"]?.nonEmptyString
        )
    }
}

public enum AccountValidation {
    public static func email(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "Enter your email address." }
        let pattern = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$"
        return trimmed.range(of: pattern, options: .regularExpression) == nil ? "Enter a valid email address." : nil
    }

    public static func password(_ value: String) -> String? {
        value.count < 8 ? "Use at least 8 characters." : nil
    }

    public static func name(_ value: String) -> String? {
        value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Enter your name." : nil
    }

    public static func companyName(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.count < 2 { return "Enter your company's name." }
        if trimmed.count > 80 { return "Use 80 characters or fewer." }
        return nil
    }

    /// Six-digit email code.
    public static func verificationCode(_ value: String) -> String {
        String(value.filter(\.isNumber).prefix(6))
    }
}

public enum DisplayName {
    /// Profile name, then auth metadata, then the email's local part.
    public static func resolve(profileName: String?, metadataName: String?, email: String?) -> String {
        if let name = profileName.nonBlank { return name }
        if let name = metadataName.nonBlank { return name }
        if let local = email?.split(separator: "@").first, !local.isEmpty { return String(local) }
        return "Crew member"
    }
}
