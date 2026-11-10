import SwiftUI

/// The signed-in shell, as the PWA's `TabBar`: a top bar with a burger that
/// opens a drawer of the nav on iPhone (compact width), a persistent sidebar
/// beside the content on iPad and Mac. Both render `NavMenu` over
/// `NavEntry.entries`, so a route registered in `Route` appears in each at once.
struct NavigationShell: View {
    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    @State private var selection: Route = .summary
    @State private var drawerOpen = false
    private let planning = PlanningStore.shared

    private var isCompact: Bool {
        #if os(iOS)
            sizeClass == .compact
        #else
            false
        #endif
    }

    private var entries: [NavEntry] { NavEntry.entries(planningActive: planning.isActive) }

    var body: some View {
        Group {
            if isCompact {
                content.overlay { drawer }
            } else {
                HStack(spacing: 0) {
                    sidebar
                    content
                }
            }
        }
        .background(NestColor.background)
        .tint(NestColor.brand)
        .background { shortcuts }
        .onChange(of: isCompact) { _, _ in drawerOpen = false }
        .onChange(of: planning.isActive) { _, active in
            if !active && selection == .planning { selection = .summary }
        }
    }

    private func select(_ route: Route) {
        selection = route
        drawerOpen = false
    }

    /// The selected route's screen in its own stack, so pushed details have a
    /// back button; the stack is recreated when the route changes.
    private var content: some View {
        NavigationStack {
            RouteScreen(route: selection)
                .navigationDestination(for: Route.self) { RouteScreen(route: $0) }
                .toolbar { if isCompact { topBar } }
        }
        .id(selection)
    }

    @ToolbarContentBuilder
    private var topBar: some ToolbarContent {
        ToolbarItem(placement: .navigation) {
            NestLogo(variant: .mark, size: 28)
        }
        ToolbarItemGroup(placement: .primaryAction) {
            WhatsNewButton(isActive: selection == .whatsNew) { select(.whatsNew) }
            Button {
                drawerOpen = true
            } label: {
                Image(systemName: "line.3.horizontal")
            }
            .accessibilityLabel("Toggle navigation menu")
            .accessibilityValue(drawerOpen ? "Expanded" : "Collapsed")
        }
    }

    private var sidebar: some View {
        VStack(spacing: 0) {
            NestLogo(variant: .lockup, size: 32)
                .padding(.horizontal, NestSpacing.xs)
                .padding(.bottom, NestSpacing.lg)
                .frame(maxWidth: .infinity, alignment: .leading)
            ScrollView {
                NavMenu(entries: entries, selection: selection, onSelect: select)
            }
            Divider().overlay(NestColor.border)
            HStack {
                Spacer()
                WhatsNewButton(isActive: selection == .whatsNew) { select(.whatsNew) }
            }
            .padding(.horizontal, NestSpacing.xs)
            .padding(.top, NestSpacing.sm)
        }
        .padding(.leading, NestSpacing.md)
        .padding(.trailing, NestSpacing.sm)
        .padding(.vertical, NestSpacing.md)
        .frame(width: 240)
        .frame(maxHeight: .infinity)
        .background(NestColor.background)
        .overlay(alignment: .trailing) { Rectangle().fill(NestColor.border).frame(width: 1) }
    }

    /// The left drawer over a dimmed scrim, closing on a scrim tap.
    private var drawer: some View {
        ZStack(alignment: .leading) {
            if drawerOpen {
                Color.black.opacity(0.5)
                    .ignoresSafeArea()
                    .onTapGesture { drawerOpen = false }
                    .transition(.opacity)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        NestLogo(variant: .mark, size: 28)
                        Spacer()
                        Button {
                            drawerOpen = false
                        } label: {
                            Image(systemName: "xmark")
                                .foregroundStyle(NestColor.dimmedText)
                                .frame(width: 32, height: 32)
                        }
                        .accessibilityLabel("Close navigation menu")
                    }
                    .padding(.bottom, NestSpacing.md)
                    ScrollView {
                        NavMenu(entries: entries, selection: selection, onSelect: select)
                    }
                }
                .padding(NestSpacing.md)
                .frame(width: 320)
                .frame(maxHeight: .infinity)
                .background(NestColor.background.ignoresSafeArea())
                .transition(.move(edge: .leading))
            }
        }
        .animation(.easeInOut(duration: 0.25), value: drawerOpen)
    }

    /// `⌘1`…`⌘9` jump to a route by position in the nav and `⇧⌘←` / `⇧⌘→`
    /// cycle it with wrap-around, as the PWA's hotkeys do.
    private var shortcuts: some View {
        let routes = NavEntry.flattened(entries)
        let index = routes.firstIndex(of: selection) ?? -1
        return ZStack {
            ForEach(Array(routes.prefix(9).enumerated()), id: \.offset) { offset, route in
                Button("") { select(route) }
                    .keyboardShortcut(
                        KeyEquivalent(Character("\(offset + 1)")), modifiers: .command)
            }
            Button("") { select(routes[(index + 1 + routes.count) % routes.count]) }
                .keyboardShortcut(.rightArrow, modifiers: [.command, .shift])
            Button("") { select(routes[(index - 1 + routes.count) % routes.count]) }
                .keyboardShortcut(.leftArrow, modifiers: [.command, .shift])
        }
        .opacity(0)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// The "What's new" button, brand-tinted so it reads as a destination.
private struct WhatsNewButton: View {
    let isActive: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "megaphone")
                .font(.system(size: 18))
                .foregroundStyle(isActive ? NestColor.navActiveText : NestColor.brand)
                .frame(width: 34, height: 34)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("What's new")
    }
}

/// Renders a route's content: its native screen, or the web fallback.
struct RouteScreen: View {
    let route: Route

    var body: some View {
        Group {
            switch route.content {
            case .native(let view):
                view
            case .web(let path):
                WebRouteView(path: path)
            }
        }
        .navigationTitle(route.title)
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

/// The embedded PWA at `path`, with a loading indicator and a retry state.
struct WebRouteView: View {
    let path: String

    @State private var isLoading = true
    @State private var loadError: String?
    @State private var reloadToken = UUID()

    var body: some View {
        ZStack {
            WebView(url: Route.url(forPath: path), isLoading: $isLoading, loadError: $loadError)
                .id(reloadToken)

            if isLoading && loadError == nil {
                ProgressView()
                    .progressViewStyle(.circular)
                    .scaleEffect(1.5)
            }

            if loadError != nil {
                ErrorView(
                    title: "Couldn't load Nest",
                    message: "Check your connection and try again.",
                    onRetry: retry
                )
            }
        }
        .background(NestColor.background)
    }

    /// Clears the error, shows the loading indicator again, and recreates
    /// `WebView` (via a fresh `id`) so it re-issues the load.
    private func retry() {
        loadError = nil
        isLoading = true
        reloadToken = UUID()
    }
}
