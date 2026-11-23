import SwiftUI
import UIKit
import UserNotifications
import UserNotificationsUI

/// The expanded transaction review notification: Up's categories to move the
/// transaction to, saved without opening the app.
final class NotificationViewController: UIViewController,
    @preconcurrency UNNotificationContentExtension
{
    private let model = RecategoriseModel()

    func didReceive(_ notification: UNNotification) {
        let content = notification.request.content
        let host = UIHostingController(
            rootView: RecategoriseView(
                title: content.title, model: model,
                openApp: { [weak self] in self?.extensionContext?.performNotificationDefaultAction() }))
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        host.didMove(toParent: self)
        preferredContentSize = CGSize(width: view.bounds.width, height: 440)
        let id = ReviewNotification.transactionID(content.userInfo)
        Task { await model.load(transactionID: id) }
    }

    /// Hands Looks right to the app, unless a pick here already reviewed the
    /// transaction.
    func didReceive(
        _ response: UNNotificationResponse,
        completionHandler completion: @escaping (UNNotificationContentExtensionResponseOption) -> Void
    ) {
        completion(model.isSaved ? .dismiss : .dismissAndForwardAction)
    }
}

/// The picker: the transaction's current category, then Up's categories by
/// parent, then the saved or failed state in place of the list.
struct RecategoriseView: View {
    let title: String
    let model: RecategoriseModel
    let openApp: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.headline)
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    @ViewBuilder private var content: some View {
        switch model.state {
        case .loading:
            ProgressView().frame(maxWidth: .infinity)
        case .choosing(let choices):
            picker(choices, saving: nil)
        case .saving(let choices, let categoryID):
            picker(choices, saving: .some(categoryID))
        case .saved(let message):
            Label(message, systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
        case .failed(_, let message):
            VStack(alignment: .leading, spacing: 8) {
                Label(message, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
                HStack {
                    Button("Try again") { Task { await model.retry() } }
                    Button("Open in Nest", action: openApp)
                }
                .buttonStyle(.bordered)
            }
        }
    }

    /// The category list; `saving` is the pick in flight, which disables the rest.
    @ViewBuilder private func picker(_ choices: RecategoriseChoices, saving: String??) -> some View {
        Text("Currently \(choices.currentLabel). Pick the right category.")
            .font(.subheadline).foregroundStyle(.secondary)
        if choices.categorisable {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    row("Uncategorised", id: nil, choices: choices, saving: saving)
                    ForEach(choices.groups) { group in
                        Text(group.name).font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .padding(.top, 12).padding(.bottom, 4)
                        ForEach(group.items) { item in
                            row(item.name, id: item.id, choices: choices, saving: saving)
                        }
                    }
                }
            }
            .disabled(saving != nil)
        } else {
            Text(ReviewFailure.message("not_categorisable")).font(.subheadline)
        }
    }

    private func row(
        _ name: String, id: String?, choices: RecategoriseChoices, saving: String??
    ) -> some View {
        Button {
            Task { await model.pick(id) }
        } label: {
            HStack {
                Text(name)
                Spacer()
                if saving == .some(id) {
                    ProgressView()
                } else if id == choices.currentID {
                    Image(systemName: "checkmark").foregroundStyle(.tint)
                }
            }
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(id == choices.currentID ? .isSelected : [])
    }
}
