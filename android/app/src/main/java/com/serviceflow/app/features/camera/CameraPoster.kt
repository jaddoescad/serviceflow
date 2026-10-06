package com.serviceflow.app.features.camera

import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import androidx.core.graphics.scale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

object CameraPoster {
    private const val MAX_SIDE = 1280

    /**
     * A JPEG still from near the start of a video, oriented upright. It's
     * shown in the drawer and uploaded as the video's grid thumbnail.
     */
    suspend fun make(video: File): File? = withContext(Dispatchers.IO) {
        val retriever = MediaMetadataRetriever()
        try {
            retriever.setDataSource(video.absolutePath)
            val frame = retriever.getFrameAtTime(100_000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC) ?: return@withContext null
            val scale = minOf(1f, MAX_SIDE.toFloat() / maxOf(frame.width, frame.height, 1))
            val image = if (scale < 1f) frame.scale((frame.width * scale).toInt(), (frame.height * scale).toInt()) else frame
            val poster = File(video.parentFile, video.nameWithoutExtension + ".poster.jpg")
            poster.outputStream().use { image.compress(Bitmap.CompressFormat.JPEG, 80, it) }
            poster
        } catch (_: Exception) {
            null
        } finally {
            runCatching { retriever.release() }
        }
    }
}
