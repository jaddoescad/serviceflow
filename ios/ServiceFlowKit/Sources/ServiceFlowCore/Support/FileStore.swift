import Foundation

/// A Codable value persisted as one JSON file, written atomically.
/// Reads are synchronous so state can be restored before the first frame.
public final class JSONFileStore<Value: Codable>: @unchecked Sendable {
    public let url: URL
    private let lock = NSLock()

    public init(url: URL) {
        self.url = url
    }

    public func load() -> Value? {
        lock.lock(); defer { lock.unlock() }
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONCoding.decoder.decode(Value.self, from: data)
    }

    public func save(_ value: Value) {
        lock.lock(); defer { lock.unlock() }
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            let data = try JSONCoding.encoder.encode(value)
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            #if DEBUG
            print("JSONFileStore: could not write \(url.lastPathComponent): \(error)")
            #endif
        }
    }

    public func delete() {
        lock.lock(); defer { lock.unlock() }
        try? FileManager.default.removeItem(at: url)
    }
}

/// Where each signed-in person's data lives. Everything a user records is kept
/// under their own directory, so a different account on the same device never
/// sees or inherits it.
public struct UserStorage: Sendable {
    public let userId: String
    public let directory: URL

    public init(userId: String, root: URL) {
        self.userId = userId
        let safe = userId.replacingOccurrences(of: "[^A-Za-z0-9-]", with: "_", options: .regularExpression)
        directory = root.appendingPathComponent("users", isDirectory: true).appendingPathComponent(safe, isDirectory: true)
    }

    public static func defaultRoot() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("ServiceFlow", isDirectory: true)
    }

    public func store<Value: Codable>(_ name: String, as type: Value.Type = Value.self) -> JSONFileStore<Value> {
        JSONFileStore(url: directory.appendingPathComponent("\(name).json"))
    }

    /// Directory for captured photos and videos waiting to upload.
    public var mediaDirectory: URL { directory.appendingPathComponent("media", isDirectory: true) }

    public func removeAll() {
        try? FileManager.default.removeItem(at: directory)
    }
}
