/// Bundle ids of the apps whose computer-use sidecar may drive this helper.
public enum TrustedOCCApplication {
    public static func isTrusted(bundleId: String) -> Bool {
        // Why: `pnpm dev` launches as `com.stablyai.occ.dev` and per-worktree wrapper apps use
        // `com.stablyai.occ.dev.<name>`; the sidecar peer check must authorize both (#26498).
        bundleId == "com.stablyai.occ" ||
            bundleId == "com.stablyai.occ.dev" ||
            bundleId.hasPrefix("com.stablyai.occ.dev.") ||
            bundleId == "com.github.Electron"
    }
}
