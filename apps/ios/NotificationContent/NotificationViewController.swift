import SwiftUI
import UIKit
import UserNotifications
import UserNotificationsUI

/// The expanded transaction review notification: the transaction and its
/// current Up category, above the category's Looks right and Wrong category
/// actions, which the system forwards to the app.
final class NotificationViewController: UIViewController, UNNotificationContentExtension {
    private let model = ReviewNotificationModel()

    func didReceive(_ notification: UNNotification) {
        let content = notification.request.content
        let host = UIHostingController(rootView: ReviewNotificationView(title: content.title, model: model))
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
        preferredContentSize = CGSize(width: view.bounds.width, height: 104)
        let id = ReviewNotification.transactionID(content.userInfo)
        Task { await model.load(transactionID: id) }
    }
}

/// The notification's title (merchant and amount), then its category, or why it
/// could not be read.
struct ReviewNotificationView: View {
    let title: String
    let model: ReviewNotificationModel

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.headline)
            switch model.state {
            case .loading:
                ProgressView()
            case .loaded(let summary):
                Text(summary.category).font(.subheadline)
                if summary.reviewed {
                    Label("Reviewed", systemImage: "checkmark.circle.fill")
                        .font(.caption).foregroundStyle(.green)
                } else if summary.flaggedWrong {
                    Label("Flagged wrong category", systemImage: "flag.fill")
                        .font(.caption).foregroundStyle(.red)
                } else {
                    Text("Right category?").font(.caption).foregroundStyle(.secondary)
                }
            case .failed(let message):
                Label(message, systemImage: "exclamationmark.triangle.fill")
                    .font(.subheadline).foregroundStyle(.red)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
