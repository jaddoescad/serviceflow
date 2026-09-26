import Foundation

/// A row for `employee_location_points`, sent through `record_location_update`.
public struct LocationRow: Codable, Hashable, Sendable {
    public var clientEventId: String
    public var clientEntryId: String
    public var jobId: String?
    public var latitude: Double
    public var longitude: Double
    public var accuracyMeters: Double?
    public var speedMps: Double?
    public var headingDegrees: Double?
    public var isMocked: Bool?
    public var trackingMode: TrackingMode
    public var eventType: LocationEventType
    public var distanceFromJobMeters: Int?
    public var isOnSite: Bool?
    public var capturedAt: Date

    public init(entry: TimeEntry, point: LocationPoint, mode: TrackingMode, event: LocationEventType, status: LocationStatus?) {
        clientEventId = [
            entry.localId, ISODate.string(point.capturedAt),
            String(format: "%.5f", point.latitude), String(format: "%.5f", point.longitude), event.rawValue,
        ].joined(separator: ":")
        clientEntryId = entry.localId
        jobId = TimeEntryCommand.isUUID(entry.project.id) ? entry.project.id : nil
        latitude = point.latitude
        longitude = point.longitude
        accuracyMeters = point.accuracy
        speedMps = point.speed
        headingDegrees = point.heading
        isMocked = point.mocked
        trackingMode = mode
        eventType = event
        distanceFromJobMeters = status?.activeDistance.map { Int($0.rounded()) }
        isOnSite = status?.onSite
        capturedAt = point.capturedAt
    }

    /// The RPC `point` argument. `time_entry_id` is only sent once the entry
    /// exists on the server (entry row ids equal their client ids).
    public func payload(timeEntryId: String?) -> JSONValue {
        [
            "client_event_id": .string(clientEventId),
            "time_entry_id": JSONValue(timeEntryId),
            "client_entry_id": .string(clientEntryId),
            "job_id": JSONValue(jobId),
            "latitude": .number(latitude),
            "longitude": .number(longitude),
            "accuracy_meters": JSONValue(accuracyMeters),
            "speed_mps": JSONValue(speedMps),
            "heading_degrees": JSONValue(headingDegrees),
            "is_mocked": JSONValue(isMocked),
            "tracking_mode": .string(trackingMode.rawValue),
            "event_type": .string(eventType.rawValue),
            "distance_from_job_meters": JSONValue(distanceFromJobMeters),
            "is_on_site": JSONValue(isOnSite),
            "captured_at": JSONValue(capturedAt),
        ]
    }
}

/// The latest tracking state shown to managers (`employee_tracking_status`).
public struct TrackingStatusUpdate: Codable, Hashable, Sendable {
    public enum TaskStatus: String, Codable, Sendable { case running, paused, stopped, error }

    public var clientEntryId: String?
    public var jobId: String?
    public var point: LocationPoint?
    public var mode: TrackingMode
    public var taskStatus: TaskStatus
    public var permissionForeground: Bool?
    public var appVersion: String
    public var lastErrorCode: String?
    public var onSite: Bool?
    public var distanceMeters: Int?
    public var reason: String?
    public var updatedAt: Date

    public init(clientEntryId: String?, jobId: String?, point: LocationPoint?, mode: TrackingMode,
                taskStatus: TaskStatus, permissionForeground: Bool?, appVersion: String,
                lastErrorCode: String? = nil, onSite: Bool? = nil, distanceMeters: Int? = nil,
                reason: String? = nil, updatedAt: Date) {
        self.clientEntryId = clientEntryId
        self.jobId = jobId
        self.point = point
        self.mode = mode
        self.taskStatus = taskStatus
        self.permissionForeground = permissionForeground
        self.appVersion = appVersion
        self.lastErrorCode = lastErrorCode
        self.onSite = onSite
        self.distanceMeters = distanceMeters
        self.reason = reason
        self.updatedAt = updatedAt
    }

