import SwiftUI
import UniformTypeIdentifiers

/// Turning what the system hands over (a file importer's security-scoped URLs, a drop)
/// into `PickedFile`s on the app's own disk, so reading them later needs no scope.
enum FileImport {
    /// Copies each URL into a fresh temporary directory, skipping any that cannot be read.
    static func copy(_ urls: [URL]) -> [UploadRules.PickedFile] {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("picked-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return urls.compactMap { url in
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let destination = directory.appendingPathComponent(url.lastPathComponent)
            do {
                try FileManager.default.copyItem(at: url, to: destination)
                return UploadRules.PickedFile(name: url.lastPathComponent, url: destination)
            } catch {
                return nil
            }
        }
    }

    /// The files a shared-extension inbox item stands for, ready to queue.
    static func picked(_ item: ShareInbox.Item) -> UploadRules.PickedFile {
        UploadRules.PickedFile(name: item.name, url: item.fileURL)
    }
}

extension View {
    /// A file importer taking any type, one file or many, handing back copied `PickedFile`s.
    /// Also takes files dropped on the view.
    func filePicker(
        isPresented: Binding<Bool>, allowsMultiple: Bool,
        onPick: @escaping ([UploadRules.PickedFile]) -> Void
    ) -> some View {
        fileImporter(
            isPresented: isPresented, allowedContentTypes: [.item],
            allowsMultipleSelection: allowsMultiple
        ) { result in
            if case .success(let urls) = result { onPick(FileImport.copy(urls)) }
        }
        .dropDestination(for: URL.self) { urls, _ in
            let files = FileImport.copy(urls.filter(\.isFileURL))
            guard !files.isEmpty else { return false }
            onPick(allowsMultiple ? files : Array(files.prefix(1)))
            return true
        }
    }
}
