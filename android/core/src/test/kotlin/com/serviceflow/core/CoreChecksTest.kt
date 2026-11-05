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

        // Shortened on both ends: the removed time no longer counts.
        entry = entry.copy(startedAt = t0.addingTimeInterval(3600.0), endedAt = t0.addingTimeInterval(4.0 * 3600))
        val edited = SegmentSummary(entry, now = t0.addingTimeInterval(6.0 * 3600))
        assertEquals("buckets follow edited times", 3 * 3600, (edited.onSite + edited.offSite + edited.unknown).toInt())
        assertEquals("first ten minutes on site before the edit", 600, summary.onSite.toInt())
        assertEquals("on-site time before the new start no longer counts", 0, edited.onSite.toInt())
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
    fun timesheetMissingDaysBeginOnAccountCreationInLocalTime() {
        val zone = ZoneId.of("America/Toronto")
        val now = ISODate.parse("2026-10-18T16:00:00Z")!!
        // UTC Sunday is still Saturday evening in Toronto, after the grid's noon.
        val created = ISODate.parse("2026-10-18T01:00:00Z")!!
        val periods = PayPeriod.recent(now, zone)
        val days = TimesheetBuilder.days(periods[0], emptyList(), now, zone, accountCreatedAt = created)
        assertEquals("include creation day and subsequent missing days only", listOf("2026-10-18", "2026-10-17"), days.map { it.id })
        assertTrue("missing days still have no recorded time", days.all { !it.isWorked && it.totalMinutes == 0 })
        assertTrue("weeks before signup have no missing days", TimesheetBuilder.days(periods[1], emptyList(), now, zone, created).isEmpty())
        assertEquals("unknown creation date retains full week", 7, TimesheetBuilder.days(periods[0], emptyList(), now, zone).size)

        val earlier = ISODate.parse("2026-10-15T13:00:00Z")!!
        val entry = TimeEntry(
            localId = "imported", userId = userId, userEmail = null, userName = "Pat", project = jobA,
            originalStartedAt = earlier, startedAt = earlier, endedAt = earlier.addingTimeInterval(3600.0),
            clockOutReason = ClockOutReason.Manual,
        )
        val recordedDays = TimesheetBuilder.days(periods[0], listOf(entry), now, zone, created)
        assertEquals("keep actual entries before signup", listOf("2026-10-18", "2026-10-17", "2026-10-15"), recordedDays.map { it.id })
        assertEquals("recorded hours remain in totals", 60, TimesheetBuilder.weekTotalMinutes(recordedDays))
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
    fun todayBoardJobsClockedInToTodayWholeCrewListed() {
        val startOfDay = Instant.parse("2026-11-03T05:00:00Z")
        val now = Instant.parse("2026-11-03T15:00:00Z")
        fun entry(id: String, user: String, name: String, job: String, start: String, end: String?,
                  lat: Double? = null, distance: Double? = null): TimeEntry {
            val pairs = mutableListOf<Pair<String, Any?>>(
                "id" to id, "employee_id" to user, "employee_name" to name, "job_id" to job, "started_at" to start,
                "status" to if (end == null) "active" else "completed",
            )
            if (end != null) pairs += "ended_at" to end
            if (lat != null) {
                pairs += "clock_in_latitude" to lat
                pairs += "clock_in_longitude" to -75.7
                pairs += "last_distance_meters" to (distance ?: 0.0)
            }
            return TimeEntry.fromServerRow(jsonObject(*pairs.toTypedArray()), now)!!
        }
        val entries = listOf(
            entry("e1", "u1", "Michael", "j1", "2026-11-03T12:43:00Z", null),
            entry("e2", "u1", "Michael", "j1", "2026-11-02T12:00:00Z", "2026-11-02T20:00:00Z"),
            entry("e3", "u2", "Burim", "j1", "2026-11-01T12:00:00Z", "2026-11-01T22:00:00Z"),
            entry("e4", "u3", "Camilo", "j2", "2026-11-03T13:32:00Z", "2026-11-03T14:00:00Z", lat = 45.4, distance = 30.0),
            entry("e5", "u3", "Camilo", "j2", "2026-11-03T14:10:00Z", null, lat = 45.5, distance = 400.0),
            entry("e6", "u4", "Julian", "j3", "2026-11-02T12:00:00Z", "2026-11-02T13:00:00Z"),
            entry("e7", "u5", "Dana", "j4", "2026-11-02T21:00:00Z", null),
            entry("e8", "u4", "Julian", "j2", "2026-11-03T13:30:00Z", "2026-11-03T14:18:00Z"),
        )
        val projects = listOf(
            Project.fromJobRow(jsonObject("id" to "j1", "name" to "Sorrenti", "status" to "active", "latitude" to 45.3,
                                          "longitude" to -75.8, "budget_minutes" to 600, "used_minutes" to 165))!!,
            Project.fromJobRow(jsonObject("id" to "j2", "name" to "Bastidas", "status" to "active"))!!,
            Project.fromJobRow(jsonObject("id" to "j3", "name" to "Not today", "status" to "active"))!!,
            Project.fromJobRow(jsonObject("id" to "j4", "name" to "Archived", "status" to "archived"))!!,
        )
        val jobs = TodayBoard.jobs(entries, projects, startOfDay, now)
        assertEquals("today's jobs by name; archived and idle left out", listOf("Bastidas", "Sorrenti"), jobs.map { it.project.name })
        val sorrenti = jobs[1]
        assertEquals("clocked in today first", listOf("Michael", "Burim"), sorrenti.painters.map { it.name })
        assertEquals("first clock-in today", Instant.parse("2026-11-03T12:43:00Z"), sorrenti.painters[0].inTodayAt)
        assertEquals("all-time hours on the job, running shift included", 137 + 480, sorrenti.painters[0].totalMinutes)
        assertNull("crew who didn't clock in today stay listed", sorrenti.painters[1].inTodayAt)
        assertEquals("earliest of several clock-ins", Instant.parse("2026-11-03T13:32:00Z"), jobs[0].painters[0].inTodayAt)
        assertEquals("no address: the clock-in nearest the site", 45.4, jobs[0].coordinate?.latitude)
        assertEquals("the job's own address first", 45.3, sorrenti.coordinate?.latitude)
        val julian = jobs[0].painters.first { it.name == "Julian" }
        assertEquals("clocked out today", Instant.parse("2026-11-03T14:18:00Z"), julian.outTodayAt)
        assertTrue("shows when they left", !julian.isOnClock && TodayBoard.timeLabel(julian, startOfDay)!!.startsWith("out at "))
        val camilo = jobs[0].painters.first { it.name == "Camilo" }
        assertTrue("back on the clock after an earlier clock-out", camilo.outTodayAt == null && camilo.isOnClock)
        assertTrue("on the clock: when they came in", TodayBoard.timeLabel(camilo, startOfDay)!!.startsWith("in at "))
        assertNull("no time for crew who didn't work today", TodayBoard.timeLabel(sorrenti.painters[1], startOfDay))
        assertEquals("summary", "3 painters on 2 jobs", TodayBoard.summary(jobs))
        assertEquals("budget label", "Labour budget · 2.8 of 10.0 h", TodayBoard.budgetLine(sorrenti.project.budget)?.first)
        assertEquals("budget percent", 28, TodayBoard.budgetLine(sorrenti.project.budget)?.second)
        assertNull("no budget", TodayBoard.budgetLine(jobs[0].project.budget))
        val leftRunning = Instant.parse("2026-10-31T02:47:00Z")
        assertTrue("shift left running since an earlier day", TodayBoard.inLabel(leftRunning, startOfDay).startsWith("in since Oct"))
        assertTrue("clocked in today", TodayBoard.inLabel(now, startOfDay).startsWith("in at "))
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

    @Test
    fun leadRowsCarryTheWebsitesDescription() {
        fun lead(vararg extra: Pair<String, Any?>) =
            Project.fromLeadRow(jsonObject("id" to "l1", "status" to "new", "contact" to mapOf("name" to "Katya"), *extra))
        assertEquals("the workspace's first", "Two rooms",
                     lead("workspace" to mapOf("description" to "Two rooms"), "metadata" to mapOf("description" to "Old"))?.description)
        assertNull("cleared stays cleared",
                   lead("workspace" to mapOf("description" to ""), "metadata" to mapOf("description" to "Old"))?.description)
        assertEquals("else what it was imported with", "Imported",
                     lead("workspace" to null, "metadata" to mapOf("project_description" to " ", "description" to "Imported"))?.description)
        assertEquals("embedded as a list", "Listed", lead("workspace" to listOf(mapOf("description" to "Listed")))?.description)
    }

    @Test
    fun addressesOpenGoogleMapsDirections() {
        val job = Project(id = "j1", name = "Job", formattedAddress = "12 O'Connor St #3, Gatineau, Québec")
        assertEquals("the formatted address, encoded",
                     "https://www.google.com/maps/dir/?api=1&destination=12%20O%27Connor%20St%20%233%2C%20Gatineau%2C%20Qu%C3%A9bec",
                     job.directionsUrl)
        assertEquals("else the parts", "https://www.google.com/maps/dir/?api=1&destination=5%20Elm%20St%2C%20Ottawa",
                     Project(id = "j2", name = "Job", addressLine1 = "5 Elm St", city = "Ottawa").directionsUrl)
        assertNull("none without an address", Project(id = "j3", name = "Job", latitude = 45.4, longitude = -75.7).directionsUrl)
    }

    @Test
    fun descriptionsKeepBoldItalicLinksAndLists() {
        val plain = "Two coats in the kitchen\n- walls\n- trim\n\nGate code 1234"
        assertEquals("plain text reads as it was written", plain, RichText.markdown(RichText.lines(plain)))
        assertEquals("dash lines are bullets",
                     listOf(RichText.Kind.Text, RichText.Kind.Bullet, RichText.Kind.Bullet, RichText.Kind.Text, RichText.Kind.Text),
                     RichText.lines(plain).map { it.kind })

        val lines = listOf(
            RichText.Line(RichText.Kind.Text, listOf(RichText.Run("Paint "), RichText.Run("all", bold = true), RichText.Run(" rooms "),
                                                     RichText.Run("except", bold = true, italic = true), RichText.Run(" the den", bold = true))),
            RichText.Line(RichText.Kind.Numbered(1), listOf(RichText.Run("See "), RichText.Run("colours", link = "https://example.com/a(1)"))),
            RichText.Line(RichText.Kind.Numbered(2), listOf(RichText.Run("Call ", italic = true), RichText.Run("Kim", italic = true, link = "tel:6135550101"))),
            RichText.Line(RichText.Kind.Bullet, listOf(RichText.Run("2*3 = 6_ [maybe] \\ ok"))),
            RichText.Line(RichText.Kind.Text, listOf(RichText.Run("- not a list"))),
            RichText.Line(RichText.Kind.Text, listOf(RichText.Run("1. not numbered either"))),
        )
        val markdown = RichText.markdown(lines)
        assertEquals(
            "written as Markdown with markers that never touch",
            """
            Paint **all** rooms **_except_ the den**
            1. See [colours](https://example.com/a(1%29)
            2. _Call [Kim](tel:6135550101)_
            - 2\*3 = 6\_ \[maybe\] \\ ok
            \- not a list
            \1. not numbered either
            """.trimIndent(),
            markdown,
        )
        val read = RichText.lines(markdown)
        assertEquals("bold and italic read back", lines[0], read[0])
        assertEquals("an italic link reads back", lines[2], read[2])
        assertEquals("literal markers and list-like text read back", lines.drop(3), read.drop(3))

        assertEquals("unclosed markers and unsafe links stay text", listOf(RichText.Run("**bold ** and [x](javascript:alert(1))")),
                     RichText.lines("**bold ** and [x](javascript:alert(1))")[0].runs)
        assertEquals("a bare site opens over https", "https://example.com/colours", RichText.linkAddress("example.com/colours"))
        assertEquals("an email address opens mail", "mailto:kim@example.com", RichText.linkAddress("kim@example.com"))
        assertNull("words aren't a link", RichText.linkAddress("not a link"))
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

    // MARK: Documents

    @Test
    fun jobDocumentsRowsSectionsLabelsAndPageImages() {
        val job = "dee00000-0000-4000-8000-000000000201"
        val page = "fd6ec6b5-52bc-4124-a54f-700f28e3c839"
        val rows = listOf(
            jsonObject(
                "id" to "d1", "project_id" to job, "name" to "Paint schedule.pdf", "kind" to "file", "folder_id" to "f1",
                "storage_path" to "$job/d1/paint-schedule.pdf", "mime_type" to "application/pdf", "byte_size" to 19351,
                "updated_at" to "2026-10-27T12:00:00.000Z",
            ),
            jsonObject(
                "id" to page, "project_id" to job, "name" to "Colour selections", "kind" to "page", "folder_id" to "f1",
                "updated_at" to "2026-10-28T12:00:00.000Z",
            ),
            jsonObject("id" to "d3", "project_id" to job, "name" to "Site notes", "kind" to "page", "updated_at" to "2026-10-29T12:00:00.000Z"),
            jsonObject("id" to "d4", "project_id" to job, "name" to "Lost.pdf", "kind" to "file"),
            jsonObject(
                "id" to "d5", "project_id" to job, "name" to "Old.docx", "kind" to "file", "folder_id" to "gone",
                "storage_path" to "x/d5/old.docx", "updated_at" to "2026-01-02T12:00:00.000Z",
            ),
        )
        val documents = rows.mapNotNull { ProjectDocument.fromRow(it) }
        assertEquals("a file without storage is skipped", 4, documents.size)
        val folders = listOf(ProjectDocumentFolder(id = "f2", name = "Empty"), ProjectDocumentFolder(id = "f1", name = "Colours & specs"))
        val sections = ProjectDocuments.sections(documents = documents, folders = folders)
        assertEquals("loose first, empty folders hidden", listOf("-", "Colours & specs"), sections.map { it.folder?.name ?: "-" })
        assertEquals("newest first; an unknown folder counts as none", listOf("d3", "d5"), sections[0].documents.map { it.id })
        assertEquals("folder contents newest first", listOf(page, "d1"), sections[1].documents.map { it.id })
        assertEquals("pdf label", "PDF", documents[0].typeLabel)
        assertEquals("word label from the extension", "Word", documents.firstOrNull { it.id == "d5" }?.typeLabel)
        // Phones write "Oct 27, 2026" (as iOS does); JDK 17's older CLDR data writes "Oct. 27, 2026".
        val shortDate = { iso: String -> DateText.canadianShortDate(ISODate.parse(iso)) }
        assertEquals("file detail", "PDF · 19 KB · ${shortDate("2026-10-27T12:00:00.000Z")}", documents[0].detail)
        assertEquals("page detail", "Page · ${shortDate("2026-10-29T12:00:00.000Z")}", documents[2].detail)
        assertEquals("bytes", "820 B", ProjectDocuments.sizeLabel(820))
        assertEquals("megabytes", "4.2 MB", ProjectDocuments.sizeLabel(4_404_019))
        assertEquals("whole megabytes", "2 MB", ProjectDocuments.sizeLabel(2_097_152))

        val image = "1bc51b0d-ec70-4b9b-a9a0-c3f8d73c5788"
        val other = "/api/jobs/$job/documents/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/images/$image"
        val mine = "/api/jobs/$job/documents/$page/images/$image"
        val html = "<p>Swatches</p><img src=\"$mine\" alt=\"x\"><img src=\"$other\">"
        val images = ProjectDocuments.pageImages(html = html, document = documents[1])
        assertEquals("only this page's images map to storage keys", mapOf(mine to "$job/pages/$page/$image"), images)
        val swapped = ProjectDocuments.replacingImageSources(html, mapOf(mine to "https://signed/1"))
        assertTrue("image swapped, others kept", swapped.contains("src=\"https://signed/1\"") && swapped.contains(other))
        assertTrue("page wrapped", ProjectDocuments.pageDocument(body = "<p>Hi</p>").contains("<body><p>Hi</p></body>"))
    }
}
