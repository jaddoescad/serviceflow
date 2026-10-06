package com.serviceflow.app

import com.serviceflow.app.backend.acceptMyInvitations
import com.serviceflow.app.backend.maintenanceMode
import com.serviceflow.app.backend.memberships
import com.serviceflow.app.backend.signOut
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import com.serviceflow.app.backend.ServiceFlowAPI
import com.serviceflow.app.platform.LocationService
import com.serviceflow.app.platform.NotificationService
import com.serviceflow.app.platform.PermissionBridge
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.status.SessionSource
import io.github.jan.supabase.auth.status.SessionStatus
import io.github.jan.supabase.auth.user.UserInfo
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.launch

/** Root state: who is signed in and which top-level screen shows. Lives as long as the process. */
class AppModel(context: Context) {
    enum class Phase {
        Booting,
        SignedOut,
        /** Signed in but not a member of any company yet. */
        Onboarding,
        Maintenance,
        Main,
        Misconfigured,
    }

    private val appContext = context.applicationContext
    /** Main-thread work that outlives any one session. */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    var phase by mutableStateOf(Phase.Booting)
        private set
    var session by mutableStateOf<SessionContext?>(null)
        private set
    /**
     * Set while a sign-up flow still has to choose a password; keeps the
     * auth screens up after the email code signs the person in.
     */
    var holdAuthFlow = false

    val config: AppConfig? = AppConfig.current
    val api: ServiceFlowAPI? = config?.let(::ServiceFlowAPI)
    /** System permission prompts; the activity attaches itself. */
    val permissions = PermissionBridge()
    val notifications = NotificationService(appContext, permissions)
    val location = LocationService(appContext, permissions)
    private var currentUserId: String? = null

    init {
        if (api == null) {
            phase = Phase.Misconfigured
        } else {
            scope.launch { watchAuth(api) }
        }
    }

    private suspend fun watchAuth(api: ServiceFlowAPI) {
        api.client.auth.sessionStatus.collect { status ->
            when (status) {
                is SessionStatus.Authenticated -> {
                    val user = status.session.user ?: return@collect
                    // Token refreshes also arrive here; nothing changes for the same person.
                    if (status.source is SessionSource.Refresh && currentUserId == user.id.lowercase()) return@collect
                    signedIn(user)
                }
                // A stored session opens the app offline; a refresh that the
                // server refuses clears the session and arrives as NotAuthenticated.
                is SessionStatus.RefreshFailure -> {
                    val user = api.client.auth.currentUserOrNull()
                        ?: runCatching { api.client.auth.sessionManager.loadSession()?.user }.getOrNull()
                    if (user != null) signedIn(user) else signedOut()
                }
                is SessionStatus.NotAuthenticated -> signedOut()
                SessionStatus.Initializing -> Unit
            }
        }
    }

    private suspend fun signedIn(user: UserInfo) {
        val api = api ?: return
        val config = config ?: return
        val userId = user.id.lowercase()
        if (currentUserId != userId) {
            session?.stop()
            currentUserId = userId
            session = SessionContext(
                authUser = user, api = api, config = config, notifications = notifications, location = location,
                filesDir = appContext.filesDir, isForeground = ::isForeground, appScope = scope,
            )
        }
        refreshAccount()
    }

    private fun signedOut() {
        session?.stop()
        session = null
        currentUserId = null
        holdAuthFlow = false
        phase = Phase.SignedOut
    }

    /** Reloads memberships and the maintenance flag, and picks the screen. */
    suspend fun refreshAccount() {
        val api = api ?: return
        val session = session ?: return
        if (holdAuthFlow) {
            phase = Phase.SignedOut
            return
        }
        val maintenance = scope.async { api.maintenanceMode() }
        // Companies that invited this email are joined before anything loads.
        runCatching { api.acceptMyInvitations() }
        // Null when offline: carry on with the memberships cached on the device.
        val loaded = runCatching { api.memberships(userId = session.user.id) }.getOrNull()
        when {
            maintenance.await() -> phase = Phase.Maintenance
            loaded?.isEmpty() == true -> phase = Phase.Onboarding
            else -> {
                phase = Phase.Main
                session.start(loaded ?: emptyList())
            }
        }
    }

    /** Called once the sign-up flow has set a password. */
    suspend fun finishAuthFlow() {
        holdAuthFlow = false
        refreshAccount()
    }

    suspend fun signOut() {
        session?.prepareForSignOut()
        api?.signOut()
        signedOut()
    }

    suspend fun accountDeleted() {
        session?.eraseLocalData()
        api?.signOut()
        signedOut()
    }

    // MARK: App lifecycle

    private fun isForeground(): Boolean =
        ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)

    /** The app came on screen or left it (from `ProcessLifecycleOwner`). */
    fun foregroundChanged(foreground: Boolean) {
        val session = session ?: return
        if (phase != Phase.Main) return
        if (foreground) session.didBecomeActive() else session.didEnterBackground()
    }
}
