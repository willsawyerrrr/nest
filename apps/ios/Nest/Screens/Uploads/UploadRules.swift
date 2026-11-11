import Foundation
import ImageIO
import UniformTypeIdentifiers

/// What the app does with a file a member attaches, wherever it takes an upload
/// (payslips, deduction receipts, trade documents), mirroring the PWA's
/// `uploadFile.ts`. Any type is accepted and stored; only the types the
/// extraction model can read are read. The extension decides everything.
enum UploadRules {
    /// The largest file the app stores, enforced here and by the Storage buckets.
    static let maxBytes = 25 * 1024 * 1024

    /// The `code` an extraction function answers with for a file type it cannot read.
    static let unsupportedTypeCode = "unsupported_type"

    /// What a member is told when a file is over `maxBytes`.
    static let fileTooLargeMessage = "That file is too large. The limit is 25 MB."

    /// The longest file name kept in a Storage key.
    static let maxKeyNameLength = 100

    /// Types the extraction model reads, by extension.
    private static let readableMediaTypes: [String: String] = [
        "pdf": "application/pdf",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "gif": "image/gif",
        "webp": "image/webp",
    ]

    private static let heicExtensions: Set<String> = ["heic", "heif"]

    private static func fileExtension(_ name: String) -> String {
        guard let dot = name.lastIndex(of: ".") else { return "" }
        return String(name[name.index(after: dot)...]).lowercased()
    }

    /// The content type Storage records: the readable type, or the opaque
    /// `application/octet-stream` for anything else, so an HTML or SVG upload is
    /// never stored as a type a browser would render.
    static func storedContentType(_ name: String) -> String {
        readableMediaTypes[fileExtension(name)] ?? "application/octet-stream"
    }

    /// Whether the extraction model can read the file named `name`.
    static func canExtract(_ name: String) -> Bool {
        readableMediaTypes[fileExtension(name)] != nil
    }

    /// A file name safe as the last segment of a Storage key: letters, digits,
    /// dots, dashes and underscores only, at most `maxKeyNameLength` characters
    /// with the extension kept.
    static func storageKeyName(_ name: String) -> String {
        let folded = name.decomposedStringWithCompatibilityMapping.unicodeScalars
            .filter {
                ![.nonspacingMark, .spacingMark, .enclosingMark].contains($0.properties.generalCategory)
            }
        let cleaned = String(String.UnicodeScalarView(folded))
        var mapped = ""
        var inRun = false
        for scalar in cleaned.unicodeScalars {
            let allowed =
                scalar.isASCII
                && (CharacterSet.alphanumerics.contains(scalar) || "._-".unicodeScalars.contains(scalar))
            if allowed {
                mapped.unicodeScalars.append(scalar)
                inRun = false
            } else if !inRun {
                mapped.append("_")
                inRun = true
            }
        }
        let dot = mapped.lastIndex(of: ".")
        let hasExtension = dot.map { $0 > mapped.startIndex } ?? false
        let ext = hasExtension ? String(mapped[dot!...]) : ""
        var stem = hasExtension ? String(mapped[..<dot!]) : mapped
        while let first = stem.first, first == "." || first == "_" { stem.removeFirst() }
        let kept = String(stem.prefix(maxKeyNameLength - ext.count))
        return (kept.isEmpty ? "file" : kept) + ext
    }

    /// The stored object's name without its generated `<uuid>-` prefix: what a
    /// downloaded copy is called.
    static func downloadName(_ path: String) -> String {
        let base = String(path[(path.lastIndex(of: "/").map { path.index(after: $0) } ?? path.startIndex)...])
        return base.replacingOccurrences(
            of: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}-",
            with: "", options: .regularExpression)
    }

    /// The Storage key a payslip document lands at in a household's bucket.
    static func objectPath(household: String, record: String, name: String) -> String {
        "\(household)/\(record)/\(UUID().uuidString.lowercased())-\(storageKeyName(name))"
    }

    /// A picked file on disk, as a surface hands it to be stored.
    struct PickedFile: Equatable, Sendable {
        let name: String
        let url: URL
    }

    /// A file ready to store: its bytes, the name it is stored under and whether
    /// the extraction model can read it.
    struct PreparedFile: Equatable, Sendable {
        let name: String
        let data: Data
        let readable: Bool
    }

    /// The outcome of getting a picked file ready to store.
    enum Prepared: Equatable, Sendable {
        case ready(PreparedFile)
        case tooLarge(message: String)
        case unreadable
    }

    /// Rejects a file over `maxBytes`, and converts a HEIC/HEIF photo to JPEG so it
    /// can be read and shown anywhere (the original is stored if it cannot be decoded).
    static func prepare(_ file: PickedFile) -> Prepared {
        let size = (try? file.url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
        if size > maxBytes { return .tooLarge(message: fileTooLargeMessage) }
        guard let data = try? Data(contentsOf: file.url, options: .mappedIfSafe) else {
            return .unreadable
        }
        if data.count > maxBytes { return .tooLarge(message: fileTooLargeMessage) }
        if heicExtensions.contains(fileExtension(file.name)), let jpeg = heicToJpeg(data) {
            let stem = (file.name as NSString).deletingPathExtension
            let name = stem + ".jpg"
            return .ready(PreparedFile(name: name, data: jpeg, readable: canExtract(name)))
        }
        return .ready(PreparedFile(name: file.name, data: data, readable: canExtract(file.name)))
    }

    private static func heicToJpeg(_ data: Data) -> Data? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
            let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else { return nil }
        let output = NSMutableData()
        guard
            let destination = CGImageDestinationCreateWithData(
                output, UTType.jpeg.identifier as CFString, 1, nil)
        else { return nil }
        CGImageDestinationAddImage(
            destination, image, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
        return CGImageDestinationFinalize(destination) ? output as Data : nil
    }
}

/// What the bulk upload queue shares across the surfaces that take many files at
/// once, mirroring the PWA's `bulkUpload.ts`.
enum BulkUpload {
    /// The most files a member can have in flight or awaiting review at once.
    static let maxBatchFiles = 20

    /// How many files are read at the same time.
    static let readConcurrency = 3

    /// The copy for a batch that was cut to `maxBatchFiles`.
    static func limitMessage(skipped: Int) -> String {
        "\(skipped == 1 ? "1 file was" : "\(skipped) files were") left out: at most \(maxBatchFiles) files can be open at once. Save or discard some, then add the rest."
    }

    /// How reading one stored file ended, in the terms the queue acts on. `halt` is
    /// a failure every other file would meet too, so it stops the queue.
    enum ReadResult<Value: Sendable>: Sendable {
        case read(Value)
        case unsupported(message: String)
        case failed(message: String)
        case halt(message: String)
    }
}
