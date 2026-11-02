package com.serviceflow.app.features.projectdetail

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.webkit.MimeTypeMap
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material.icons.outlined.TableChart
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.FileProvider
import com.serviceflow.app.LocalSession
import com.serviceflow.app.backend.ServiceFlowAPI
import com.serviceflow.app.backend.downloadDocument
import com.serviceflow.app.backend.pageDocument
import com.serviceflow.app.backend.projectDocuments
import com.serviceflow.app.design.AppIcon
import com.serviceflow.app.design.DetailPalette
import com.serviceflow.app.design.Palette
import com.serviceflow.app.design.appText
import com.serviceflow.app.design.hex
import com.serviceflow.app.features.jobs.ContentUnavailable
import com.serviceflow.core.ProjectDocument
import com.serviceflow.core.ProjectDocumentKind
import com.serviceflow.core.ProjectDocuments
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.io.File

/** The Documents tab's list; kept with the job's screen so switching tabs doesn't blank it. */
class ProjectDocumentsStore(private val projectId: String) {
    var sections by mutableStateOf<List<ProjectDocuments.Section>?>(null)
        private set
    var loadFailed by mutableStateOf(false)
        private set
    /** The file being downloaded, and how far along (null while the size is unknown). */
    var opening by mutableStateOf<String?>(null)
    var progress by mutableStateOf<Float?>(null)

    suspend fun load(api: ServiceFlowAPI) {
        if (sections == null) loadFailed = false
        try {
            val (documents, folders) = api.projectDocuments(projectId)
            sections = ProjectDocuments.sections(documents = documents, folders = folders)
            loadFailed = false
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
            // Keep what's on screen if a refresh fails.
            if (sections == null) loadFailed = true
        }
    }
}

/**
 * Project Detail's Documents tab: the files and pages managers add to the
 * job on the web. Pages open in the app; files open in another app.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectDocumentsTab(store: ProjectDocumentsStore, onOpenPage: (ProjectDocument) -> Unit) {
    val session = LocalSession.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    var openError by remember { mutableStateOf<String?>(null) }

    fun open(document: ProjectDocument) {
        if (store.opening != null) return
        store.opening = document.id
        store.progress = null
        scope.launch {
            try {
                val file = File(context.cacheDir, "$documentsFolder/${document.id}/${fileName(document)}")
                session.api.downloadDocument(document, file) { store.progress = it }
                openError = view(context, file, document)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Throwable) {
                openError = "${document.name} didn't download. Check your connection and try again."
            } finally {
                store.opening = null
            }
        }
    }

    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            scope.launch {
                refreshing = true
                store.load(session.api)
                refreshing = false
            }
        },
        modifier = Modifier.fillMaxSize(),
    ) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 96.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            val sections = store.sections
            when {
                sections == null && store.loadFailed -> GroupCard {
                    ContentUnavailable(
                        icon = Icons.Outlined.CloudOff,
                        title = "Couldn't load documents",
                        description = { Text("Check your connection and try again.") },
                        actions = {
                            TextButton(
                                onClick = { scope.launch { store.load(session.api) } },
                                colors = ButtonDefaults.textButtonColors(contentColor = DetailPalette.brand),
                            ) { Text("Try Again") }
                        },
                    )
                }
                sections == null -> Box(Modifier.fillMaxWidth().padding(vertical = 40.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = DetailPalette.brand)
                }
                sections.isEmpty() -> GroupCard {
                    ContentUnavailable(
                        icon = Icons.Outlined.Description,
                        title = "No documents yet",
                        description = { Text("Documents your manager adds to this job on the web show up here.") },
                    )
                }
                else -> sections.forEach { section ->
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        section.folder?.let { FolderHeader(it.name) }
                        GroupCard {
                            section.documents.forEachIndexed { index, document ->
                                if (index > 0) HorizontalDivider(Modifier.padding(start = 64.dp))
                                ProjectDocumentRow(
                                    document = document,
                                    opening = store.opening == document.id,
                                    progress = store.progress,
                                    modifier = Modifier.clickable(enabled = store.opening == null) {
                                        if (document.kind == ProjectDocumentKind.Page) onOpenPage(document) else open(document)
                                    },
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    openError?.let { message ->
        AlertDialog(
            onDismissRequest = { openError = null },
            title = { Text("Couldn't open the file") },
            text = { Text(message) },
            confirmButton = { TextButton(onClick = { openError = null }) { Text("OK") } },
        )
    }
}

@Composable
private fun FolderHeader(name: String) {
    val colors = MaterialTheme.colorScheme
    Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        AppIcon(Icons.Outlined.Folder, 16.dp, colors.onSurfaceVariant)
        Text(name, style = MaterialTheme.typography.titleSmall, color = colors.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** One document: its type icon, name, and type · size · date. */
