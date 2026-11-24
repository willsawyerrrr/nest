import Foundation
import PDFKit

/// The files and checks behind reading a whole document rather than its first page.
enum Pages {
  /// A document's rendered page PNGs in reading order: `<id>.png`, `<id>.p2.png`, and so on while
  /// they exist. A variant has only `<id>.png`, its pages already composed onto one image.
  static func images(of id: String, in files: URL) -> [URL] {
    var urls = [files.appending(path: "\(id).png")]
    while case let next = files.appending(path: "\(id).p\(urls.count + 1).png"),
      FileManager.default.fileExists(atPath: next.path)
    {
      urls.append(next)
    }
    return urls
  }

  /// Why the PDF cannot be opened (`corrupt` or `encrypted`), or nil when it can. An app rejects
  /// such a file, so a run records the reason instead of an answer. A missing file is not
  /// unreadable, it is an error.
  static func unreadable(_ pdf: URL) -> String? {
    guard FileManager.default.fileExists(atPath: pdf.path) else { return nil }
    guard let document = PDFDocument(url: pdf) else { return "corrupt" }
    if document.isLocked { return "encrypted" }
    return document.pageCount == 0 ? "corrupt" : nil
  }

  /// `context_exceeded(<tokens>/<size>)` when the prompt alone fills the context, else nil.
  static func overflow(tokens: Int, contextSize: Int) -> String? {
    tokens > contextSize ? "context_exceeded(\(tokens)/\(contextSize))" : nil
  }
}
