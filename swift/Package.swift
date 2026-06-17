// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "CalendarCLI",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "CalendarCLI",
            path: "Sources/CalendarCLI",
            exclude: ["Info.plist"]
        )
    ]
)
