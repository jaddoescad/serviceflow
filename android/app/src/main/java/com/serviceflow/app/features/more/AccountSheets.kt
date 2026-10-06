package com.serviceflow.app.features.more

import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Circle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ModalBottomSheetProperties
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SheetValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.serviceflow.app.LocalAppModel
import com.serviceflow.app.LocalSession
import com.serviceflow.app.backend.AccountDeletionResult
import com.serviceflow.app.backend.PendingInvitation
import com.serviceflow.app.backend.deleteAccount
import com.serviceflow.app.backend.invite
import com.serviceflow.app.backend.pendingInvitations
import com.serviceflow.app.backend.revokeInvitation
import com.serviceflow.app.design.Palette
import com.serviceflow.app.design.rememberRequestState
import com.serviceflow.app.features.auth.AuthFooter
import com.serviceflow.app.features.auth.AuthPicker
import com.serviceflow.app.features.auth.AuthPrimaryButton
import com.serviceflow.app.features.auth.AuthTextField
import com.serviceflow.app.features.auth.BrandTint
import com.serviceflow.core.AccountValidation
import com.serviceflow.core.CompanyMembership
import kotlinx.coroutines.launch

/** A full-height sheet with a title; it can't be dismissed while [locked]. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountSheet(title: String, onDismiss: () -> Unit, locked: Boolean = false, content: @Composable ColumnScope.(close: () -> Unit) -> Unit) {
    val isLocked by rememberUpdatedState(locked)
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { it != SheetValue.Hidden || !isLocked })
    val scope = rememberCoroutineScope()
    val close: () -> Unit = { scope.launch { state.hide() }.invokeOnCompletion { onDismiss() } }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = state,
        properties = ModalBottomSheetProperties(shouldDismissOnBackPress = !locked),
    ) {
        Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 8.dp))
        Column(
            Modifier
                .fillMaxWidth()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 24.dp),
        ) { content(close) }
    }
}

/** In-app account deletion (Play account deletion policy, App Store 5.1.1(v)). */
@Composable
fun DeleteAccountSheet(onDismiss: () -> Unit, onDeleted: () -> Unit) {
    val model = LocalAppModel.current
    var confirmation by remember { mutableStateOf("") }
    val request = rememberRequestState()
    val confirmed = confirmation.trim().uppercase() == "DELETE"

    AccountSheet(title = "Delete Account", onDismiss = onDismiss, locked = request.isRunning) { close ->
        SectionLabel("What happens")
        listOf(
            "Your login is removed and you can't sign in again.",
            "You leave every company you belong to, and your devices and location history are deleted.",
            "Time entries and photos you recorded stay with your company for payroll and job records, shown as “Deleted user”.",
            "If you're the last admin of a company with other members, make someone else an admin first.",
        ).forEach { Bullet(it) }

        SectionLabel("Type DELETE to confirm", Modifier.padding(top = 16.dp))
        OutlinedTextField(
            value = confirmation,
            onValueChange = { confirmation = it },
            placeholder = { Text("DELETE") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false,
                imeAction = ImeAction.Done),
            modifier = Modifier.fillMaxWidth(),
        )
        AuthFooter(error = request.error)
        AuthPrimaryButton(title = "Delete Account", busy = request.isRunning, enabled = confirmed, destructive = true) {
            val api = model.api ?: return@AuthPrimaryButton
            if (!confirmed) return@AuthPrimaryButton
            request.run {
                when (val result = api.deleteAccount()) {
                    AccountDeletionResult.Deleted -> {
                        close()
                        onDeleted()
                    }
                    is AccountDeletionResult.Blocked -> request.error = result.message
                    is AccountDeletionResult.Failed -> request.error = result.message
                }
            }
        }
    }
}

@Composable
private fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary, modifier = modifier.padding(bottom = 8.dp))
}

@Composable
private fun Bullet(text: String) {
    Row(Modifier.padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Icon(Icons.Filled.Circle, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 7.dp).size(6.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium)
    }
}

/**
 * Invites people to the company by email. They join automatically the next
 * time they sign in to ServiceFlow with that address.
 */
