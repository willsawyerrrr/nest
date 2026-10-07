import Foundation
import UniformTypeIdentifiers

/// The App Group folder the share extension drops files into and the app picks
/// them up from. Compiled into both targets.
///
/// Each shared file lives in its own `<id>/` directory holding the file and a
/// `meta.json`. A directory is written under a hidden temporary name and renamed
/// into place, so the app never sees a half-copied file.
struct ShareInbox: Sendable {
    static let appGroupIdentifier = "group.dev.willsawyerrrr.nest"

    /// Largest file accepted, matching the PWA's upload limit (25 MiB).
    static let maxFileBytes: Int64 = 25 * 1024 * 1024

    /// How long a shared file waits for the app before it is discarded.
    static let staleAfter: TimeInterval = 7 * 24 * 60 * 60

    /// The inbox in the shared App Group container, or nil when the group is
    /// not available to this process.
    static func shared() -> ShareInbox? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier)
            .map { ShareInbox(root: $0.appendingPathComponent("SharedReceipts", isDirectory: true)) }
    }

    let root: URL

    /// A file waiting in the inbox.
    struct Item: Equatable, Sendable {
        let id: String
        let name: String
        let mimeType: String
        let size: Int64
        let createdAt: Date
        let fileURL: URL
    }

    /// What became of a file offered to `store`.
    enum StoreResult: Equatable, Sendable {
        case stored(id: String)
        case unsupported
        case tooLarge
        case failed
    }

    private struct Meta: Codable {
        let name: String
        let mimeType: String
        let size: Int64
        let createdAt: Date
    }

    private static let metaName = "meta.json"
    private static let fileName = "file"

    /// Media types the PWA stores and reads, by lower-cased extension.
    static let mimeTypes: [String: String] = [
        "pdf": "application/pdf",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "gif": "image/gif",
        "webp": "image/webp",
        "heic": "image/heic",
        "heif": "image/heif",
    ]

    /// The file name to store `name` under: the original when its extension is
    /// supported, else the name with the extension the type identifier implies.
    /// Nil when neither says the file is a PDF or an image.
    static func resolvedName(_ name: String, typeIdentifier: String?) -> String? {
        let base = (name as NSString).lastPathComponent
        let ext = (base as NSString).pathExtension.lowercased()
        if mimeTypes[ext] != nil {
            return base
        }
        guard
            let typeIdentifier,
            let type = UTType(typeIdentifier),
            type.conforms(to: .pdf) || type.conforms(to: .image),
            let suffix = type.preferredFilenameExtension?.lowercased(),
            mimeTypes[suffix] != nil
        else {
            return nil
        }
        let stem = (base as NSString).deletingPathExtension
        return (stem.isEmpty ? "file" : stem) + "." + suffix
    }

    static func mimeType(forName name: String) -> String {
        mimeTypes[(name as NSString).pathExtension.lowercased()] ?? "application/octet-stream"
    }

    /// Whether `id` is a name this inbox minted, so it can never address a path
    /// outside the inbox.
    static func isValidID(_ id: String) -> Bool {
        UUID(uuidString: id) != nil
    }

    static func isStale(_ createdAt: Date, now: Date) -> Bool {
        now.timeIntervalSince(createdAt) > staleAfter
    }

    /// Copies the file at `source` into the inbox. The file is copied on disk,
    /// never read into memory, so a large file costs the extension no more than
    /// a small one.
    func store(
        fileAt source: URL, name: String, typeIdentifier: String?, now: Date = Date()
    ) -> StoreResult {
        guard let storedName = Self.resolvedName(name, typeIdentifier: typeIdentifier) else {
            return .unsupported
        }
        let fm = FileManager.default
        guard
            let attributes = try? fm.attributesOfItem(atPath: source.path),
            let size = (attributes[.size] as? NSNumber)?.int64Value
        else {
            return .failed
        }
        guard size <= Self.maxFileBytes else {
            return .tooLarge
        }

        let id = UUID().uuidString
        let staging = root.appendingPathComponent(".tmp-\(id)", isDirectory: true)
        let final = root.appendingPathComponent(id, isDirectory: true)
        do {
            try fm.createDirectory(at: staging, withIntermediateDirectories: true)
            try fm.copyItem(at: source, to: staging.appendingPathComponent(Self.fileName))
            let meta = Meta(
                name: storedName, mimeType: Self.mimeType(forName: storedName), size: size,
                createdAt: now
            )
            try JSONEncoder().encode(meta).write(
                to: staging.appendingPathComponent(Self.metaName))
            try fm.moveItem(at: staging, to: final)
            return .stored(id: id)
        } catch {
            try? fm.removeItem(at: staging)
            return .failed
        }
    }

    /// Every complete item, oldest first. Unreadable directories are skipped.
    func pending() -> [Item] {
        let fm = FileManager.default
        guard
            let entries = try? fm.contentsOfDirectory(
                at: root, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles])
        else {
            return []
        }
        let decoder = JSONDecoder()
        return
            entries
            .compactMap { dir -> Item? in
                let id = dir.lastPathComponent
                guard
                    Self.isValidID(id),
                    let data = try? Data(contentsOf: dir.appendingPathComponent(Self.metaName)),
                    let meta = try? decoder.decode(Meta.self, from: data)
                else {
                    return nil
                }
                let file = dir.appendingPathComponent(Self.fileName)
                guard fm.fileExists(atPath: file.path) else { return nil }
                return Item(
                    id: id, name: meta.name, mimeType: meta.mimeType, size: meta.size,
                    createdAt: meta.createdAt, fileURL: file)
            }
            .sorted { ($0.createdAt, $0.id) < ($1.createdAt, $1.id) }
    }

    /// Deletes an item once the PWA has taken it. Ignores an id this inbox did
    /// not mint.
    func remove(id: String) {
        guard Self.isValidID(id) else { return }
        try? FileManager.default.removeItem(at: root.appendingPathComponent(id, isDirectory: true))
    }

    /// Deletes items older than `staleAfter`, and temporary directories
    /// left by a copy that never finished.
    func purgeStale(now: Date = Date()) {
        for item in pending() where Self.isStale(item.createdAt, now: now) {
            remove(id: item.id)
        }
        let fm = FileManager.default
        let entries = (try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
        for entry in entries where entry.lastPathComponent.hasPrefix(".tmp-") {
            let modified =
                (try? entry.resourceValues(forKeys: [.contentModificationDateKey]))?
                .contentModificationDate ?? .distantPast
            if Self.isStale(modified, now: now) {
                try? fm.removeItem(at: entry)
            }
        }
    }

    /// The ids in `items` not yet in `delivered`, in order.
    static func undelivered(_ items: [Item], delivered: Set<String>) -> [Item] {
        items.filter { !delivered.contains($0.id) }
    }
}
