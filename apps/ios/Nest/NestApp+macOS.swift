extension NestApp {
    /// No push or local-notification permission is requested on macOS: there
    /// is no push support and the share extension posts no tap notification
    /// there.
    func requestNotificationAuthorization() {}
}