@Composable
private fun ProjectDocumentRow(document: ProjectDocument, opening: Boolean, progress: Float?, modifier: Modifier = Modifier) {
    val colors = MaterialTheme.colorScheme
    val (icon, tint) = symbol(document)
    Row(
        modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(36.dp).background(tint.copy(alpha = 0.12f), RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) {
            AppIcon(icon, 20.dp, tint)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(document.name, style = appText(15, FontWeight.SemiBold, colors.onSurface), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(document.detail, style = appText(13, color = colors.onSurfaceVariant), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        when {
            opening && progress != null ->
                CircularProgressIndicator(progress = { progress }, Modifier.size(20.dp), color = DetailPalette.brand, strokeWidth = 2.dp)
            opening -> CircularProgressIndicator(Modifier.size(20.dp), color = DetailPalette.brand, strokeWidth = 2.dp)
            else -> Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = colors.onSurfaceVariant)
        }
    }
}

private fun symbol(document: ProjectDocument): Pair<ImageVector, Color> = when (document.typeLabel) {
    "Page" -> Icons.Outlined.Description to DetailPalette.brand
    "PDF" -> Icons.Outlined.PictureAsPdf to Palette.red
    "Image" -> Icons.Outlined.Image to Palette.teal
    "Spreadsheet" -> Icons.Outlined.TableChart to hex(0x27ae60)
    else -> Icons.AutoMirrored.Outlined.InsertDriveFile to DetailPalette.navy
}

/** Downloads live under the cache, in the folder `res/xml/document_paths.xml` shares. */
private const val documentsFolder = "documents"

/** The file's own name (viewers go by the extension), safe as a path component. */
private fun fileName(document: ProjectDocument): String {
    var name = document.name.replace("/", "-")
    if (name.trim('.', ' ').isEmpty()) name = "document"
    val stored = document.storagePath?.let { File(it).extension }.orEmpty()
    if (File(name).extension.isEmpty() && stored.isNotEmpty()) name += ".$stored"
    return name
}

/** Hands the downloaded file to an app that can show it; the message to show if none can. */
private fun view(context: Context, file: File, document: ProjectDocument): String? {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.documents", file)
    val type = document.mimeType
        ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase())
        ?: "*/*"
    val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, type).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    return try {
        context.startActivity(intent)
        null
    } catch (_: ActivityNotFoundException) {
        "No app on this phone can open ${document.name}."
    }
}

/** A written page, read-only (pushed from the Documents tab). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectDocumentPageScreen(document: ProjectDocument, onBack: () -> Unit) {
    val session = LocalSession.current
    var html by remember { mutableStateOf<String?>(null) }
    var failed by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    LaunchedEffect(attempt) {
        failed = false
        try {
            html = session.api.pageDocument(document)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
            failed = true
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(document.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            val page = html
            when {
                page != null -> PageWebView(page, Modifier.fillMaxSize())
                failed -> ContentUnavailable(
                    icon = Icons.Outlined.CloudOff,
                    title = "Couldn't load this page",
                    description = { Text("Check your connection and try again.") },
                    actions = {
                        TextButton(onClick = { attempt++ }, colors = ButtonDefaults.textButtonColors(contentColor = DetailPalette.brand)) {
                            Text("Try Again")
                        }
                    },
                )
                else -> CircularProgressIndicator(Modifier.align(Alignment.Center), color = DetailPalette.brand)
            }
        }
    }
}

/** Shows a page's HTML with scripts off; links open in the browser. */
@Composable
private fun PageWebView(html: String, modifier: Modifier = Modifier) {
    AndroidView(
        factory = { context ->
            WebView(context).apply {
                settings.javaScriptEnabled = false
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                setBackgroundColor(android.graphics.Color.WHITE)
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                        try {
                            view.context.startActivity(Intent(Intent.ACTION_VIEW, request.url).addCategory(Intent.CATEGORY_BROWSABLE))
                        } catch (_: ActivityNotFoundException) {
                        }
                        return true
                    }
                }
                loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
            }
        },
        onRelease = { it.destroy() },
        modifier = modifier,
    )
}
