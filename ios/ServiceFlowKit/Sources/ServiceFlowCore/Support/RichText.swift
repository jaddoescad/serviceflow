import Foundation

/// A job description's formatting: bold, italic, links, bulleted and numbered
/// lines. It's saved as a small Markdown subset (`**bold**`, `_italic_`,
/// `[text](https://…)`, `- item`, `1. item`) so plain descriptions read as
/// they always did and the website shows the same text.
public enum RichText {
    public struct Run: Equatable, Sendable {
        public var text: String
        public var bold: Bool
        public var italic: Bool
        /// An http(s), mailto or tel address.
        public var link: String?

        public init(_ text: String, bold: Bool = false, italic: Bool = false, link: String? = nil) {
            self.text = text
            self.bold = bold
            self.italic = italic
            self.link = link
        }

        func sameStyle(as other: Run) -> Bool { bold == other.bold && italic == other.italic && link == other.link }
    }

    public enum Kind: Equatable, Sendable {
        case text
        case bullet
        case numbered(Int)
    }

    public struct Line: Equatable, Sendable {
        public var kind: Kind
        public var runs: [Run]

        public init(_ kind: Kind = .text, _ runs: [Run]) {
            self.kind = kind
            self.runs = RichText.merged(runs)
        }

        public var plainText: String { runs.map(\.text).joined() }
    }

    // MARK: Reading

    public static func lines(_ markdown: String) -> [Line] {
        markdown.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n").map(line)
    }

    private static func line(_ raw: String) -> Line {
        // A leading backslash keeps a line that only looks like a list item plain.
        if raw.hasPrefix("\\"), listItem(String(raw.dropFirst())) != nil {
            return Line(.text, inline(String(raw.dropFirst())))
        }
        if let (kind, rest) = listItem(raw) { return Line(kind, inline(rest)) }
        return Line(.text, inline(raw))
    }

    private static func listItem(_ raw: String) -> (Kind, String)? {
        let trimmed = raw.drop(while: { $0 == " " })
        for marker in ["- ", "• ", "* "] where trimmed.hasPrefix(marker) {
            return (.bullet, String(trimmed.dropFirst(marker.count)))
        }
        let digits = trimmed.prefix(while: \.isASCIIDigit)
        let after = trimmed.dropFirst(digits.count)
        if (1...3).contains(digits.count), after.hasPrefix(". ") || after.hasPrefix(") "), let number = Int(digits) {
            return (.numbered(number), String(after.dropFirst(2)))
        }
        return nil
    }

    private struct Token {
        let character: Character
        let escaped: Bool
        func isMarker(_ value: Character) -> Bool { !escaped && character == value }
    }

    private static let escapable: Set<Character> = ["\\", "*", "_", "[", "]"]

    private static func inline(_ text: String) -> [Run] {
        var tokens: [Token] = []
        let characters = Array(text)
        var index = 0
        while index < characters.count {
            if characters[index] == "\\", index + 1 < characters.count, escapable.contains(characters[index + 1]) {
                tokens.append(Token(character: characters[index + 1], escaped: true))
                index += 2
            } else {
                tokens.append(Token(character: characters[index], escaped: false))
                index += 1
            }
        }
        return merged(inline(tokens[...], bold: false, italic: false))
    }

    private static func inline(_ tokens: ArraySlice<Token>, bold: Bool, italic: Bool) -> [Run] {
        var runs: [Run] = []
        var buffer = ""
        func flush() {
            if !buffer.isEmpty { runs.append(Run(buffer, bold: bold, italic: italic)) }
            buffer = ""
        }
        var index = tokens.startIndex
        while index < tokens.endIndex {
            let token = tokens[index]
            if token.isMarker("*"), index + 1 < tokens.endIndex, tokens[index + 1].isMarker("*"),
               let close = closingPair(tokens, from: index + 2) {
                flush()
                runs += inline(tokens[(index + 2)..<close], bold: true, italic: italic)
                index = close + 2
            } else if token.isMarker("_"), let close = closing("_", tokens, from: index + 1) {
                flush()
                runs += inline(tokens[(index + 1)..<close], bold: bold, italic: true)
                index = close + 1
            } else if token.isMarker("["), let (labelEnd, urlEnd) = linkBounds(tokens, from: index) {
                flush()
                let label = String(tokens[(index + 1)..<labelEnd].map(\.character))
                let address = String(tokens[(labelEnd + 2)..<urlEnd].map(\.character))
                runs.append(Run(label, bold: bold, italic: italic, link: address))
                index = urlEnd + 1
            } else {
                buffer.append(token.character)
                index += 1
            }
        }
        flush()
        return runs
    }

