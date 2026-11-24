import SwiftUI

struct EvalView: View {
  @Bindable var model: EvalModel
  @State private var importing = false

  var body: some View {
    NavigationStack {
      Form {
        Section("Corpus") {
          LabeledContent("Documents", value: model.corpusCount.map(String.init) ?? "none")
          Button("Import corpus folder") { importing = true }
          Text("Or copy the folder's files into Nest Eval in the Files app.").font(.footnote).foregroundStyle(.secondary)
        }
        Section("Arms") {
          ForEach([ModelChoice.system, .pcc], id: \.rawValue) { toggle($0.rawValue, in: $model.models, $0) }
          ForEach([InputPath.pdftext, .ocr, .image, .imageHires, .ocrImage], id: \.rawValue) { toggle($0.rawValue, in: $model.paths, $0) }
          ForEach([Sampling.default, .greedy], id: \.rawValue) { toggle($0.rawValue, in: $model.samplings, $0) }
        }
        Section("Run") {
          Stepper("Repeats: \(model.repeats)", value: $model.repeats, in: 1...20)
          TextField("Only document ids (comma-separated)", text: $model.only).textInputAutocapitalization(.never).autocorrectionDisabled()
          Toggle("Every kind per document", isOn: $model.cross)
          Button(model.running ? "Running" : "Run \(model.arms.count) arms") { model.start() }
            .disabled(model.running || model.arms.isEmpty || model.corpusCount == nil)
          Text(model.status).font(.footnote)
          ForEach(model.log, id: \.self) { Text($0).font(.footnote).foregroundStyle(.red) }
        }
        Section("Results") {
          ForEach(model.results, id: \.self) { url in ShareLink(item: url) { Text(url.lastPathComponent) } }
          Button("Refresh") { model.refresh() }
        }
      }
      .navigationTitle("Nest Eval")
      .fileImporter(isPresented: $importing, allowedContentTypes: [.folder], onCompletion: model.importFolder)
    }
  }

  private func toggle<Value: Hashable>(_ title: String, in set: Binding<Set<Value>>, _ value: Value) -> some View {
    Toggle(
      title,
      isOn: Binding(
        get: { set.wrappedValue.contains(value) },
        set: { if $0 { set.wrappedValue.insert(value) } else { set.wrappedValue.remove(value) } }))
  }
}
