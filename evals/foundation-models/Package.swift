// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "ExtractionEval",
  platforms: [.macOS("27.0")],
  targets: [
    .executableTarget(name: "ExtractionEval", path: "Sources/ExtractionEval")
  ]
)
