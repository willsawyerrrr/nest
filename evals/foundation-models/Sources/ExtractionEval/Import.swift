import Foundation

/// Copies the contents of a picked folder into a corpus folder without ever deleting a file before its replacement exists.
enum CorpusImport {
  /// The outcome of an import.
  enum Result: Equatable {
    /// The picked folder is the corpus folder, so its files are already in place.
    case alreadyInPlace
    /// `copied` items were placed in the corpus folder.
    case imported(copied: Int)
  }

  /// Copies each item of `source` into `root`, replacing an item of the same name via `replaceItemAt`.
  ///
  /// Returns `.alreadyInPlace` without touching anything when `source` is `root`, and skips any item that is already its own target.
  static func run(from source: URL, into root: URL, fileManager fm: FileManager = .default) throws -> Result {
    let resolved = { (url: URL) in url.standardizedFileURL.resolvingSymlinksInPath().path }
    if resolved(source) == resolved(root) { return .alreadyInPlace }
    var copied = 0
    for item in try fm.contentsOfDirectory(at: source, includingPropertiesForKeys: nil) {
      let target = root.appending(path: item.lastPathComponent)
      if resolved(item) == resolved(target) { continue }
      let staged = root.appending(path: ".import-\(UUID().uuidString)")
      try fm.copyItem(at: item, to: staged)
      if fm.fileExists(atPath: target.path) {
        _ = try fm.replaceItemAt(target, withItemAt: staged)
      } else {
        try fm.moveItem(at: staged, to: target)
      }
      copied += 1
    }
    return .imported(copied: copied)
  }
}
