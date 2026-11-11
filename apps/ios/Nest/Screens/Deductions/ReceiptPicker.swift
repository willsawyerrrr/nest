import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// The receipt input: a menu choosing a file or a photo, taking one receipt or several,
/// and a drop target for files dropped on it. Picked items are copied to temporary files
/// the queue can read after the source goes away.
struct ReceiptPicker: View {
    var label: String
    var description: String
    var placeholder: String
    var multiple = false
    var disabled = false
    let onFiles: ([UploadRules.PickedFile]) -> Void

    @State private var showImporter = false
    @State private var showPhotos = false
    @State private var photos: [PhotosPickerItem] = []

    var body: some View {
        LabelledField(label: label, description: description) {
            Menu {
                Button("Choose file…") { showImporter = true }
                Button("Choose photo…") { showPhotos = true }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "paperclip").font(.system(size: 13))
                    Text(placeholder).font(.system(size: 14))
                    Spacer(minLength: 0)
                }
                .foregroundStyle(NestColor.dimmedText)
                .padding(.horizontal, FormMetric.sm)
                .frame(minHeight: 36)
                .background(
                    NestColor.surface,
                    in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                        .strokeBorder(NestColor.border, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(disabled)
        }
        .fileImporter(
            isPresented: $showImporter, allowedContentTypes: [.item],
            allowsMultipleSelection: multiple
        ) { result in
            guard case .success(let urls) = result else { return }
            deliver(urls)
        }
        .photosPicker(
            isPresented: $showPhotos, selection: $photos, maxSelectionCount: multiple ? 20 : 1,
            matching: .images
        )
        .onChange(of: photos) { _, items in
            guard !items.isEmpty else { return }
            photos = []
            Task { await load(items) }
        }
        .dropDestination(for: URL.self) { urls, _ in
            guard !disabled else { return false }
            deliver(multiple ? urls : Array(urls.prefix(1)))
            return true
        }
    }

    private func deliver(_ urls: [URL]) {
        let files = FileImport.copy(urls)
        if !files.isEmpty { onFiles(files) }
    }

    private func load(_ items: [PhotosPickerItem]) async {
        var files: [UploadRules.PickedFile] = []
        for (index, item) in items.enumerated() {
            guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
            let ext = item.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
            let name = "photo-\(index + 1).\(ext)"
            let directory = FileManager.default.temporaryDirectory
                .appendingPathComponent("receipts-\(UUID().uuidString)", isDirectory: true)
            let url = directory.appendingPathComponent(name)
            do {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                try data.write(to: url)
                files.append(UploadRules.PickedFile(name: name, url: url))
            } catch { continue }
        }
        if !files.isEmpty { onFiles(files) }
    }
}
