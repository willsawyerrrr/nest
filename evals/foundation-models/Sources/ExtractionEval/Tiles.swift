import CoreGraphics
import Foundation
import ImageIO

/// Cuts a page image into pieces so the model reads each at a higher effective resolution.
enum Tiles {
  static let count = 4
  /// Fraction of a band's height shared with its neighbour, so a row on a seam is whole in one.
  static let overlap: CGFloat = 0.1

  /// The bands of every page, in page order.
  static func bands(ofPages urls: [URL]) throws -> [CGImage] {
    try urls.flatMap { try bands(of: $0) }
  }

  /// Overlapping full-width horizontal bands, top to bottom.
  static func bands(of url: URL) throws -> [CGImage] {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else { throw EvalError("cannot read \(url.lastPathComponent)") }
    let height = CGFloat(image.height)
    let step = height / CGFloat(count)
    return try (0..<count).map { index in
      let top = max(0, CGFloat(index) * step - step * overlap)
      let bottom = min(height, CGFloat(index + 1) * step + step * overlap)
      guard let band = image.cropping(to: CGRect(x: 0, y: top, width: CGFloat(image.width), height: bottom - top))
      else { throw EvalError("cannot crop \(url.lastPathComponent)") }
      return band
    }
  }
}
