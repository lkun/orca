cask "occ@rc" do
  arch arm: "arm64", intel: "x64"

  version "1.4.36-rc.3"
  sha256 arm:   "563b6b14323fc9d5489299c82442d514bc12cabffc9d06d3964ed572af4b3955",
         intel: "457088c7021f07de1a419197f7b2bd00092741ad4727d4fef3d86af38a6831e7"

  url "https://github.com/stablyai/occ/releases/download/v#{version}/occ-macos-#{arch}.dmg"
  name "OCC RC"
  desc "IDE for orchestrating AI coding agents across terminals and worktrees"
  homepage "https://onocc.dev/"

  livecheck do
    url "https://github.com/stablyai/occ"
    regex(/^v?(\d+(?:\.\d+)+-rc\.\d+)$/i)
    strategy :github_releases do |json, regex|
      json.map do |release|
        next if release["draft"]
        next unless release["prerelease"]

        match = release["tag_name"]&.match(regex)
        next if match.blank?

        match[1]
      end
    end
  end

  # Use OCC’s prerelease-aware updater between frequent RCs.
  auto_updates true
  conflicts_with cask: "occ"
  depends_on macos: :big_sur

  app "OCC.app"

  # Expose the symlink-resolving bundled CLI on PATH so headless hosts can use occ serve without the in-app installer.
  binary "#{appdir}/OCC.app/Contents/Resources/bin/occ"

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
