package com.serviceflow.app.features.projectdetail

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ProcessLifecycleOwner

/** Runs [action] each time the app comes back on screen (not when this first appears). */
@Composable
internal fun OnAppForeground(action: () -> Unit) {
    val current by rememberUpdatedState(action)
    DisposableEffect(Unit) {
        val lifecycle = ProcessLifecycleOwner.get().lifecycle
        // Adding the observer replays ON_START when the app is already on screen; that one is skipped.
        var seenStart = false
        val observer = LifecycleEventObserver { _, event ->
            if (event != Lifecycle.Event.ON_START) return@LifecycleEventObserver
            if (seenStart) current() else seenStart = true
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
}
