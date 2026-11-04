import UIKit

extension AuthModel {
    /// The topmost presented view controller, for Google Sign-In to present
    /// from.
    static func presenter() -> UIViewController? {
        let root = UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }
            .first?.rootViewController
        var top = root
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }
}
