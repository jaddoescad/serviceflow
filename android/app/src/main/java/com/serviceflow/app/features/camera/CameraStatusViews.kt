package com.serviceflow.app.features.camera

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.graphics.scale

/**
 * Covers the preview until the first live frame: the last frame blurred
 * (like the system camera refocusing), or a Retry button if it failed.
 */
@Composable
fun CameraPreviewPlaceholder(camera: CameraModel, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
        val frame = camera.frozenFrame
        if (frame != null && !camera.previewFailed) {
            // Before Android 12 there's no blur; a tiny copy stretched up looks the same.
            val image = remember(frame) {
                (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) frame else frame.scale(24, maxOf(1, frame.height * 24 / frame.width)))
                    .asImageBitmap()
            }
            Image(
                image, null, contentScale = ContentScale.Crop, filterQuality = FilterQuality.High,
                modifier = Modifier.fillMaxSize().blur(22.dp),
            )
        }
        if (camera.previewFailed) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(Icons.Outlined.PhotoCamera, null, tint = Color.White, modifier = Modifier.size(30.dp))
                Text("Camera preview unavailable", style = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Color.White))
                Button(onClick = camera::retryPreview, colors = whiteButton()) { Text("Retry Camera") }
            }
        }
    }
}

@Composable
private fun whiteButton() = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Color.Black)

/**
 * Shown instead of the preview until camera access is allowed. The system
 * prompt comes first; Settings is offered only once it was declined.
 */
@Composable
fun CameraPermissionCard(permission: CameraPermission, onAllow: () -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    Column(
        modifier.padding(horizontal = 36.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
    ) {
        Icon(Icons.Filled.PhotoCamera, null, tint = Color.White, modifier = Modifier.size(42.dp))
        Text("Camera access needed", style = TextStyle(fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Color.White))
        Text(
            "ServiceFlow needs camera access to capture project photos and videos.",
            style = TextStyle(fontSize = 15.sp, color = Color.White.copy(alpha = 0.72f), textAlign = TextAlign.Center),
        )
        Button(
            onClick = {
                if (permission == CameraPermission.NotDetermined) {
                    onAllow()
                } else {
                    context.startActivity(
                        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)),
                    )
                }
            },
            colors = whiteButton(),
            modifier = Modifier.padding(top = 8.dp),
        ) { Text(if (permission == CameraPermission.NotDetermined) "Continue" else "Open Settings") }
    }
}

@Composable
fun CameraUnavailableView(modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterVertically),
    ) {
        Icon(Icons.Outlined.PhotoCamera, null, tint = Color.White, modifier = Modifier.size(40.dp))
        Text(
            "No camera is available on this device.",
            style = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Color.White.copy(alpha = 0.8f)),
        )
    }
}
