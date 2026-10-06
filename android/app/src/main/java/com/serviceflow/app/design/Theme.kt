package com.serviceflow.app.design

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** `hex(0x173f37)`, optionally with alpha. */
fun hex(value: Long, alpha: Float = 1f): Color = Color(
    red = ((value shr 16) and 0xff).toInt(),
    green = ((value shr 8) and 0xff).toInt(),
    blue = (value and 0xff).toInt(),
).copy(alpha = alpha)

/** The app palette (`theme.js` `palette`). */
object Palette {
    val green = hex(0x173f37)
    val teal = hex(0x2f8d7f)
    val brown = hex(0x7c5127)
    val border = hex(0xe0e3e1)
    val muted = hex(0x8b9692)
    val ink = hex(0x11201d)
    val navy = hex(0x31495d)
    val red = hex(0xc0432b)
}

/** Sign-in and sign-up screens. */
object AuthPalette {
    val brand = hex(0x258585)
    val danger = hex(0xb91c1c)
}

/** Project detail uses its own palette on purpose. */
object DetailPalette {
    val brand = hex(0x2b8496)
    val navy = hex(0x31495d)
    val ink = hex(0x1f2933)
    val muted = hex(0x8a8f95)
    val subtle = hex(0xb8bcc1)
    val border = hex(0xe6e8eb)
    val soft = hex(0xf6f8f9)
}

/**
 * Text at a size (sp, so it follows the system font scale), weight, colour
 * and letter spacing: `Text("Jobs", style = appText(14, FontWeight.Black, Palette.ink))`.
 */
fun appText(size: Number, weight: FontWeight = FontWeight.Normal, color: Color, tracking: Number = 0): TextStyle =
    TextStyle(fontSize = size.toFloat().sp, fontWeight = weight, color = color, letterSpacing = tracking.toFloat().sp)

private val LightColors = lightColorScheme(
    primary = Palette.green,
    onPrimary = Color.White,
    primaryContainer = hex(0xdcebe7),
    onPrimaryContainer = Palette.green,
    secondary = Palette.teal,
    onSecondary = Color.White,
    secondaryContainer = hex(0xdcebe7),
    onSecondaryContainer = Palette.green,
    tertiary = Palette.brown,
    onTertiary = Color.White,
    error = Palette.red,
    onError = Color.White,
    background = Color.White,
    onBackground = Palette.ink,
    surface = Color.White,
    onSurface = Palette.ink,
    surfaceVariant = hex(0xf2f4f3),
    onSurfaceVariant = Palette.muted,
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = hex(0xf8f9f8),
    surfaceContainer = hex(0xf3f5f4),
    surfaceContainerHigh = hex(0xeef1f0),
    surfaceContainerHighest = hex(0xe8ecea),
    outline = Palette.border,
    outlineVariant = Palette.border,
)

/** Material 3 with the brand colours. Light only, like the iOS app. */
@Composable
fun ServiceFlowTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = LightColors, content = content)
}
