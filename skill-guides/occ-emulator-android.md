---
name: occ-emulator-android
description: >-
  Android device and emulator control from inside OCC over adb, with the live
  device view in OCC's emulator pane. Use when driving an adb-connected emulator
  or phone on Windows, Linux, or macOS: booting AVDs, taps, swipes, typing,
  hardware buttons, rotation, app install and launch, runtime permissions, the
  accessibility tree, and logcat. For an iOS simulator use the iOS emulator
  skill; build the APK with Gradle first.
license: Apache-2.0
---

# OCC Emulator (Android)

`OCC` is a placeholder for the executable you resolved in the stub; substitute it before running.

## Command surface

The Android backend shells out to `adb`, plus the SDK `emulator` for AVDs, so it runs on
Windows, Linux, and macOS. Input uses
`adb shell input`, with no extra streaming server.

`OCC emulator --help` lists the wrapped verbs. Anything else goes through
`OCC emulator exec --command "<adb shell command>"`, which runs
`adb -s <serial> shell <command>` with the string unvalidated.

`install`, `launch`, `permissions`, and `logcat` are Android-only and fail against an iOS
device with `emulator_unsupported`. `tap`, `type`, `gesture`, `button`, `rotate`, `ax`, and
`exec` work on both backends, with backend-specific output for `ax` — a `uiautomator` node
tree on Android, a serve-sim node tree on iOS.

Camera and sensor injection are not wrapped; Android virtual-scene is out of scope. Commands
drive the SDK and devices on the host that runs the OCC runtime, including a headless
`occ serve` or SSH host.

## Prerequisites

- `adb` from the Android SDK (`ANDROID_HOME`, `ANDROID_SDK_ROOT`, or the per-OS default
  `%LOCALAPPDATA%\Android\Sdk`, `~/Library/Android/sdk`, `~/Android/Sdk`), or a standalone
  `adb` on `PATH` such as a distro `android-tools` package.
- A connected device with USB debugging, or at least one AVD (Android Studio ▸ Device
  Manager). AVDs need the SDK `emulator` package; without it only running devices are listed.
- A booted, adb-visible device before any input or capability command. A shutdown AVD is
  listed with `state: shutdown` and must be started first, by `OCC emulator attach`,
  Android Studio, or `emulator @<avd>`.

OCC returns a clear message when the SDK is missing
(`Android SDK not found. Install Android Studio and set ANDROID_HOME.`).

## Operations

Use `--json` for agent-driven calls. Unqualified commands target the worktree's active
device.

| Goal                 | Command                                                                         | Constraint                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| List devices + AVDs  | `OCC emulator devices --json`                                                  | Every backend's devices with a platform column, booted and shutdown.                                                      |
| Attach / make active | `OCC emulator attach <avd-name-or-serial> --json`                              | Given an AVD name, boots it first. Makes the device active for the worktree.                                              |
| Single tap           | `OCC emulator tap <x> <y> --json`                                              | Normalized 0..1 coordinates.                                                                                              |
| Swipe / gesture      | `OCC emulator gesture '<json>' --json`                                         | adb approximates the path by its endpoints, first point to last.                                                          |
| Type text            | `OCC emulator type "user@example.com" --json`                                  | US-ASCII, spaces handled, no newlines.                                                                                    |
| Hardware button      | `OCC emulator button back --json`                                              | `home`, `back`, `recents`, `power`, `volume_up`, `volume_down`.                                                           |
| Rotate               | `OCC emulator rotate landscape_left --json`                                    | Sets `user_rotation` and disables auto-rotate.                                                                            |
| Install an APK       | `OCC emulator install ./app-debug.apk --reinstall --json`                      | `--reinstall` passes `-r`.                                                                                                |
| Launch an app        | `OCC emulator launch com.acme.app --activity .MainActivity --json`             | Omit `--activity` to launch the default LAUNCHER activity.                                                                |
| Runtime permission   | `OCC emulator permissions grant com.acme.app android.permission.CAMERA --json` | Positional order is `<grant\|revoke> <package> <permission>`; `reset` takes no positionals and clears all runtime grants. |
| Accessibility tree   | `OCC emulator ax --json`                                                       | `uiautomator dump` parsed to a node tree.                                                                                 |
| Logcat (one-shot)    | `OCC emulator logcat --lines 200 --json`                                       | Dumps recent lines, parsed to entries.                                                                                    |
| Raw adb shell        | `OCC emulator exec --command "getprop ro.build.version.sdk" --json`            | Runs `adb -s <serial> shell <command>`.                                                                                   |
| Stop the helper      | `OCC emulator kill --json`                                                     | Leaves the device booted.                                                                                                 |
| Stop and power off   | `OCC emulator shutdown --json`                                                 | Stops the helper and shuts the device down.                                                                               |

## Targeting

`attach`, or opening the emulator pane, makes one device active per worktree, and unqualified
commands target it. Pass a selector only to override that or reach a second device.

- `--device <serial>` such as `emulator-5554`, from `OCC emulator devices`. An AVD name
  resolves only once that AVD is booted.
- `--emulator <id>` is an alternative spelling of `--device`: the bridge resolves both
  through the same device lookup.
- `--worktree id:<fullWorktreeId>` or `--worktree active`. The full id is the exact
  `<repo-id>::<path>` value returned by `OCC worktree list --json`; a bare repo id is not
  valid here.
- `--worktree all` drops worktree scoping on every verb, not only on listing, so a mutating
  command passed `all` runs unscoped. Use it only for listing.
- `OCC emulator devices` is global and lists every backend; the other verbs route to the
  backend that owns the resolved device.

## Constraints

- All coordinates are normalized 0..1 with a top-left origin, never pixels. OCC scales them
  to the device's live resolution.
- Prefer `tap` over `gesture` for a single tap.
- `type` uses `adb shell input text`: US-ASCII only, spaces handled, newlines not. Use the
  app UI directly for unicode-heavy input.
- `gesture` is a straight swipe between the first and last point, so it fits scrolling and
  swiping but not a true multi-touch path.
- Run `kill` when you are done. A helper left running holds the device until OCC quits.

## Examples

```text
OCC emulator devices --json
OCC emulator attach emulator-5554 --json
OCC emulator tap 0.5 0.85 --json
OCC emulator type "hello world" --json
OCC emulator button recents --json
OCC emulator install ./app-debug.apk --reinstall --json
OCC emulator launch com.acme.app --json
OCC emulator permissions grant com.acme.app android.permission.CAMERA --json
OCC emulator ax --json
OCC emulator logcat --lines 100 --json
OCC emulator kill --json
```

See also: `occ-emulator` for iOS simulators, `occ-cli` for terminals, worktrees, and the
built-in browser, and `occ-computer-use` for desktop UI outside the emulator.
