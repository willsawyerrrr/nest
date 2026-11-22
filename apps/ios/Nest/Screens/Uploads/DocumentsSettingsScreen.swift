import SwiftUI

/// The native Documents settings route: the per-device switch for reading payslips
/// and receipts with the on-device model.
struct DocumentsSettingsScreen: View {
    @AppStorage(OnDevicePreference.key) private var enabled = true
    private let unavailability = OnDeviceModel.unavailability

    var body: some View {
        NestPageSection(title: "Documents") {
            NestCard {
                VStack(alignment: .leading, spacing: NestSpacing.sm) {
                    Toggle("Read documents on this device", isOn: unavailability == nil ? $enabled : .constant(false))
                        .font(.system(size: 16, weight: .semibold))
                        .disabled(unavailability != nil)
                    Text(
                        "Receipts are read by Apple Intelligence on this device, so they stay on it. When turned off, or when a document can't be read here, Nest sends it to its server to be read."
                    )
                    .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                    if let unavailability {
                        Text("Unavailable: \(unavailability.reason)")
                            .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                    }
                }
            }
        }
    }
}
