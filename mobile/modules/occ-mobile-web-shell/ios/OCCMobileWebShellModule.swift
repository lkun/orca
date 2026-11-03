import ExpoModulesCore
import QuickLook

public class OCCMobileWebShellModule: Module {
  private var pdfPreview: MobileWebShellPdfPreview?

  public func definition() -> ModuleDefinition {
    Name("OCCMobileWebShell")

    AsyncFunction("presentPdf") { (url: URL) in
      guard let presenter = self.appContext?.utilities?.currentViewController() else {
        throw PdfPresenterUnavailableException()
      }
      let preview = MobileWebShellPdfPreview(url: url)
      let controller = QLPreviewController()
      controller.dataSource = preview
      self.pdfPreview = preview
      presenter.present(controller, animated: true)
    }.runOnQueue(.main)

    View(OCCMobileWebShellView.self) {
      Events("onLoadState", "onBridgeMessage", "onExternalNavigation", "onBackEdgeSwipe")

      Prop("generationDirectory") { (view: OCCMobileWebShellView, value: String) in
        view.setGenerationDirectory(value)
      }

      Prop("sessionId") { (view: OCCMobileWebShellView, value: String) in
        view.setSessionId(value)
      }

      Prop("bridgeEnabled") { (view: OCCMobileWebShellView, value: Bool) in
        view.setBridgeEnabled(value)
      }

      Prop("backEdgeSwipe") { (view: OCCMobileWebShellView, value: Bool) in
        view.setBackEdgeSwipe(value)
      }

      AsyncFunction("postBridgeMessage") {
        (view: OCCMobileWebShellView, json: String, promise: Promise) in
        try view.postBridgeMessage(json, promise: promise)
      }

      OnViewDidUpdateProps { (view: OCCMobileWebShellView) in
        view.propsDidUpdate()
      }
    }
  }
}
