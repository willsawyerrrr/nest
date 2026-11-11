import SwiftUI

/// The hand-off of files shared into the app from other apps (see `docs/ios.md`). The share
/// extension drops each PDF or image in the App Group inbox; the Deductions screen reads
/// the inbox directly, queues the files as work expenses on the signed-in member's list,
/// and removes each from the inbox once queued, so a file shared twice makes one draft.
enum SharedReceipts {
    /// The inbox, or nil when the App Group is unavailable.
    static var inbox: ShareInbox? { ShareInbox.shared() }

    static var hasPending: Bool {
        guard let inbox else { return false }
        inbox.purgeStale()
        return !inbox.pending().isEmpty
    }

    /// Queues every pending shared file into `model` and clears each from the inbox.
    @MainActor
    static func take(into model: DeductionsViewModel) {
        guard let inbox else { return }
        inbox.purgeStale()
        for id in model.receiveShared(inbox.pending()) { inbox.remove(id: id) }
    }
}

private struct SharedReceiptsHandoff: ViewModifier {
    @State private var presented = false

    func body(content: Content) -> some View {
        content
            .onAppear { presented = presented || SharedReceipts.hasPending }
            #if os(iOS)
                .onReceive(
                    NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)
                ) { _ in presented = presented || SharedReceipts.hasPending }
            #else
                .onReceive(
                    NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)
                ) { _ in presented = presented || SharedReceipts.hasPending }
            #endif
            .sheet(isPresented: $presented, onDismiss: { DeductionsRevision.shared.bump() }) {
                NavigationStack {
                    DeductionsScreen(consumesSharedFiles: true)
                        .navigationTitle("Deductions")
                        #if os(iOS)
                            .navigationBarTitleDisplayMode(.inline)
                        #endif
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button("Done") { presented = false }
                            }
                        }
                }
            }
    }
}

extension View {
    /// Presents the Deductions review in a sheet when files shared from other apps are
    /// waiting, on launch and whenever the app becomes active.
    func sharedReceiptsHandoff() -> some View { modifier(SharedReceiptsHandoff()) }
}
