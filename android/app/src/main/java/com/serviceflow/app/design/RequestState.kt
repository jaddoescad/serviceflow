package com.serviceflow.app.design

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import com.serviceflow.core.BackendError
import io.github.jan.supabase.exceptions.RestException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import java.io.IOException

/**
 * A form's in-flight request: a busy flag for the button and the error to
 * show. [run] clears the old error, marks the form busy, and turns any
 * thrown error into readable text.
 */
class RequestState(private val scope: CoroutineScope, private val hideKeyboard: () -> Unit = {}) {
    var isRunning by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)

    fun run(work: suspend () -> Unit) {
        if (isRunning) return
        error = null
        isRunning = true
        // As iOS does on submit; otherwise the keyboard outlives the form.
        hideKeyboard()
        scope.launch {
            try {
                work()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                error = AuthMessage.from(e)
            } finally {
                isRunning = false
            }
        }
    }
}

@Composable
fun rememberRequestState(): RequestState {
    val scope = rememberCoroutineScope()
    val keyboard = LocalSoftwareKeyboardController.current
    val focus = LocalFocusManager.current
    return remember {
        RequestState(scope) {
            focus.clearFocus(force = true)
            keyboard?.hide()
        }
    }
}

/** Readable text for an auth or account error. */
object AuthMessage {
    fun from(error: Throwable): String {
        // Server refusals already carry readable text (e.g. invite codes).
        if (error is BackendError.Server) return error.message
        if (error is BackendError.Offline || error is IOException) {
            return "You're offline. Check your connection and try again."
        }
        // Supabase errors: the code and its description, without the request dump.
        val text = (error as? RestException)?.let { listOfNotNull(it.error, it.description).joinToString(": ") }
            ?: error.message ?: error.toString()
        val lower = text.lowercase()
        if ("invalid login credentials" in lower) return "That email and password don't match."
        if ("token has expired" in lower || "otp_expired" in lower || ("invalid" in lower && "otp" in lower)) {
            return "That code is wrong or has expired. Check the latest email, or send a new code."
        }
        if ("rate limit" in lower || "security purposes" in lower) return "Too many attempts. Wait a minute and try again."
        if ("signups not allowed" in lower || "user not found" in lower) return "There's no ServiceFlow account for that email."
        val rest = error as? RestException
        return (rest?.description ?: rest?.error ?: text).lineSequence().first()
    }
}
