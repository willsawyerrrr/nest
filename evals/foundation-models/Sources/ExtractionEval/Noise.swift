import CoreGraphics
import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// One operation of a variant, as `supabase/functions/_eval/noise.ts` writes it. Only the fields
/// of the operation named by `op` are present.
struct NoiseOp: Decodable {
  let op: String
  var companion: String?
  var left, top, right, bottom: Double?
  var degrees: Double?
  var corners: [[Double]]?
  var factor, fade: Double?
  var angle, strength, offset: Double?
  var radius: Double?
  var period: Double?
  var density: Double?
  var seed: UInt32?
  var quality: Int?
}

struct Variant: Decodable {
  let id: String
  let baseId: String
  let profile: String
  let textLayer: Bool
  let ops: [NoiseOp]
}

struct Manifest: Decodable {
  let seed: Int
  let variants: [Variant]

  /// The manifest beside `corpus.json`, or nil when there is none.
  static func load(from dir: URL) throws -> Manifest? {
    let url = dir.appending(path: "manifest.json")
    guard FileManager.default.fileExists(atPath: url.path) else { return nil }
    return try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: url))
  }
}

/// Applies a variant's operations, in the manifest's order, to the clean raster of its document.
enum Noise {
  static let context = CIContext(options: [.useSoftwareRenderer: true])
  /// What shows beyond the page: a desk for a photograph, white for a scanner bed.
  static func backdrop(_ profile: String) -> CIColor {
    profile == "scan" ? CIColor(red: 1, green: 1, blue: 1) : CIColor(red: 0.42, green: 0.38, blue: 0.34)
  }

  /// Writes `<id>.png`, and `<id>.pdf`: the clean text-layer PDF for a born-digital variant, else
  /// a PDF holding only the degraded raster, so no text layer exists.
  static func render(_ variant: Variant, of docs: [CorpusDoc], into dir: URL) throws {
    guard let base = docs.first(where: { $0.id == variant.baseId }) else {
      throw EvalError("\(variant.id): no document \(variant.baseId)")
    }
    let files = try Render.filesDirectory(in: dir)
    var image = try Render.raster(base)
    for op in variant.ops {
      image = try apply(op, to: image, profile: variant.profile, docs: docs, variant: variant.id)
    }
    try Render.writePNG(image, to: files.appending(path: "\(variant.id).png"), name: variant.id)
    let pdf = files.appending(path: "\(variant.id).pdf")
    if variant.textLayer {
      try Render.writeTextPDF(
        CorpusDoc(id: variant.id, kind: base.kind, financialYear: base.financialYear, rows: base.rows,
          pageBreaks: base.pageBreaks, fault: nil),
        to: pdf)
    } else {
      try Render.writeImagePDF(image, to: pdf, name: variant.id)
    }
  }

