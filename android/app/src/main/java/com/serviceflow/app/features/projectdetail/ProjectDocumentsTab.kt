package com.serviceflow.app.features.projectdetail

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.view.MotionEvent
import android.view.inputmethod.InputMethodManager
import android.webkit.JavascriptInterface
import android.webkit.MimeTypeMap
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.FormatListBulleted
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Redo
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.FormatBold
import androidx.compose.material.icons.filled.FormatColorText
import androidx.compose.material.icons.filled.FormatItalic
import androidx.compose.material.icons.filled.FormatListNumbered
import androidx.compose.material.icons.filled.FormatUnderlined
import androidx.compose.material.icons.filled.KeyboardHide
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material.icons.outlined.TableChart
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.VerticalDivider
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.FileProvider
import com.serviceflow.app.LocalSession
import com.serviceflow.app.backend.ProjectDocumentPage
import com.serviceflow.app.backend.ServiceFlowAPI
import com.serviceflow.app.backend.downloadDocument
import com.serviceflow.app.backend.pageDocument
import com.serviceflow.app.backend.projectDocuments
import com.serviceflow.app.backend.savePageDocument
import com.serviceflow.app.design.AppIcon
import com.serviceflow.app.design.DetailPalette
import com.serviceflow.app.design.Palette
import com.serviceflow.app.design.appText
import com.serviceflow.app.design.hex
import com.serviceflow.app.features.jobs.ContentUnavailable
import com.serviceflow.core.ProjectDocument
import com.serviceflow.core.ProjectDocumentKind
import com.serviceflow.core.ProjectDocuments
import com.serviceflow.core.boolValue
import com.serviceflow.core.get
import com.serviceflow.core.stringValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
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

/**
 * A written page (pushed from the Documents tab). Managers tap Edit to edit it
 * right here, and it saves as they type like the web's editor; everyone else
 * reads it.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ProjectDocumentPageScreen(document: ProjectDocument, onBack: () -> Unit) {
    val session = LocalSession.current
    var page by remember { mutableStateOf<ProjectDocumentPage?>(null) }
    var editing by remember { mutableStateOf<PageEditing?>(null) }
    var failed by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    LaunchedEffect(attempt) {
        failed = false
        try {
            val loaded = session.api.pageDocument(document)
            editing = if (session.isManager) PageEditing(session.api, document, loaded, session.scope) else null
            page = loaded
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
            failed = true
        }
    }
    // Leaving keeps the last few keystrokes too.
    DisposableEffect(editing) {
        val current = editing
        onDispose { current?.let { session.scope.launch { it.flush() } } }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(document.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
                actions = {
                    editing?.let { current ->
                        current.statusText?.let { status ->
                            val color = if (current.status == PageEditing.Status.Failed) hex(0xb42318) else MaterialTheme.colorScheme.onSurfaceVariant
                            Text(status, style = appText(13, color = color), modifier = Modifier.padding(end = 4.dp))
                        }
                        TextButton(onClick = { current.edit(!current.active) }) {
                            Text(if (current.active) "Done" else "Edit", fontWeight = if (current.active) FontWeight.SemiBold else FontWeight.Normal)
                        }
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding).imePadding()) {
            val current = editing
            if (current?.status == PageEditing.Status.Conflict) {
                Row(
                    Modifier.fillMaxWidth().background(hex(0xfef3f2)).padding(start = 16.dp, end = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Someone else changed this page.", style = appText(13, color = hex(0x101725)), modifier = Modifier.weight(1f))
                    TextButton(onClick = { attempt++ }) { Text("Reload") }
                }
            }
            Box(Modifier.weight(1f).fillMaxWidth()) {
                val loaded = page
                when {
                    loaded != null -> key(loaded.updatedAt) {
                        PageWebView(ProjectDocuments.pageDocument(body = loaded.body, editable = current != null), Modifier.fillMaxSize(), current)
                    }
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
            if (current != null && WindowInsets.isImeVisible) PageFormatBar(current)
        }
    }
}

/**
 * A manager's editing of a page: Edit/Done, what the format bar shows, and
 * saving each change a second after typing stops, over the version they have
 * open. Saves run in the session's scope so leaving the page doesn't drop them.
 */
