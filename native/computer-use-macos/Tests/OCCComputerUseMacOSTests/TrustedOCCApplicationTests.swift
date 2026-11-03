import Testing
@testable import OCCComputerUseMacOSCore

@Suite("TrustedOCCApplication")
struct TrustedOCCApplicationTests {
    @Test("trusts the packaged app, every dev build and stock Electron")
    func trusted() {
        #expect(TrustedOCCApplication.isTrusted(bundleId: "com.stablyai.occ"))
        // What `pnpm dev` launches as: DEV_BUNDLE_ID in dev-electron-bundle-identity.mjs (#26498).
        #expect(TrustedOCCApplication.isTrusted(bundleId: "com.stablyai.occ.dev"))
        #expect(TrustedOCCApplication.isTrusted(bundleId: "com.stablyai.occ.dev.worktree"))
        #expect(TrustedOCCApplication.isTrusted(bundleId: "com.github.Electron"))
    }

    @Test("rejects look-alike and unrelated bundle ids")
    func untrusted() {
        #expect(!TrustedOCCApplication.isTrusted(bundleId: "com.stablyai.occ.devtools"))
        #expect(!TrustedOCCApplication.isTrusted(bundleId: "com.stablyai.occx"))
        #expect(!TrustedOCCApplication.isTrusted(bundleId: "com.example.occ"))
        #expect(!TrustedOCCApplication.isTrusted(bundleId: ""))
    }
}
