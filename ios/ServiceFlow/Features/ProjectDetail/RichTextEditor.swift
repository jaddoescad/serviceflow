import ServiceFlowCore
import SwiftUI
import UIKit

/// A description with its formatting: bold, italic, links and list lines.
struct RichTextView: View {
    let markdown: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            ForEach(Array(RichText.lines(markdown).enumerated()), id: \.offset) { _, line in
                switch line.kind {
                case .text:
                    if line.runs.isEmpty { Color.clear.frame(height: 6) } else { text(line) }
                case .bullet:
                    HStack(alignment: .firstTextBaseline, spacing: 6) { Text("•"); text(line) }
                case .numbered(let number):
                    HStack(alignment: .firstTextBaseline, spacing: 6) { Text("\(number).").monospacedDigit(); text(line) }
                }
            }
        }
        .font(.app(14))
        .foregroundStyle(.primary)
        .multilineTextAlignment(.leading)
    }

    private func text(_ line: RichText.Line) -> some View {
        var string = AttributedString()
        for run in line.runs {
            var part = AttributedString(run.text)
            let font = Font.app(14, run.bold ? .semibold : .regular)
            part.font = run.italic ? font.italic() : font
            if let link = run.link, let url = URL(string: link) {
                part.link = url
                part.foregroundColor = DetailPalette.brand
                part.underlineStyle = .single
            }
            string += part
        }
        return Text(string).frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The editing text view and its formatting: the format bar reads its state
/// and calls its actions. Lists are typed as "• " and "1. " at line starts.
@MainActor @Observable
final class RichTextEditorModel {
    enum ListKind { case bullet, numbered }

    private(set) var markdown = ""
    private(set) var bold = false
    private(set) var italic = false
    private(set) var list: ListKind?
    /// The link under the cursor or selection.
    private(set) var link: String?

    @ObservationIgnored weak var textView: UITextView?
    @ObservationIgnored private var savedSelection: NSRange?

    static let size = UIFontMetrics.default.scaledValue(for: 16)

    static func font(bold: Bool, italic: Bool) -> UIFont {
        let base = UIFont.systemFont(ofSize: size, weight: bold ? .semibold : .regular)
        guard italic, let descriptor = base.fontDescriptor.withSymbolicTraits(base.fontDescriptor.symbolicTraits.union(.traitItalic)) else {
            return base
        }
        return UIFont(descriptor: descriptor, size: size)
    }

    static func attributes(bold: Bool = false, italic: Bool = false, link: String? = nil) -> [NSAttributedString.Key: Any] {
        var attributes: [NSAttributedString.Key: Any] = [.font: font(bold: bold, italic: italic), .foregroundColor: UIColor.label]
        if let link, let url = URL(string: link) { attributes[.link] = url }
        return attributes
    }

    // MARK: Converting

    static func attributed(_ markdown: String) -> NSAttributedString {
        let result = NSMutableAttributedString()
        for (index, line) in RichText.lines(markdown).enumerated() {
            if index > 0 { result.append(NSAttributedString(string: "\n", attributes: attributes())) }
            switch line.kind {
            case .text: break
            case .bullet: result.append(NSAttributedString(string: "• ", attributes: attributes()))
            case .numbered(let number): result.append(NSAttributedString(string: "\(number). ", attributes: attributes()))
            }
            for run in line.runs {
                result.append(NSAttributedString(string: run.text, attributes: attributes(bold: run.bold, italic: run.italic, link: run.link)))
            }
        }
        return result
    }

    /// The text view's text as saved: numbered lines counted from 1 in each list.
    static func markdown(from text: NSAttributedString) -> String {
        var lines: [RichText.Line] = []
        var count = 0
        for range in lineRanges(text.string as NSString) {
            let (kind, prefix) = listPrefix(of: (text.string as NSString).substring(with: range))
            var runs: [RichText.Run] = []
            let body = NSRange(location: range.location + prefix, length: range.length - prefix)
            text.enumerateAttributes(in: body) { attributes, runRange, _ in
                let traits = (attributes[.font] as? UIFont)?.fontDescriptor.symbolicTraits ?? []
                let link = (attributes[.link] as? URL)?.absoluteString ?? attributes[.link] as? String
                runs.append(RichText.Run((text.string as NSString).substring(with: runRange),
                                         bold: traits.contains(.traitBold), italic: traits.contains(.traitItalic), link: link))
            }
            switch kind {
            case .numbered:
                count += 1
                lines.append(RichText.Line(.numbered(count), runs))
            case .bullet:
                count = 0
                lines.append(RichText.Line(.bullet, runs))
            case nil:
                count = 0
                lines.append(RichText.Line(.text, runs))
            }
        }
        return RichText.markdown(lines).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func lineRanges(_ string: NSString) -> [NSRange] {
        var ranges: [NSRange] = []
        var start = 0
        while true {
            let newline = string.range(of: "\n", range: NSRange(location: start, length: string.length - start))
            guard newline.location != NSNotFound else { break }
            ranges.append(NSRange(location: start, length: newline.location - start))
            start = newline.location + 1
        }
        ranges.append(NSRange(location: start, length: string.length - start))
        return ranges
    }

    /// The list a line belongs to and how many UTF-16 characters its marker takes.
    private static func listPrefix(of line: String) -> (ListKind?, Int) {
        if line.hasPrefix("• ") { return (.bullet, 2) }
        let digits = line.prefix(while: { $0.isASCII && $0.isNumber })
        if (1...3).contains(digits.count), line.dropFirst(digits.count).hasPrefix(". ") { return (.numbered, digits.count + 2) }
        return (nil, 0)
    }

    // MARK: State

    /// Fills the text view; the model's state follows once SwiftUI has drawn it.
    func load(_ markdown: String, into textView: UITextView) {
        self.textView = textView
        textView.attributedText = Self.attributed(markdown)
        textView.typingAttributes = Self.attributes()
    }

    func textChanged() {
        guard let textView else { return }
        markdown = Self.markdown(from: textView.attributedText)
        refresh()
    }

    func refresh() {
        guard let textView else { return }
        // Typing after a link starts plain text.
        textView.typingAttributes[.link] = nil
        let selection = textView.selectedRange
        let text = textView.attributedText ?? NSAttributedString()
        // UIKit keeps the typing style in step with the character before the cursor.
        let font = selection.length > 0 ? text.attribute(.font, at: selection.location, effectiveRange: nil) : textView.typingAttributes[.font]
        let traits = (font as? UIFont)?.fontDescriptor.symbolicTraits ?? []
        bold = traits.contains(.traitBold)
        italic = traits.contains(.traitItalic)
        link = linkRange(at: selection).map { (text.attribute(.link, at: $0.location, effectiveRange: nil) as? URL)?.absoluteString ?? "" }
        list = Self.listPrefix(of: currentLine(textView).text).0
    }

    private func currentLine(_ textView: UITextView) -> (range: NSRange, text: String) {
        let string = textView.text as NSString? ?? ""
        let range = string.lineRange(for: NSRange(location: textView.selectedRange.location, length: 0))
        let trimmed = string.substring(with: range).hasSuffix("\n") ? NSRange(location: range.location, length: range.length - 1) : range
        return (trimmed, string.substring(with: trimmed))
    }

    // MARK: Actions

    func toggleBold() { toggle(.traitBold, on: !bold) }
    func toggleItalic() { toggle(.traitItalic, on: !italic) }

    private func toggle(_ trait: UIFontDescriptor.SymbolicTraits, on: Bool) {
        guard let textView else { return }
        let selection = textView.selectedRange
        if selection.length == 0 {
            let current = (textView.typingAttributes[.font] as? UIFont)?.fontDescriptor.symbolicTraits ?? []
            textView.typingAttributes[.font] = Self.font(bold: trait == .traitBold ? on : current.contains(.traitBold),
                                                        italic: trait == .traitItalic ? on : current.contains(.traitItalic))
            refresh()
            return
        }
        edit(textView) { storage in
            storage.enumerateAttribute(.font, in: selection) { value, range, _ in
                let traits = (value as? UIFont)?.fontDescriptor.symbolicTraits ?? []
                storage.addAttribute(.font, value: Self.font(bold: trait == .traitBold ? on : traits.contains(.traitBold),
                                                             italic: trait == .traitItalic ? on : traits.contains(.traitItalic)), range: range)
            }
        }
        textView.selectedRange = selection
    }

    /// Before the link prompt takes the keyboard away.
    func rememberSelection() { savedSelection = textView?.selectedRange }

    /// Links the selection (or the link under the cursor) to `address`; nil removes it.
    /// With nothing selected, the address goes in as its own linked text.
    func setLink(_ address: String?, label: String) {
        guard let textView else { return }
        let selection = savedSelection ?? textView.selectedRange
        let target = linkRange(at: selection) ?? selection
        edit(textView) { storage in
            if target.length > 0 {
                if let address, let url = URL(string: address) {
                    storage.addAttribute(.link, value: url, range: target)
                } else {
                    storage.removeAttribute(.link, range: target)
                }
            } else if let address {
                let text = label.isEmpty ? address.replacingOccurrences(of: "mailto:", with: "") : label
                storage.insert(NSAttributedString(string: text, attributes: Self.attributes(link: address)), at: target.location)
                textView.selectedRange = NSRange(location: target.location + (text as NSString).length, length: 0)
            }
        }
        savedSelection = nil
        textView.becomeFirstResponder()
    }

    /// The whole link touching the cursor, or covering the selection.
    private func linkRange(at selection: NSRange) -> NSRange? {
        guard let text = textView?.attributedText, text.length > 0 else { return nil }
        let location = selection.length > 0 ? selection.location : max(0, min(selection.location, text.length) - 1)
        var range = NSRange()
        guard location < text.length, text.attribute(.link, at: location, longestEffectiveRange: &range,
                                                     in: NSRange(location: 0, length: text.length)) != nil else { return nil }
        return selection.length == 0 || NSLocationInRange(selection.location, range) ? range : nil
    }

    /// Makes the selected lines that list, or plain again when they already are.
    func toggleList(_ kind: ListKind) {
        guard let textView else { return }
        let string = (textView.text ?? "") as NSString
        let selection = textView.selectedRange
        let end = selection.location + selection.length
        let lines = Self.lineRanges(string).filter { line in
            line.location <= end && selection.location <= line.location + line.length
                && (selection.length == 0 || line.location < end || line.location == selection.location)
        }
        guard let first = lines.first, let last = lines.last else { return }
        let removing = lines.allSatisfy { Self.listPrefix(of: string.substring(with: $0)).0 == kind }
        var shift = 0
        edit(textView) { storage in
            // Last line first, so earlier lines keep their positions.
            for (index, line) in lines.enumerated().reversed() {
                let old = Self.listPrefix(of: string.substring(with: line)).1
                let marker = removing ? "" : (kind == .bullet ? "• " : "\(index + 1). ")
                storage.replaceCharacters(in: NSRange(location: line.location, length: old),
                                          with: NSAttributedString(string: marker, attributes: Self.attributes()))
                shift += (marker as NSString).length - old
            }
        }
        textView.selectedRange = lines.count == 1
            ? NSRange(location: max(first.location, selection.location + shift), length: selection.length)
            : NSRange(location: first.location, length: last.location + last.length + shift - first.location)
        renumber()
    }

    /// Return on a list line starts the next item; on an empty item it ends the list.
    func handleReturn(in textView: UITextView) -> Bool {
        let line = currentLine(textView)
        let (kind, prefix) = Self.listPrefix(of: line.text)
        guard let kind, textView.selectedRange.length == 0 else { return true }
        edit(textView) { storage in
            if (line.text as NSString).length == prefix {
                storage.replaceCharacters(in: NSRange(location: line.range.location, length: prefix), with: "")
                textView.selectedRange = NSRange(location: line.range.location, length: 0)
            } else {
                let number = Int(line.text.prefix(while: { $0.isNumber })) ?? 0
                let marker = "\n" + (kind == .bullet ? "• " : "\(number + 1). ")
                let at = textView.selectedRange.location
                storage.replaceCharacters(in: NSRange(location: at, length: 0), with: NSAttributedString(string: marker, attributes: Self.attributes()))
                textView.selectedRange = NSRange(location: at + (marker as NSString).length, length: 0)
            }
        }
        renumber()
        return false
    }

    /// Counts each numbered list from 1 after list edits.
    private func renumber() {
        guard let textView else { return }
        let selection = textView.selectedRange
        var count = 0
        var shift = 0
        edit(textView) { storage in
            for range in Self.lineRanges(storage.string as NSString) {
                let location = range.location + shift
                let line = (storage.string as NSString).substring(with: NSRange(location: location, length: range.length))
                let (kind, prefix) = Self.listPrefix(of: line)
                guard kind == .numbered else { count = 0; continue }
                count += 1
                let marker = "\(count). "
                if line.hasPrefix(marker) { continue }
                storage.replaceCharacters(in: NSRange(location: location, length: prefix),
                                          with: NSAttributedString(string: marker, attributes: Self.attributes()))
                if location < selection.location { shift += (marker as NSString).length - prefix }
            }
        }
        textView.selectedRange = NSRange(location: min(selection.location + shift, (textView.text as NSString).length),
                                         length: selection.length)
    }

    private func edit(_ textView: UITextView, _ change: (NSTextStorage) -> Void) {
        let typing = textView.typingAttributes
        textView.textStorage.beginEditing()
        change(textView.textStorage)
        textView.textStorage.endEditing()
        textView.typingAttributes = typing
        textChanged()
    }
}

/// The UIKit text view behind the editor: SwiftUI's own editor can't hold bold or links on iOS 17.
struct RichTextEditorView: UIViewRepresentable {
    let editor: RichTextEditorModel
    let initial: String

    func makeUIView(context: Context) -> UITextView {
        let textView = UITextView()
        textView.delegate = context.coordinator
        textView.backgroundColor = .clear
        textView.textContainerInset = UIEdgeInsets(top: 12, left: 0, bottom: 24, right: 0)
        textView.linkTextAttributes = [.foregroundColor: UIColor(DetailPalette.brand), .underlineStyle: NSUnderlineStyle.single.rawValue]
        textView.alwaysBounceVertical = true
        textView.keyboardDismissMode = .interactive
        editor.load(initial, into: textView)
        DispatchQueue.main.async { [editor] in
            textView.becomeFirstResponder()
            textView.selectedRange = NSRange(location: textView.attributedText.length, length: 0)
            editor.textChanged()
        }
        return textView
    }

    func updateUIView(_ textView: UITextView, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(editor: editor) }

    final class Coordinator: NSObject, UITextViewDelegate {
        let editor: RichTextEditorModel
        init(editor: RichTextEditorModel) { self.editor = editor }

        func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
            MainActor.assumeIsolated {
                text == "\n" ? editor.handleReturn(in: textView) : true
            }
        }

        func textViewDidChange(_ textView: UITextView) {
            MainActor.assumeIsolated { editor.textChanged() }
        }

        func textViewDidChangeSelection(_ textView: UITextView) {
            MainActor.assumeIsolated { editor.refresh() }
        }
    }
}

/// Bold, italic, link and the two lists, above the keyboard.
struct RichTextFormatBar: View {
    let editor: RichTextEditorModel
    let onLink: () -> Void

    var body: some View {
        HStack(spacing: 2) {
            button("bold", "Bold", active: editor.bold, action: editor.toggleBold)
            button("italic", "Italic", active: editor.italic, action: editor.toggleItalic)
            button("link", "Link", active: editor.link != nil, action: onLink)
            Divider().frame(height: 20).padding(.horizontal, 6)
            button("list.bullet", "Bulleted list", active: editor.list == .bullet) { editor.toggleList(.bullet) }
            button("list.number", "Numbered list", active: editor.list == .numbered) { editor.toggleList(.numbered) }
            Spacer()
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(.bar)
        .overlay(alignment: .top) { Divider() }
    }

    private func button(_ symbol: String, _ label: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .medium))
                .frame(width: 40, height: 36)
                .foregroundStyle(active ? DetailPalette.brand : Color.primary)
                .background(active ? DetailPalette.brand.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(active ? .isSelected : [])
    }
}
