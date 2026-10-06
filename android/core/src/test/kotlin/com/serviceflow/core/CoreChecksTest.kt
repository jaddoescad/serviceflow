package com.serviceflow.core

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.time.Instant
import java.time.ZoneId

/**
 * Behavioural checks for the core, ported one-to-one from
 * `ios/ServiceFlowKit/Sources/ServiceFlowCoreChecks/main.swift`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CoreChecksTest {
    private val userId = "11111111-1111-4111-8111-111111111111"
    private val jobA = Project(id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name = "Maple House", latitude = 45.4215, longitude = -75.6972)
    private val jobB = Project(id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name = "Elm Street", latitude = 45.4300, longitude = -75.7000)
    private val start: Instant = ISODate.parse("2026-09-21T13:00:00.000Z")!!

    /** Lets detached follow-up work (background flushes) finish. */
    private fun TestScope.settle() = advanceUntilIdle()

    /**
     * Where the tracker launches its follow-up work: the test scheduler, so
     * [settle] runs it (`work` work is skipped by `advanceUntilIdle`).
     */
    private val TestScope.work: CoroutineScope get() = CoroutineScope(StandardTestDispatcher(testScheduler) + SupervisorJob())

    private fun tempRoot(prefix: String): File = Files.createTempDirectory(prefix).toFile().also { it.deleteOnExit() }

    private fun makeTracker(
        server: FakeServer, scope: CoroutineScope, location: FakeLocation = FakeLocation(), clock: TestClock,
        root: File = tempRoot("sf-checks-"), user: String = userId,
    ): Pair<TimeTracker, FakeReminders> {
        val reminders = FakeReminders()
        val tracker = TimeTracker(
            user = CrewMember(id = user, email = "pat@example.com", name = "Pat Painter"),
            storage = UserStorage(user, root), backend = server, location = location,
            reminders = reminders, appVersion = "2.0.0", scope = scope, now = { clock.date },
        )
        tracker.projects = listOf(jobA, jobB)
        return tracker to reminders
    }

    @Test
    fun offlineClockInAndClockOutBothReachTheServerInOrder() = runTest {
        val server = FakeServer(userId)
        server.setOnline(false)
        val clock = TestClock(start)
        val (tracker, _) = makeTracker(server, work, clock = clock)
        val shift = tracker.clockIn(jobA)
        clock.advance(minutes = 90.0)
        val entry = tracker.clockOut()
        settle()
        assertEquals("both commands queued", 2, tracker.pendingCommandCount())
        server.setOnline(true)
        tracker.refresh()
        val rows = server.allRows()
        assertEquals("one server row", 1, rows.size)
        assertEquals("server row completed", "completed", rows.firstOrNull()["status"].stringValue)
        assertEquals("row id equals the client id", shift.localId, rows.firstOrNull()["id"].stringValue)
        assertEquals("queue drained", 0, tracker.pendingCommandCount())
        assertEquals("entry acknowledged", shift.localId, tracker.entries.value.firstOrNull()?.serverId)
        assertTrue("duration is 90 minutes", entry?.duration(clock.date) == 90.0 * 60)
    }

    @Test
    fun anOfflineSwitchAfterAnOfflineClockInKeepsBothShifts() = runTest {
        val server = FakeServer(userId)
        server.setOnline(false)
        val clock = TestClock(start)
        val (tracker, _) = makeTracker(server, work, clock = clock)
        tracker.clockIn(jobA)
        clock.advance(minutes = 30.0)
        val next = tracker.switchProject(to = jobB)
        clock.advance(minutes = 30.0)
        tracker.clockOut()
        settle()
        server.setOnline(true)
        tracker.refresh()
        val rows = server.allRows()
        assertEquals("two server rows", 2, rows.size)
        assertTrue("both completed", rows.all { it["status"].stringValue == "completed" })
        assertEquals("commands sent in order", listOf("clock_in", "switch", "clock_out"), server.callLog())
        assertEquals("two local entries", 2, tracker.entries.value.size)
        assertEquals("newest first", next?.localId, tracker.entries.value.firstOrNull()?.localId)
    }

    @Test
    fun deletingAnEntryThatNeverReachedTheServerSendsNothing() = runTest {
        val server = FakeServer(userId)
        server.setOnline(false)
        val clock = TestClock(start)
        val (tracker, _) = makeTracker(server, work, clock = clock)
        tracker.clockIn(jobA)
        clock.advance(minutes = 10.0)
        val entry = tracker.clockOut()!!
        tracker.deleteEntry(entry)
        settle()
        assertEquals("nothing queued", 0, tracker.pendingCommandCount())
        assertTrue("entry removed locally", tracker.entries.value.isEmpty())
    }

    @Test
    fun clockInWorksWithoutLocationAndNeverAsksTwice() = runTest {
        val server = FakeServer(userId)
        val location = FakeLocation(authorization = LocationAuthorization.NotDetermined, answer = LocationAuthorization.Denied)
        val clock = TestClock(start)
        val (tracker, _) = makeTracker(server, work, location = location, clock = clock)
        tracker.clockIn(jobA)
        settle()
        assertNotNull("shift started", tracker.activeShift.value)
        assertEquals("asked once", 1, location.requests)
        assertEquals("no fix requested when denied", 0, location.fixes)
        assertNull("no permission nag", tracker.notice.value)
        tracker.clockOut()
        tracker.clockIn(jobB)
        assertEquals("not asked again", 1, location.requests)
    }

    @Test
    fun aNewDeviceAdoptsTheServersActiveShift() = runTest {
        val server = FakeServer(userId)
        server.seed(
            jsonObject(
                "id" to "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "client_entry_id" to "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                "employee_id" to userId, "job_id" to jobA.id, "job_name" to "Maple House",
                "started_at" to ISODate.string(start), "ended_at" to null, "status" to "active",
            ),
        )
        val clock = TestClock(start.addingTimeInterval(3600.0))
        val (tracker, reminders) = makeTracker(server, work, clock = clock)
        tracker.refresh()
        assertEquals("active shift adopted", "cccccccc-cccc-4ccc-8ccc-cccccccccccc", tracker.activeShift.value?.localId)
        assertEquals("project coordinates filled in", jobA.latitude, tracker.activeShift.value?.project?.latitude)
        assertEquals("reminders scheduled", 1, reminders.scheduled.size)
    }

    @Test
    fun aShiftClockedOutByAManagerEndsOnTheDevice() = runTest {
        val server = FakeServer(userId)
        val clock = TestClock(start)
        val (tracker, _) = makeTracker(server, work, clock = clock)
        val shift = tracker.clockIn(jobA)
        settle()
        tracker.flushCommands()
        server.recordTimeEntryCommand(
            "clock_out",
            jsonObject("client_entry_id" to shift.localId, "ended_at" to ISODate.string(start.addingTimeInterval(1800.0))),
            null,
        )
        tracker.refresh()
        assertNull("local shift cleared", tracker.activeShift.value)
        assertEquals("completed entry in history", shift.localId, tracker.entries.value.firstOrNull()?.localId)
        assertEquals("no second clock-out sent", 1, server.callLog().count { it == "clock_out" })
    }

    @Test
    fun aShiftAlreadyRunningElsewhereReplacesTheLocalOne() = runTest {
        val server = FakeServer(userId)
        server.seed(
            jsonObject(
                "id" to "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "client_entry_id" to "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                "employee_id" to userId, "job_id" to jobB.id, "job_name" to "Elm Street",
                "started_at" to ISODate.string(start), "ended_at" to null, "status" to "active",
            ),
        )
        val clock = TestClock(start.addingTimeInterval(600.0))
        val (tracker, _) = makeTracker(server, work, clock = clock)
        tracker.clockIn(jobA)
        settle()
        tracker.refresh()
        assertEquals("server shift adopted", "dddddddd-dddd-4ddd-8ddd-dddddddddddd", tracker.activeShift.value?.localId)
        assertEquals("failed clock-in not retried forever", 0, tracker.pendingCommandCount())
    }

    @Test
    fun aLocallyClosedShiftIsNotRevivedByAStaleRead() = runTest {
        val server = FakeServer(userId)
        val clock = TestClock(start)
        val (tracker, _) = makeTracker(server, work, clock = clock)
        val shift = tracker.clockIn(jobA)
        settle()
        server.setOnline(false)
        tracker.clockOut()
        settle()
        tracker.reconcile(server.allRows()) // server still says active
        assertNull("stays clocked out", tracker.activeShift.value)
        assertEquals("entry kept", shift.localId, tracker.entries.value.firstOrNull()?.localId)
    }

    @Test
    fun eachPersonsDataStaysSeparateOnASharedDevice() = runTest {
        val server = FakeServer(userId)
        val clock = TestClock(start)
        val root = tempRoot("sf-shared-")
        val (first, _) = makeTracker(server, work, clock = clock, root = root)
        first.clockIn(jobA)
        settle()
        val (reopened, _) = makeTracker(server, work, clock = clock, root = root)
        assertNotNull("shift restored for the same person", reopened.activeShift.value)
        val (other, _) = makeTracker(
            FakeServer("99999999-9999-4999-8999-999999999999"), work, clock = clock,
            root = root, user = "99999999-9999-4999-8999-999999999999",
        )
        assertNull("another account does not inherit it", other.activeShift.value)
    }

    @Test
    fun editsValidateTimesAndCoalesceOffline() = runTest {
        val server = FakeServer(userId)
        val clock = TestClock(start)
        val (tracker, _) = makeTracker(server, work, clock = clock)
        tracker.clockIn(jobA)
        clock.advance(minutes = 60.0)
        val entry = tracker.clockOut()!!
        settle()
        server.setOnline(false)
        try {
            tracker.updateEntry(entry, startedAt = entry.startedAt, endedAt = entry.startedAt.addingTimeInterval(-60.0))
            fail("end before start is rejected")
        } catch (_: TimeTrackingError) {
        }
        tracker.updateEntry(entry, startedAt = entry.startedAt.addingTimeInterval(-300.0), endedAt = entry.endedAt)
        tracker.updateEntry(tracker.entries.value[0], startedAt = entry.startedAt.addingTimeInterval(-600.0), endedAt = entry.endedAt)
        settle()
        assertEquals("two edits become one", 1, tracker.pendingCommandCount())
        try {
            tracker.clockIn(jobA)
            tracker.adjustActiveStart(byMinutes = 5)
            fail("start can't move past now")
        } catch (_: TimeTrackingError) {
        }
    }

    @Test
    fun locationPointsWaitForTheirEntryAndCarryItsId() = runTest {
        val server = FakeServer(userId)
        server.setOnline(false)
        val point = LocationPoint(latitude = 45.4216, longitude = -75.6973, accuracy = 20.0, capturedAt = start)
        val clock = TestClock(start)
        val (tracker, _) = makeTracker(server, work, location = FakeLocation(point = point), clock = clock)
        val shift = tracker.clockIn(jobA)
        settle()
        assertEquals("on site from the clock-in fix", true, tracker.activeShift.value?.onSite)
        server.setOnline(true)
        tracker.refresh()
        val points = server.points()
        assertEquals("point linked to the entry", shift.localId, points.firstOrNull()["time_entry_id"].stringValue)
        assertEquals("clock-in event", "clock_in", points.firstOrNull()["event_type"].stringValue)
    }

    @Test
    fun overBudgetReasonsAreQueuedWhileOffline() = runTest {
        val server = FakeServer(userId)
        server.setOnline(false)
        val (tracker, _) = makeTracker(server, work, clock = TestClock(start))
        tracker.submitOverBudgetReason(jobId = jobA.id, reason = "extra_prep", note = null, minutesOver = 45)
        assertEquals("queued", 1, tracker.pendingCommandCount())
        server.setOnline(true)
        tracker.flushCommands()
        assertEquals("sent once online", 1, server.issues.size)
    }

    @Test
    fun segmentsMarkUnobservedTimeAsNotRecorded() {
        val t0 = start
        var segments = SegmentBuilder.append(emptyList(), SiteMode.OnSite, at = t0, distance = 10.0, location = null, shiftStart = t0)
        segments = SegmentBuilder.append(segments, SiteMode.OnSite, at = t0.addingTimeInterval(600.0), distance = 12.0, location = null, shiftStart = t0)
        segments = SegmentBuilder.append(segments, SiteMode.OnSite, at = t0.addingTimeInterval(3.0 * 3600), distance = 12.0, location = null, shiftStart = t0)
        assertEquals("gap becomes unknown", listOf(SiteMode.OnSite, SiteMode.Unknown, SiteMode.OnSite), segments.map { it.mode })
        val closed = SegmentBuilder.close(segments, at = t0.addingTimeInterval(5.0 * 3600))
        assertEquals("unobserved tail is unknown", SiteMode.Unknown, closed.lastOrNull()?.mode)
        var entry = TimeEntry(
            localId = "x", userId = userId, userEmail = null, userName = "Pat", project = jobA,
            originalStartedAt = t0, startedAt = t0, endedAt = t0.addingTimeInterval(5.0 * 3600), segments = closed,
        )
        entry = entry.copy(clockOutReason = ClockOutReason.Manual)
        val summary = SegmentSummary(entry, now = t0.addingTimeInterval(6.0 * 3600))
        assertEquals("buckets add up to the shift", 5 * 3600, (summary.onSite + summary.offSite + summary.unknown).toInt())
    }

    @Test
    fun formattersMatchTheRNApp() {
        assertEquals("hours and minutes", "7h 5m", DurationFormat.hoursMinutes((7 * 3600 + 5 * 60 + 59).toDouble()))
        assertEquals("header hours", "7H 05M", DurationFormat.headerHours((7 * 3600 + 5 * 60).toDouble()))
        assertEquals("timer main", "02:07", DurationFormat.shiftTimer((2 * 3600 + 7 * 60 + 45).toDouble()).main)
        assertEquals("elapsed clock", "01:07:09", DurationFormat.elapsedClock((3600 + 7 * 60 + 9).toDouble()))
        assertEquals("budget rounding", "10h", HoursFormat.budgetValue(9.96))
        assertEquals("budget decimal", "9.5h", HoursFormat.budgetValue(9.5))
        assertEquals("budget over 100", "123h", HoursFormat.budgetValue(123.4))
        assertEquals("task minutes", "15m", HoursFormat.task(0.25))
        assertEquals("task hours", "1.0h", HoursFormat.task(1.0))
        assertEquals("km", "1.4 km", DistanceFormat.meters(1400.0))
        assertEquals("m", "120 m", DistanceFormat.meters(119.6))
        assertEquals("unknown", "distance unknown", DistanceFormat.meters(null))
        assertEquals("recording", "00:07 / 10:00", DurationFormat.recording(seconds = 7))
    }

    @Test
    fun budgetPresentation() {
        val under = BudgetProgress(jobId = "j", percentUsed = 99.7, hoursUsed = 30.0, status = BudgetProgress.Status.Under)
        assertEquals("under never shows 100%", "99%", BudgetPresentation(under).percentLabel)
        val over = BudgetProgress(jobId = "j", percentUsed = 100.2, hoursUsed = 46.0, status = BudgetProgress.Status.Over)
        assertEquals("over shows at least 101%", "101%", BudgetPresentation(over).percentLabel)
        val breakdown = BudgetHoursBreakdown(BudgetProgress(jobId = "j", percentUsed = 75.0, hoursUsed = 30.0, status = BudgetProgress.Status.Under))
        assertEquals("hours left", "10h", breakdown.leftLabel)
        assertEquals("expected total", "40h", breakdown.totalLabel)
        assertEquals("9 of 12 lit", 9, BudgetHoursBreakdown.litSegments(percent = 75.0))
        assertEquals("all lit when over", 12, BudgetHoursBreakdown.litSegments(percent = 115.0))
        assertEquals("one lit when started", 1, BudgetHoursBreakdown.litSegments(percent = 0.5))
    }

    @Test
    fun payPeriodsAndTimesheetDays() {
        val zone = ZoneId.of("America/Toronto")
        val wednesday = ISODate.parse("2026-09-23T16:00:00.000Z")!!
        val periods = PayPeriod.recent(now = wednesday, zone = zone)
        assertEquals("Monday keys", listOf("2026-09-21", "2026-09-14", "2026-09-07"), periods.map { it.id })
        val entry = TimeEntry(
            localId = "e", userId = userId, userEmail = null, userName = "Pat", project = jobA,
            originalStartedAt = start, startedAt = start, endedAt = start.addingTimeInterval(3600.0),
            clockOutReason = ClockOutReason.Manual,
        )
        val days = TimesheetBuilder.days(periods[0], entries = listOf(entry), now = wednesday, zone = zone)
        assertEquals("past days only, newest first", listOf("2026-09-23", "2026-09-22", "2026-09-21"), days.map { it.id })
        assertEquals("Monday total", 60, days.lastOrNull()?.totalMinutes)
        assertEquals("one day worked", 1, TimesheetBuilder.daysWorked(days))
    }

    @Test
    fun projectDetailGroupsPaintersById() {
        val a = TimeEntry(
            localId = "1", userId = "u1", userEmail = null, userName = "Sam", project = jobA, originalStartedAt = start,
            startedAt = start, endedAt = start.addingTimeInterval(3600.0), clockOutReason = ClockOutReason.Manual,
        )
        val b = TimeEntry(
            localId = "2", userId = "u2", userEmail = null, userName = "Sam", project = jobA, originalStartedAt = start,
            startedAt = start, endedAt = start.addingTimeInterval(1800.0), clockOutReason = ClockOutReason.Manual,
        )
        val summaries = ProjectClockIns.summaries(entries = listOf(a, b), activeShift = null, projectId = jobA.id, userId = "u2", now = start)
        assertEquals("two painters with the same name stay separate", 2, summaries.size)
        assertEquals("you first", "u2", summaries.firstOrNull()?.userId)
    }

    @Test
    fun accountRules() {
        assertNull("valid email", AccountValidation.email("pat@example.com"))
        assertNotNull("invalid email", AccountValidation.email("pat@"))
        assertEquals("code digits", "123456", AccountValidation.verificationCode("12 34-56 7"))
        assertEquals("filename", "My_photo_1_.jpg", MediaRules.sanitizedFilename("../.My photo (1).jpg"))
    }

    @Test
    fun serverRowsDecodeHistoryInEitherKeyStyle() {
        val row = jsonObject(
            "id" to "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "client_entry_id" to "local-1", "employee_id" to userId,
            "job_id" to jobA.id, "job_name" to "Maple", "started_at" to "2026-09-21T13:00:00.123456+00:00",
            "ended_at" to "2026-09-21T15:00:00+00:00", "status" to "completed",
            "adjustment_history" to listOf(
                mapOf("adjusted_at" to "2026-09-21T16:00:00Z", "previous_started_at" to "2026-09-21T12:55:00Z"),
                mapOf("adjustedAt" to "2026-09-21T17:00:00Z", "previousEndedAt" to "2026-09-21T15:05:00Z"),
            ),
        )
        val entry = TimeEntry.fromServerRow(row)
        assertEquals("client id", "local-1", entry?.localId)
        assertEquals("microsecond timestamps parse", 7_199_877, entry?.let { (it.duration(Instant.now()) * 1000).roundedSwift().toInt() })
        assertNotNull("snake_case history", entry?.adjustmentHistory?.firstOrNull()?.previousStartedAt)
        assertNotNull("camelCase history", entry?.adjustmentHistory?.lastOrNull()?.previousEndedAt)
    }

    // MARK: Media

    @Test
    fun drawingsEncodeInTheWebEditorsFormat() {
        val arrow = AnnotationShape(
            type = AnnotationShape.Kind.Arrow, points = listOf(AnnotationPoint(x = 0.1, y = 0.2), AnnotationPoint(x = 1.4, y = -1.0)),
            color = "#ffcc00", width = 0.2,
        )
        val text = AnnotationShape(
            type = AnnotationShape.Kind.Text, points = listOf(AnnotationPoint(x = 0.5, y = 0.5)), color = "#ffffff", width = 0.01,
            text = "  Patch here ", fontSize = 0.5,
        )
        val invalid = AnnotationShape(type = AnnotationShape.Kind.Line, points = listOf(AnnotationPoint(x = 0.0, y = 0.0)), color = "red", width = 0.01)
        val document = AnnotationDocument(shapes = listOf(arrow, text, invalid)).sanitized()
        assertEquals("invalid shapes dropped", 2, document.shapes.size)
        assertEquals("points clamped to the image", AnnotationPoint(x = 1.0, y = 0.0), document.shapes[0].points[1])
        assertEquals("width clamped", 0.05, document.shapes[0].width, 0.0)
        assertEquals("text trimmed", "Patch here", document.shapes[1].text)
        assertEquals("font size clamped", 0.2, document.shapes[1].fontSize!!, 0.0)
        val json = JSONCoding.json.encodeToString(AnnotationDocument.serializer(), document)
        assertFalse("no null keys (the web schema is strict)", json.contains("null"))
        assertTrue("version 1", json.contains("\"version\":1"))
        val row = jsonObject(
            "id" to "m1", "media_type" to "image",
            "source_metadata" to jsonObject(
                "description" to "Before sanding", "photo_revision" to "r1",
                "annotations" to JSONCoding.encode(AnnotationDocument.serializer(), document),
            ),
        )
        val item = MediaItem.fromRow(row)
        assertEquals("description read", "Before sanding", item?.mediaDescription)
        assertEquals("drawings read", 2, item?.annotations?.shapes?.size)
        assertEquals("revision read", "r1", item?.detailsRevision)
    }
}
