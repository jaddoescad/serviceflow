package com.serviceflow.app.platform

import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import kotlinx.coroutines.CompletableDeferred
import java.lang.ref.WeakReference

/**
 * Lets app-level services show a system permission prompt. [MainActivity]
 * attaches itself in `onCreate`; [request] suspends until the person answers.
 * A result that arrives after the activity is recreated is delivered to the
 * new activity's launcher, which completes the same request.
 */
class PermissionBridge {
    private var activity = WeakReference<ComponentActivity>(null)
    private var launcher: ActivityResultLauncher<Array<String>>? = null
    private var pending: CompletableDeferred<Map<String, Boolean>>? = null

    fun attach(activity: ComponentActivity) {
        this.activity = WeakReference(activity)
        launcher = activity.registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
            pending?.complete(result)
            pending = null
        }
    }

    fun detach(activity: ComponentActivity) {
        if (this.activity.get() !== activity) return
        this.activity = WeakReference(null)
        launcher = null
    }

    /** True when the system would still show its prompt for a permission the person declined. */
    fun shouldShowRationale(permission: String): Boolean =
        activity.get()?.shouldShowRequestPermissionRationale(permission) ?: false

    /**
     * Shows the system prompt; the grants by permission, or null when no
     * activity is on screen to show it. Call on the main thread.
     */
    suspend fun request(permissions: Array<String>): Map<String, Boolean>? {
        pending?.let { return it.await() }
        val launcher = launcher ?: return null
        val deferred = CompletableDeferred<Map<String, Boolean>>()
        pending = deferred
        launcher.launch(permissions)
        return deferred.await()
    }
}