  static func apply(
    _ op: NoiseOp, to image: CGImage, profile: String, docs: [CorpusDoc], variant: String
  ) throws -> CGImage {
    switch op.op {
    case "twoUp":
      guard let companion = docs.first(where: { $0.id == op.companion }) else {
        throw EvalError("\(variant): no companion \(op.companion ?? "")")
      }
      return try twoUp(image, try Render.raster(companion))
    case "crop":
      let w = Double(image.width), h = Double(image.height)
      let rect = CGRect(
        x: w * op.left!, y: h * op.top!, width: w * (1 - op.left! - op.right!),
        height: h * (1 - op.top! - op.bottom!))
      guard let out = image.cropping(to: rect) else { throw EvalError("\(variant): crop failed") }
      return out
    case "rotate": return try rotate(image, degrees: op.degrees!, background: backdrop(profile))
    case "perspective":
      return try perspective(image, corners: op.corners!, background: backdrop(profile))
    case "lowLight":
      return try pixels(image) { buffer, _, _ in
        for i in stride(from: 0, to: buffer.count, by: 4) {
          for c in 0..<3 {
            let v = Double(buffer[i + c]) / 255 * (1 - op.fade!) + 0.5 * op.fade!
            buffer[i + c] = byte(v * op.factor!)
          }
        }
      }
    case "shadow":
      return try pixels(image) { buffer, w, h in
        let a = op.angle! * .pi / 180
        let (c, s) = (cos(a), sin(a))
        let range = abs(c) * Double(w) + abs(s) * Double(h)
        let start = min(0, c * Double(w)) + min(0, s * Double(h))
        for y in 0..<h {
          for x in 0..<w {
            let position = (Double(x) * c + Double(y) * s - start) / range
            let factor = 1 - op.strength! * smoothstep(-1, 1, (position - op.offset!) / 0.08)
            let i = (y * w + x) * 4
            for k in 0..<3 { buffer[i + k] = byte(Double(buffer[i + k]) / 255 * factor) }
          }
        }
      }
    case "blur": return try blur(image, radius: op.radius!)
    case "moire":
      return try pixels(image) { buffer, w, h in
        let a = op.angle! * .pi / 180
        let (c, s) = (cos(a), sin(a))
        for y in 0..<h {
          for x in 0..<w {
            let u = Double(x) * c + Double(y) * s
            let v = -Double(x) * s + Double(y) * c
            let grid = (0.5 + 0.5 * sin(2 * .pi * u / op.period!))
              * (0.5 + 0.5 * sin(2 * .pi * v / (op.period! * 1.07)))
            let factor = 1 - op.strength! * (1 - grid)
            let i = (y * w + x) * 4
            for k in 0..<3 { buffer[i + k] = byte(Double(buffer[i + k]) / 255 * factor) }
          }
        }
      }
    case "speckle":
      return try pixels(image) { buffer, w, h in
        var next = SeededRandom(seed: op.seed!)
        for p in 0..<(w * h) where next.unit() < op.density! {
          let value: UInt8 = next.unit() < 0.5 ? 0 : 255
          for c in 0..<3 { buffer[p * 4 + c] = value }
        }
      }
    case "jpeg": return try jpeg(image, quality: op.quality!)
    default: throw EvalError("\(variant): unknown operation \(op.op)")
    }
  }

  // MARK: Pixels

  static func byte(_ value: Double) -> UInt8 { UInt8(max(0, min(255, (value * 255).rounded()))) }

  static func smoothstep(_ low: Double, _ high: Double, _ x: Double) -> Double {
    let t = max(0, min(1, (x - low) / (high - low)))
    return t * t * (3 - 2 * t)
  }

  /// Runs `edit` over the image's opaque RGBA bytes and returns the result.
  static func pixels(_ image: CGImage, _ edit: (inout [UInt8], Int, Int) -> Void) throws -> CGImage {
    let (w, h) = (image.width, image.height)
    var buffer = [UInt8](repeating: 0, count: w * h * 4)
    let space = CGColorSpaceCreateDeviceRGB()
    let info = CGImageAlphaInfo.premultipliedLast.rawValue
    try buffer.withUnsafeMutableBytes { raw in
      guard let draw = CGContext(
        data: raw.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
        space: space, bitmapInfo: info)
      else { throw EvalError("cannot read pixels") }
      draw.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    }
    edit(&buffer, w, h)
    return try buffer.withUnsafeMutableBytes { raw in
      guard
        let out = CGContext(
          data: raw.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
          space: space, bitmapInfo: info),
        let result = out.makeImage()
      else { throw EvalError("cannot write pixels") }
      return result
    }
  }

  // MARK: Geometry

  static func finish(_ image: CIImage, extent: CGRect) throws -> CGImage {
    guard let out = context.createCGImage(image, from: extent) else {
      throw EvalError("cannot render filter output")
    }
    return out
  }

