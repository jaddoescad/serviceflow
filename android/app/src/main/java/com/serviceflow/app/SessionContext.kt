package com.serviceflow.app

import com.serviceflow.app.backend.accessToken
import com.serviceflow.app.backend.assignedJobIds
import com.serviceflow.app.backend.budgets
import com.serviceflow.app.backend.mappedProjects
import com.serviceflow.app.backend.profile
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.serviceflow.app.backend.ServiceFlowAPI
import com.serviceflow.app.features.shell.ShellNavigator
import com.serviceflow.app.platform.LocationService
import com.serviceflow.app.platform.NotificationService
import com.serviceflow.core.ClockOutReason
import com.serviceflow.core.CompanyMembership
import com.serviceflow.core.CrewMember
import com.serviceflow.core.DisplayName
import com.serviceflow.core.ISODate
import com.serviceflow.core.JSONFileStore
import com.serviceflow.core.LocationAuthorization
import com.serviceflow.core.MediaClient
import com.serviceflow.core.MediaUploadQueue
import com.serviceflow.core.Project
import com.serviceflow.core.TimeEntry
import com.serviceflow.core.TimeTracker
import com.serviceflow.core.TrackingConstants
import com.serviceflow.core.UserStorage
import com.serviceflow.core.nonEmptyString
import com.serviceflow.core.get
import com.serviceflow.core.stringValue
import io.github.jan.supabase.auth.user.UserInfo
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import java.io.File
import java.time.Instant
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Everything that belongs to the signed-in person. Created at sign-in and
 * discarded at sign-out, so nothing leaks from one account to the next.
 *
 * Compose reads the `by mutableStateOf` properties directly; the tracker's
 * state is in its `StateFlow`s.
 */
