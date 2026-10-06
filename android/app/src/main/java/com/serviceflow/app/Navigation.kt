package com.serviceflow.app

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Article
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.ui.graphics.vector.ImageVector
import com.serviceflow.core.Project
import com.serviceflow.core.ProjectKind
import java.util.UUID

enum class MainTab(val title: String, val icon: ImageVector) {
    Clock("Clock In", Icons.Outlined.Schedule),
    Projects("Jobs", Icons.Filled.Folder),
    Timesheet("Timesheet", Icons.AutoMirrored.Outlined.Article),
    More("More", Icons.Filled.MoreHoriz),
}

/** A pushed Project Detail. */
data class ProjectRoute(val project: Project, val action: Action? = null) {
    enum class Action { Photos, Camera }
}

/** The full-screen camera, opened over the whole app (tabs included). */
data class CameraRequest(
    val projectName: String,
    val projectId: String,
    val projectKind: ProjectKind,
    val onClose: () -> Unit,
    val onCapture: (() -> Unit)? = null,
)

/**
 * In-memory values behind navigation keys, so a route can carry a whole
 * [Project] (or a screen) without serialising it into the back stack.
 * Entries live for the signed-in session; a key whose value is gone (the
 * process was recreated) shows nothing and pops itself.
 */
class RouteRegistry {
    private val values = mutableMapOf<String, Any>()

    fun put(value: Any): String {
        val key = UUID.randomUUID().toString()
        values[key] = value
        return key
    }

    @Suppress("UNCHECKED_CAST")
    fun <T> get(key: String): T? = values[key] as? T

    fun remove(key: String) {
        values.remove(key)
    }

    fun clear() = values.clear()
}
