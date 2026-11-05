package com.serviceflow.core

/**
 * A job description's formatting: bold, italic, links, bulleted and numbered
 * lines. It's saved as a small Markdown subset (`**bold**`, `_italic_`,
 * `[text](https://…)`, `- item`, `1. item`) so plain descriptions read as
 * they always did and the website shows the same text.
 */
object RichText {
    data class Run(
        val text: String,
        val bold: Boolean = false,
        val italic: Boolean = false,
        /** An http(s), mailto or tel address. */
        val link: String? = null,
    ) {
        internal fun sameStyle(other: Run) = bold == other.bold && italic == other.italic && link == other.link
    }

    sealed interface Kind {
        data object Text : Kind
        data object Bullet : Kind
        data class Numbered(val number: Int) : Kind
    }

    class Line(val kind: Kind = Kind.Text, runs: List<Run>) {
        val runs: List<Run> = merged(runs)
        val plainText: String get() = runs.joinToString("") { it.text }

        override fun equals(other: Any?) = other is Line && other.kind == kind && other.runs == runs
        override fun hashCode() = 31 * kind.hashCode() + runs.hashCode()
        override fun toString() = "Line($kind, $runs)"
    }

    // Reading

    fun lines(markdown: String): List<Line> = markdown.replace("\r\n", "\n").split("\n").map(::line)

    private fun line(raw: String): Line {
        // A leading backslash keeps a line that only looks like a list item plain.
        if (raw.startsWith("\\") && listItem(raw.drop(1)) != null) return Line(Kind.Text, inline(raw.drop(1)))
        val item = listItem(raw) ?: return Line(Kind.Text, inline(raw))
        return Line(item.first, inline(item.second))
    }

    private fun listItem(raw: String): Pair<Kind, String>? {
        val trimmed = raw.trimStart(' ')
        for (marker in listOf("- ", "• ", "* ")) {
            if (trimmed.startsWith(marker)) return Kind.Bullet to trimmed.drop(marker.length)
        }
        val digits = trimmed.takeWhile { it in '0'..'9' }
        val after = trimmed.drop(digits.length)
        if (digits.length in 1..3 && (after.startsWith(". ") || after.startsWith(") "))) {
            return Kind.Numbered(digits.toInt()) to after.drop(2)
        }
        return null
    }

    private class Token(val character: Char, val escaped: Boolean) {
        fun isMarker(value: Char) = !escaped && character == value
    }

    private val escapable = setOf('\\', '*', '_', '[', ']')

    private fun inline(text: String): List<Run> {
        val tokens = mutableListOf<Token>()
        var index = 0
        while (index < text.length) {
            if (text[index] == '\\' && index + 1 < text.length && text[index + 1] in escapable) {
                tokens += Token(text[index + 1], escaped = true)
                index += 2
            } else {
                tokens += Token(text[index], escaped = false)
                index += 1
            }
        }
        return merged(inline(tokens, 0, tokens.size, bold = false, italic = false))
    }

    private fun inline(tokens: List<Token>, start: Int, end: Int, bold: Boolean, italic: Boolean): List<Run> {
        val runs = mutableListOf<Run>()
        val buffer = StringBuilder()
        fun flush() {
            if (buffer.isNotEmpty()) runs += Run(buffer.toString(), bold = bold, italic = italic)
            buffer.clear()
        }
        var index = start
        while (index < end) {
            val token = tokens[index]
            val pair = if (token.isMarker('*') && index + 1 < end && tokens[index + 1].isMarker('*')) closingPair(tokens, index + 2, end) else null
            val single = if (pair == null && token.isMarker('_')) closing('_', tokens, index + 1, end) else null
            val link = if (pair == null && single == null && token.isMarker('[')) linkBounds(tokens, index, end) else null
            when {
                pair != null -> {
                    flush()
                    runs += inline(tokens, index + 2, pair, bold = true, italic = italic)
                    index = pair + 2
                }
                single != null -> {
                    flush()
                    runs += inline(tokens, index + 1, single, bold = bold, italic = true)
                    index = single + 1
                }
                link != null -> {
                    flush()
                    val label = tokens.subList(index + 1, link.first).joinToString("") { it.character.toString() }
                    val address = tokens.subList(link.first + 2, link.second).joinToString("") { it.character.toString() }
                    runs += Run(label, bold = bold, italic = italic, link = address)
                    index = link.second + 1
                }
                else -> {
                    buffer.append(token.character)
                    index += 1
                }
            }
        }
        flush()
        return runs
    }

