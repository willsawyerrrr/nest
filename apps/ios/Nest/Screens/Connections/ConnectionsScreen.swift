import SwiftUI

#if os(iOS)
    import UIKit
#else
    import AppKit
#endif

/// The native Connections route: Up, Redbark and the calendar feed.
struct ConnectionsScreen: View {
    @State private var model: ConnectionsViewModel
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase

    init(model: ConnectionsViewModel = ConnectionsViewModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { rows in
            ConnectionsContentView(
                rows: rows, model: model,
                connectBank: {
                    if let url = await model.startBankConnection() { openURL(url) }
                })
        }
        .task {
            await model.load()
            await model.completePendingConnection()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.completePendingConnection() } }
        }
    }
}

private struct ConnectionsContentView: View {
    let rows: ConnectionsRows
    let model: ConnectionsViewModel
    let connectBank: () async -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NestSpacing.md) {
                Text(ConnectionsPresentation.title)
                    .font(.system(size: 38, weight: .bold, design: .rounded))
                    .tracking(-0.76)
                    .foregroundStyle(NestColor.text)
                    .accessibilityAddTraits(.isHeader)
                UpCard(rows: rows, model: model)
                BankCard(rows: rows, model: model, connect: connectBank)
                FeedCard(rows: rows, model: model)
            }
            .padding(NestSpacing.md)
        }
    }
}

// MARK: Cards

private struct UpCard: View {
    let rows: ConnectionsRows
    let model: ConnectionsViewModel

    @State private var token = ""

    private var me: Member? { rows.member(userID: model.userID) }
    private var connected: Bool { me?.upConnectedAt != nil }
    private var needsReconnecting: Bool { me?.upSyncFailedAt != nil }

    var body: some View {
        NestCard {
            VStack(alignment: .leading, spacing: NestSpacing.md) {
                CardTitle(ConnectionsPresentation.upTitle)
                if needsReconnecting {
                    ToneAlert(
                        tone: .warning, title: ConnectionsPresentation.reconnectTitle,
                        message: AttributedString(ConnectionsPresentation.reconnectMessage))
                }
                if connected {
                    HStack {
                        StatusBadge(
                            status: .init(label: "Connected", tone: .positive), fixedWidth: false)
                        Spacer()
                        ActionButton(
                            label: "Disconnect", tone: .negative, compact: true,
                            loading: model.upBusy
                        ) { Task { await model.disconnectUp() } }
                    }
                } else {
                    VStack(alignment: .leading, spacing: NestSpacing.xs) {
                        Text(ConnectionsPresentation.upIntro).dimmed()
                        VStack(alignment: .leading, spacing: NestSpacing.xxs) {
                            Text(ConnectionsPresentation.upTokenLabel)
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(NestColor.text)
                            SecureField(
                                "", text: $token,
                                prompt: Text(ConnectionsPresentation.upTokenPlaceholder)
                            )
                            .textContentType(.password)
                            .autocorrectionDisabled()
                            #if os(iOS)
                                .textInputAutocapitalization(.never)
                            #endif
                            .font(NestFont.body)
                            .foregroundStyle(NestColor.text)
                            .padding(NestSpacing.sm)
                            .outlined()
                        }
                        ActionButton(
                            label: ConnectionsPresentation.upSubmitLabel(
                                needsReconnecting: needsReconnecting),
                            tone: .brand, loading: model.upBusy,
                            disabled: token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        ) {
                            let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
                            token = ""
                            Task { await model.connectUp(token: trimmed) }
                        }
                    }
                }
                if let error = model.upError { ErrorLine(error) }
                VStack(spacing: 0) {
                    ForEach(rows.members) { member in
                        ListRowLine {
                            Text(member.name).font(.system(size: 14)).foregroundStyle(NestColor.text)
                                .lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                            StatusBadge(status: ConnectionsPresentation.upStatus(member))
                        }
                    }
                }
            }
        }
    }
}

private struct BankCard: View {
    let rows: ConnectionsRows
    let model: ConnectionsViewModel
    let connect: () async -> Void

    @State private var disconnecting: RedbarkConnection?

    private var currentMemberID: String? { rows.member(userID: model.userID)?.id }

