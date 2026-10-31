// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "OCCComputerUseMacOS",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "OCCComputerUseMacOSCore",
            targets: ["OCCComputerUseMacOSCore"]
        ),
        .executable(
            name: "occ-computer-use-macos",
            targets: ["OCCComputerUseMacOS"]
        )
    ],
    targets: [
        .target(
            name: "OCCComputerUseMacOSCore",
            path: "Sources/OCCComputerUseMacOSCore"
        ),
        .executableTarget(
            name: "OCCComputerUseMacOS",
            dependencies: ["OCCComputerUseMacOSCore"],
            path: "Sources/OCCComputerUseMacOS"
        ),
        .testTarget(
            name: "OCCComputerUseMacOSTests",
            dependencies: ["OCCComputerUseMacOSCore"],
            path: "Tests/OCCComputerUseMacOSTests"
        )
    ]
)
