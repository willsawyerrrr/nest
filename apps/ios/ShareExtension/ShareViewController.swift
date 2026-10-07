import UIKit
import UniformTypeIdentifiers

/// The share sheet's "Nest" destination. It copies each shared PDF or image
/// into the App Group inbox and says so; the app hands the files to the
/// deduction review the next time it is opened. An extension cannot open its
/// containing app, so the member opens Nest themselves.
final class ShareViewController: UIViewController {
    private let label = UILabel()
    private let spinner = UIActivityIndicatorView(style: .large)
    private let doneButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        label.numberOfLines = 0
        label.textAlignment = .center
        label.font = .preferredFont(forTextStyle: .headline)
        label.text = "Saving to Nest…"

        doneButton.setTitle("Done", for: .normal)
        doneButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        doneButton.isHidden = true
        doneButton.addTarget(self, action: #selector(finish), for: .touchUpInside)

        spinner.startAnimating()

        let stack = UIStackView(arrangedSubviews: [spinner, label, doneButton])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
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
            summary.failed = providers.count
        }

        spinner.stopAnimating()
        spinner.isHidden = true
        label.text = summary.message
        doneButton.isHidden = false
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
