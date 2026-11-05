package com.serviceflow.app.features.projectdetail

import android.content.Context
import android.graphics.Typeface
import android.text.Editable
import android.text.InputType
import android.text.Spannable
import android.text.SpannableStringBuilder
import android.text.TextWatcher
import android.text.style.StyleSpan
import android.text.style.URLSpan
import android.util.TypedValue
import android.view.Gravity
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.FormatListBulleted
import androidx.compose.material.icons.filled.FormatBold
import androidx.compose.material.icons.filled.FormatItalic
import androidx.compose.material.icons.filled.FormatListNumbered
import androidx.compose.material.icons.filled.Link
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.serviceflow.app.design.DetailPalette
import com.serviceflow.app.design.appText
import com.serviceflow.core.RichText

/** A description with its formatting: bold, italic, links and list lines. */
@Composable
fun RichTextView(markdown: String, modifier: Modifier = Modifier) {
    val style = appText(14, color = MaterialTheme.colorScheme.onSurface)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        for (line in RichText.lines(markdown)) {
            when (val kind = line.kind) {
                RichText.Kind.Text ->
                    if (line.runs.isEmpty()) Spacer(Modifier.height(6.dp)) else Text(annotated(line), style = style)
                RichText.Kind.Bullet -> Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("•", style = style, modifier = Modifier.alignByBaseline())
                    Text(annotated(line), style = style, modifier = Modifier.alignByBaseline())
                }
                is RichText.Kind.Numbered -> Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("${kind.number}.", style = style, modifier = Modifier.alignByBaseline())
                    Text(annotated(line), style = style, modifier = Modifier.alignByBaseline())
                }
            }
        }
    }
}

private fun annotated(line: RichText.Line): AnnotatedString = buildAnnotatedString {
    for (run in line.runs) {
        val style = SpanStyle(
            fontWeight = if (run.bold) FontWeight.SemiBold else null,
            fontStyle = if (run.italic) FontStyle.Italic else null,
        )
        val link = run.link
        if (link == null) {
            withStyle(style) { append(run.text) }
        } else {
            val linkStyle = TextLinkStyles(SpanStyle(color = DetailPalette.brand, textDecoration = TextDecoration.Underline))
            withLink(LinkAnnotation.Url(link, linkStyle)) { withStyle(style) { append(run.text) } }
        }
    }
}

/**
 * The editing text view and its formatting: the format bar reads its state
 * and calls its actions. Lists are typed as "• " and "1. " at line starts.
 */
class RichTextEditorState {
    enum class ListKind { Bullet, Numbered }

    var markdown by mutableStateOf("")
        private set
    var bold by mutableStateOf(false)
        private set
    var italic by mutableStateOf(false)
        private set
    var list by mutableStateOf<ListKind?>(null)
        private set
    /** The link under the cursor or selection. */
    var link by mutableStateOf<String?>(null)
        private set

    private var view: EditText? = null
    // The style typed text takes; follows the character before the cursor.
    private var typingBold = false
    private var typingItalic = false
    // Set while the editor changes the text itself, so the watcher leaves it alone.
    private var applying = false
    // Set from a text change until its typing style is applied: the cursor moves
    // in between, and reading the style then would lose the one being typed.
    private var changing = false

    fun create(context: Context, initial: String, textColor: Int, hintColor: Int): EditText {
        val editText = object : EditText(context) {
            override fun onSelectionChanged(selStart: Int, selEnd: Int) {
                super.onSelectionChanged(selStart, selEnd)
                if (view != null && !applying && !changing) refresh()
            }
        }
        editText.background = null
        editText.gravity = Gravity.TOP or Gravity.START
        editText.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        editText.isSingleLine = false
        editText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
        editText.setTextColor(textColor)
        editText.setHintTextColor(hintColor)
        editText.setLinkTextColor(DetailPalette.brand.toArgb())
        editText.hint = "Rooms, surfaces, colours, access…"
        editText.setText(spanned(initial))
        editText.addTextChangedListener(watcher)
        view = editText
        editText.setSelection(editText.length())
        editText.post {
            editText.requestFocus()
            context.getSystemService(InputMethodManager::class.java)?.showSoftInput(editText, InputMethodManager.SHOW_IMPLICIT)
        }
        textChanged()
        return editText
    }

    /** Puts the keyboard away as the editor closes. */
    fun hideKeyboard() {
        val editText = view ?: return
        editText.context.getSystemService(InputMethodManager::class.java)?.hideSoftInputFromWindow(editText.windowToken, 0)
    }

