package com.serviceflow.app.features.shell

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
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
import com.serviceflow.app.design.Palette
import com.serviceflow.app.design.appText
import com.serviceflow.app.design.hex
import com.serviceflow.app.features.camera.CameraScreen
import com.serviceflow.app.features.clockin.ClockInScreen
import com.serviceflow.app.features.jobs.JobsScreen
import com.serviceflow.app.features.more.MoreScreen
import com.serviceflow.app.features.projectdetail.OverBudgetPrompt
import com.serviceflow.app.features.projectdetail.ProjectDetailScreen
import com.serviceflow.app.features.timesheet.TimesheetScreen
import com.serviceflow.app.features.today.TodayScreen

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
                    TabBar(
                        tabs = MainTab.entries.filter { it != MainTab.Today || session.isManager },
                        active = navigator.activeTab,
                        onSelect = { tab ->
                            if (navigator.activeTab == tab) navigator.popToRoot(tab) else navigator.activeTab = tab
                        },
                    )
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

/**
 * The tabs as a floating bar, like the iOS app's: the selected tab sits in a
 * soft pill with a filled icon in the brand colour.
 */
@Composable
private fun TabBar(tabs: List<MainTab>, active: MainTab, onSelect: (MainTab) -> Unit) {
    val bar = RoundedCornerShape(30.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(start = 12.dp, end = 12.dp, top = 6.dp, bottom = 8.dp)
            .shadow(10.dp, bar, ambientColor = Color.Black.copy(alpha = 0.12f), spotColor = Color.Black.copy(alpha = 0.18f))
            .background(Color.White, bar)
            .border(0.5.dp, Palette.border, bar)
            .padding(4.dp)
            .selectableGroup(),
    ) {
        tabs.forEach { tab ->
            val selected = tab == active
            val color = if (selected) Palette.green else Palette.ink.copy(alpha = 0.78f)
            Column(
                Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(26.dp))
                    .background(if (selected) hex(0xebefee) else Color.Transparent)
                    .selectable(selected = selected, role = Role.Tab, onClick = { onSelect(tab) })
                    .padding(vertical = 7.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Icon(if (selected) tab.selectedIcon else tab.icon, contentDescription = null, tint = color, modifier = Modifier.size(24.dp))
                Text(tab.title, style = appText(11, if (selected) FontWeight.SemiBold else FontWeight.Medium, color), maxLines = 1)
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
        MainTab.Today -> TodayScreen(enabled = enabled)
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
    // Back from another tab's first screen returns to the first tab (Today for managers).
    val home = if (LocalSession.current.isManager) MainTab.Today else MainTab.Clock
    BackHandler(enabled = tab != home && atRoot) { navigator.activeTab = home }

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
