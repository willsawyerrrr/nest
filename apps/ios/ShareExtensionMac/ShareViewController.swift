import AppKit
import UniformTypeIdentifiers

/// The macOS share menu's "Nest" destination. It copies each shared PDF or image
/// into the App Group inbox and says so; the app hands the files to the
/// deduction review. The app is opened once a file is saved, and takes the files
/// as it becomes active.
final class ShareViewController: NSViewController {
    private let label = NSTextField(wrappingLabelWithString: "Saving to Nest…")
    private let spinner = NSProgressIndicator()
    private let doneButton = NSButton(title: "Done", target: nil, action: nil)

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 360, height: 160))
    }

    override func viewDidLoad() {
        super.viewDidLoad()

        label.alignment = .center
        label.font = .preferredFont(forTextStyle: .headline)

        spinner.style = .spinning
        spinner.isIndeterminate = true
        spinner.startAnimation(nil)

        doneButton.target = self
        doneButton.action = #selector(finish)
        doneButton.keyEquivalent = "\r"
        doneButton.isHidden = true

        let stack = NSStackView(views: [spinner, label, doneButton])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
        ])

        Task { await save() }
    }

    private func save() async {
        let providers =
            (extensionContext?.inputItems as? [NSExtensionItem] ?? [])
            .flatMap { $0.attachments ?? [] }
        var summary = ShareSummary()

        if let inbox = ShareInbox.shared() {
            try? FileManager.default.createDirectory(
                at: inbox.root, withIntermediateDirectories: true)
            for provider in providers {
                summary.record(await store(provider, in: inbox))
            }
        } else {
            summary.storageUnavailable = true
        }

        if summary.saved > 0, await openApp() {
            summary.reviewPrompt = "Opening Nest to review."
        }

        spinner.stopAnimation(nil)
        spinner.isHidden = true
        label.stringValue = summary.message
        doneButton.isHidden = false
    }

    /// Opens the containing app (`Nest.app/Contents/PlugIns/<this>.appex`) and
    /// reports whether it launched.
    private func openApp() async -> Bool {
        let appURL = Bundle.main.bundleURL
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        return (try? await NSWorkspace.shared.openApplication(at: appURL, configuration: configuration)) != nil
    }

    /// Copies one attachment into the inbox. `loadFileRepresentation` hands
    /// over a file on disk, so nothing is read into the extension's memory.
    private func store(_ provider: NSItemProvider, in inbox: ShareInbox) async -> ShareInbox.StoreResult {
        guard
            let typeIdentifier = [UTType.pdf, UTType.image]
                .compactMap({ type in
                    provider.registeredTypeIdentifiers.first {
                        UTType($0)?.conforms(to: type) == true
                    }
                })
                .first
        else {
            return .unsupported
        }
        return await withCheckedContinuation { continuation in
            _ = provider.loadFileRepresentation(forTypeIdentifier: typeIdentifier) { url, _ in
                guard let url else {
                    continuation.resume(returning: .failed)
                    return
                }
                // The URL is removed when this closure returns, so the copy
                // happens here.
                let name = provider.suggestedName.map { name in
                    (name as NSString).pathExtension.isEmpty
                        ? name + "." + url.pathExtension : name
                } ?? url.lastPathComponent
                continuation.resume(
                    returning: inbox.store(fileAt: url, name: name, typeIdentifier: typeIdentifier)
                )
            }
        }
    }

    @objc private func finish() {
        extensionContext?.completeRequest(returningItems: nil)
    }
}
