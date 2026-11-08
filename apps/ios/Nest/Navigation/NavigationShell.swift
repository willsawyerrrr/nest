import SwiftUI

/// The signed-in shell: a tab bar on iPhone, a sidebar on iPad and Mac.
struct NavigationShell: View {
    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    var body: some View {
        #if os(iOS)
            if sizeClass == .compact {
                TabShell()
            } else {
                SidebarShell()
            }
        #else
            SidebarShell()
        #endif
    }
}

private struct TabShell: View {
    var body: some View {
        TabView {
            ForEach(NavSection.allCases) { section in
                SectionStack(section: section)
                    .tabItem { Label(section.title, systemImage: section.systemImage) }
            }
        }
        .tint(NestColor.brand)
    }
}

/// A section as one tab: its only route directly, or a list of its routes
/// pushing each screen.
private struct SectionStack: View {
    let section: NavSection

    var body: some View {
        NavigationStack {
            Group {
                if let only = section.routes.first, section.routes.count == 1 {
                    RouteScreen(route: only)
                } else {
                    List(section.routes) { route in
                        NavigationLink(route.title, value: route)
                    }
                    .scrollContentBackground(.hidden)
                    .background(NestColor.background)
                    .navigationTitle(section.title)
                }
            }
            .navigationDestination(for: Route.self) { RouteScreen(route: $0) }
        }
    }
}

private struct SidebarShell: View {
    @State private var selection: Route? = .summary

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                ForEach(NavSection.allCases) { section in
                    if section.routes.count == 1, let only = section.routes.first {
                        Label(only.title, systemImage: section.systemImage).tag(only)
                    } else {
                        Section(section.title) {
                            ForEach(section.routes) { Text($0.title).tag($0) }
                        }
                    }
                }
            }
            .navigationTitle("Nest")
        } detail: {
            if let selection {
                RouteScreen(route: selection)
                    .id(selection)
            }
        }
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