    /** The closing `**` after [from], around text that doesn't start or end with a space. */
    private fun closingPair(tokens: List<Token>, from: Int, end: Int): Int? {
        if (from >= end || tokens[from].character.isWhitespace()) return null
        var index = from + 1
        while (index + 1 < end) {
            if (tokens[index].isMarker('*') && tokens[index + 1].isMarker('*') && !tokens[index - 1].character.isWhitespace()) return index
            index += 1
        }
        return null
    }

    private fun closing(marker: Char, tokens: List<Token>, from: Int, end: Int): Int? {
        if (from >= end || tokens[from].character.isWhitespace()) return null
        var index = from + 1
        while (index < end) {
            if (tokens[index].isMarker(marker) && !tokens[index - 1].character.isWhitespace()) return index
            index += 1
        }
        return null
    }

    /** `[label](address)` starting at [from]: where the label and the address end. */
    private fun linkBounds(tokens: List<Token>, from: Int, end: Int): Pair<Int, Int>? {
        val labelEnd = (from + 1 until end).firstOrNull { tokens[it].isMarker(']') } ?: return null
        if (labelEnd == from + 1 || labelEnd + 1 >= end || tokens[labelEnd + 1].character != '(') return null
        val urlEnd = (labelEnd + 2 until end).firstOrNull { tokens[it].character == ')' } ?: return null
        val address = tokens.subList(labelEnd + 2, urlEnd).joinToString("") { it.character.toString() }
        return if (isLinkAddress(address)) labelEnd to urlEnd else null
    }

    // Writing

    fun markdown(lines: List<Line>): String = lines.joinToString("\n") { line ->
        val body = inlineMarkdown(line.runs)
        when (val kind = line.kind) {
            Kind.Text -> if (listItem(body) != null) "\\" + body else body
            Kind.Bullet -> "- $body"
            is Kind.Numbered -> "${kind.number}. $body"
        }
    }

    /** Bold runs side by side share one `**…**`, italic ones inside it one `_…_`, so markers never touch. */
    private fun inlineMarkdown(runs: List<Run>): String = grouped(merged(runs)) { it.bold }.joinToString("") { group ->
        val inner = grouped(group) { it.italic }.joinToString("") { italicGroup ->
            val text = italicGroup.joinToString("", transform = ::runMarkdown)
            if (italicGroup[0].italic) wrap(text, "_") else text
        }
        if (group[0].bold) wrap(inner, "**") else inner
    }

    private fun runMarkdown(run: Run): String {
        val text = escaped(run.text)
        val link = run.link ?: return text
        val address = link.replace(")", "%29").replace(" ", "%20")
        return wrap(text, "[", "]($address)")
    }

    private fun escaped(text: String): String = buildString {
        for (character in text) {
            if (character in escapable) append('\\')
            append(character)
        }
    }

    /** Spaces at either end stay outside the markers. */
    private fun wrap(text: String, open: String, close: String = open): String {
        val leading = text.takeWhile { it.isWhitespace() }
        val rest = text.drop(leading.length)
        val trailing = rest.takeLastWhile { it.isWhitespace() }
        val core = rest.dropLast(trailing.length)
        if (core.isEmpty()) return text
        return "$leading$open$core$close$trailing"
    }

    private fun grouped(runs: List<Run>, key: (Run) -> Boolean): List<List<Run>> {
        val groups = mutableListOf<MutableList<Run>>()
        for (run in runs) {
            val last = groups.lastOrNull()
            if (last != null && key(last.last()) == key(run)) last += run else groups += mutableListOf(run)
        }
        return groups
    }

    internal fun merged(runs: List<Run>): List<Run> {
        val output = mutableListOf<Run>()
        for (run in runs) {
            if (run.text.isEmpty()) continue
            val last = output.lastOrNull()
            if (last != null && last.sameStyle(run)) output[output.size - 1] = last.copy(text = last.text + run.text) else output += run
        }
        return output
    }

    // Links

    fun isLinkAddress(address: String): Boolean {
        val lower = address.lowercase()
        return listOf("http://", "https://", "mailto:", "tel:").any { lower.startsWith(it) && lower.length > it.length } &&
            address.none { it.isWhitespace() }
    }

    /**
     * What someone typed as a link, as an address: `example.com` opens over
     * https, an email address as mail. Null when it can't be a link.
     */
    fun linkAddress(typed: String): String? {
        val text = typed.trim()
        if (isLinkAddress(text)) return text
        if (text.isEmpty() || text.any { it.isWhitespace() } || ':' in text) return null
        if ('@' in text) return "mailto:$text"
        return if ('.' in text) "https://$text" else null
    }
}