    /// The RPC `tracking` argument. `background_tracking: false` in the
    /// metadata tells the stale-location alert that this device only records
    /// location while the app is open.
    public func payload(timeEntryId: String?, now: Date) -> JSONValue {
        [
            "time_entry_id": JSONValue(timeEntryId),
            "client_entry_id": JSONValue(clientEntryId),
            "job_id": JSONValue(jobId),
            "latitude": JSONValue(point?.latitude),
            "longitude": JSONValue(point?.longitude),
            "accuracy_meters": JSONValue(point?.accuracy),
            "last_location_at": JSONValue(point?.capturedAt),
            "last_sync_at": JSONValue(now),
            "tracking_mode": .string(mode.rawValue),
            "task_status": .string(taskStatus.rawValue),
            "permission_foreground": JSONValue(permissionForeground),
            "permission_background": false,
            "platform": "ios",
            "app_version": .string(appVersion),
            "last_error_code": JSONValue(lastErrorCode),
            "metadata": [
                "on_site": JSONValue(onSite),
                "distance_from_project_meters": JSONValue(distanceMeters),
                "reason": JSONValue(reason),
                "background_tracking": false,
                "client": "ios-native",
            ],
        ]
    }

    /// A point to carry the status when no fix is queued with it.
    func carrierPoint() -> JSONValue? {
        guard let point else { return nil }
        let stamp = ISODate.string(point.capturedAt)
        return [
            "client_event_id": .string("tracking-status-\(clientEntryId ?? "none")-\(stamp)"),
            "time_entry_id": .null,
            "client_entry_id": .string(clientEntryId ?? "tracking-status"),
            "job_id": JSONValue(jobId),
            "latitude": .number(point.latitude),
            "longitude": .number(point.longitude),
            "accuracy_meters": JSONValue(point.accuracy),
            "tracking_mode": .string(mode.rawValue),
            "event_type": .string(LocationEventType.trackingStatus.rawValue),
            "captured_at": .string(stamp),
        ]
    }
}

struct LocationQueueState: Codable {
    var rows: [LocationRow] = []
    var status: TrackingStatusUpdate?
}

/// Location points and the latest tracking status waiting to upload.
public actor LocationQueue {
    public static let capacity = 2000

    private let store: JSONFileStore<LocationQueueState>
    private var state: LocationQueueState
    private var syncing = false

    public init(storeURL: URL) {
        store = JSONFileStore(url: storeURL)
        state = store.load() ?? LocationQueueState()
    }

    public var pendingRows: [LocationRow] { state.rows }
    public var pendingStatus: TrackingStatusUpdate? { state.status }

    public func enqueue(_ row: LocationRow) {
        state.rows.removeAll { $0.clientEventId == row.clientEventId }
        state.rows.append(row)
        if state.rows.count > Self.capacity { state.rows.removeFirst(state.rows.count - Self.capacity) }
        store.save(state)
    }

    public func setStatus(_ status: TrackingStatusUpdate) {
        state.status = status
        store.save(state)
    }

    /// Uploads queued points in order, the status riding on the last one sent.
    /// Points of entries the server doesn't have yet wait for the next sync.
    public func sync(
        heldBack: Set<String>, now: Date,
        send: @Sendable (_ point: JSONValue, _ tracking: JSONValue?) async throws -> Void
    ) async {
        guard !syncing else { return }
        syncing = true
        defer { syncing = false }

        let status = state.status
        let statusHeld = status?.clientEntryId.map { heldBack.contains($0) } ?? false
        let ready = state.rows.filter { !heldBack.contains($0.clientEntryId) }
        let timeEntryId: (String?) -> String? = { id in
            guard let id, TimeEntryCommand.isUUID(id), !heldBack.contains(id) else { return nil }
            return id.lowercased()
        }
        var statusSent = false

        for (index, row) in ready.enumerated() {
            let isLast = index == ready.count - 1
            let tracking = isLast && !statusHeld ? status?.payload(timeEntryId: timeEntryId(status?.clientEntryId), now: now) : nil
            do {
                try await send(row.payload(timeEntryId: timeEntryId(row.clientEntryId)), tracking)
                state.rows.removeAll { $0.clientEventId == row.clientEventId }
                if tracking != nil { statusSent = true }
                store.save(state)
            } catch {
                if case .offline = BackendError.from(error) { return }
                // A point the server refuses for good is dropped, not retried forever.
                if !BackendError.from(error).isRetryable {
                    state.rows.removeAll { $0.clientEventId == row.clientEventId }
                    store.save(state)
                }
            }
        }

        if ready.isEmpty, !statusHeld, let status, let carrier = status.carrierPoint() {
            do {
                try await send(carrier, status.payload(timeEntryId: timeEntryId(status.clientEntryId), now: now))
                statusSent = true
            } catch {}
        }

        if statusSent, state.status == status {
            state.status = nil
            store.save(state)
        }
    }

    public func removeAll() {
        state = LocationQueueState()
        store.save(state)
    }
}
