import ImageIO
import ServiceFlowCore
import SwiftUI
import UIKit

/// Loads media images through the Worker with a token fetched at request
/// time (never a stale one frozen into a row), decodes them downsampled with
/// ImageIO so large originals don't stall the grid, and caches them in memory.
actor MediaImageLoader {
    static let shared = MediaImageLoader()

    nonisolated static let cache: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.totalCostLimit = 150 * 1024 * 1024
        return cache
    }()

    private var tasks: [String: Task<UIImage?, Never>] = [:]

    nonisolated static func key(_ url: URL, _ maxPixel: CGFloat) -> NSString {
        "\(url.absoluteString)#\(Int(maxPixel))" as NSString
    }

    nonisolated static func cached(_ url: URL, maxPixel: CGFloat) -> UIImage? {
        cache.object(forKey: key(url, maxPixel))
    }

    func image(for url: URL, maxPixel: CGFloat,
               headers: @escaping @Sendable () async throws -> [String: String]) async -> UIImage? {
        let key = Self.key(url, maxPixel)
        if let cached = Self.cache.object(forKey: key) { return cached }
        if let running = tasks[key as String] { return await running.value }

        let task = Task<UIImage?, Never> {
            if url.isFileURL {
                guard let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary) else {
                    return nil
                }
                return Self.downsample(source, maxPixel: maxPixel)
            }
            do {
                var request = URLRequest(url: url)
                for (name, value) in try await headers() { request.setValue(value, forHTTPHeaderField: name) }
                let (data, response) = try await URLSession.shared.data(for: request)
                guard let status = (response as? HTTPURLResponse)?.statusCode, (200..<300).contains(status),
                      let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary) else {
                    return nil
                }
                return Self.downsample(source, maxPixel: maxPixel)
            } catch {
                return nil
            }
        }
        tasks[key as String] = task
        let image = await task.value
        tasks[key as String] = nil
        if let image {
            let cost = Int(image.size.width * image.size.height * image.scale * image.scale * 4)
            Self.cache.setObject(image, forKey: key, cost: cost)
        }
        return image
    }

    nonisolated static func downsample(_ source: CGImageSource, maxPixel: CGFloat) -> UIImage? {
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: max(1, Int(maxPixel.rounded(.up))),
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return UIImage(cgImage: image)
    }
}

/// An image from the media Worker (or a local capture file).
struct MediaAsyncImage: View {
    var url: URL?
    /// Largest side in points the image is shown at.
    var downsampleTo: CGFloat
    var contentMode: ContentMode = .fill
    var showsSpinner = false
    var spinnerColor: Color = DetailPalette.brand
    var onFailure: (() -> Void)? = nil
    var onLoad: ((UIImage) -> Void)? = nil

    @Environment(SessionContext.self) private var session
    @Environment(\.displayScale) private var displayScale
    @State private var image: UIImage?

    init(url: URL?, downsampleTo: CGFloat, contentMode: ContentMode = .fill, showsSpinner: Bool = false,
         spinnerColor: Color = DetailPalette.brand, onFailure: (() -> Void)? = nil, onLoad: ((UIImage) -> Void)? = nil) {
        self.url = url
        self.downsampleTo = downsampleTo
        self.contentMode = contentMode
        self.showsSpinner = showsSpinner
        self.spinnerColor = spinnerColor
        self.onFailure = onFailure
        self.onLoad = onLoad
    }

    var body: some View {
        Color.clear
            .overlay {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: contentMode)
                } else if showsSpinner, url != nil {
                    Spinner(color: spinnerColor)
                }
            }
            .clipped()
            .task(id: url) { await load() }
    }

    private func load() async {
        guard let url else {
            image = nil
            return
        }
        let pixels = downsampleTo * displayScale
        if let cached = MediaImageLoader.cached(url, maxPixel: pixels) {
            image = cached
            onLoad?(cached)
            return
        }
        image = nil
        let client = session.mediaClient
        let loaded = await MediaImageLoader.shared.image(for: url, maxPixel: pixels) {
            guard !url.isFileURL, let client else { return [:] }
            return try await client.authorizationHeaders()
        }
        guard !Task.isCancelled else { return }
        image = loaded
        if let loaded { onLoad?(loaded) } else { onFailure?() }
    }
}

extension MediaClient {
    /// The image a tile shows: the original for photos, the still for videos.
    func tileURL(for item: MediaItem) -> URL {
        item.kind == .video ? thumbnailURL(item.id) : originalURL(item.id)
    }
}