    var body: some View {
        NestCard {
            VStack(alignment: .leading, spacing: NestSpacing.md) {
                CardTitle(ConnectionsPresentation.bankTitle)
                if let result = model.completeResult {
                    let banner = ConnectionsPresentation.banner(for: result)
                    ToneAlert(
                        tone: tone(of: result), title: banner.title, message: banner.message,
                        onClose: model.dismissCompleteResult)
                }
                Text(ConnectionsPresentation.bankIntro).dimmed()
                ActionButton(
                    label: ConnectionsPresentation.bankTitle, tone: .brand, loading: model.bankBusy
                ) { Task { await connect() } }
                if let failure = model.bankFailure {
                    ToneAlert(
                        tone: .negative, title: ConnectionsPresentation.connectBankFailureTitle,
                        message: ConnectionsPresentation.failureMessage(code: failure.code),
                        onClose: model.dismissBankFailure)
                }
                if !rows.redbarkConnections.isEmpty {
                    VStack(spacing: 0) {
                        ForEach(rows.redbarkConnections) { connection in
                            ListRowLine {
                                Text(ConnectionsPresentation.institution(connection))
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(NestColor.text).lineLimit(1)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                Text(
                                    ConnectionsPresentation.memberName(
                                        rows.members, id: connection.memberId)
                                )
                                .font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                                .lineLimit(1).frame(width: 72, alignment: .leading)
                                StatusBadge(status: ConnectionsPresentation.bankStatus(connection))
                                Group {
                                    if connection.memberId == currentMemberID {
                                        Button { disconnecting = connection } label: {
                                            Image(systemName: "bolt.slash").font(.system(size: 14))
                                                .foregroundStyle(NestColor.negative)
                                                .frame(width: 28, height: 28)
                                        }
                                        .buttonStyle(.plain)
                                        .disabled(model.bankBusy)
                                        .accessibilityLabel(
                                            "Disconnect \(connection.institutionName ?? "bank")")
                                    }
                                }
                                .frame(width: 28)
                            }
                        }
                    }
                }
            }
        }
        .alert(
            ConnectionsPresentation.disconnectBankTitle,
            isPresented: Binding(get: { disconnecting != nil }, set: { if !$0 { disconnecting = nil } }),
            presenting: disconnecting
        ) { connection in
            Button("Disconnect", role: .destructive) {
                Task { await model.disconnectBank(id: connection.id) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { connection in
            Text(
                "Disconnect \(connection.institutionName ?? "this bank")? \(ConnectionsPresentation.disconnectBankDescription)"
            )
        }
    }

    private func tone(of result: RedbarkCompleteResult) -> ToneAlert.Tone {
        switch result {
        case .connected: .positive
        case .failed: .negative
        case .pending: .info
        }
    }
}

private struct FeedCard: View {
    let rows: ConnectionsRows
    let model: ConnectionsViewModel

    @State private var copied: String?

    private var active: Bool { rows.calendarFeed != nil || model.feedLinks != nil }

    var body: some View {
        NestCard {
            VStack(alignment: .leading, spacing: NestSpacing.md) {
                CardTitle(ConnectionsPresentation.feedTitle)
                if active {
                    VStack(alignment: .leading, spacing: NestSpacing.xs) {
                        Text("Active").font(.system(size: 14)).foregroundStyle(NestColor.text)
                        if let links = model.feedLinks {
                            VStack(alignment: .leading, spacing: NestSpacing.xs) {
                                Text(links.https)
                                    .font(.system(size: 12, design: .monospaced))
                                    .foregroundStyle(NestColor.text).textSelection(.enabled)
                                    .padding(.horizontal, 6).padding(.vertical, 2)
                                    .background(
                                        NestColor.dimmedText.opacity(0.16),
                                        in: RoundedRectangle(
                                            cornerRadius: NestRadius.sm, style: .continuous))
                                HStack(spacing: NestSpacing.xs) {
                                    copyButton(links.https, label: "Copy URL")
                                    copyButton(links.webcal, label: "Copy webcal://")
                                }
                                Text(ConnectionsPresentation.feedHowTo).dimmed()
                            }
                        } else {
                            Text(ConnectionsPresentation.feedShownOnce).dimmed()
                        }
                        HStack(spacing: NestSpacing.xs) {
                            ActionButton(
                                label: "Regenerate", tone: .brand, compact: true,
                                loading: model.feedBusy
                            ) { Task { await model.createFeed() } }
                            ActionButton(
                                label: "Revoke", tone: .negative, compact: true,
                                loading: model.feedBusy
                            ) { Task { await model.revokeFeed() } }
                        }
                    }
                } else {
                    VStack(alignment: .leading, spacing: NestSpacing.xs) {
                        Text(ConnectionsPresentation.feedIntro).dimmed()
                        ActionButton(
                            label: ConnectionsPresentation.feedGenerateLabel, tone: .brand,
                            loading: model.feedBusy
                        ) { Task { await model.createFeed() } }
                    }
                }
                if let error = model.feedError { ErrorLine(error) }
            }
        }
    }

    private func copyButton(_ value: String, label: String) -> some View {
        ActionButton(label: copied == value ? "Copied" : label, tone: .brand, compact: true) {
            Pasteboard.copy(value)
            copied = value
            Task {
                try? await Task.sleep(for: .seconds(2))
                if copied == value { copied = nil }
            }
        }
    }
}

// MARK: Pieces

private enum Pasteboard {
    static func copy(_ value: String) {
        #if os(iOS)
            UIPasteboard.general.string = value
        #else
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(value, forType: .string)
        #endif
    }
}

private struct CardTitle: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text).font(.system(size: 16, weight: .semibold, design: .rounded))
            .foregroundStyle(NestColor.text)
            .accessibilityAddTraits(.isHeader)
    }
}

