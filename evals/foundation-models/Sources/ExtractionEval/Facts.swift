import Foundation
import FoundationModels

/// The values the SDK reports at runtime, for the docs to record.
enum Facts {
  static func print() async {
    let system = SystemLanguageModel.default
    Swift.print("os:", ProcessInfo.processInfo.operatingSystemVersionString)
    Swift.print("system availability:", system.availability)
    Swift.print("system variant:", system.variant.displayName)
    Swift.print("system contextSize:", system.contextSize)
    Swift.print("system vision:", system.capabilities.contains(.vision))
    let cloud = PrivateCloudComputeLanguageModel()
    Swift.print("pcc availability:", cloud.availability)
    Swift.print("pcc contextSize:", (try? await cloud.contextSize).map(String.init) ?? "unavailable")
    Swift.print("pcc vision:", cloud.capabilities.contains(.vision))
  }
}
