import Foundation

/// What the share sheet tells the member after saving: how many files were
/// kept and why any were not.
struct ShareSummary: Equatable {
    var saved = 0
    var unsupported = 0
    var tooLarge = 0
    var failed = 0

    mutating func record(_ result: ShareInbox.StoreResult) {
        switch result {
        case .stored: saved += 1
        case .unsupported: unsupported += 1
        case .tooLarge: tooLarge += 1
        case .failed: failed += 1
        }
    }

    var message: String {
        var lines: [String] = []
        if saved > 0 {
            lines.append(
                (saved == 1 ? "Saved to Nest." : "Saved \(saved) files to Nest.")
                    + " Open Nest to review.")
        }
        if unsupported > 0 {
            lines.append(Self.count(unsupported, "was", "were") + " not a PDF or image.")
        }
        if tooLarge > 0 {
            lines.append(Self.count(tooLarge, "was", "were") + " over 25 MB.")
        }
        if failed > 0 {
            lines.append(Self.count(failed, "could", "could") + " not be saved.")
        }
        return lines.isEmpty ? "Nothing to save." : lines.joined(separator: "\n")
    }

    private static func count(_ n: Int, _ singular: String, _ plural: String) -> String {
        n == 1 ? "1 file \(singular)" : "\(n) files \(plural)"
    }
}
