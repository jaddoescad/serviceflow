package com.serviceflow.app.features.onboarding

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Business
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.serviceflow.app.LocalAppModel
import com.serviceflow.app.backend.createCompany
import com.serviceflow.app.design.AuthPalette
import com.serviceflow.app.design.Palette
import com.serviceflow.app.design.rememberRequestState
import com.serviceflow.app.features.auth.AuthFooter
import com.serviceflow.app.features.auth.AuthForm
import com.serviceflow.app.features.auth.AuthLogo
import com.serviceflow.app.features.auth.AuthPicker
import com.serviceflow.app.features.auth.AuthPrimaryButton
import com.serviceflow.app.features.auth.AuthTextField
import com.serviceflow.app.features.auth.BrandTint
import com.serviceflow.app.features.more.DeleteAccountSheet
import com.serviceflow.core.AccountValidation
import kotlinx.coroutines.launch

/** Shown to a signed-in person who doesn't belong to a company yet. */
@Composable
fun OnboardingScreen() {
    var creating by rememberSaveable { mutableStateOf(false) }
    BackHandler(enabled = creating) { creating = false }
    BrandTint {
        if (creating) CreateCompanyScreen(onBack = { creating = false }) else WelcomeScreen(onCreate = { creating = true })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun WelcomeScreen(onCreate: () -> Unit) {
    val model = LocalAppModel.current
    val scope = rememberCoroutineScope()
    var showDelete by remember { mutableStateOf(false) }
    var checking by remember { mutableStateOf(false) }

    Scaffold(topBar = { TopAppBar(title = { Text("Welcome") }) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState())) {
            AuthLogo()
            Text(
                "Track time, photos and job progress with your crew.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            )

            ListItem(
                headlineContent = { Text("Create a company", style = MaterialTheme.typography.titleMedium) },
                supportingContent = { Text("For owners and managers. Invite your crew next.") },
                leadingContent = { Icon(Icons.Filled.Business, contentDescription = null, tint = AuthPalette.brand) },
                trailingContent = { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null) },
                modifier = Modifier.padding(top = 8.dp).clickable(onClick = onCreate),
            )

            HorizontalDivider()
            Text(
                "Joining your team?",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 4.dp),
            )
            ListItem(
                headlineContent = { Text("Check Again", color = MaterialTheme.colorScheme.primary.copy(alpha = if (checking) 0.38f else 1f)) },
                trailingContent = if (checking) {
                    { CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(20.dp)) }
                } else {
                    null
                },
                modifier = Modifier.clickable(enabled = !checking) {
                    checking = true
                    scope.launch {
                        model.refreshAccount()
                        checking = false
                    }
                },
            )
            Text(
                "Ask your company to invite ${model.session?.user?.email ?: "your email"}. You'll join as soon as they do.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )

            HorizontalDivider(Modifier.padding(top = 16.dp))
            ListItem(
                headlineContent = { Text("Sign Out", color = MaterialTheme.colorScheme.primary) },
                modifier = Modifier.clickable { model.scope.launch { model.signOut() } },
            )
            ListItem(
                headlineContent = { Text("Delete Account", color = Palette.red) },
                modifier = Modifier.clickable { showDelete = true },
            )
        }
    }

    if (showDelete) {
        DeleteAccountSheet(
            onDismiss = { showDelete = false },
            onDeleted = { model.scope.launch { model.accountDeleted() } },
        )
    }
}

private val trades = listOf(
    "Painting", "Cleaning", "Landscaping", "Construction", "Electrical", "Plumbing", "HVAC",
    "Roofing", "Flooring", "Handyman", "Other",
)

@Composable
private fun CreateCompanyScreen(onBack: () -> Unit) {
    val model = LocalAppModel.current
    var name by rememberSaveable { mutableStateOf("") }
    var trade by rememberSaveable { mutableStateOf("") }
    val request = rememberRequestState()

    fun create() {
        val companyName = name.trim()
        AccountValidation.companyName(companyName)?.let {
            request.error = it
            return
        }
        val api = model.api ?: return
        val chosenTrade = trade.ifEmpty { null }
        request.run {
            api.createCompany(name = companyName, trade = chosenTrade)
            model.refreshAccount()
        }
    }

    AuthForm(title = "New Company", onBack = onBack) {
        AuthTextField(
            label = "Company name", value = name, onValueChange = { name = it; request.error = null },
            capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Done,
        )
        AuthPicker(
            label = "Trade",
            options = listOf("" to "Choose…") + trades.map { it to it },
            selected = trade,
            onSelect = { trade = it },
            modifier = Modifier.padding(top = 8.dp),
        )
        AuthFooter(error = request.error, hint = "You'll be the owner. You can change these details later.")
        AuthPrimaryButton(title = "Create Company", busy = request.isRunning, enabled = true, onClick = ::create)
    }
}
