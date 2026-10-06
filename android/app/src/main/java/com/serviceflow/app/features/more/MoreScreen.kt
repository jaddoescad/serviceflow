package com.serviceflow.app.features.more

import android.text.format.DateFormat
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.serviceflow.app.LocalAppModel
import com.serviceflow.app.LocalSession
import com.serviceflow.app.LocalTracker
import com.serviceflow.app.design.Palette
import com.serviceflow.app.features.auth.BrandTint
import com.serviceflow.core.ClockOutReason
import com.serviceflow.core.TrackingMode
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private enum class MoreSheet { Invite, Delete }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MoreScreen() {
    val model = LocalAppModel.current
    val session = LocalSession.current
    val tracker = LocalTracker.current
    val activeShift by tracker.activeShift.collectAsStateWithLifecycle()
    val locationStatus by tracker.locationStatus.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()

    var pendingChanges by remember { mutableIntStateOf(0) }
    var confirmSignOut by remember { mutableStateOf(false) }
    var sheet by remember { mutableStateOf<MoreSheet?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    LaunchedEffect(activeShift?.localId) { pendingChanges = tracker.pendingCommandCount() }

    // Sign-out outlives this screen, so it runs on the app's scope.
    fun signOut() {
        model.scope.launch { model.signOut() }
    }

    val company = session.activeCompany
    val authorized = session.locationAuthorization.isAuthorized
    val locationTitle = when {
        activeShift == null -> "Off while clocked out"
        !authorized -> "Not recorded"
        locationStatus?.mode == TrackingMode.Painting -> "On site"
        locationStatus?.mode == TrackingMode.Travel -> "Away from job site"
        else -> "Waiting for location"
    }

    BrandTint(Palette.teal) {
        Scaffold(topBar = { TopAppBar(title = { Text("More") }) }) { padding ->
            PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = {
                    scope.launch {
                        refreshing = true
                        model.refreshAccount()
                        pendingChanges = tracker.pendingCommandCount()
                        refreshing = false
                    }
                },
                modifier = Modifier.fillMaxSize().padding(padding),
            ) {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    Subheader("Signed in as")
                    ListItem(
                        headlineContent = { Text(session.displayName, style = MaterialTheme.typography.titleMedium) },
                        supportingContent = session.user.email?.let { email -> { Text(email) } },
                    )

                    HorizontalDivider()
                    Subheader("Company")
                    if (session.memberships.size > 1) {
                        // Invited by more than one company: pick the one to show.
                        CompanyPicker()
                    } else if (company != null) {
                        Labeled("Company", company.name)
                    }
                    if (company != null) Labeled("Role", company.role.label)
                    if (session.isManager) {
                        ListItem(
                            headlineContent = { Text("Invite Crew", color = MaterialTheme.colorScheme.primary) },
                            leadingContent = { Icon(Icons.Outlined.PersonAdd, contentDescription = null, tint = MaterialTheme.colorScheme.primary) },
                            modifier = Modifier.clickable { sheet = MoreSheet.Invite },
                        )
                    }

                    HorizontalDivider()
                    Subheader("Location")
                    ListItem(
                        headlineContent = { Text("Status") },
                        trailingContent = {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Box(Modifier.size(8.dp).background(if (activeShift != null) Palette.teal else Palette.muted, CircleShape))
                                Text(locationTitle)
                            }
                        },
                    )
                    activeShift?.let { shift ->
                        Labeled("Last location", diagnosticTime(shift.lastLocation?.capturedAt))
                        Labeled("Access", if (authorized) "While using the app" else "Not allowed")
                    }
                    if (pendingChanges > 0) {
                        Labeled("Waiting to sync", if (pendingChanges == 1) "1 time change" else "$pendingChanges time changes")
                    }
                    Footer("ServiceFlow records your location when you clock in, when you clock out, and while the app is open during a shift.")

                    HorizontalDivider(Modifier.padding(top = 16.dp))
                    ListItem(
                        headlineContent = { Text("Sign Out", color = MaterialTheme.colorScheme.primary) },
                        modifier = Modifier.clickable { if (activeShift != null) confirmSignOut = true else signOut() },
                    )
                    ListItem(
                        headlineContent = { Text("Delete Account", color = Palette.red) },
                        modifier = Modifier.clickable { sheet = MoreSheet.Delete },
                    )
                    Text(
                        "ServiceFlow ${session.config.appVersion} (${session.config.buildNumber})",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth().padding(top = 16.dp, bottom = 24.dp),
                    )
                }
            }
        }

        if (confirmSignOut) {
            AlertDialog(
                onDismissRequest = { confirmSignOut = false },
                title = { Text("You're still clocked in") },
                text = { Text("Your shift keeps running if you only sign out. It's saved on this phone and continues when you sign back in.") },
                confirmButton = {
                    Column(horizontalAlignment = Alignment.End) {
                        TextButton(onClick = {
                            confirmSignOut = false
                            model.scope.launch {
                                session.clockOut(reason = ClockOutReason.Manual)
                                model.signOut()
                            }
                        }) { Text("Clock Out and Sign Out", color = Palette.red) }
                        TextButton(onClick = {
                            confirmSignOut = false
                            signOut()
                        }) { Text("Sign Out, Stay Clocked In") }
                        TextButton(onClick = { confirmSignOut = false }) { Text("Cancel") }
                    }
                },
            )
        }

        when (sheet) {
            MoreSheet.Invite -> InviteCrewSheet(onDismiss = { sheet = null })
            MoreSheet.Delete -> DeleteAccountSheet(
                onDismiss = { sheet = null },
                onDeleted = { model.scope.launch { model.accountDeleted() } },
            )
            null -> Unit
        }
    }
}

@Composable
private fun CompanyPicker() {
    val session = LocalSession.current
    var expanded by remember { mutableStateOf(false) }
    Box {
        ListItem(
            headlineContent = { Text("Company") },
            trailingContent = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(session.activeCompany?.name ?: "")
                    Icon(Icons.Filled.ArrowDropDown, contentDescription = null)
                }
            },
            modifier = Modifier.clickable { expanded = true },
        )
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }, modifier = Modifier.align(Alignment.TopEnd)) {
            session.memberships.forEach { membership ->
                DropdownMenuItem(
                    text = { Text(membership.name) },
                    onClick = {
                        expanded = false
                        session.selectCompany(membership.orgId)
                    },
                )
            }
        }
    }
}

@Composable
private fun Subheader(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 4.dp),
    )
}

@Composable
private fun Labeled(label: String, value: String) {
    ListItem(
        headlineContent = { Text(label) },
        trailingContent = { Text(value, style = MaterialTheme.typography.bodyMedium) },
    )
}

@Composable
private fun Footer(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
    )
}

private fun diagnosticTime(date: Instant?): String {
    date ?: return "Not received yet"
    val locale = Locale.getDefault()
    val pattern = DateFormat.getBestDateTimePattern(locale, "MMMdjmm")
    return DateTimeFormatter.ofPattern(pattern, locale).withZone(ZoneId.systemDefault()).format(date)
}
