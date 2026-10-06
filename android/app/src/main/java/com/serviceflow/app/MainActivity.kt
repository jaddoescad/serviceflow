package com.serviceflow.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import com.serviceflow.app.design.ServiceFlowTheme

class MainActivity : ComponentActivity() {
    private val model: AppModel get() = (application as ServiceFlowApplication).model

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Light only, like the iOS app.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT),
        )
        // Must register before the activity starts; results also reach a recreated activity.
        model.permissions.attach(this)
        if (savedInstanceState == null) model.notifications.handle(intent)

        setContent {
            ServiceFlowTheme {
                CompositionLocalProvider(LocalAppModel provides model) {
                    RootView()
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        model.notifications.handle(intent)
    }

    override fun onDestroy() {
        model.permissions.detach(this)
        super.onDestroy()
    }
}
