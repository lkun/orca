/// Bundle ids of the apps whose computer-use sidecar may drive this helper.
public enum TrustedOCCApplication {
    public static func isTrusted(bundleId: String) -> Bool {
        // Why: `pnpm dev` launches as `com.lkun.occ.dev` and per-worktree wrapper apps use
        // `com.lkun.occ.dev.<name>`; the sidecar peer check must authorize both (#26498).
        bundleId == "com.lkun.occ" ||
            bundleId == "com.lkun.occ.dev" ||
            bundleId.hasPrefix("com.lkun.occ.dev.") ||
            bundleId == "com.github.Electron"
    }
}