/// A dense list row: its columns over a light bottom rule.
private struct ListRowLine<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        HStack(spacing: NestSpacing.sm) { content }
            .padding(.vertical, 6)
            .overlay(alignment: .bottom) { Rectangle().fill(NestColor.border).frame(height: 1) }
    }
}

/// A status pill, fixed-width so statuses align down a list of rows.
private struct StatusBadge: View {
    let status: ConnectionStatus
    var fixedWidth = true

    private var color: Color {
        switch status.tone {
        case .positive: NestColor.positive
        case .neutral: NestColor.dimmedText
        case .warning: NestColor.warning
        }
    }

    var body: some View {
        Text(status.label)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(color)
            .lineLimit(1)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .frame(width: fixedWidth ? 88 : nil)
            .background(
                color.opacity(0.16),
                in: RoundedRectangle(cornerRadius: NestRadius.sm, style: .continuous))
            .fixedSize()
    }
}

/// A tinted, titled message, as Mantine's light `Alert`.
private struct ToneAlert: View {
    enum Tone { case positive, negative, info, warning }

    let tone: Tone
    let title: String
    let message: AttributedString
    var onClose: (() -> Void)?

    private var color: Color {
        switch tone {
        case .positive: NestColor.positive
        case .negative: NestColor.negative
        case .info: NestColor.info
        case .warning: NestColor.warning
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: NestSpacing.xs) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.system(size: 14, weight: .bold)).foregroundStyle(color)
                Text(message).font(.system(size: 14)).foregroundStyle(NestColor.text)
            }
            Spacer(minLength: 0)
            if let onClose {
                Button(action: onClose) {
                    Image(systemName: "xmark").font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(color)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Dismiss")
            }
        }
        .padding(NestSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            color.opacity(0.12), in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous))
    }
}

private struct ErrorLine: View {
    let error: NestError
    init(_ error: NestError) { self.error = error }

    var body: some View {
        Text(error.userMessage).font(.system(size: 12)).foregroundStyle(NestColor.negative)
    }
}

/// A light-variant button: a tinted fill with tinted text, spinning while loading.
private struct ActionButton: View {
    enum Tone { case brand, negative }

    let label: String
    let tone: Tone
    var compact = false
    var loading = false
    var disabled = false
    let action: () -> Void

    private var color: Color { tone == .brand ? NestColor.navActiveText : NestColor.negative }

    var body: some View {
        Button(action: action) {
            ZStack {
                Text(label).opacity(loading ? 0 : 1)
                if loading { ProgressView().controlSize(.small) }
            }
            .font(.system(size: compact ? 12 : 14, weight: .semibold))
            .foregroundStyle(color)
            .padding(.horizontal, compact ? 10 : NestSpacing.sm)
            .frame(maxWidth: compact ? nil : .infinity)
            .frame(height: compact ? 30 : 36)
            .background(
                (tone == .brand ? NestColor.brand : NestColor.negative).opacity(
                    tone == .brand ? 0.2 : 0.1),
                in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(loading || disabled)
        .opacity(disabled ? 0.5 : 1)
        .accessibilityLabel(label)
    }
}

private extension Text {
    func dimmed() -> some View {
        font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
    }
}

private extension View {
    /// A bordered rounded outline on the elevated surface, as a default input.
    func outlined() -> some View {
        background(
            NestColor.surface, in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                .strokeBorder(NestColor.border, lineWidth: 1))
    }
}
