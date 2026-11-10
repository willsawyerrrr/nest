import SwiftUI

/// The nav list shared by the drawer and the sidebar, as the PWA's `NavList`:
/// Summary and Planning stand alone, every other section is a collapsible group.
/// The group holding the selected route opens on every selection and the rest
/// fold away; toggling a header in between leaves it as set.
struct NavMenu: View {
    let entries: [NavEntry]
    let selection: Route
    let onSelect: (Route) -> Void

    @State private var openSections: Set<NavSection>

    init(entries: [NavEntry], selection: Route, onSelect: @escaping (Route) -> Void) {
        self.entries = entries
        self.selection = selection
        self.onSelect = onSelect
        _openSections = State(initialValue: selection.section.map { [$0] } ?? [])
    }

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xxs) {
            ForEach(entries) { entry in
                switch entry {
                case .item(let route):
                    NavItemRow(route: route, isActive: route == selection) { onSelect(route) }
                case .group(let section):
                    NavGroupView(
                        section: section,
                        selection: selection,
                        isOpen: openSections.contains(section),
                        onToggle: { toggle(section) },
                        onSelect: onSelect
                    )
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Primary")
        .onChange(of: selection) { _, route in
            withAnimation(.easeInOut(duration: 0.2)) {
                openSections = route.section.map { [$0] } ?? []
            }
        }
    }

    private func toggle(_ section: NavSection) {
        withAnimation(.easeInOut(duration: 0.2)) {
            if openSections.contains(section) {
                openSections.remove(section)
            } else {
                openSections.insert(section)
            }
        }
    }
}

/// A group header over its items. The header is a quiet label rather than a
/// destination, and carries a brand dot while folded over the selected route.
private struct NavGroupView: View {
    let section: NavSection
    let selection: Route
    let isOpen: Bool
    let onToggle: () -> Void
    let onSelect: (Route) -> Void

    private var holdsSelection: Bool { selection.section == section }

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xxs) {
            Button(action: onToggle) {
                HStack(spacing: NestSpacing.xxs) {
                    Image(systemName: isOpen ? "chevron.down" : "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .frame(width: 14)
                    Text(section.title.uppercased())
                        .font(.system(size: 14, weight: .bold))
                        .tracking(0.84)
                    if !isOpen && holdsSelection {
                        Circle().fill(NestColor.brand).frame(width: 6, height: 6)
                            .accessibilityHidden(true)
                    }
                    Spacer(minLength: 0)
                }
                .foregroundStyle(NestColor.dimmedText)
                .navRowBackground(isActive: false)
            }
            .buttonStyle(.plain)
            .accessibilityValue(isOpen ? "Expanded" : "Collapsed")

            if isOpen {
                VStack(alignment: .leading, spacing: NestSpacing.xxs) {
                    ForEach(section.routes) { route in
                        NavItemRow(route: route, isActive: route == selection) { onSelect(route) }
                    }
                }
                .padding(.top, NestSpacing.xxs)
                .padding(.leading, NestSpacing.xs)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .clipped()
    }
}

/// One destination: a brand wash and leading bar while it is the selected route.
private struct NavItemRow: View {
    let route: Route
    let isActive: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(route.title)
                .font(.system(size: 16, weight: isActive ? .bold : .medium))
                .foregroundStyle(isActive ? NestColor.navActiveText : NestColor.text)
                .frame(maxWidth: .infinity, alignment: .leading)
                .navRowBackground(isActive: isActive)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }
}

extension View {
    /// The nav row's padding, corner radius, hover fill and active wash with its
    /// leading bar (`drawer-nav__link` in `App.css`).
    fileprivate func navRowBackground(isActive: Bool) -> some View {
        modifier(NavRowBackground(isActive: isActive))
    }
}

private struct NavRowBackground: ViewModifier {
    let isActive: Bool
    @State private var isHovered = false

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
        content
            .padding(.vertical, NestSpacing.xs)
            .padding(.horizontal, NestSpacing.sm)
            .background {
                shape.fill(
                    isActive
                        ? NestColor.brand.opacity(0.18)
                        : (isHovered ? NestColor.surfaceRaised : .clear))
            }
            .overlay(alignment: .leading) {
                if isActive {
                    Rectangle().fill(NestColor.brand).frame(width: 3)
                }
            }
            .clipShape(shape)
            .contentShape(shape)
            .onHover { isHovered = $0 }
    }
}

/// The brand mark, or the mark beside the "nest" wordmark (`Logo.tsx`'s `mark`
/// and `lockup` variants); the mark restores its dark tile in light mode.
struct NestLogo: View {
    enum Variant { case mark, lockup }

    let variant: Variant
    let size: CGFloat

    var body: some View {
        HStack(spacing: size * 0.32) {
            Image("NestMark")
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
                .background(
                    NestColor.markTile,
                    in: RoundedRectangle(cornerRadius: size * 0.21, style: .continuous))
            if variant == .lockup {
                Text("nest")
                    .font(.system(size: size * 0.9, weight: .semibold, design: .rounded))
                    .foregroundStyle(NestColor.text)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Nest")
    }
}