    /// The closing `**` after `from`, around text that doesn't start or end with a space.
    private static func closingPair(_ tokens: ArraySlice<Token>, from: Int) -> Int? {
        guard from < tokens.endIndex, !tokens[from].character.isWhitespace else { return nil }
        var index = from + 1
        while index + 1 < tokens.endIndex {
            if tokens[index].isMarker("*"), tokens[index + 1].isMarker("*"), !tokens[index - 1].character.isWhitespace {
                return index
            }
            index += 1
        }
        return nil
    }

    private static func closing(_ marker: Character, _ tokens: ArraySlice<Token>, from: Int) -> Int? {
        guard from < tokens.endIndex, !tokens[from].character.isWhitespace else { return nil }
        var index = from + 1
        while index < tokens.endIndex {
            if tokens[index].isMarker(marker), !tokens[index - 1].character.isWhitespace { return index }
            index += 1
        }
        return nil
    }

    /// `[label](address)` starting at `from`: where the label and the address end.
    private static func linkBounds(_ tokens: ArraySlice<Token>, from: Int) -> (Int, Int)? {
        guard let labelEnd = tokens[(from + 1)...].firstIndex(where: { $0.isMarker("]") }), labelEnd > from + 1,
              labelEnd + 1 < tokens.endIndex, tokens[labelEnd + 1].character == "(",
              let urlEnd = tokens[(labelEnd + 2)...].firstIndex(where: { $0.character == ")" }) else { return nil }
        let address = String(tokens[(labelEnd + 2)..<urlEnd].map(\.character))
        return isLinkAddress(address) ? (labelEnd, urlEnd) : nil
    }

    // MARK: Writing

    public static func markdown(_ lines: [Line]) -> String {
        lines.map { line in
            let body = inlineMarkdown(line.runs)
            switch line.kind {
            case .text: return listItem(body) != nil ? "\\" + body : body
            case .bullet: return "- " + body
            case .numbered(let number): return "\(number). " + body
            }
        }.joined(separator: "\n")
    }

    /// Bold runs side by side share one `**…**`, italic ones inside it one `_…_`,
    /// so markers never touch.
    private static func inlineMarkdown(_ runs: [Run]) -> String {
        var output = ""
        for group in grouped(merged(runs), by: \.bold) {
            let inner = grouped(group, by: \.italic).map { italicGroup in
                let text = italicGroup.map(runMarkdown).joined()
                return italicGroup[0].italic ? wrap(text, in: "_") : text
            }.joined()
            output += group[0].bold ? wrap(inner, in: "**") : inner
        }
        return output
    }

    private static func runMarkdown(_ run: Run) -> String {
        let text = escaped(run.text)
        guard let link = run.link else { return text }
        let address = link.replacingOccurrences(of: ")", with: "%29").replacingOccurrences(of: " ", with: "%20")
        return wrap(text, in: "[", "](\(address))")
    }

    private static func escaped(_ text: String) -> String {
        var output = ""
        for character in text {
            if escapable.contains(character) { output.append("\\") }
            output.append(character)
        }
        return output
    }

    /// Spaces at either end stay outside the markers.
    private static func wrap(_ text: String, in open: String, _ close: String? = nil) -> String {
        let leading = text.prefix(while: \.isWhitespace)
        let rest = text.dropFirst(leading.count)
        let trailing = String(rest.reversed().prefix(while: \.isWhitespace).reversed())
        let core = rest.dropLast(trailing.count)
        guard !core.isEmpty else { return text }
        return "\(leading)\(open)\(core)\(close ?? open)\(trailing)"
    }

    private static func grouped(_ runs: [Run], by key: KeyPath<Run, Bool>) -> [[Run]] {
        var groups: [[Run]] = []
        for run in runs {
            if let last = groups.last?.last, last[keyPath: key] == run[keyPath: key] {
                groups[groups.count - 1].append(run)
            } else {
                groups.append([run])
            }
        }
        return groups
    }

    static func merged(_ runs: [Run]) -> [Run] {
        var output: [Run] = []
        for run in runs where !run.text.isEmpty {
            if let last = output.last, last.sameStyle(as: run) {
                output[output.count - 1].text += run.text
            } else {
                output.append(run)
            }
        }
        return output
    }

    // MARK: Links

    public static func isLinkAddress(_ address: String) -> Bool {
        let lower = address.lowercased()
        return ["http://", "https://", "mailto:", "tel:"].contains { lower.hasPrefix($0) && lower.count > $0.count }
            && !address.contains(where: \.isWhitespace)
    }

    /// What someone typed as a link, as an address: `example.com` opens over
    /// https, an email address as mail. Nil when it can't be a link.
    public static func linkAddress(_ typed: String) -> String? {
        let text = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        if isLinkAddress(text) { return text }
        guard !text.isEmpty, !text.contains(where: \.isWhitespace), !text.contains(":") else { return nil }
        if text.contains("@") { return "mailto:" + text }
        return text.contains(".") ? "https://" + text : nil
    }
}

private extension Character {
    var isASCIIDigit: Bool { isASCII && isNumber }
}
