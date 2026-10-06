package com.serviceflow.app.features.photoeditor

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private enum class Picker { Size, Color }

/**
 * The column down the right edge: brush size, colour, drawing tools and the
 * timestamp. Size and colour open a small picker beside the column.
 */
@Composable
internal fun PhotoEditorToolbar(model: PhotoEditorModel, modifier: Modifier = Modifier) {
    var picker by remember { mutableStateOf<Picker?>(null) }
    fun toggle(value: Picker) {
        picker = if (picker == value) null else value
    }
    LaunchedEffect(model.tool) { picker = null }
    val drawing = model.draft != null
    LaunchedEffect(drawing) { if (drawing) picker = null }

    Row(modifier, verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        when (picker) {
            Picker.Size -> SizePicker(model) { picker = null }
            Picker.Color -> ColorPicker(model) { picker = null }
            null -> Unit
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(
                Modifier.size(44.dp, 40.dp).clickable(role = Role.Button) { toggle(Picker.Size) }
                    .semantics { contentDescription = "Brush size" },
                contentAlignment = Alignment.Center,
            ) {
                Box(Modifier.size(model.brush.dot.dp).background(Color.White, CircleShape))
            }
            Box(
                Modifier.size(44.dp, 40.dp).clickable(role = Role.Button) { toggle(Picker.Color) }
                    .semantics { contentDescription = "Colour" },
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    Modifier.size(32.dp)
                        .background(Color(AnnotationRenderer.annotationColor(model.color)), RoundedCornerShape(7.dp))
                        .border(1.dp, Color.White.copy(alpha = 0.6f), RoundedCornerShape(7.dp)),
                )
            }
            Column(
                Modifier.background(Color.Black.copy(alpha = 0.45f), RoundedCornerShape(14.dp)).padding(vertical = 6.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                PhotoEditorTool.entries.forEach { ToolButton(model, it) }
                Box(
                    Modifier.size(48.dp, 46.dp).clickable(role = Role.Button) { model.addTimestamp() }
                        .semantics { contentDescription = "Add date and time" },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Outlined.Schedule, contentDescription = null, tint = Color.White, modifier = Modifier.size(22.dp))
                }
            }
        }
    }
}

@Composable
private fun ToolButton(model: PhotoEditorModel, tool: PhotoEditorTool) {
    val active = model.tool == tool
    Box(
        Modifier.size(48.dp, 46.dp)
            .clickable(role = Role.Button) { model.select(tool) }
            .semantics {
                contentDescription = tool.label
                selected = active
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier.size(40.dp).background(if (active) Color.White else Color.Transparent, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                tool.icon, contentDescription = null, tint = if (active) Color.Black else Color.White,
                modifier = Modifier.size(22.dp).rotate(if (tool == PhotoEditorTool.Line) -45f else 0f),
            )
        }
    }
}

@Composable
private fun SizePicker(model: PhotoEditorModel, onDone: () -> Unit) {
    Row(
        Modifier.background(Color.Black.copy(alpha = 0.7f), RoundedCornerShape(14.dp)).padding(6.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        PhotoEditorBrush.entries.forEach { brush ->
            Column(
                Modifier.size(40.dp, 48.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(if (model.brush == brush) Color.White.copy(alpha = 0.22f) else Color.Transparent)
                    .clickable(role = Role.Button) {
                        model.chooseBrush(brush)
                        onDone()
                    }
                    .semantics { contentDescription = "Size ${brush.label}" },
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Box(Modifier.height(22.dp), contentAlignment = Alignment.Center) {
                    Box(Modifier.size(brush.dot.dp).background(Color.White, CircleShape))
                }
                Text(brush.label, color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun ColorPicker(model: PhotoEditorModel, onDone: () -> Unit) {
    Row(
        Modifier.background(Color.Black.copy(alpha = 0.7f), RoundedCornerShape(50)).padding(10.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        PhotoEditorPalette.colors.forEach { choice ->
            val chosen = model.color == choice.hex
            Box(
                Modifier.size(28.dp)
                    .clip(CircleShape)
                    .background(Color(AnnotationRenderer.annotationColor(choice.hex)))
                    .border(if (chosen) 3.dp else 1.dp, Color.White.copy(alpha = if (chosen) 1f else 0.3f), CircleShape)
                    .clickable(role = Role.Button) {
                        model.chooseColor(choice.hex)
                        onDone()
                    }
                    .semantics { contentDescription = choice.name },
            )
        }
    }
}