  /// Stacks two pages, each scaled to half the height and centred on a white page.
  static func twoUp(_ top: CGImage, _ bottom: CGImage) throws -> CGImage {
    let (w, h) = (top.width, top.height)
    guard
      let canvas = CGContext(
        data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { throw EvalError("cannot create two-up page") }
    canvas.setFillColor(CGColor(gray: 1, alpha: 1))
    canvas.fill(CGRect(x: 0, y: 0, width: w, height: h))
    let half = Double(h) / 2
    let width = half * Double(w) / Double(h)
    let x = (Double(w) - width) / 2
    canvas.draw(top, in: CGRect(x: x, y: half, width: width, height: half))
    canvas.draw(bottom, in: CGRect(x: x, y: 0, width: width, height: half))
    canvas.setStrokeColor(CGColor(gray: 0.8, alpha: 1))
    canvas.stroke(CGRect(x: 0, y: half, width: Double(w), height: 1))
    guard let image = canvas.makeImage() else { throw EvalError("cannot render two-up page") }
    return image
  }

  /// Turns the page clockwise by `degrees` on an enlarged canvas, so nothing is clipped.
  static func rotate(_ image: CGImage, degrees: Double, background: CIColor) throws -> CGImage {
    let a = degrees * .pi / 180
    let (w, h) = (Double(image.width), Double(image.height))
    let outW = (w * abs(cos(a)) + h * abs(sin(a))).rounded(.up)
    let outH = (w * abs(sin(a)) + h * abs(cos(a))).rounded(.up)
    let transform = CGAffineTransform(translationX: -w / 2, y: -h / 2)
      .concatenating(CGAffineTransform(rotationAngle: -a))
      .concatenating(CGAffineTransform(translationX: outW / 2, y: outH / 2))
    let extent = CGRect(x: 0, y: 0, width: outW, height: outH)
    let moved = CIImage(cgImage: image).transformed(by: transform)
    let desk = CIImage(color: background).cropped(to: extent)
    return try finish(moved.composited(over: desk), extent: extent)
  }

  /// Moves the corners (top-left, top-right, bottom-right, bottom-left) by fractions of the size.
  static func perspective(_ image: CGImage, corners: [[Double]], background: CIColor) throws -> CGImage {
    let (w, h) = (Double(image.width), Double(image.height))
    // Core Image's origin is bottom-left, so a downward move (positive dy) subtracts.
    func point(_ x: Double, _ y: Double, _ c: [Double]) -> CGPoint {
      CGPoint(x: x + c[0] * w, y: y - c[1] * h)
    }
    guard let filter = CIFilter(name: "CIPerspectiveTransform") else {
      throw EvalError("CIPerspectiveTransform unavailable")
    }
    filter.setValue(CIImage(cgImage: image), forKey: kCIInputImageKey)
    filter.setValue(CIVector(cgPoint: point(0, h, corners[0])), forKey: "inputTopLeft")
    filter.setValue(CIVector(cgPoint: point(w, h, corners[1])), forKey: "inputTopRight")
    filter.setValue(CIVector(cgPoint: point(w, 0, corners[2])), forKey: "inputBottomRight")
    filter.setValue(CIVector(cgPoint: point(0, 0, corners[3])), forKey: "inputBottomLeft")
    let extent = CGRect(x: 0, y: 0, width: w, height: h)
    let desk = CIImage(color: background).cropped(to: extent)
    return try finish(filter.outputImage!.composited(over: desk), extent: extent)
  }

  static func blur(_ image: CGImage, radius: Double) throws -> CGImage {
    let extent = CGRect(x: 0, y: 0, width: image.width, height: image.height)
    let source = CIImage(cgImage: image).clampedToExtent().applyingGaussianBlur(sigma: radius)
    return try finish(source, extent: extent)
  }

  /// Encodes as JPEG at `quality` (1 to 100) and decodes the result.
  static func jpeg(_ image: CGImage, quality: Int) throws -> CGImage {
    let data = NSMutableData()
    guard
      let out = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil)
    else { throw EvalError("cannot encode JPEG") }
    CGImageDestinationAddImage(
      out, image, [kCGImageDestinationLossyCompressionQuality: Double(quality) / 100] as CFDictionary)
    guard CGImageDestinationFinalize(out),
      let source = CGImageSourceCreateWithData(data, nil),
      let decoded = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else { throw EvalError("cannot encode JPEG") }
    return decoded
  }
}

/// mulberry32, matching `rng` in `corpus.ts`.
struct SeededRandom {
  var state: UInt32
  init(seed: UInt32) { state = seed }
  mutating func unit() -> Double {
    state = state &+ 0x6d2b_79f5
    var t = (state ^ (state >> 15)) &* (1 | state)
    t = (t &+ ((t ^ (t >> 7)) &* (61 | t))) ^ t
    return Double(t ^ (t >> 14)) / 4_294_967_296
  }
}
