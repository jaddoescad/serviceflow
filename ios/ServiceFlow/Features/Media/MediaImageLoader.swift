import ImageIO
import ServiceFlowCore
import UIKit

/// Loads media images from the Worker (or a local capture file), decoded
/// downsampled with ImageIO so large originals never stall scrolling, and
/// keeps them in a memory cache. The Worker token is fetched per request, so a
/// stale token is never reused. Concurrent requests for the same image share
/// one download.
actor MediaImageLoader {
    static let shared = MediaImageLoader()

    // NSCache is thread-safe.
    private nonisolated(unsafe) static let cache: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.totalCostLimit = 150 * 1024 * 1024
        return cache
    }()

    private var inFlight: [NSString: Task<UIImage?, Never>] = [:]

    /// A cached image, without waiting.
    nonisolated static func cached(_ url: URL, maxPixel: CGFloat) -> UIImage? {
        cache.object(forKey: key(url, maxPixel))
    }

    /// The image at `url`, at most `maxPixel` pixels on its longer side.
    func image(for url: URL, maxPixel: CGFloat, client: MediaClient?) async -> UIImage? {
        let key = Self.key(url, maxPixel)
        if let cached = Self.cache.object(forKey: key) { return cached }
        if let running = inFlight[key] { return await running.value }

        let task = Task<UIImage?, Never> { await Self.fetch(url, maxPixel: maxPixel, client: client) }
        inFlight[key] = task
        let image = await task.value
        inFlight[key] = nil
        if let image { Self.cache.setObject(image, forKey: key, cost: Self.cost(of: image)) }
        return image
    }

    // MARK: Helpers

    private nonisolated static func fetch(_ url: URL, maxPixel: CGFloat, client: MediaClient?) async -> UIImage? {
        let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
        if url.isFileURL {
            guard let source = CGImageSourceCreateWithURL(url as CFURL, sourceOptions) else { return nil }
            return downsample(source, maxPixel: maxPixel)
        }
        guard let client, let headers = try? await client.authorizationHeaders() else { return nil }
        var request = URLRequest(url: url)
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let status = (response as? HTTPURLResponse)?.statusCode, (200..<300).contains(status),
              let source = CGImageSourceCreateWithData(data as CFData, sourceOptions) else { return nil }
        return downsample(source, maxPixel: maxPixel)
    }

    private nonisolated static func downsample(_ source: CGImageSource, maxPixel: CGFloat) -> UIImage? {
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: max(1, Int(maxPixel.rounded(.up))),
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return UIImage(cgImage: image)
    }

    private nonisolated static func key(_ url: URL, _ maxPixel: CGFloat) -> NSString {
        "\(url.absoluteString)#\(Int(maxPixel))" as NSString
    }

    private nonisolated static func cost(of image: UIImage) -> Int {
        Int(image.size.width * image.size.height * image.scale * image.scale * 4)
    }
}

extension MediaClient {
    /// The image a tile shows: the original for photos (so drawings line up),
    /// the still frame for videos.
    func tileURL(for item: MediaItem) -> URL {
        item.kind == .video ? thumbnailURL(item.id) : originalURL(item.id)
    }
}
