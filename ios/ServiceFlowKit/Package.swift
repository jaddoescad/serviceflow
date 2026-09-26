// swift-tools-version: 5.9
import PackageDescription

// Platform-independent logic of the ServiceFlow crew app: models, the
// time-tracking state machine, offline queues and presentation rules. It only
// depends on Foundation so it builds and runs its checks on macOS:
//
//     swift run ServiceFlowCoreChecks
let package = Package(
    name: "ServiceFlowKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "ServiceFlowCore", targets: ["ServiceFlowCore"]),
    ],
    targets: [
        .target(name: "ServiceFlowCore"),
        .executableTarget(name: "ServiceFlowCoreChecks", dependencies: ["ServiceFlowCore"]),
    ]
)
