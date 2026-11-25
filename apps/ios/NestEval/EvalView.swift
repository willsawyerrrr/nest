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
          Toggle("Resume: skip arms with results", isOn: $model.resume)
          Button(model.running ? "Running" : "Run \(model.arms.count) arms") { model.start() }
            .disabled(model.running || model.arms.isEmpty || model.corpusCount == nil)
          Text(model.status).font(.footnote)
          if let progress = model.progress {
            VStack(alignment: .leading, spacing: 4) {
              Text("Arm \(progress.arm)/\(progress.arms), document \(progress.document.index)/\(progress.document.total)")
              Text(progress.document.id).foregroundStyle(.secondary)
              Text("Elapsed \(clock(progress.elapsed))" + (progress.remaining.map { ", about \(clock($0)) left in this arm" } ?? ""))
            }
            .font(.footnote.monospacedDigit())
          }
          if let gap = model.suspendedFor {
            Label("Suspended for \(clock(gap)) while locked. Keep the screen on to avoid stalls.", systemImage: "lock.fill")
              .font(.footnote).foregroundStyle(.orange)
          }
        }
        Section("Log") {
          ScrollViewReader { proxy in
            ScrollView {
              LazyVStack(alignment: .leading) {
                ForEach(Array(model.log.enumerated()), id: \.offset) { _, line in
                  Text(line).font(.caption2.monospaced()).frame(maxWidth: .infinity, alignment: .leading)
                }
              }
              .padding(.vertical, 4)
            }
            .frame(height: 200)
            .onChange(of: model.log.count) { _, count in proxy.scrollTo(count - 1) }
          }
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