@Composable
fun InviteCrewSheet(onDismiss: () -> Unit) {
    val session = LocalSession.current
    val context = LocalContext.current
    var email by remember { mutableStateOf("") }
    var role by remember { mutableStateOf(CompanyMembership.Role.Crew) }
    var invited by remember { mutableStateOf<PendingInvitation?>(null) }
    var pending by remember { mutableStateOf<List<PendingInvitation>>(emptyList()) }
    val request = rememberRequestState()

    val company = session.activeCompany
    val canInviteAdmins = company?.role == CompanyMembership.Role.Owner || company?.role == CompanyMembership.Role.Admin

    suspend fun loadPending() {
        val orgId = company?.orgId ?: return
        runCatching { session.api.pendingInvitations(orgId = orgId) }.getOrNull()?.let { pending = it }
    }
    LaunchedEffect(Unit) { loadPending() }

    fun invite() {
        val address = email.trim().lowercase()
        AccountValidation.email(address)?.let {
            request.error = it
            return
        }
        val orgId = company?.orgId ?: return
        val chosen = role
        request.run {
            val result = session.api.invite(email = address, role = chosen, orgId = orgId)
            invited = PendingInvitation.fromRow(result)
            email = ""
            loadPending()
        }
    }

    fun revoke(invitation: PendingInvitation) {
        request.run {
            session.api.revokeInvitation(id = invitation.id)
            loadPending()
        }
    }

    fun share(invitation: PendingInvitation) {
        val text = "You're invited to join ${company?.name ?: "our company"} on ServiceFlow. Install the app and sign in with ${invitation.email}."
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
        context.startActivity(Intent.createChooser(send, null))
    }

    BrandTint(Palette.teal) {
        AccountSheet(title = "Invite Crew", onDismiss = onDismiss) {
            AuthTextField(
                label = "Email address", value = email, onValueChange = { email = it; request.error = null },
                content = ContentType.EmailAddress, keyboard = KeyboardType.Email, imeAction = ImeAction.Send, onSubmit = ::invite,
            )
            val roles = buildList {
                add(CompanyMembership.Role.Crew to "Crew")
                add(CompanyMembership.Role.Manager to "Manager")
                if (canInviteAdmins) add(CompanyMembership.Role.Admin to "Admin")
            }
            AuthPicker(label = "Role", options = roles, selected = role, onSelect = { role = it }, modifier = Modifier.padding(top = 8.dp))
            AuthFooter(error = request.error, hint = "They join ${company?.name ?: "your company"} when they sign in to ServiceFlow with this email.")
            AuthPrimaryButton(title = "Send Invite", busy = request.isRunning, enabled = AccountValidation.email(email) == null, onClick = ::invite)

            invited?.let { invitation ->
                ListItem(
                    headlineContent = { Text("Let ${invitation.email} Know", color = MaterialTheme.colorScheme.primary) },
                    leadingContent = { Icon(Icons.Outlined.Share, contentDescription = null, tint = MaterialTheme.colorScheme.primary) },
                    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                    modifier = Modifier.padding(top = 16.dp).clickable { share(invitation) },
                )
                AuthFooter(error = null, hint = "Invited ${invitation.email}. Send them a message so they know to install ServiceFlow.")
            }

            if (pending.isNotEmpty()) {
                SectionLabel("Waiting to join", Modifier.padding(top = 24.dp))
                pending.forEach { invitation ->
                    ListItem(
                        headlineContent = { Text(invitation.email) },
                        supportingContent = { Text(invitation.role.label) },
                        trailingContent = {
                            IconButton(onClick = { revoke(invitation) }, enabled = !request.isRunning) {
                                Icon(Icons.Outlined.Close, contentDescription = "Cancel Invite")
                            }
                        },
                        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                    )
                }
            }
        }
    }
}

val CompanyMembership.Role.label: String
    get() = when (this) {
        CompanyMembership.Role.Owner -> "Owner"
        CompanyMembership.Role.Admin -> "Admin"
        CompanyMembership.Role.Manager -> "Manager"
        CompanyMembership.Role.Crew -> "Crew"
    }
