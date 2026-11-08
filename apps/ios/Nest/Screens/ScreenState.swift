import Foundation
import SwiftUI

/// What a native screen is showing. A screen holds one `ScreenState` and renders
/// it with `ScreenStateView`, so every screen loads, refreshes and fails the same way.
enum ScreenState<Value> {
    /// Nothing to show yet: no cached snapshot and no fetch has landed.
    case loading
    /// `value` is on screen. `isRefreshing` while a fetch is still to arrive after
    /// a cached snapshot; `refreshError` when that fetch failed, so the screen
    /// keeps the cached value and says it may be out of date.
    case loaded(Value, isRefreshing: Bool, refreshError: NestError?)
    /// Nothing cached and the fetch failed.
    case failed(NestError)

    var value: Value? {
        if case .loaded(let value, _, _) = self { value } else { nil }
    }
}

/// Renders a `ScreenState`: a spinner while loading, `ErrorView` with fixed copy
/// and a retry when failed, and `content` once loaded, with a slim banner above it
/// while refreshing or when the refresh failed.
struct ScreenStateView<Value, Content: View>: View {
    let state: ScreenState<Value>
    let retry: () -> Void
    @ViewBuilder let content: (Value) -> Content

    var body: some View {
        switch state {
        case .loading:
            ProgressView()
                .progressViewStyle(.circular)
                .scaleEffect(1.5)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(NestColor.background)
        case .failed(let error):
            ErrorView(title: "Couldn't load", message: error.userMessage, onRetry: retry)
        case .loaded(let value, let isRefreshing, let refreshError):
            VStack(spacing: 0) {
                if let refreshError {
                    Banner(text: refreshError.userMessage, tone: .warning, retry: retry)
                } else if isRefreshing {
                    Banner(text: "Refreshing…", tone: .neutral, retry: nil)
                }
                content(value)
            }
            .background(NestColor.background)
        }
    }
}

private struct Banner: View {
    let text: String
    let tone: NestPill.Tone
    let retry: (() -> Void)?

    var body: some View {
        HStack(spacing: NestSpacing.xs) {
            Text(text)
                .font(NestFont.caption)
                .foregroundStyle(tone.color)
            Spacer()
            if let retry {
                Button("Retry", action: retry).font(NestFont.caption)
            }
        }
        .padding(.horizontal, NestSpacing.md)
        .padding(.vertical, NestSpacing.xs)
        .background(NestColor.surface)
    }
}