class SessionContext(
    authUser: UserInfo,
    val api: ServiceFlowAPI,
    val config: AppConfig,
    val notifications: NotificationService,
    val location: LocationService,
    filesDir: File,
    /** Whether the app is on screen (the process lifecycle is at least started). */
    private val isForeground: () -> Boolean,
    /** Outlives the session: finishes uploads after sign-out or backgrounding. */
    private val appScope: CoroutineScope,
) {
    @Serializable
    private data class Profile(val fullName: String? = null, val email: String? = null)

    /** One-time prompts and answers, remembered per person. */
    private object Flag {
        const val ASKED_NOTIFICATIONS = "askedNotifications"
        const val ACTIVE_COMPANY = "activeCompany"
        fun answeredOverBudget(jobId: String) = "overBudget:$jobId"
    }

    /** Main-thread work for this session; cancelled by [stop]. */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    val user: CrewMember
    @OptIn(kotlin.time.ExperimentalTime::class)
    val accountCreatedAt: Instant? = authUser.createdAt?.let { Instant.ofEpochSecond(it.epochSeconds, it.nanosecondsOfSecond.toLong()) }
    val storage: UserStorage
    val tracker: TimeTracker
    /** Nil when the build has no media Worker configured. */
    val mediaClient: MediaClient?
    val uploads: MediaUploadQueue?

    /** The selected tab, each tab's back stack and the camera. */
    val navigator = ShellNavigator()

    var memberships by mutableStateOf<List<CompanyMembership>>(emptyList())
        private set
    /** The company being shown; a person invited by several switches in More. */
    var activeCompanyId by mutableStateOf<String?>(null)
        private set
    /** Changes when the company changes, so every screen reloads for it. */
    var companyGeneration by mutableIntStateOf(0)
        private set
    /** Scheduled and active jobs with coordinates, for the map and on-site checks. */
    var mappedProjects by mutableStateOf<List<Project>>(emptyList())
        private set
    var assignedJobIds by mutableStateOf<List<String>>(emptyList())
        private set
    var locationAuthorization by mutableStateOf(location.authorization)
        private set

    private val membershipStore: JSONFileStore<List<CompanyMembership>>
    private val flagsStore: JSONFileStore<Map<String, String>>
    private var loops: List<Job> = emptyList()
    private var started = false

    init {
        val userId = authUser.id.lowercase()
        storage = UserStorage(userId, UserStorage.defaultRoot(filesDir))
        val profileStore = storage.store("profile", Profile.serializer())
        val metadata = authUser.userMetadata
        val metadataName = metadata["full_name"].stringValue ?: metadata["name"].stringValue
        val name = DisplayName.resolve(profileName = profileStore.load()?.fullName, metadataName = metadataName, email = authUser.email)

        user = CrewMember(id = userId, email = authUser.email, name = name)
        membershipStore = storage.store("memberships", ListSerializer(CompanyMembership.serializer()))
        flagsStore = storage.store("flags", MapSerializer(String.serializer(), String.serializer()))
        memberships = membershipStore.load() ?: emptyList()

        tracker = TimeTracker(
            user = user, storage = storage, backend = api, location = location, reminders = notifications,
            appVersion = config.appVersion, uploadsLocation = config.locationTrackingEnabled, scope = scope,
        )
        mediaClient = config.mediaURL?.let { url -> MediaClient(baseURL = url, token = { api.accessToken() }) }
        uploads = mediaClient?.let { makeUploadQueue(it, storage, name, api) }

        connectPlatformCallbacks()
        scope.launch { refreshProfile(profileStore) }
    }

    private fun makeUploadQueue(client: MediaClient, storage: UserStorage, uploaderName: String,
                                api: ServiceFlowAPI): MediaUploadQueue {
        val queue = MediaUploadQueue(client = client, storage = storage, uploaderName = uploaderName, scope = scope)
        // Notes and drawings go up right after the photo, through the same
        // save path as edits to existing photos.
        queue.saveDetails = { remote, item ->
            savePhotoEdits(
                api = api, projectId = item.projectId, mediaId = remote.id,
                description = item.note, annotations = item.annotations,
                expected = PhotoRevisions(details = item.savedDetailsRevision?.toString()?.lowercase(),
                                          annotations = item.savedAnnotationsRevision?.toString()?.lowercase()),
                next = PhotoRevisionIds(item.detailsRevision ?: java.util.UUID.randomUUID(),
                                        item.annotationsRevision ?: java.util.UUID.randomUUID()),
            )
        }
        return queue
    }

    private fun connectPlatformCallbacks() {
        location.onFix = { point -> scope.launch { tracker.handleForegroundFix(point) } }
        location.onAuthorizationChange = { status ->
            locationAuthorization = status
            updateWatching()
        }
        notifications.onClockOutAction = { scope.launch { tracker.clockOut(reason = ClockOutReason.Notification) } }
        notifications.onReminderTap = { _ -> showClockIn() }
    }

    val displayName: String get() = user.name

    val activeCompany: CompanyMembership?
        get() = memberships.firstOrNull { it.orgId == activeCompanyId } ?: memberships.firstOrNull()

    /** Owners, admins and managers of the company being shown. */
    val isManager: Boolean get() = activeCompany?.isManager ?: false

    // MARK: Lifecycle

    fun start(loaded: List<CompanyMembership>) {
        // Offline, the last known memberships stay in place.
        if (loaded.isNotEmpty()) {
            memberships = loaded
            membershipStore.save(loaded)
        }
        val remembered = activeCompanyId ?: flag(Flag.ACTIVE_COMPANY)
        activeCompanyId = if (memberships.any { it.orgId == remembered }) remembered else memberships.firstOrNull()?.orgId
        api.activeOrgId = activeCompanyId
        if (started) return
        started = true
        tracker.projects = mappedProjects
        scope.launch { refreshProjects() }
        // Remote push isn't registered on Android yet (see NotificationService).
        didBecomeActive()
    }

    fun stop() {
        stopLoops()
        location.stopWatching()
        location.onFix = null
        location.onAuthorizationChange = null
        notifications.onClockOutAction = null
        notifications.onReminderTap = null
        scope.cancel()
    }

    fun didBecomeActive() {
        location.checkAuthorization()
        locationAuthorization = location.authorization
        startLoops()
        updateWatching()
        uploads?.resume()
        scope.launch {
            tracker.appDidBecomeActive()
            refreshAssignments()
            captureForegroundFix()
        }
    }

    fun didEnterBackground() {
        stopLoops()
        location.stopWatching()
        // Finish pending uploads of time and location while the process lives.
        appScope.launch { tracker.appDidEnterBackground() }
    }

    /** Foreground location updates run only during a shift. */
    fun updateWatching() {
        if (tracker.activeShift.value != null && isForeground()) {
            location.startWatching()
        } else {
            location.stopWatching()
        }
    }

    // MARK: Foreground loops

    private fun startLoops() {
        if (loops.isNotEmpty()) return
        loops = listOf(
            repeating(45.0) { tracker.refresh() },
            repeating(60.0) { refreshAssignments() },
            repeating(TrackingConstants.foregroundHeartbeat) { captureForegroundFix() },
        )
    }

    private fun stopLoops() {
        loops.forEach { it.cancel() }
        loops = emptyList()
    }

    private fun repeating(seconds: Double, work: suspend () -> Unit): Job = scope.launch {
        while (isActive) {
            delay((seconds * 1000).toLong())
            work()
        }
    }

    /** One fresh fix for the running shift (the heartbeat, and on returning to the app). */
    private suspend fun captureForegroundFix() {
        if (tracker.activeShift.value == null || !location.authorization.isAuthorized) return
        val point = location.currentPoint(TrackingConstants.clockInLocationTimeout) ?: return
        tracker.handleForegroundFix(point)
    }

    // MARK: Data

    private suspend fun refreshProfile(store: JSONFileStore<Profile>) {
        val row = runCatching { api.profile(userId = user.id) }.getOrNull() ?: return
        store.save(Profile(fullName = row["full_name"].nonEmptyString, email = row["email"].nonEmptyString))
    }

    /** Shows another of the person's companies. */
    fun selectCompany(orgId: String) {
        if (orgId == activeCompany?.orgId || memberships.none { it.orgId == orgId }) return
        activeCompanyId = orgId
        api.activeOrgId = orgId
        setFlag(Flag.ACTIVE_COMPANY, orgId)
        navigator.reset()
        mappedProjects = emptyList()
        assignedJobIds = emptyList()
        companyGeneration += 1
        scope.launch {
            refreshProjects()
            refreshAssignments()
        }
    }

    private suspend fun refreshProjects() {
        val projects = runCatching { api.mappedProjects() }.getOrNull() ?: return
        mappedProjects = projects
        tracker.projects = projects
    }

    private suspend fun refreshAssignments() {
        runCatching { api.assignedJobIds(userId = user.id) }.getOrNull()?.let { assignedJobIds = it }
    }

    // MARK: Navigation

    /** Pushes Project Detail on the current tab. */
    fun open(project: Project, action: ProjectRoute.Action? = null) = navigator.open(ProjectRoute(project, action))

    /** Shows the Clock In tab at its root. */
    fun showClockIn() = navigator.showClockIn()

    // MARK: Clocking from the UI

    /**
     * Clock in from a button; asks for notification permission once after
     * the first successful clock-in so shift reminders can be delivered.
     */
    suspend fun clockIn(project: Project): TimeEntry {
        val shift = tracker.clockIn(project)
        locationAuthorization = location.authorization
        updateWatching()
        if (flag(Flag.ASKED_NOTIFICATIONS) == null) {
            setFlag(Flag.ASKED_NOTIFICATIONS, "1")
            notifications.requestIfUndetermined()
        }
        return shift
    }

    suspend fun switchProject(to: Project): TimeEntry? {
        val shift = tracker.switchProject(to = to)
        updateWatching()
        return shift
    }

    suspend fun clockOut(reason: ClockOutReason): TimeEntry? {
        val entry = tracker.clockOut(reason = reason)
        updateWatching()
        return entry
    }

    // MARK: Over-budget prompt

    /**
     * Hours over budget when the job went over and the person hasn't been
     * asked about it yet; null otherwise.
     */
    suspend fun overBudgetHours(jobId: String): Double? {
        if (flag(Flag.answeredOverBudget(jobId)) != null) return null
        val progress = runCatching { api.budgets(jobIds = listOf(jobId))[jobId] }.getOrNull() ?: return null
        val percent = progress.percentUsed ?: return null
        val used = progress.hoursUsed ?: return null
        if (percent <= 100 || used <= 0) return null
        return max(0.0, used - used * 100 / percent)
    }

    /** Records the answer (null reason = skipped); asked once per job. */
    suspend fun answerOverBudget(jobId: String, reason: String?, note: String?, hoursOver: Double) {
        setFlag(Flag.answeredOverBudget(jobId), ISODate.string(Instant.now()))
        if (reason == null) return
        tracker.submitOverBudgetReason(jobId = jobId, reason = reason, note = note,
                                       minutesOver = (hoursOver * 60).roundToInt())
    }

    private fun flag(key: String): String? = flagsStore.load()?.get(key)

    private fun setFlag(key: String, value: String) {
        flagsStore.save((flagsStore.load() ?: emptyMap()) + (key to value))
    }

    // MARK: Sign-out

    suspend fun prepareForSignOut() = withContext(NonCancellable) {
        tracker.flushCommands()
        tracker.syncLocations()
        stop()
    }

    suspend fun eraseLocalData() = withContext(NonCancellable) {
        stop()
        tracker.eraseLocalData()
        storage.removeAll()
    }
}
