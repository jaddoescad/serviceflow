package com.serviceflow.app.features.shell

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.navigation.NavHostController
import com.serviceflow.app.CameraRequest
import com.serviceflow.app.MainTab
import com.serviceflow.app.ProjectRoute
import com.serviceflow.app.RouteRegistry
import com.serviceflow.app.design.OverBudgetPromptItem
import kotlinx.serialization.Serializable

/** Each tab's first screen. */
@Serializable
internal object TabRoot

/** Project Detail; the [ProjectRoute] lives in the [RouteRegistry]. */
@Serializable
internal data class ProjectDestination(val key: String)

/** Any other pushed screen (a timesheet day, an edit form…). */
@Serializable
internal data class PushedDestination(val key: String)

internal class PushedScreen(val content: @Composable (onBack: () -> Unit) -> Unit)

/**
 * The selected tab, one back stack per tab and the full-screen camera.
 * Owned by the session, so it is dropped at sign-out; [MainShell] attaches a
 * `NavHostController` per tab while it is on screen.
 */
class ShellNavigator {
    var activeTab by mutableStateOf(MainTab.Clock)

    /** The camera shown over the whole app, if open. */
    var camera by mutableStateOf<CameraRequest?>(null)
        private set

    /** The over-budget question after a Clock In tab clock-out; shown above whatever screen follows it. */
    var overBudget by mutableStateOf<OverBudgetPromptItem?>(null)

    internal val registry = RouteRegistry()
    internal val controllers = mutableMapOf<MainTab, NavHostController>()

    /** Pushes Project Detail on the current tab. */
    fun open(route: ProjectRoute) {
        controllers[activeTab]?.navigate(ProjectDestination(registry.put(route)))
    }

    /** Pushes any screen on [tab] (default: the current one). */
    fun push(tab: MainTab = activeTab, content: @Composable (onBack: () -> Unit) -> Unit) {
        controllers[tab]?.navigate(PushedDestination(registry.put(PushedScreen(content))))
    }

    /** Goes back one screen on [tab]. */
    fun pop(tab: MainTab = activeTab) {
        controllers[tab]?.popBackStack()
    }

    /** Returns [tab] to its first screen. */
    fun popToRoot(tab: MainTab) {
        controllers[tab]?.popBackStack(TabRoot, inclusive = false)
    }

    /** Shows the Clock In tab at its root. */
    fun showClockIn() {
        MainTab.entries.forEach(::popToRoot)
        activeTab = MainTab.Clock
    }

    fun openCamera(request: CameraRequest) {
        camera = request
    }

    internal fun closeCamera() {
        camera = null
    }

    /** Forgets every tab's screens (company switch). */
    internal fun reset() {
        controllers.clear()
        registry.clear()
        camera = null
    }
}