    private val watcher = object : TextWatcher {
        private var inserted: IntRange? = null

        override fun beforeTextChanged(s: CharSequence, start: Int, count: Int, after: Int) {
            if (!applying) changing = true
        }

        override fun onTextChanged(s: CharSequence, start: Int, before: Int, count: Int) {
            inserted = if (!applying && count > 0) start until start + count else null
        }

        override fun afterTextChanged(s: Editable) {
            if (applying) return
            val range = inserted
            inserted = null
            if (range != null) {
                applying = true
                setStyle(s, range.first, range.last + 1, Typeface.BOLD, typingBold)
                setStyle(s, range.first, range.last + 1, Typeface.ITALIC, typingItalic)
                if (range.first == range.last && s[range.first] == '\n') continueList(s, range.first)
                applying = false
            }
            changing = false
            textChanged()
        }
    }

    private fun textChanged() {
        val text = view?.text ?: return
        markdown = markdown(text)
        refresh()
    }

    private fun refresh() {
        val editText = view ?: return
        val text = editText.text
        val start = editText.selectionStart.coerceAtLeast(0)
        val end = editText.selectionEnd.coerceAtLeast(start)
        if (start == end) {
            typingBold = start > 0 && has(text, start - 1, start, Typeface.BOLD)
            typingItalic = start > 0 && has(text, start - 1, start, Typeface.ITALIC)
            bold = typingBold
            italic = typingItalic
        } else {
            bold = has(text, start, end, Typeface.BOLD)
            italic = has(text, start, end, Typeface.ITALIC)
        }
        link = linkRange(text, start, end)?.let { text.getSpans(it.first, it.last + 1, URLSpan::class.java).firstOrNull()?.url }
        list = listPrefix(lineAt(text, start).let { text.substring(it.first, it.last + 1) }).first
    }

    // Actions

    fun toggleBold() = toggle(Typeface.BOLD, !bold)
    fun toggleItalic() = toggle(Typeface.ITALIC, !italic)

    private fun toggle(style: Int, on: Boolean) {
        val editText = view ?: return
        val start = editText.selectionStart
        val end = editText.selectionEnd
        if (start == end) {
            if (style == Typeface.BOLD) typingBold = on else typingItalic = on
            if (style == Typeface.BOLD) bold = on else italic = on
            return
        }
        edit { setStyle(it, start, end, style, on) }
    }

