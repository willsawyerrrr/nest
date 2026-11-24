import SwiftUI

@main
struct NestEvalApp: App {
  @State private var model = EvalModel()

  var body: some Scene {
    WindowGroup {
      EvalView(model: model)
    }
  }
}
