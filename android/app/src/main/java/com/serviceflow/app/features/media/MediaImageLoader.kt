package com.serviceflow.app.features.media

import android.content.Context
import android.graphics.Bitmap
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import coil3.SingletonImageLoader
import coil3.memory.MemoryCache
import coil3.network.NetworkHeaders
import coil3.network.httpHeaders
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.allowHardware
import coil3.size.Precision
import coil3.size.Scale
import coil3.toBitmap
import com.serviceflow.app.LocalSession
import com.serviceflow.app.design.DetailPalette
import com.serviceflow.app.design.Spinner
import com.serviceflow.app.features.photoeditor.AnnotationRenderer
import com.serviceflow.core.AnnotationDocument
import com.serviceflow.core.MediaClient
import com.serviceflow.core.MediaItem
import com.serviceflow.core.MediaKind
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.roundToInt

/**
 * Loads media images from the Worker (or a local capture file), decoded
 * downsampled so large originals never stall scrolling, and keeps them in
 * Coil's memory cache (never on disk). The Worker token is fetched per
 * request, so a stale token is never reused.
 */
object MediaImageLoader {
    /** A cached image, without waiting. [data] is a Worker URL `String` or a local `File`. */
    fun cached(context: Context, data: Any, maxPixel: Int): Bitmap? =
        SingletonImageLoader.get(context).memoryCache?.get(MemoryCache.Key(key(data, maxPixel)))?.image?.toBitmap()

    /** The image at [data], at most about [maxPixel] pixels on its longer side. */
    suspend fun image(context: Context, data: Any, maxPixel: Int, client: MediaClient?): Bitmap? {
        val builder = ImageRequest.Builder(context)
            .data(data)
            .size(maxPixel.coerceAtLeast(1))
            .scale(Scale.FIT)
            .precision(Precision.INEXACT)
            .allowHardware(false)
            .memoryCacheKey(key(data, maxPixel))
            .diskCachePolicy(CachePolicy.DISABLED)
        if (data is String) {
            val headers = runCatching { client?.authorizationHeaders() }.getOrNull() ?: return null
            builder.httpHeaders(NetworkHeaders.Builder().apply { headers.forEach { (name, value) -> set(name, value) } }.build())
        }
        val result = SingletonImageLoader.get(context).execute(builder.build()) as? SuccessResult ?: return null
        return result.image.toBitmap()
    }

    private fun key(data: Any, maxPixel: Int): String {
        val name = if (data is File) data.absolutePath else data.toString()
        return "$name#$maxPixel"
    }
}

/** The image a tile shows: the original for photos (so drawings line up), the still frame for videos. */
fun MediaClient.tileURL(item: MediaItem): String =
    if (item.kind == MediaKind.Video) thumbnailURL(item.id) else originalURL(item.id)

/**
 * An image from the media Worker (a URL `String`) or a local capture `File`,
 * loaded at the size it's shown ([downsampleTo] is its longest side). When
 * [annotations] are given, the drawings are painted onto the loaded image, so
 * they stay aligned however the image is cropped or fitted.
 */
@Composable
fun MediaAsyncImage(
    data: Any?,
    downsampleTo: Dp,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Crop,
    annotations: AnnotationDocument? = null,
    showsSpinner: Boolean = false,
    spinnerColor: Color = DetailPalette.brand,
) {
    val context = LocalContext.current
    val client = LocalSession.current.mediaClient
    val pixels = with(LocalDensity.current) { downsampleTo.toPx() }.roundToInt()
    var image by remember(data, annotations, pixels) {
        // Shown at once when cached, so scrolling back doesn't flicker.
        val cached = data?.let { MediaImageLoader.cached(context, it, pixels) }
        mutableStateOf(cached?.takeIf { annotations == null || annotations.isEmpty }?.asImageBitmap())
    }
    LaunchedEffect(data, annotations, pixels) {
        if (data == null || image != null) return@LaunchedEffect
        val loaded = MediaImageLoader.image(context, data, pixels, client) ?: return@LaunchedEffect
        image = withContext(Dispatchers.Default) {
            (if (annotations != null && !annotations.isEmpty) AnnotationRenderer.composite(loaded, annotations) else loaded)
                .asImageBitmap()
        }
    }
    Box(modifier.clipToBounds(), contentAlignment = Alignment.Center) {
        val shown: ImageBitmap? = image
        if (shown != null) {
            Image(shown, contentDescription = null, contentScale = contentScale, modifier = Modifier.fillMaxSize())
        } else if (showsSpinner && data != null) {
            Spinner(spinnerColor)
        }
    }
}
