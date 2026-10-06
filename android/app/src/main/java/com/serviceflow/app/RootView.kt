package com.serviceflow.app

import androidx.compose.animation.Crossfade
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.serviceflow.app.design.Palette
import com.serviceflow.app.design.Spinner
import com.serviceflow.app.design.appText
import com.serviceflow.app.features.auth.AuthFlowScreen
import com.serviceflow.app.features.onboarding.OnboardingScreen
import com.serviceflow.app.features.shell.MainShell
import kotlinx.coroutines.launch

@Composable
fun RootView() {
    val model = LocalAppModel.current
    Box(Modifier.fillMaxSize()) {
        // When a focused field disappears (signing in), Android asks the window
        // for focus again and Compose gives it to the top-left-most focusable:
        // without this 1dp target in the corner, the next screen's search
        // field, which opens the keyboard.
        Box(Modifier.size(1.dp).focusable())
        Crossfade(targetState = model.phase, label = "phase") { phase ->
            when (phase) {
                AppModel.Phase.Booting -> Box(Modifier.fillMaxSize().background(Color.White), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = Palette.teal)
                }
                AppModel.Phase.SignedOut -> AuthFlowScreen()
                AppModel.Phase.Onboarding -> OnboardingScreen()
                AppModel.Phase.Maintenance -> MaintenanceView()
                AppModel.Phase.Main -> model.session?.let { session ->
                    CompositionLocalProvider(LocalSession provides session, LocalTracker provides session.tracker) {
                        MainShell()
                    }
                }
                AppModel.Phase.Misconfigured -> MessageScreen(
                    title = "ServiceFlow isn't set up",
                    message = "This build is missing its server configuration. Install the version from Google Play.",
                )
            }
        }
    }
}

/** Centred title and body on white (maintenance, configuration errors). */
@Composable
fun MessageScreen(title: String, message: String, footer: @Composable ColumnScope.() -> Unit = {}) {
    Box(Modifier.fillMaxSize().background(Color.White).safeDrawingPadding(), contentAlignment = Alignment.Center) {
        Column(Modifier.padding(horizontal = 32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(title, style = appText(22, FontWeight.Black, Palette.ink), textAlign = TextAlign.Center)
            Text(
                message,
                style = appText(15, FontWeight.Normal, Palette.muted).copy(lineHeight = 22.sp),
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 12.dp),
            )
            footer()
        }
    }
}

@Composable
fun MaintenanceView() {
    val model = LocalAppModel.current
    val scope = rememberCoroutineScope()
    var checking by remember { mutableStateOf(false) }
    MessageScreen(
        title = "Database upgrade in progress",
        message = "ServiceFlow is temporarily paused while your jobs and time records are verified. Please try again shortly.",
    ) {
        Spacer(Modifier.height(28.dp))
        Column(verticalArrangement = Arrangement.spacedBy(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Button(
                onClick = {
                    checking = true
                    scope.launch {
                        model.refreshAccount()
                        checking = false
                    }
                },
                enabled = !checking,
                colors = ButtonDefaults.buttonColors(containerColor = Palette.green),
                modifier = Modifier.fillMaxWidth().height(50.dp),
            ) {
                if (checking) Spinner(Color.White) else Text("Try Again", fontWeight = FontWeight.SemiBold)
            }
            TextButton(onClick = { scope.launch { model.signOut() } }) {
                Text("Sign Out", color = Palette.muted)
            }
        }
    }
}