class PageEditing(
    private val api: ServiceFlowAPI,
    private val document: ProjectDocument,
    private var page: ProjectDocumentPage,
    private val scope: CoroutineScope,
) {
    enum class Status { Idle, Saving, Saved, Failed, Conflict }

    /** The selection's formatting, as the page editor script reports it. */
    data class Format(
        val block: String = "p",
        val bold: Boolean = false,
        val italic: Boolean = false,
        val underline: Boolean = false,
        val bullets: Boolean = false,
        val numbers: Boolean = false,
        val checklist: Boolean = false,
    )

    var active by mutableStateOf(false)
        private set
    var status by mutableStateOf(Status.Idle)
        private set
    var format by mutableStateOf(Format())
        private set
    var view: WebView? = null
    private var pending: String? = null
    private var saving = false
    private var timer: Job? = null

    val statusText: String?
        get() = when (status) {
            Status.Idle, Status.Conflict -> null
            Status.Saving -> "Saving…"
            Status.Saved -> "Saved"
            Status.Failed -> "Not saved"
        }

    /** Edit makes the page editable where it is; Done stops and saves. */
    fun edit(on: Boolean) {
        active = on
        view?.evaluateJavascript("serviceFlowPage.edit($on)", null)
        if (!on) {
            hideKeyboard()
            scope.launch { flush() }
        }
    }

    /** Runs a formatting command in the page (see page-editor.js). */
    fun run(command: String, value: String? = null) {
        val arguments = JsonArray(listOfNotNull(command, value).map(::JsonPrimitive))
        view?.evaluateJavascript("serviceFlowPage.run(...$arguments)", null)
    }

    fun hideKeyboard() {
        val view = view ?: return
        view.context.getSystemService(InputMethodManager::class.java)?.hideSoftInputFromWindow(view.windowToken, 0)
        view.clearFocus()
    }

    /** A message from page-editor.js. */
    fun received(text: String) {
        val message = ServiceFlowAPI.parse(text)
        when (message["kind"].stringValue) {
            "changed" -> message["html"].stringValue?.let(::changed)
            "state" -> format = Format(
                block = message["block"].stringValue ?: "p",
                bold = message["bold"].boolValue == true,
                italic = message["italic"].boolValue == true,
                underline = message["underline"].boolValue == true,
                bullets = message["bullets"].boolValue == true,
                numbers = message["numbers"].boolValue == true,
                checklist = message["checklist"].boolValue == true,
            )
        }
    }

    /** Saves whatever hasn't been saved yet, now. */
    suspend fun flush() {
        timer?.cancel()
        save()
    }

    private fun changed(html: String) {
        if (status == Status.Conflict || html == (pending ?: page.body)) return
        pending = html
        later(1_000)
    }

    private fun later(millis: Long) {
        timer?.cancel()
        timer = scope.launch {
            delay(millis)
            save()
        }
    }

    private suspend fun save() {
        if (saving || status == Status.Conflict) return
        val body = pending ?: return
        saving = true
        pending = null
        status = Status.Saving
        try {
            val version = api.savePageDocument(document, page, body)
            if (version != null) {
                page = page.copy(body = body, updatedAt = version)
                status = Status.Saved
            } else {
                status = Status.Conflict
            }
        } catch (e: CancellationException) {
            if (pending == null) pending = body
            throw e
        } catch (_: Throwable) {
            if (pending == null) pending = body
            status = Status.Failed
            later(4_000)
        } finally {
            saving = false
        }
        if (status == Status.Saved && pending != null) save()
    }
}

/** Hands page-editor.js messages to the editing on the main thread. */
private class PageMessages(private val editing: PageEditing) {
    private val main = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun post(text: String) {
        main.post { editing.received(text) }
    }
}

private val pageBlocks = listOf("h1" to "Heading 1", "h2" to "Heading 2", "h3" to "Heading 3", "p" to "Paragraph")
private val pageColors = listOf(
    "Default" to 0x101725L, "Gray" to 0x6b7688L, "Red" to 0xd3453eL, "Orange" to 0xd9730dL,
    "Yellow" to 0xb7770fL, "Green" to 0x17935aL, "Blue" to 0x2f6bffL, "Purple" to 0x7c3aedL,
)

