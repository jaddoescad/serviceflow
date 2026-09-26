import Foundation

/// ISO-8601 timestamps as the server and the RN app write them
/// (`2026-09-26T14:05:09.123Z`). Parsing also accepts Postgres output such as
/// `2026-09-26T14:05:09.123456+00:00` and values without fractional seconds.
public enum ISODate {
    private static let withFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let withoutFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    private static let lock = NSLock()

    public static func string(_ date: Date) -> String {
        lock.lock(); defer { lock.unlock() }
        return withFraction.string(from: date)
    }

    public static func parse(_ value: String?) -> Date? {
        guard var text = value?.trimmingCharacters(in: .whitespaces), !text.isEmpty else { return nil }
        if text.contains(" "), !text.contains("T") { text = text.replacingOccurrences(of: " ", with: "T") }
        text = trimFraction(text)
        lock.lock(); defer { lock.unlock() }
        return withFraction.date(from: text) ?? withoutFraction.date(from: text)
    }

    /// ISO8601DateFormatter only understands up to three fractional digits.
    private static func trimFraction(_ text: String) -> String {
        guard let dot = text.firstIndex(of: ".") else { return text }
        let afterDot = text.index(after: dot)
        let digitsEnd = text[afterDot...].firstIndex(where: { !$0.isNumber }) ?? text.endIndex
        let digits = text[afterDot..<digitsEnd]
        guard digits.count > 3 else { return text }
        return String(text[..<afterDot]) + digits.prefix(3) + String(text[digitsEnd...])
    }
}

extension JSONCoding {
    static func configure(_ encoder: JSONEncoder) {
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(ISODate.string(date))
        }
    }

    static func configure(_ decoder: JSONDecoder) {
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            if let text = try? container.decode(String.self), let date = ISODate.parse(text) { return date }
            if let millis = try? container.decode(Double.self) { return Date(timeIntervalSince1970: millis / 1000) }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid date")
        }
    }
}

public extension JSONValue {
    var dateValue: Date? {
        switch self {
        case .string(let text): return ISODate.parse(text)
        case .number(let millis): return Date(timeIntervalSince1970: millis / 1000)
        default: return nil
        }
    }

    init(_ date: Date?) { self = date.map { .string(ISODate.string($0)) } ?? .null }
}
