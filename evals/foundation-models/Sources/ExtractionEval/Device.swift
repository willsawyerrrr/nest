import Foundation
import FoundationModels

/// What the run records about the machine and model beside each result.
enum Device {
  /// OS build, model variant and context size; constant for a run.
  static func snapshot(_ choice: ModelChoice) async -> [String: Any] {
    var out: [String: Any] = [
      "osBuild": osBuild(),
      "osVersion": ProcessInfo.processInfo.operatingSystemVersionString,
      "model": choice.rawValue,
    ]
    switch choice {
    case .system:
      let system = SystemLanguageModel.default
      out["modelVariant"] = system.variant.displayName
      out["contextSize"] = system.contextSize
    case .pcc:
      out["modelVariant"] = "pcc"
      if let size = try? await PrivateCloudComputeLanguageModel().contextSize { out["contextSize"] = size }
    }
    return out
  }

  /// `nominal`, `fair`, `serious` or `critical`.
  static var thermalState: String {
    switch ProcessInfo.processInfo.thermalState {
    case .nominal: "nominal"
    case .fair: "fair"
    case .serious: "serious"
    case .critical: "critical"
    @unknown default: "unknown"
    }
  }

  private static func osBuild() -> String {
    var size = 0
    sysctlbyname("kern.osversion", nil, &size, nil, 0)
    var buffer = [CChar](repeating: 0, count: size)
    sysctlbyname("kern.osversion", &buffer, &size, nil, 0)
    return String(decoding: buffer.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }, as: UTF8.self)
  }
}
