package com.serviceflow.app.features.shell

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import com.serviceflow.app.LocalSession
import com.serviceflow.app.MainTab
import com.serviceflow.app.ProjectRoute
import com.serviceflow.app.features.camera.CameraScreen
import com.serviceflow.app.features.clockin.ClockInScreen
import com.serviceflow.app.features.jobs.JobsScreen
import com.serviceflow.app.features.more.MoreScreen
import com.serviceflow.app.features.projectdetail.OverBudgetPrompt
import com.serviceflow.app.features.projectdetail.ProjectDetailScreen
import com.serviceflow.app.features.timesheet.TimesheetScreen

/**
 * The signed-in app: the navigation bar with one back stack per tab. Only the
 * selected tab is composed; the others keep their back stack and saved state.
 * Reselecting a tab returns it to its first screen.
 */
@Composable
fun MainShell() {
    val session = LocalSession.current
    val navigator = session.navigator
    // Switching company rebuilds every tab so each loads that company's data.
    key(session.companyGeneration) {
        val controllers = MainTab.entries.associateWith { rememberNavController() }
        DisposableEffect(controllers) {
            navigator.controllers.putAll(controllers)
            onDispose {
                controllers.forEach { (tab, controller) ->
                    if (navigator.controllers[tab] === controller) navigator.controllers.remove(tab)
                }
            }
        }
        val saveableState = rememberSaveableStateHolder()

        Box(Modifier.fillMaxSize()) {
            Scaffold(
                bottomBar = {
                    NavigationBar {
                        MainTab.entries.forEach { tab ->
                            NavigationBarItem(
                                selected = navigator.activeTab == tab,
                                onClick = {
                                    if (navigator.activeTab == tab) navigator.popToRoot(tab) else navigator.activeTab = tab
                                },
                                icon = { Icon(tab.icon, contentDescription = null) },
                                label = { Text(tab.title) },
                            )
                        }
                    }
                },
            ) { padding ->
                val tab = navigator.activeTab
                // Only the bar's height is used here; the status bar inset is left
                // for each screen's top app bar.
                val bar = PaddingValues(bottom = padding.calculateBottomPadding())
                Box(Modifier.fillMaxSize().padding(bar).consumeWindowInsets(bar)) {
                    saveableState.SaveableStateProvider(tab.name) {
                        TabHost(tab, controllers.getValue(tab), navigator)
                    }
                }
            }

            OverBudgetPrompt(navigator.overBudget, onDismiss = { navigator.overBudget = null })

            navigator.camera?.let { request ->
                val close = {
                    navigator.closeCamera()
                    request.onClose()
                }
                // CameraScreen may handle back itself (finishing its captures); this is the fallback.
                BackHandler(onBack = close)
                CameraScreen(
                    projectName = request.projectName,
                    projectId = request.projectId,
                    projectKind = request.projectKind,
                    onClose = close,
                    onCapture = request.onCapture,
                )
            }
        }
    }
}

/** A tab's first screen; `enabled` is false while another screen is pushed over it. */
@Composable
private fun TabRootScreen(tab: MainTab, controller: NavHostController) {
    val entry by controller.currentBackStackEntryAsState()
    val enabled = entry?.destination?.hasRoute<TabRoot>() ?: true
    when (tab) {
        MainTab.Clock -> ClockInScreen(enabled = enabled)
        MainTab.Projects -> JobsScreen(enabled = enabled)
        MainTab.Timesheet -> TimesheetScreen()
        MainTab.More -> MoreScreen()
    }
}

@Composable
private fun TabHost(tab: MainTab, controller: NavHostController, navigator: ShellNavigator) {
    val entry by controller.currentBackStackEntryAsState()
    val atRoot = entry?.destination?.hasRoute<TabRoot>() ?: true
    // Back from another tab's first screen returns to Clock In.
    BackHandler(enabled = tab != MainTab.Clock && atRoot) { navigator.activeTab = MainTab.Clock }

    NavHost(controller, startDestination = TabRoot) {
        composable<TabRoot> { TabRootScreen(tab, controller) }
        composable<ProjectDestination> { backStackEntry ->
            val route = navigator.registry.get<ProjectRoute>(backStackEntry.toRoute<ProjectDestination>().key)
            if (route != null) {
                ProjectDetailScreen(route = route, onBack = { controller.popBackStack() })
            } else {
                // The app was recreated and the route is gone.
                LaunchedEffect(Unit) { controller.popBackStack() }
            }
        }
        composable<PushedDestination> { backStackEntry ->
            val screen = navigator.registry.get<PushedScreen>(backStackEntry.toRoute<PushedDestination>().key)
            if (screen != null) {
                screen.content { controller.popBackStack() }
            } else {
                LaunchedEffect(Unit) { controller.popBackStack() }
            }
        }
    }
}
