import SwiftUI

extension Color {
    /// `Color(hex: 0x173f37)`, optionally with opacity.
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xff) / 255,
            green: Double((hex >> 8) & 0xff) / 255,
            blue: Double(hex & 0xff) / 255,
            opacity: opacity
        )
    }

    /// `Color(rgba: 17, 32, 29, 0.42)`.
    init(rgba red: Double, _ green: Double, _ blue: Double, _ opacity: Double) {
        self.init(.sRGB, red: red / 255, green: green / 255, blue: blue / 255, opacity: opacity)
    }
}

/// The app palette (`theme.js` `palette`).
enum Palette {
    static let green = Color(hex: 0x173f37)
    static let teal = Color(hex: 0x2f8d7f)
    static let brown = Color(hex: 0x7c5127)
    static let border = Color(hex: 0xe0e3e1)
    static let muted = Color(hex: 0x8b9692)
    static let ink = Color(hex: 0x11201d)
    static let navy = Color(hex: 0x31495d)
    static let red = Color(hex: 0xc0432b)
}

/// Sign-in and sign-up screens.
enum AuthPalette {
    static let brand = Color(hex: 0x258585)
    static let danger = Color(hex: 0xb91c1c)
}

/// Project detail uses its own palette on purpose.
enum DetailPalette {
    static let brand = Color(hex: 0x2b8496)
    static let navy = Color(hex: 0x31495d)
    static let ink = Color(hex: 0x1f2933)
    static let muted = Color(hex: 0x8a8f95)
    static let subtle = Color(hex: 0xb8bcc1)
    static let border = Color(hex: 0xe6e8eb)
    static let soft = Color(hex: 0xf6f8f9)
}

extension Font {
    /// System font scaled with Dynamic Type, like RN text.
    static func app(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .system(size: UIFontMetrics.default.scaledValue(for: size), weight: weight)
    }
}

extension View {
    /// RN-style text: size, weight, colour and letter spacing in one call.
    func text(_ size: CGFloat, _ weight: Font.Weight = .regular, _ color: Color, tracking: CGFloat = 0) -> some View {
        font(.app(size, weight)).foregroundStyle(color).tracking(tracking)
    }
}

/// A pressed-state style: opacity and optional scale.
struct PressableStyle: ButtonStyle {
    var pressedOpacity: Double = 0.85
    var pressedScale: CGFloat = 1

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? pressedOpacity : 1)
            .scaleEffect(configuration.isPressed ? pressedScale : 1)
            .contentShape(Rectangle())
    }
}

extension ButtonStyle where Self == PressableStyle {
    static var pressable: PressableStyle { PressableStyle() }
    static func pressable(opacity: Double, scale: CGFloat = 1) -> PressableStyle {
        PressableStyle(pressedOpacity: opacity, pressedScale: scale)
    }
}
