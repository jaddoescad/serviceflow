package com.serviceflow.app

import androidx.compose.runtime.staticCompositionLocalOf
import com.serviceflow.core.TimeTracker

/** The app model, provided by [MainActivity]. */
val LocalAppModel = staticCompositionLocalOf<AppModel> { error("No AppModel provided") }

/** The signed-in session, provided around the main shell (phase `Main`). */
val LocalSession = staticCompositionLocalOf<SessionContext> { error("No SessionContext provided") }

/** The session's time tracker; read its `StateFlow`s with `collectAsStateWithLifecycle()`. */
val LocalTracker = staticCompositionLocalOf<TimeTracker> { error("No TimeTracker provided") }
