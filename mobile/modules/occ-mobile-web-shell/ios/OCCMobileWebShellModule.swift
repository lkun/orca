import ExpoModulesCore
import QuickLook

public class OCCMobileWebShellModule: Module {
  private var pdfPreview: MobileWebShellPdfPreview?

  public func definition() -> ModuleDefinition {
    Name("OCCMobileWebShell")

    // Home calls this once it has a paired host, so a user with nothing to open pays nothing.
    Function("warmUp") {
      // A second's delay keeps the warm-up off the launch's first frames.
      DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
        MobileWebShellWarmUp.start()
      }
    }

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

    AsyncFunction("shareImage") { (url: URL, _: String) in
      guard let presenter = self.appContext?.utilities?.currentViewController() else {
        throw ImagePresenterUnavailableException()
      }
      presentImageShareSheet(url: url, from: presenter)
    }.runOnQueue(.main)

    AsyncFunction("saveImageToPhotos") { (url: URL, _: String, promise: Promise) in
      saveImageToPhotoLibrary(url: url, promise: promise)
    }

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
