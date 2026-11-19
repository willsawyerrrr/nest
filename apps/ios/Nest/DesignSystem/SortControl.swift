import SwiftUI

/// Which way a sorted order runs, as the PWA's `SortDirection`.
enum SortDirection: String, Codable, Sendable {
    case asc, desc

    var toggled: Self { self == .asc ? .desc : .asc }
    var glyph: String { self == .asc ? "↑" : "↓" }
}

/// A list's sort keys, with the key its choice persists under and its default.
protocol SortKey: RawRepresentable<String>, Codable, CaseIterable, Hashable, Sendable
where AllCases: RandomAccessCollection {
    var label: String { get }
    /// The `UserDefaults` key, the PWA's `localStorage` key for the same list.
    static var storageKey: String { get }
    static var defaultKey: Self { get }
}

/// A persisted sort choice, as the PWA's `SortPreference`.
struct SortPreference<Key: SortKey>: Codable, Equatable, Sendable {
    var key: Key = .defaultKey
    var direction: SortDirection = .asc

    static func stored(in defaults: UserDefaults = .standard) -> Self {
        defaults.data(forKey: Key.storageKey).flatMap {
            try? JSONDecoder().decode(Self.self, from: $0)
        } ?? Self()
    }

    func store(in defaults: UserDefaults = .standard) {
        defaults.set(try? JSONEncoder().encode(self), forKey: Key.storageKey)
    }

    /// `items` ordered by `ascending` (ties in given order), reversed for descending,
    /// as the PWA's `sortBy`.
    func sorted<T>(_ items: [T], by ascending: (T, T) -> ComparisonResult) -> [T] {
        let sorted = items.enumerated().sorted { a, b in
            let order = ascending(a.element, b.element)
            return order == .orderedSame ? a.offset < b.offset : order == .orderedAscending
        }.map(\.element)
        return direction == .desc ? sorted.reversed() : sorted
    }
}

/// The sort `Select` and direction toggle, right-aligned.
struct SortBar<Key: SortKey>: View {
    @Binding var sort: SortPreference<Key>

    var body: some View {
        HStack(spacing: NestSpacing.xs) {
            Spacer()
            Menu {
                Picker("Sort by", selection: $sort.key) {
                    ForEach(Key.allCases, id: \.self) { Text($0.label).tag($0) }
                }
            } label: {
                HStack {
                    Text(sort.key.label)
                    Spacer(minLength: NestSpacing.xs)
                    Image(systemName: "chevron.down").font(.system(size: 11))
                }
                .font(.system(size: 14))
                .foregroundStyle(NestColor.text)
                .padding(.horizontal, NestSpacing.sm)
                .frame(width: 140, height: 36)
                .outlined()
            }
            .accessibilityLabel("Sort by")
            Button {
                sort.direction = sort.direction.toggled
            } label: {
                Text(sort.direction.glyph)
                    .font(.system(size: 16)).foregroundStyle(NestColor.text)
                    .frame(width: 36, height: 36).outlined()
            }
            .accessibilityLabel("Toggle sort direction")
        }
    }
}

extension Comparable {
    /// The order of `self` against `other`, for a `SortPreference` comparator.
    func compared(to other: Self) -> ComparisonResult {
        self < other ? .orderedAscending : self > other ? .orderedDescending : .orderedSame
    }
}
