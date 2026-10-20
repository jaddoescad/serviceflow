import Foundation
@testable import ServiceFlowCore

// Behavioural checks for ServiceFlowCore. Run with `swift run ServiceFlowCoreChecks`.

var failures = 0
var passed = 0

func expect(_ condition: @autoclosure () -> Bool, _ message: String, file: StaticString = #fileID, line: UInt = #line) {
    if condition() {
        passed += 1
    } else {
        failures += 1
        print("  ✗ \(message) (\(file):\(line))")
    }
}

func expectEqual<T: Equatable>(_ actual: T, _ expected: T, _ message: String, file: StaticString = #fileID, line: UInt = #line) {
    expect(actual == expected, "\(message): expected \(expected), got \(actual)", file: file, line: line)
}

@MainActor
func check(_ name: String, _ body: () async throws -> Void) async {
    print("• \(name)")
    do { try await body() } catch {
        failures += 1
        print("  ✗ threw \(error)")
    }
}

/// Lets detached follow-up work (background flushes) finish.
func settle() async {
    for _ in 0..<20 { await Task.yield() }
    try? await Task.sleep(nanoseconds: 30_000_000)
}

let userId = "11111111-1111-4111-8111-111111111111"
let jobA = Project(id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Maple House", latitude: 45.4215, longitude: -75.6972)
let jobB = Project(id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Elm Street", latitude: 45.4300, longitude: -75.7000)
let start = ISODate.parse("2026-09-21T13:00:00.000Z")!

@MainActor
func makeTracker(server: FakeServer, location: FakeLocation = FakeLocation(), clock: TestClock,
                 root: URL = FileManager.default.temporaryDirectory.appendingPathComponent("sf-checks-\(UUID().uuidString)"),
                 user: String = userId) -> (TimeTracker, FakeReminders) {
    let reminders = FakeReminders()
    let tracker = TimeTracker(
        user: CrewMember(id: user, email: "pat@example.com", name: "Pat Painter"),
        storage: UserStorage(userId: user, root: root), backend: server, location: location,
        reminders: reminders, appVersion: "2.0.0", now: { clock.date }
    )
    tracker.projects = [jobA, jobB]
    return (tracker, reminders)
}

@MainActor
func runChecks() async {
    await check("Offline clock-in and clock-out both reach the server, in order") {
        let server = FakeServer(employeeId: userId)
        await server.setOnline(false)
        let clock = TestClock(start)
        let (tracker, _) = makeTracker(server: server, clock: clock)
        let shift = try await tracker.clockIn(jobA)
        clock.advance(minutes: 90)
        let entry = await tracker.clockOut()
        await settle()
        expectEqual(await tracker.pendingCommandCount(), 2, "both commands queued")
        await server.setOnline(true)
        await tracker.refresh()
        let rows = await server.allRows()
        expectEqual(rows.count, 1, "one server row")
        expectEqual(rows.first?["status"]?.stringValue, "completed", "server row completed")
        expectEqual(rows.first?["id"]?.stringValue, shift.localId, "row id equals the client id")
        expectEqual(await tracker.pendingCommandCount(), 0, "queue drained")
        expectEqual(tracker.entries.first?.serverId, shift.localId, "entry acknowledged")
        expect(entry?.duration(at: clock.date) == 90 * 60, "duration is 90 minutes")
    }

    await check("An offline switch after an offline clock-in keeps both shifts") {
        let server = FakeServer(employeeId: userId)
        await server.setOnline(false)
        let clock = TestClock(start)
        let (tracker, _) = makeTracker(server: server, clock: clock)
        try await tracker.clockIn(jobA)
        clock.advance(minutes: 30)
        let next = try await tracker.switchProject(to: jobB)
        clock.advance(minutes: 30)
        await tracker.clockOut()
        await settle()
        await server.setOnline(true)
        await tracker.refresh()
        let rows = await server.allRows()
        expectEqual(rows.count, 2, "two server rows")
        expect(rows.allSatisfy { $0["status"]?.stringValue == "completed" }, "both completed")
        expectEqual(await server.callLog(), ["clock_in", "switch", "clock_out"], "commands sent in order")
        expectEqual(tracker.entries.count, 2, "two local entries")
        expectEqual(tracker.entries.first?.localId, next?.localId, "newest first")
    }

    await check("Deleting an entry that never reached the server sends nothing") {
        let server = FakeServer(employeeId: userId)
        await server.setOnline(false)
        let clock = TestClock(start)
        let (tracker, _) = makeTracker(server: server, clock: clock)
        try await tracker.clockIn(jobA)
        clock.advance(minutes: 10)
        let entry = await tracker.clockOut()!
        await tracker.deleteEntry(entry)
        await settle()
        expectEqual(await tracker.pendingCommandCount(), 0, "nothing queued")
        expect(tracker.entries.isEmpty, "entry removed locally")
    }

    await check("Clock-in works without location and never asks twice") {
        let server = FakeServer(employeeId: userId)
        let location = FakeLocation(authorization: .notDetermined, answer: .denied)
        let clock = TestClock(start)
        let (tracker, _) = makeTracker(server: server, location: location, clock: clock)
        try await tracker.clockIn(jobA)
        await settle()
        expect(tracker.activeShift != nil, "shift started")
        expectEqual(location.requests, 1, "asked once")
        expectEqual(location.fixes, 0, "no fix requested when denied")
        expect(tracker.notice == nil, "no permission nag")
        await tracker.clockOut()
        try await tracker.clockIn(jobB)
        expectEqual(location.requests, 1, "not asked again")
    }

    await check("A new device adopts the server's active shift") {
        let server = FakeServer(employeeId: userId)
        await server.seed([
            "id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "client_entry_id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            "employee_id": .string(userId), "job_id": .string(jobA.id), "job_name": "Maple House",
            "started_at": .string(ISODate.string(start)), "ended_at": .null, "status": "active",
        ])
        let clock = TestClock(start.addingTimeInterval(3600))
        let (tracker, reminders) = makeTracker(server: server, clock: clock)
        await tracker.refresh()
        expectEqual(tracker.activeShift?.localId, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "active shift adopted")
        expectEqual(tracker.activeShift?.project.latitude, jobA.latitude, "project coordinates filled in")
        expectEqual(reminders.scheduled.count, 1, "reminders scheduled")
    }

    await check("A shift clocked out by a manager ends on the device") {
        let server = FakeServer(employeeId: userId)
        let clock = TestClock(start)
        let (tracker, _) = makeTracker(server: server, clock: clock)
        let shift = try await tracker.clockIn(jobA)
        await settle()
        await tracker.flushCommands()
        _ = try await server.recordTimeEntryCommand(action: "clock_out", command: [
            "client_entry_id": .string(shift.localId), "ended_at": .string(ISODate.string(start.addingTimeInterval(1800))),
        ], nextCommand: nil)
        await tracker.refresh()
        expect(tracker.activeShift == nil, "local shift cleared")
        expectEqual(tracker.entries.first?.localId, shift.localId, "completed entry in history")
        expectEqual(await server.callLog().filter { $0 == "clock_out" }.count, 1, "no second clock-out sent")
    }

    await check("A shift already running elsewhere replaces the local one") {
        let server = FakeServer(employeeId: userId)
        await server.seed([
            "id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "client_entry_id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            "employee_id": .string(userId), "job_id": .string(jobB.id), "job_name": "Elm Street",
            "started_at": .string(ISODate.string(start)), "ended_at": .null, "status": "active",
        ])
        let clock = TestClock(start.addingTimeInterval(600))
        let (tracker, _) = makeTracker(server: server, clock: clock)
        try await tracker.clockIn(jobA)
        await settle()
        await tracker.refresh()
        expectEqual(tracker.activeShift?.localId, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "server shift adopted")
        expectEqual(await tracker.pendingCommandCount(), 0, "failed clock-in not retried forever")
    }

    await check("A locally closed shift is not revived by a stale read") {
        let server = FakeServer(employeeId: userId)
        let clock = TestClock(start)
        let (tracker, _) = makeTracker(server: server, clock: clock)
        let shift = try await tracker.clockIn(jobA)
        await settle()
        await server.setOnline(false)
        await tracker.clockOut()
        await settle()
        await tracker.reconcile(await server.allRows()) // server still says active
        expect(tracker.activeShift == nil, "stays clocked out")
        expectEqual(tracker.entries.first?.localId, shift.localId, "entry kept")
    }

    await check("Each person's data stays separate on a shared device") {
        let server = FakeServer(employeeId: userId)
        let clock = TestClock(start)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("sf-shared-\(UUID().uuidString)")
        let (first, _) = makeTracker(server: server, clock: clock, root: root)
        try await first.clockIn(jobA)
        await settle()
        let (reopened, _) = makeTracker(server: server, clock: clock, root: root)
        expect(reopened.activeShift != nil, "shift restored for the same person")
        let (other, _) = makeTracker(server: FakeServer(employeeId: "99999999-9999-4999-8999-999999999999"), clock: clock,
                                     root: root, user: "99999999-9999-4999-8999-999999999999")
        expect(other.activeShift == nil, "another account does not inherit it")
    }

    await check("Edits validate times and coalesce offline") {
        let server = FakeServer(employeeId: userId)
        let clock = TestClock(start)
        let (tracker, _) = makeTracker(server: server, clock: clock)
        try await tracker.clockIn(jobA)
        clock.advance(minutes: 60)
        let entry = await tracker.clockOut()!
        await settle()
        await server.setOnline(false)
        do {
            try await tracker.updateEntry(entry, startedAt: entry.startedAt, endedAt: entry.startedAt.addingTimeInterval(-60))
            expect(false, "end before start is rejected")
        } catch {}
        try await tracker.updateEntry(entry, startedAt: entry.startedAt.addingTimeInterval(-300), endedAt: entry.endedAt)
        try await tracker.updateEntry(tracker.entries[0], startedAt: entry.startedAt.addingTimeInterval(-600), endedAt: entry.endedAt)
        await settle()
        expectEqual(await tracker.pendingCommandCount(), 1, "two edits become one")
        do {
            try await tracker.clockIn(jobA)
            try await tracker.adjustActiveStart(byMinutes: 5)
            expect(false, "start can't move past now")
        } catch {}
    }

    await check("Location points wait for their entry and carry its id") {
        let server = FakeServer(employeeId: userId)
        await server.setOnline(false)
        let point = LocationPoint(latitude: 45.4216, longitude: -75.6973, accuracy: 20, capturedAt: start)
        let clock = TestClock(start)
        let (tracker, _) = makeTracker(server: server, location: FakeLocation(point: point), clock: clock)
        let shift = try await tracker.clockIn(jobA)
        await settle()
        expectEqual(tracker.activeShift?.onSite, true, "on site from the clock-in fix")
        await server.setOnline(true)
        await tracker.refresh()
        let points = await server.points()
        expectEqual(points.first?["time_entry_id"]?.stringValue, shift.localId, "point linked to the entry")
        expectEqual(points.first?["event_type"]?.stringValue, "clock_in", "clock-in event")
    }

    await check("Over-budget reasons are queued while offline") {
        let server = FakeServer(employeeId: userId)
        await server.setOnline(false)
        let (tracker, _) = makeTracker(server: server, clock: TestClock(start))
        await tracker.submitOverBudgetReason(jobId: jobA.id, reason: "extra_prep", note: nil, minutesOver: 45)
        expectEqual(await tracker.pendingCommandCount(), 1, "queued")
        await server.setOnline(true)
        await tracker.flushCommands()
        expectEqual(await server.issues.count, 1, "sent once online")
    }

    await check("Segments mark unobserved time as not recorded") {
        let t0 = start
        var segments = SegmentBuilder.append([], mode: .onSite, at: t0, distance: 10, location: nil, shiftStart: t0)
        segments = SegmentBuilder.append(segments, mode: .onSite, at: t0.addingTimeInterval(600), distance: 12, location: nil, shiftStart: t0)
        segments = SegmentBuilder.append(segments, mode: .onSite, at: t0.addingTimeInterval(3 * 3600), distance: 12, location: nil, shiftStart: t0)
        expectEqual(segments.map(\.mode), [.onSite, .unknown, .onSite], "gap becomes unknown")
        let closed = SegmentBuilder.close(segments, at: t0.addingTimeInterval(5 * 3600))
        expectEqual(closed.last?.mode, .unknown, "unobserved tail is unknown")
        var entry = TimeEntry(localId: "x", userId: userId, userEmail: nil, userName: "Pat", project: jobA,
                              originalStartedAt: t0, startedAt: t0, endedAt: t0.addingTimeInterval(5 * 3600), segments: closed)
        entry.clockOutReason = .manual
        let summary = SegmentSummary(entry, now: t0.addingTimeInterval(6 * 3600))
        expectEqual(Int(summary.onSite + summary.offSite + summary.unknown), 5 * 3600, "buckets add up to the shift")

        // Shortened on both ends: the removed time no longer counts.
        entry.startedAt = t0.addingTimeInterval(3600)
        entry.endedAt = t0.addingTimeInterval(4 * 3600)
        let edited = SegmentSummary(entry, now: t0.addingTimeInterval(6 * 3600))
        expectEqual(Int(edited.onSite + edited.offSite + edited.unknown), 3 * 3600, "buckets follow edited times")
        expectEqual(Int(summary.onSite), 600, "first ten minutes on site before the edit")
        expectEqual(Int(edited.onSite), 0, "on-site time before the new start no longer counts")
    }

    await check("Formatters match the RN app") {
        expectEqual(DurationFormat.hoursMinutes(7 * 3600 + 5 * 60 + 59), "7h 5m", "hours and minutes")
        expectEqual(DurationFormat.headerHours(7 * 3600 + 5 * 60), "7H 05M", "header hours")
        expectEqual(DurationFormat.shiftTimer(2 * 3600 + 7 * 60 + 45).main, "02:07", "timer main")
        expectEqual(DurationFormat.elapsedClock(3600 + 7 * 60 + 9), "01:07:09", "elapsed clock")
        expectEqual(HoursFormat.budgetValue(9.96), "10h", "budget rounding")
        expectEqual(HoursFormat.budgetValue(9.5), "9.5h", "budget decimal")
        expectEqual(HoursFormat.budgetValue(123.4), "123h", "budget over 100")
        expectEqual(HoursFormat.task(0.25), "15m", "task minutes")
        expectEqual(HoursFormat.task(1), "1.0h", "task hours")
        expectEqual(DistanceFormat.meters(1400), "1.4 km", "km")
        expectEqual(DistanceFormat.meters(119.6), "120 m", "m")
        expectEqual(DistanceFormat.meters(nil), "distance unknown", "unknown")
        expectEqual(DurationFormat.recording(seconds: 7), "00:07 / 10:00", "recording")
    }

    await check("Budget presentation") {
        let under = BudgetProgress(jobId: "j", percentUsed: 99.7, hoursUsed: 30, status: .under)
        expectEqual(BudgetPresentation(under).percentLabel, "99%", "under never shows 100%")
        let over = BudgetProgress(jobId: "j", percentUsed: 100.2, hoursUsed: 46, status: .over)
        expectEqual(BudgetPresentation(over).percentLabel, "101%", "over shows at least 101%")
        let breakdown = BudgetHoursBreakdown(BudgetProgress(jobId: "j", percentUsed: 75, hoursUsed: 30, status: .under))
        expectEqual(breakdown.leftLabel, "10h", "hours left")
        expectEqual(breakdown.totalLabel, "40h", "expected total")
        expectEqual(BudgetHoursBreakdown.litSegments(percent: 75), 9, "9 of 12 lit")
        expectEqual(BudgetHoursBreakdown.litSegments(percent: 115), 12, "all lit when over")
        expectEqual(BudgetHoursBreakdown.litSegments(percent: 0.5), 1, "one lit when started")
    }

    await check("Pay periods and timesheet days") {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Toronto")!
        let wednesday = ISODate.parse("2026-09-23T16:00:00.000Z")!
        let periods = PayPeriod.recent(now: wednesday, calendar: calendar)
        expectEqual(periods.map(\.id), ["2026-09-21", "2026-09-14", "2026-09-07"], "Monday keys")
        let entry = TimeEntry(localId: "e", userId: userId, userEmail: nil, userName: "Pat", project: jobA,
                              originalStartedAt: start, startedAt: start, endedAt: start.addingTimeInterval(3600),
                              clockOutReason: .manual)
        let days = TimesheetBuilder.days(for: periods[0], entries: [entry], now: wednesday, calendar: calendar)
        expectEqual(days.map(\.id), ["2026-09-23", "2026-09-22", "2026-09-21"], "past days only, newest first")
        expectEqual(days.last?.totalMinutes, 60, "Monday total")
        expectEqual(TimesheetBuilder.daysWorked(days), 1, "one day worked")
    }

    await check("Timesheet missing days begin on account creation in local time") {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Toronto")!
        let now = ISODate.parse("2026-10-18T16:00:00Z")!
        // UTC Sunday is still Saturday evening in Toronto, after the grid's noon.
        let created = ISODate.parse("2026-10-18T01:00:00Z")!
        let periods = PayPeriod.recent(now: now, calendar: calendar)
        let days = TimesheetBuilder.days(for: periods[0], entries: [], now: now, calendar: calendar, accountCreatedAt: created)
        expectEqual(days.map(\.id), ["2026-10-18", "2026-10-17"], "include creation day and subsequent missing days only")
        expect(days.allSatisfy { !$0.isWorked && $0.totalMinutes == 0 }, "missing days still have no recorded time")
        expect(TimesheetBuilder.days(for: periods[1], entries: [], now: now, calendar: calendar, accountCreatedAt: created).isEmpty,
               "weeks before signup have no missing days")
        expectEqual(TimesheetBuilder.days(for: periods[0], entries: [], now: now, calendar: calendar).count, 7,
                    "unknown creation date retains full week")

        let earlier = ISODate.parse("2026-10-15T13:00:00Z")!
        let entry = TimeEntry(localId: "imported", userId: userId, userEmail: nil, userName: "Pat", project: jobA,
                              originalStartedAt: earlier, startedAt: earlier, endedAt: earlier.addingTimeInterval(3600),
                              clockOutReason: .manual)
        let recordedDays = TimesheetBuilder.days(for: periods[0], entries: [entry], now: now, calendar: calendar, accountCreatedAt: created)
        expectEqual(recordedDays.map(\.id), ["2026-10-18", "2026-10-17", "2026-10-15"], "keep actual entries before signup")
        expectEqual(TimesheetBuilder.weekTotalMinutes(recordedDays), 60, "recorded hours remain in totals")
    }

    await check("Project detail groups painters by id") {
        let a = TimeEntry(localId: "1", userId: "u1", userEmail: nil, userName: "Sam", project: jobA, originalStartedAt: start,
                          startedAt: start, endedAt: start.addingTimeInterval(3600), clockOutReason: .manual)
        let b = TimeEntry(localId: "2", userId: "u2", userEmail: nil, userName: "Sam", project: jobA, originalStartedAt: start,
                          startedAt: start, endedAt: start.addingTimeInterval(1800), clockOutReason: .manual)
        let summaries = ProjectClockIns.summaries(entries: [a, b], activeShift: nil, projectId: jobA.id, userId: "u2", now: start)
        expectEqual(summaries.count, 2, "two painters with the same name stay separate")
        expectEqual(summaries.first?.userId, "u2", "you first")
    }

    await check("Account rules") {
        expect(AccountValidation.email("pat@example.com") == nil, "valid email")
        expect(AccountValidation.email("pat@") != nil, "invalid email")
        expectEqual(AccountValidation.verificationCode("12 34-56 7"), "123456", "code digits")
        expectEqual(MediaRules.sanitizedFilename("../.My photo (1).jpg"), "My_photo_1_.jpg", "filename")
    }

    await check("Server rows decode, history in either key style") {
        let row: JSONValue = [
            "id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "client_entry_id": "local-1", "employee_id": .string(userId),
            "job_id": .string(jobA.id), "job_name": "Maple", "started_at": "2026-09-21T13:00:00.123456+00:00",
            "ended_at": "2026-09-21T15:00:00+00:00", "status": "completed",
            "adjustment_history": [["adjusted_at": "2026-09-21T16:00:00Z", "previous_started_at": "2026-09-21T12:55:00Z"],
                                   ["adjustedAt": "2026-09-21T17:00:00Z", "previousEndedAt": "2026-09-21T15:05:00Z"]],
        ]
        let entry = TimeEntry(serverRow: row)
        expectEqual(entry?.localId, "local-1", "client id")
        expectEqual(entry.map { Int(($0.duration(at: Date()) * 1000).rounded()) }, 7_199_877, "microsecond timestamps parse")
        expect(entry?.adjustmentHistory.first?.previousStartedAt != nil, "snake_case history")
        expect(entry?.adjustmentHistory.last?.previousEndedAt != nil, "camelCase history")
    }
}

@MainActor
func runMediaChecks() async {
    await check("Drawings encode in the web editor's format") {
        let arrow = AnnotationShape(type: .arrow, points: [AnnotationPoint(x: 0.1, y: 0.2), AnnotationPoint(x: 1.4, y: -1)],
                                    color: "#ffcc00", width: 0.2)
        let text = AnnotationShape(type: .text, points: [AnnotationPoint(x: 0.5, y: 0.5)], color: "#ffffff", width: 0.01,
                                   text: "  Patch here ", fontSize: 0.5)
        let invalid = AnnotationShape(type: .line, points: [AnnotationPoint(x: 0, y: 0)], color: "red", width: 0.01)
        let document = AnnotationDocument(shapes: [arrow, text, invalid]).sanitized()
        expectEqual(document.shapes.count, 2, "invalid shapes dropped")
        expectEqual(document.shapes[0].points[1], AnnotationPoint(x: 1, y: 0), "points clamped to the image")
        expectEqual(document.shapes[0].width, 0.05, "width clamped")
        expectEqual(document.shapes[1].text, "Patch here", "text trimmed")
        expectEqual(document.shapes[1].fontSize, 0.2, "font size clamped")
        let json = String(data: try JSONCoding.encoder.encode(document), encoding: .utf8) ?? ""
        expect(!json.contains("null"), "no null keys (the web schema is strict)")
        expect(json.contains("\"version\":1"), "version 1")
        let row: JSONValue = ["id": "m1", "media_type": "image", "source_metadata": [
            "description": "Before sanding", "photo_revision": "r1",
            "annotations": try JSONValue(encoding: document),
        ]]
        let item = MediaItem(row: row)
        expectEqual(item?.mediaDescription, "Before sanding", "description read")
        expectEqual(item?.annotations?.shapes.count, 2, "drawings read")
        expectEqual(item?.detailsRevision, "r1", "revision read")
    }
}

await runChecks()
await runMediaChecks()
print("\n\(passed) passed, \(failures) failed")
exit(failures == 0 ? 0 : 1)