    /** Links the selection (or the link under the cursor) to [address]; null removes it. With nothing selected the address goes in as its own linked text. */
    fun setLink(address: String?, label: String) {
        val editText = view ?: return
        val text = editText.text
        val start = editText.selectionStart
        val end = editText.selectionEnd
        val target = linkRange(text, start, end) ?: (start until end)
        edit { editable ->
            for (span in editable.getSpans(target.first, target.last + 1, URLSpan::class.java)) editable.removeSpan(span)
            when {
                address == null -> Unit
                !target.isEmpty() -> editable.setSpan(URLSpan(address), target.first, target.last + 1, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
                else -> {
                    val shown = label.ifEmpty { address.removePrefix("mailto:") }
                    editable.insert(start, shown)
                    editable.setSpan(URLSpan(address), start, start + shown.length, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
                    editText.setSelection(start + shown.length)
                }
            }
        }
        editText.requestFocus()
    }

    /** Makes the selected lines that list, or plain again when they already are. */
    fun toggleList(kind: ListKind) {
        val editText = view ?: return
        val text = editText.text
        val start = editText.selectionStart
        val end = editText.selectionEnd
        val lines = lineRanges(text).filter { line ->
            line.first <= end && start <= line.last + 1 && (start == end || line.first < end || line.first == start)
        }
        if (lines.isEmpty()) return
        val removing = lines.all { listPrefix(text.substring(it.first, it.last + 1)).first == kind }
        var shift = 0
        edit { editable ->
            // Last line first, so earlier lines keep their positions.
            lines.withIndex().reversed().forEach { (index, line) ->
                val old = listPrefix(editable.substring(line.first, line.last + 1)).second
                val marker = if (removing) "" else if (kind == ListKind.Bullet) "• " else "${index + 1}. "
                editable.replace(line.first, line.first + old, marker)
                shift += marker.length - old
            }
            renumber(editable)
        }
        val length = editText.length()
        if (lines.size == 1) editText.setSelection((start + shift).coerceIn(lines[0].first, length))
        else editText.setSelection(lines[0].first, (lines.last().last + 1 + shift).coerceIn(lines[0].first, length))
    }

    /** Return on a list line starts the next item; on an empty item it ends the list. */
    private fun continueList(editable: Editable, newline: Int) {
        val previous = lineAt(editable, newline)
        val text = editable.substring(previous.first, previous.last + 1)
        val (kind, prefix) = listPrefix(text)
        kind ?: return
        if (text.length == prefix) {
            editable.delete(previous.first, newline + 1)
            view?.setSelection(previous.first)
        } else {
            val number = text.takeWhile { it.isDigit() }.toIntOrNull() ?: 0
            val marker = if (kind == ListKind.Bullet) "• " else "${number + 1}. "
            editable.insert(newline + 1, marker)
            setStyle(editable, newline + 1, newline + 1 + marker.length, Typeface.BOLD, false)
            setStyle(editable, newline + 1, newline + 1 + marker.length, Typeface.ITALIC, false)
            view?.setSelection(newline + 1 + marker.length)
            renumber(editable)
        }
    }

    private fun edit(change: (Editable) -> Unit) {
        val text = view?.text ?: return
        applying = true
        change(text)
        applying = false
        textChanged()
    }

    companion object {
        private const val FLAGS = Spannable.SPAN_EXCLUSIVE_EXCLUSIVE

        /** The saved description as styled text, lists as "• " and "1. ". */
        fun spanned(markdown: String): SpannableStringBuilder {
            val text = SpannableStringBuilder()
            RichText.lines(markdown).forEachIndexed { index, line ->
                if (index > 0) text.append('\n')
                when (val kind = line.kind) {
                    RichText.Kind.Text -> Unit
                    RichText.Kind.Bullet -> text.append("• ")
                    is RichText.Kind.Numbered -> text.append("${kind.number}. ")
                }
                for (run in line.runs) {
                    val start = text.length
                    text.append(run.text)
                    if (run.bold) text.setSpan(StyleSpan(Typeface.BOLD), start, text.length, FLAGS)
                    if (run.italic) text.setSpan(StyleSpan(Typeface.ITALIC), start, text.length, FLAGS)
                    run.link?.let { text.setSpan(URLSpan(it), start, text.length, FLAGS) }
                }
            }
            return text
        }

        /** The styled text as saved: numbered lines counted from 1 in each list. */
        fun markdown(text: Spannable): String {
            var count = 0
            val lines = lineRanges(text).map { line ->
                val (kind, prefix) = listPrefix(text.substring(line.first, line.last + 1))
                val start = line.first + prefix
                val end = line.last + 1
                val cuts = sortedSetOf(start, end)
                for (span in text.getSpans(start, end, Any::class.java)) {
                    if (span !is StyleSpan && span !is URLSpan) continue
                    cuts += text.getSpanStart(span).coerceIn(start, end)
                    cuts += text.getSpanEnd(span).coerceIn(start, end)
                }
                val runs = cuts.zipWithNext().filter { (a, b) -> a < b }.map { (a, b) ->
                    RichText.Run(
                        text.substring(a, b), bold = has(text, a, b, Typeface.BOLD), italic = has(text, a, b, Typeface.ITALIC),
                        link = text.getSpans(a, b, URLSpan::class.java).firstOrNull { text.getSpanStart(it) <= a && text.getSpanEnd(it) >= b }?.url,
                    )
                }
                when (kind) {
                    ListKind.Numbered -> RichText.Line(RichText.Kind.Numbered(++count), runs)
                    ListKind.Bullet -> RichText.Line(RichText.Kind.Bullet, runs).also { count = 0 }
                    null -> RichText.Line(RichText.Kind.Text, runs).also { count = 0 }
                }
            }
            return RichText.markdown(lines).trim()
        }

        /** Whether [style] covers all of [start] until [end]. */
        private fun has(text: Spannable, start: Int, end: Int, style: Int): Boolean {
            val covering = text.getSpans(start, end, StyleSpan::class.java).filter {
                it.style == style || it.style == Typeface.BOLD_ITALIC
            }
            if (covering.isEmpty()) return false
            var at = start
            for (span in covering.sortedBy { text.getSpanStart(it) }) {
                if (text.getSpanStart(span) > at) break
                at = maxOf(at, text.getSpanEnd(span))
            }
            return at >= end
        }

        private fun setStyle(text: Editable, start: Int, end: Int, style: Int, on: Boolean) {
            if (start >= end) return
            for (span in text.getSpans(start, end, StyleSpan::class.java)) {
                if (span.style != style && span.style != Typeface.BOLD_ITALIC) continue
                val spanStart = text.getSpanStart(span)
                val spanEnd = text.getSpanEnd(span)
                if (spanEnd <= start || spanStart >= end) continue
                text.removeSpan(span)
                // A pasted bold-italic span splits into its two styles.
                val other = if (span.style == Typeface.BOLD_ITALIC) (if (style == Typeface.BOLD) Typeface.ITALIC else Typeface.BOLD) else null
                other?.let { text.setSpan(StyleSpan(it), spanStart, spanEnd, FLAGS) }
                if (spanStart < start) text.setSpan(StyleSpan(style), spanStart, start, FLAGS)
                if (spanEnd > end) text.setSpan(StyleSpan(style), end, spanEnd, FLAGS)
            }
            if (on) text.setSpan(StyleSpan(style), start, end, FLAGS)
        }

        private fun linkRange(text: Spannable, start: Int, end: Int): IntRange? {
            val at = if (start == end) (start - 1).coerceAtLeast(0) else start
            val span = text.getSpans(at, at + 1, URLSpan::class.java).firstOrNull() ?: return null
            val range = text.getSpanStart(span) until text.getSpanEnd(span)
            return if (start == end || start in range) range else null
        }

        /** Counts each numbered list from 1. */
        private fun renumber(text: Editable) {
            var count = 0
            var start = 0
            while (start <= text.length) {
                var end = text.indexOf('\n', start).let { if (it < 0) text.length else it }
                val line = text.substring(start, end)
                val (kind, prefix) = listPrefix(line)
                if (kind == ListKind.Numbered) {
                    count += 1
                    val marker = "$count. "
                    if (!line.startsWith(marker)) {
                        text.replace(start, start + prefix, marker)
                        end += marker.length - prefix
                    }
                } else {
                    count = 0
                }
                start = end + 1
            }
        }

        private fun lineRanges(text: CharSequence): List<IntRange> {
            val ranges = mutableListOf<IntRange>()
            var start = 0
            while (true) {
                val newline = text.indexOf('\n', start)
                if (newline < 0) break
                ranges += start until newline
                start = newline + 1
            }
            ranges += start until text.length
            return ranges
        }

        private fun lineAt(text: CharSequence, index: Int): IntRange {
            val start = text.lastIndexOf('\n', (index - 1).coerceAtLeast(0)).let { if (index == 0 || it < 0) 0 else it + 1 }
            val end = text.indexOf('\n', index).let { if (it < 0) text.length else it }
            return start until end
        }

        /** The list a line belongs to and how many characters its marker takes. */
        private fun listPrefix(line: String): Pair<ListKind?, Int> {
            if (line.startsWith("• ")) return ListKind.Bullet to 2
            val digits = line.takeWhile { it in '0'..'9' }
            if (digits.length in 1..3 && line.drop(digits.length).startsWith(". ")) return ListKind.Numbered to digits.length + 2
            return null to 0
        }
    }
}

/** Bold, italic, link and the two lists, above the keyboard. */
@Composable
fun RichTextFormatBar(editor: RichTextEditorState, onLink: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FormatButton(Icons.Filled.FormatBold, "Bold", editor.bold, editor::toggleBold)
        FormatButton(Icons.Filled.FormatItalic, "Italic", editor.italic, editor::toggleItalic)
        FormatButton(Icons.Filled.Link, "Link", editor.link != null, onLink)
        VerticalDivider(Modifier.height(20.dp).padding(horizontal = 6.dp))
        FormatButton(Icons.AutoMirrored.Filled.FormatListBulleted, "Bulleted list", editor.list == RichTextEditorState.ListKind.Bullet) {
            editor.toggleList(RichTextEditorState.ListKind.Bullet)
        }
        FormatButton(Icons.Filled.FormatListNumbered, "Numbered list", editor.list == RichTextEditorState.ListKind.Numbered) {
            editor.toggleList(RichTextEditorState.ListKind.Numbered)
        }
    }
}

@Composable
private fun FormatButton(icon: ImageVector, label: String, active: Boolean, onClick: () -> Unit) {
    IconButton(
        onClick = onClick,
        modifier = Modifier
            // The text keeps the cursor and keyboard while formatting.
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
    Spacer(Modifier.width(2.dp))
}
