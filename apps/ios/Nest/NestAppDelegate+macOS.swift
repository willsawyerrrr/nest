import AppKit
import SwiftUI

/// No push or notification handling exists on macOS; this exists only so
/// `NestApp` can attach a delegate adaptor uniformly across platforms.
final class NestAppDelegate: NSObject, NSApplicationDelegate {}

/// The platform's `UIApplicationDelegateAdaptor` / `NSApplicationDelegateAdaptor`,
/// specialised to `NestAppDelegate` so `NestApp` attaches it with no
/// platform-specific syntax.
typealias PlatformAppDelegateAdaptor = NSApplicationDelegateAdaptor<NestAppDelegate>
