import ServiceFlowCore
import SwiftUI
import UIKit

/// An image from the media Worker or a local capture file, loaded at the size
/// it's shown. When `annotations` are given, the drawings are painted onto the
/// loaded image, so they stay aligned however the image is cropped or fitted.
struct MediaAsyncImage: View {
    var url: URL?
    /// Longest side, in points, the image is shown at.
    var downsampleTo: CGFloat
    var contentMode: ContentMode
    var annotations: AnnotationDocument?
    var showsSpinner: Bool
    var spinnerColor: Color

    @Environment(SessionContext.self) private var session
    @Environment(\.displayScale) private var displayScale
    @State private var image: UIImage?

    init(url: URL?, downsampleTo: CGFloat, contentMode: ContentMode = .fill, annotations: AnnotationDocument? = nil,
         showsSpinner: Bool = false, spinnerColor: Color = DetailPalette.brand) {
        self.url = url
        self.downsampleTo = downsampleTo
        self.contentMode = contentMode
        self.annotations = annotations
        self.showsSpinner = showsSpinner
        self.spinnerColor = spinnerColor
    }

    var body: some View {
        Color.clear
            .overlay {
                if let image {
                    Image(uiImage: image).resizable().aspectRatio(contentMode: contentMode)
                } else if showsSpinner, url != nil {
                    Spinner(color: spinnerColor)
                }
            }
            .clipped()
            // Cancelled when the view leaves the screen.
            .task(id: LoadKey(url: url, annotations: annotations)) { await load() }
    }

    private struct LoadKey: Hashable {
        var url: URL?
        var annotations: AnnotationDocument?
    }

    private func load() async {
        guard let url else {
            image = nil
            return
        }
        let pixels = downsampleTo * displayScale
        let loaded: UIImage?
        if let cached = MediaImageLoader.cached(url, maxPixel: pixels) {
            loaded = cached
        } else {
            image = nil
            loaded = await MediaImageLoader.shared.image(for: url, maxPixel: pixels, client: session.mediaClient)
        }
        guard !Task.isCancelled, let loaded else { return }
        if let annotations, !annotations.isEmpty {
            image = AnnotationRenderer.composite(loaded, document: annotations)
        } else {
            image = loaded
        }
    }
}
