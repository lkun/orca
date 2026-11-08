cask "occ" do
  arch arm: "arm64", intel: "x64"

  version "1.3.24"
  sha256 arm:   "fc707f290ff3b631b7b7947bf339885b61a43d2e89475997c125b61268ed4966",
         intel: "5f677c13a08f7a5740442e29d388285a86488c8c1f7aa5f10a8721a2c6ede8e4"

  url "https://github.com/stablyai/occ/releases/download/v#{version}/occ-macos-#{arch}.dmg"
  name "OCC"
  desc "IDE for orchestrating AI coding agents across terminals and worktrees"
  homepage "https://onocc.dev/"

  livecheck do
    url :url
    strategy :github_latest
  end

  # Let the in-app updater own updates between brew upgrades.
  auto_updates true
  conflicts_with cask: "occ@rc"
  depends_on macos: :ventura

  app "OCC.app"

  # Expose the symlink-resolving bundled CLI on PATH so headless hosts can use occ serve without the in-app installer.
  binary "#{appdir}/OCC.app/Contents/Resources/bin/occ"

  # depends_on can't say 13.4, and Homebrew upgrades auto_updates casks past the in-app updater's macOS gate.
  preflight_steps do
    run "/bin/sh", args: [
      "-c",
      'case "$(/usr/bin/sw_vers -productVersion)" in 13|13.[0-3]|13.[0-3].*) ' \
      'echo "OCC needs macOS 13.4 or later. Update macOS to upgrade OCC." >&2; exit 1;; esac',
    ]
  end

  # Zap app-created ~/.occ and Electron userData for a clean uninstall.
  zap trash: [
    "~/.occ",
    "~/Library/Application Support/OCC",
    "~/Library/Caches/com.stablyai.occ",
    "~/Library/Caches/com.stablyai.occ.ShipIt",
    "~/Library/HTTPStorages/com.stablyai.occ",
    "~/Library/Preferences/com.stablyai.occ.plist",
    "~/Library/Saved Application State/com.stablyai.occ.savedState",
  ]
end
