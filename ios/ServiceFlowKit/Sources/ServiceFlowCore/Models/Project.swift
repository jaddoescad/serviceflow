import Foundation

/// A job (`job_feed` row) or an unconverted lead that the crew can see.
public struct Project: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var status: String?
    public var formattedAddress: String?
    public var addressLine1: String?
    public var addressLine2: String?
    public var city: String?
    public var province: String?
    public var postalCode: String?
    public var latitude: Double?
    public var longitude: Double?
    public var updatedAt: Date?
    public var createdAt: Date?
    public var isLead: Bool
    /// Pipeline stage shown on lead badges (`proposal_sent`).
    public var leadStage: String?
    /// For a job, the lead it was converted from (its photos belong to the job too).
    public var linkedLeadId: String?
    public var contactName: String?
    public var budget: BudgetProgress?

    public init(
        id: String, name: String, status: String? = nil, formattedAddress: String? = nil,
        addressLine1: String? = nil, addressLine2: String? = nil, city: String? = nil,
        province: String? = nil, postalCode: String? = nil, latitude: Double? = nil,
        longitude: Double? = nil, updatedAt: Date? = nil, createdAt: Date? = nil,
        isLead: Bool = false, leadStage: String? = nil, linkedLeadId: String? = nil,
        contactName: String? = nil, budget: BudgetProgress? = nil
    ) {
        self.id = id
        self.name = name
        self.status = status
        self.formattedAddress = formattedAddress
        self.addressLine1 = addressLine1
        self.addressLine2 = addressLine2
        self.city = city
        self.province = province
        self.postalCode = postalCode
        self.updatedAt = updatedAt
        self.createdAt = createdAt
        self.isLead = isLead
        self.leadStage = leadStage
        self.linkedLeadId = linkedLeadId
        self.contactName = contactName
        self.budget = budget
        (self.latitude, self.longitude) = Project.validCoordinate(latitude, longitude)
    }

    public var isArchived: Bool { status == "archived" }
    public var isCancelled: Bool { status == "cancelled" }
    public var kind: ProjectKind { isLead ? .lead : .job }

    public var coordinate: Coordinate? {
        guard let latitude, let longitude else { return nil }
        return Coordinate(latitude: latitude, longitude: longitude)
    }

    /// Full address: the formatted address, else the address parts joined.
    public var fullAddress: String? {
        if let formatted = formattedAddress.nonBlank { return formatted }
        let parts = [addressLine1, addressLine2, city, province, postalCode].compactMap(\.nonBlank)
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }

    /// The address line shown on cards: the formatted address, else
    /// "City, Province, Postal code".
    public var cardAddress: String? {
        if let formatted = formattedAddress.nonBlank { return formatted }
        let parts = [city, province, postalCode].compactMap(\.nonBlank)
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }

    /// Latitude must be in [-90, 90] and longitude in [-180, 180]; exactly
    /// (0, 0) means "never geocoded".
    static func validCoordinate(_ latitude: Double?, _ longitude: Double?) -> (Double?, Double?) {
        guard let latitude, let longitude, latitude.isFinite, longitude.isFinite,
              (-90...90).contains(latitude), (-180...180).contains(longitude),
              !(latitude == 0 && longitude == 0) else { return (nil, nil) }
        return (latitude, longitude)
    }

    /// Test and placeholder jobs that must never show in the app.
    public var isHiddenTestProject: Bool {
        name.range(of: "qa web smoke|do not use", options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// Stage shown on the lead badge: `proposal_sent` → `Proposal Sent`.
    public var leadStageLabel: String {
        let raw = leadStage.nonBlank ?? status.nonBlank ?? "new"
        return raw
            .replacingOccurrences(of: "[_-]+", with: " ", options: .regularExpression)
            .split(separator: " ")
            .map { $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined(separator: " ")
    }
}

public enum ProjectKind: String, Codable, Sendable {
    case job
    case lead

    /// Path segment used by the media worker (`/v1/jobs/…`, `/v1/leads/…`).
    public var mediaPathSegment: String { self == .job ? "jobs" : "leads" }
}

public struct Coordinate: Codable, Hashable, Sendable {
    public var latitude: Double
    public var longitude: Double

    public init(latitude: Double, longitude: Double) {
        self.latitude = latitude
        self.longitude = longitude
    }
}

// MARK: - Decoding server rows

public extension Project {
    /// A `job_feed` view row, or a `jobs` row returned by `ensure_lead_clock_in_job`.
    init?(jobRow row: JSONValue) {
        guard let id = row["id"]?.nonEmptyString else { return nil }
        self.init(
            id: id,
            name: row["name"]?.nonEmptyString ?? "Project",
            status: row["status"]?.nonEmptyString,
            formattedAddress: row["formatted_address"]?.nonEmptyString,
            addressLine1: row["address_line_1"]?.nonEmptyString,
            addressLine2: row["address_line_2"]?.nonEmptyString,
            city: row["city"]?.nonEmptyString,
            province: row["province"]?.nonEmptyString,
            postalCode: row["postal_code"]?.nonEmptyString,
            latitude: row["latitude"]?.doubleValue,
            longitude: row["longitude"]?.doubleValue,
            updatedAt: row["updated_at"]?.dateValue,
            createdAt: row["created_at"]?.dateValue,
            isLead: false,
            linkedLeadId: row["lead_id"]?.nonEmptyString,
            budget: BudgetProgress(jobFeedRow: row, includeBudgetHours: true)
        )
    }

    /// A `leads` row selected with `contact:contacts(id,name,email,phone)`.
    init?(leadRow row: JSONValue) {
        guard let id = row["id"]?.nonEmptyString else { return nil }
        let contactName = row["contact"]?["name"]?.nonEmptyString
        let parts = ["address_line_1", "city", "province", "postal_code"].compactMap { row[$0]?.nonEmptyString }
        self.init(
            id: id,
            name: contactName ?? row["name"]?.nonEmptyString ?? "Unnamed lead",
            status: row["status"]?.nonEmptyString,
            formattedAddress: row["address"]?.nonEmptyString ?? (parts.isEmpty ? nil : parts.joined(separator: ", ")),
            addressLine1: row["address_line_1"]?.nonEmptyString,
            city: row["city"]?.nonEmptyString,
            province: row["province"]?.nonEmptyString,
            postalCode: row["postal_code"]?.nonEmptyString,
            latitude: row["latitude"]?.doubleValue,
            longitude: row["longitude"]?.doubleValue,
            updatedAt: row["updated_at"]?.dateValue,
            createdAt: row["created_at"]?.dateValue,
            isLead: true,
            leadStage: row["pipeline_stage_raw"]?.nonEmptyString ?? row["status"]?.nonEmptyString ?? "new",
            contactName: contactName
        )
    }

    /// Jobs shown in lists: not cancelled, not archived, not test jobs.
    var isListable: Bool { !isCancelled && !isArchived && !isHiddenTestProject }
}

extension Optional where Wrapped == String {
    /// The trimmed value, or nil when missing or blank.
    var nonBlank: String? {
        guard let value = self?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        return value
    }
}

extension String {
    var nonBlank: String? { Optional(self).nonBlank }
}
