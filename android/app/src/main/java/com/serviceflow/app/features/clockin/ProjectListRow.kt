package com.serviceflow.app.features.clockin

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Work
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.SearchBarDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.serviceflow.app.design.AppIcon
import com.serviceflow.app.design.Palette
import com.serviceflow.app.design.appText
import com.serviceflow.app.design.hex
import com.serviceflow.core.Project

/** A job or lead in a list: name, address and a lead badge. */
@Composable
fun ProjectListRow(project: Project, modifier: Modifier = Modifier) {
    ListItem(
        modifier = modifier,
        leadingContent = {
            AppIcon(if (project.isLead) Icons.Filled.PersonAdd else Icons.Filled.Work, 22.dp, Palette.teal)
        },
        headlineContent = {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(project.name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                     modifier = Modifier.weight(1f, fill = false))
                if (project.isLead) {
                    Text(
                        "LEAD", style = appText(11, FontWeight.Bold, hex(0x245c9c)),
                        modifier = Modifier.background(hex(0xe8f1ff), CircleShape).padding(horizontal = 5.dp, vertical = 1.dp),
                    )
                }
            }
        },
        supportingContent = {
            Text(project.cardAddress ?: "No address on file", maxLines = 1, overflow = TextOverflow.Ellipsis)
        },
    )
}

/** The search field of Clock In and Change Job. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectSearchField(search: ProjectSearch, placeholder: String, modifier: Modifier = Modifier) {
    val focus = LocalFocusManager.current
    Surface(shape = SearchBarDefaults.inputFieldShape, color = SearchBarDefaults.colors().containerColor, modifier = modifier) {
        SearchBarDefaults.InputField(
            query = search.query.text,
            onQueryChange = search::update,
            onSearch = { focus.clearFocus() },
            expanded = false,
            onExpandedChange = {},
            placeholder = { Text(placeholder) },
            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
            trailingIcon = if (search.query.text.isNotEmpty()) {
                { IconButton(onClick = search::clear) { Icon(Icons.Filled.Close, contentDescription = "Clear search") } }
            } else {
                null
            },
        )
    }
}