/** The bar above the keyboard while a manager edits a page: the web editor's text styles, colours and lists. */
@Composable
private fun PageFormatBar(editing: PageEditing) {
    val format = editing.format
    var menu by remember { mutableStateOf<String?>(null) }
    HorizontalDivider()
    Row(
        Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier.weight(1f).horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box {
                TextButton(
                    onClick = { menu = "block" },
                    modifier = Modifier.focusProperties { canFocus = false },
                ) {
                    Text(pageBlocks.firstOrNull { it.first == format.block }?.second ?: "Paragraph", color = MaterialTheme.colorScheme.onSurface)
                    Icon(Icons.Filled.ArrowDropDown, contentDescription = null, tint = MaterialTheme.colorScheme.onSurface)
                }
                DropdownMenu(expanded = menu == "block", onDismissRequest = { menu = null }) {
                    pageBlocks.forEach { (tag, label) ->
                        DropdownMenuItem(text = { Text(label) }, onClick = {
                            menu = null
                            editing.run("formatBlock", "<$tag>")
                        })
                    }
                }
            }
            PageFormatButton(Icons.Filled.FormatBold, "Bold", format.bold) { editing.run("bold") }
            PageFormatButton(Icons.Filled.FormatItalic, "Italic", format.italic) { editing.run("italic") }
            PageFormatButton(Icons.Filled.FormatUnderlined, "Underline", format.underline) { editing.run("underline") }
            Box {
                PageFormatButton(Icons.Filled.FormatColorText, "Text colour", false) { menu = "color" }
                DropdownMenu(expanded = menu == "color", onDismissRequest = { menu = null }) {
                    pageColors.forEach { (name, color) ->
                        DropdownMenuItem(
                            text = { Text(name) },
                            leadingIcon = { Box(Modifier.size(16.dp).background(hex(color), RoundedCornerShape(8.dp))) },
                            onClick = {
                                menu = null
                                editing.run("foreColor", "#%06x".format(color))
                            },
                        )
                    }
                }
            }
            VerticalDivider(Modifier.height(20.dp).padding(horizontal = 6.dp))
            PageFormatButton(Icons.AutoMirrored.Filled.FormatListBulleted, "Bulleted list", format.bullets) { editing.run("bullets") }
            PageFormatButton(Icons.Filled.FormatListNumbered, "Numbered list", format.numbers) { editing.run("numbers") }
            PageFormatButton(Icons.Filled.Checklist, "Checklist", format.checklist) { editing.run("checklist") }
            VerticalDivider(Modifier.height(20.dp).padding(horizontal = 6.dp))
            PageFormatButton(Icons.AutoMirrored.Filled.Undo, "Undo", false) { editing.run("undo") }
            PageFormatButton(Icons.AutoMirrored.Filled.Redo, "Redo", false) { editing.run("redo") }
        }
        VerticalDivider(Modifier.height(20.dp))
        PageFormatButton(Icons.Filled.KeyboardHide, "Hide keyboard", false, editing::hideKeyboard)
    }
}

@Composable
private fun PageFormatButton(icon: ImageVector, label: String, active: Boolean, onClick: () -> Unit) {
    IconButton(
        onClick = onClick,
        modifier = Modifier
            // The page keeps the cursor and keyboard while formatting.
            .focusProperties { canFocus = false }
            .size(44.dp)
            .background(if (active) DetailPalette.brand.copy(alpha = 0.12f) else Color.Transparent, RoundedCornerShape(8.dp))
            .semantics {
                contentDescription = label
                selected = active
            },
    ) {
        Icon(icon, contentDescription = null, tint = if (active) DetailPalette.brand else MaterialTheme.colorScheme.onSurface)
    }
}

/**
 * Shows a page's HTML with its scripts off; links open in the browser. With
 * [editing], the page editor script edits it: JavaScript is on for that
 * script, and the editable page's policy still blocks scripts of its own.
 * Scrolling with the finger moving down puts the keyboard away.
 */
@SuppressLint("SetJavaScriptEnabled", "JavascriptInterface", "ClickableViewAccessibility")
@Composable
private fun PageWebView(html: String, modifier: Modifier = Modifier, editing: PageEditing? = null) {
    AndroidView(
        factory = { context ->
            WebView(context).apply {
                settings.javaScriptEnabled = editing != null
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

                    override fun onPageFinished(view: WebView, url: String?) {
                        if (editing == null) return
                        val script = view.context.assets.open("page-editor.js").bufferedReader().use { it.readText() }
                        view.evaluateJavascript(script, null)
                    }
                }
                if (editing != null) {
                    addJavascriptInterface(PageMessages(editing), "ServiceFlowPage")
                    editing.view = this
                    val reach = 24 * resources.displayMetrics.density
                    var startY = 0f
                    var startScroll = 0
                    setOnTouchListener { view, event ->
                        when (event.actionMasked) {
                            MotionEvent.ACTION_DOWN -> {
                                startY = event.y
                                startScroll = view.scrollY
                            }
                            MotionEvent.ACTION_MOVE ->
                                if (event.y - startY > reach && (view.scrollY < startScroll || view.scrollY == 0)) editing.hideKeyboard()
                        }
                        false
                    }
                }
                tag = html
                loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
            }
        },
        update = { view ->
            if (view.tag != html) {
                view.tag = html
                view.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
            }
        },
        onRelease = {
            if (editing?.view == it) editing.view = null
            it.destroy()
        },
        modifier = modifier,
    )
}
