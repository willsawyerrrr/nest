import SwiftUI

/// The native What's new route: the changelog and, when a newer version of the
/// app exists, an update alert.
struct WhatsNewScreen: View {
    @State private var model: WhatsNewViewModel

    init(model: WhatsNewViewModel = WhatsNewViewModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        Group {
            switch model.state {
            case .loading:
                ProgressView()
                    .progressViewStyle(.circular)
                    .scaleEffect(1.5)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .failed:
                WhatsNewPage { GoalAlert(text: WhatsNewPresentation.loadError) }
            case .loaded(let content, _, _):
                WhatsNewPage { WhatsNewBody(presentation: WhatsNewPresentation(content: content)) }
            }
        }
        .background(NestColor.background)
        .refreshable { await model.load() }
        .task { await model.load() }
    }
}

/// The page scaffold: the title above the body, with the layout width measured.
private struct WhatsNewPage<Body: View>: View {
    @ViewBuilder let content: Body
    @State private var width: CGFloat = 0

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NestSpacing.md) {
                Text(WhatsNewPresentation.title)
                    .font(.system(size: 38, weight: .bold, design: .rounded))
                    .tracking(-0.76)
                    .foregroundStyle(NestColor.text)
                    .accessibilityAddTraits(.isHeader)
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(NestSpacing.md)
            .background(
                GeometryReader { Color.clear.preference(key: GoalsWidthKey.self, value: $0.size.width) })
        }
        .onPreferenceChange(GoalsWidthKey.self) { width = $0 }
        .environment(\.isWideChangelog, width >= 768)
    }
}

private struct WideChangelogKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
    /// Whether the changelog lays out as the PWA's wide rows (768pt and up).
    fileprivate var isWideChangelog: Bool {
        get { self[WideChangelogKey.self] }
        set { self[WideChangelogKey.self] = newValue }
    }
}

private struct WhatsNewBody: View {
    let presentation: WhatsNewPresentation

    var body: some View {
        if !presentation.configured {
            Text(WhatsNewPresentation.notConfigured)
                .font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
        } else {
            if let message = presentation.updateMessage { UpdateAlert(presentation: presentation, message: message) }
            ChangelogSection(
                title: WhatsNewPresentation.inProgressTitle,
                emptyLabel: WhatsNewPresentation.inProgressEmpty, rows: presentation.inProgress)
            ChangelogSection(
                title: WhatsNewPresentation.implementedTitle,
                emptyLabel: WhatsNewPresentation.implementedEmpty, rows: presentation.implemented)
        }
    }
}

/// The light-tinted info alert offering the newer version.
private struct UpdateAlert: View {
    let presentation: WhatsNewPresentation
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.sm) {
            Text(WhatsNewPresentation.updateTitle)
                .font(.system(size: 14, weight: .bold)).foregroundStyle(NestColor.info)
            Text(message).font(.system(size: 14)).foregroundStyle(NestColor.info)
            if let command = presentation.upgradeCommand {
                Text(command)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(NestColor.text)
                    .textSelection(.enabled)
            }
            if let link = presentation.updateLink {
                Link("Open the App Store", destination: link)
                    .buttonStyle(NestPrimaryButtonStyle())
                    .fixedSize()
            }
        }
        .padding(NestSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            NestColor.info.opacity(0.12),
            in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous))
        .accessibilityElement(children: .contain)
    }
}

/// A titled list of changes, or its empty label.
private struct ChangelogSection: View {
    let title: String
    let emptyLabel: String
    let rows: [ChangelogRow]

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            Text(title.uppercased())
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(NestColor.dimmedText)
                .accessibilityAddTraits(.isHeader)
            if rows.isEmpty {
                Text(emptyLabel).font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
            } else {
                VStack(spacing: 0) { ForEach(rows) { ChangelogEntryRow(row: $0) } }
            }
        }
    }
}

private struct FullHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

private struct ShownHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

/// One change as a compact row: a chevron when the description is clamped, the
/// type emoji, the description clamped to two lines and the date (beside the
/// row from 768pt, under the description below). A clamped row expands on tap.
private struct ChangelogEntryRow: View {
    let row: ChangelogRow
    @Environment(\.isWideChangelog) private var wide
    @State private var expanded = false
    @State private var shownHeight: CGFloat = 0
    @State private var fullHeight: CGFloat = 0

    private var expandable: Bool { fullHeight > shownHeight + 1 || expanded }

    var body: some View {
        HStack(spacing: NestSpacing.xs) {
            if expandable {
                Button { expanded.toggle() } label: { content }
                    .buttonStyle(.plain)
                    .accessibilityValue(expanded ? "Expanded" : "Collapsed")
            } else {
                content
            }
            if wide {
                Text(row.date ?? "")
                    .font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                    .frame(width: 96, alignment: .trailing)
            }
        }
        .padding(.vertical, 6)
        .overlay(alignment: .bottom) { Rectangle().fill(NestColor.border).frame(height: 1) }
    }

    private var content: some View {
        HStack(alignment: .top, spacing: NestSpacing.xs) {
            Group {
                if expandable {
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                } else {
                    Color.clear
                }
            }
            .frame(width: 16, height: 20)
            .foregroundStyle(NestColor.text)
            if let emoji = row.emoji {
                Text(emoji).font(.system(size: 14)).accessibilityLabel(row.emojiLabel ?? "")
            }
            VStack(alignment: .leading, spacing: 0) {
                Text(row.description)
                    .font(.system(size: 14)).foregroundStyle(NestColor.text)
                    .lineLimit(expanded ? nil : 2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        GeometryReader { Color.clear.preference(key: ShownHeightKey.self, value: $0.size.height) }
                    )
                    .background(
                        Text(row.description)
                            .font(.system(size: 14))
                            .fixedSize(horizontal: false, vertical: true)
                            .hidden()
                            .background(
                                GeometryReader {
                                    Color.clear.preference(key: FullHeightKey.self, value: $0.size.height)
                                })
                    )
                    .onPreferenceChange(ShownHeightKey.self) { shownHeight = $0 }
                    .onPreferenceChange(FullHeightKey.self) { fullHeight = $0 }
                if !wide, let date = row.date {
                    Text(date).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                }
            }
        }
        .contentShape(Rectangle())
    }
}
