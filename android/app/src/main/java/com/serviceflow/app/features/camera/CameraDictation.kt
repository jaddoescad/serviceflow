package com.serviceflow.app.features.camera

import android.Manifest
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.serviceflow.app.platform.PermissionBridge
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/** Live speech-to-text for capture notes. One field dictates at a time. Main thread only. */
class CameraDictation(
    private val context: Context,
    private val permissions: PermissionBridge,
    private val scope: CoroutineScope,
) {
    /** The capture whose note is being dictated. */
    var activeId by mutableStateOf<String?>(null)
        private set
    var error by mutableStateOf<String?>(null)
        private set

    private var recognizer: SpeechRecognizer? = null
    private var onText: ((String) -> Unit)? = null
    private var onEnd: (() -> Unit)? = null

    val isActive: Boolean get() = activeId != null

    /** Starts dictating. [prefix] is the text already in the field; the transcript is appended after it. */
    fun start(id: String, prefix: String, onText: (String) -> Unit, onBegin: () -> Unit, onEnd: () -> Unit) {
        stop()
        error = null
        scope.launch {
            if (!CameraPermission.microphoneGranted(context)) {
                val granted = permissions.request(arrayOf(Manifest.permission.RECORD_AUDIO))?.get(Manifest.permission.RECORD_AUDIO)
                if (granted != true) {
                    error = "Allow Microphone for ServiceFlow in Settings to dictate notes."
                    return@launch
                }
            }
            if (!SpeechRecognizer.isRecognitionAvailable(context)) {
                error = "Dictation isn't available right now."
                return@launch
            }
            onBegin()
            this@CameraDictation.onEnd = onEnd
            this@CameraDictation.onText = onText
            try {
                begin(prefix)
                activeId = id
            } catch (_: Exception) {
                error = "Dictation couldn't start."
                finish()
                onEnd()
                this@CameraDictation.onEnd = null
            }
        }
    }

    private fun begin(prefix: String) {
        val base = prefix.trim()
        val recognizer = SpeechRecognizer.createSpeechRecognizer(context)
        this.recognizer = recognizer
        recognizer.setRecognitionListener(object : RecognitionListener {
            private fun deliver(results: Bundle?) {
                val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: return
                if (text.isEmpty()) return
                onText?.invoke(if (base.isEmpty()) text else "$base $text")
            }

            override fun onPartialResults(partialResults: Bundle?) = deliver(partialResults)
            override fun onResults(results: Bundle?) {
                deliver(results)
                finish()
            }
            override fun onError(error: Int) = finish()
            override fun onReadyForSpeech(params: Bundle?) = Unit
            override fun onBeginningOfSpeech() = Unit
            override fun onRmsChanged(rmsdB: Float) = Unit
            override fun onBufferReceived(buffer: ByteArray?) = Unit
            override fun onEndOfSpeech() = Unit
            override fun onEvent(eventType: Int, params: Bundle?) = Unit
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        recognizer.startListening(intent)
    }

    fun stop() {
        recognizer?.stopListening()
        finish()
    }

    private fun finish() {
        recognizer?.destroy()
        recognizer = null
        val wasActive = activeId != null
        activeId = null
        onText = null
        if (wasActive) onEnd?.invoke()
        onEnd = null
    }
}
