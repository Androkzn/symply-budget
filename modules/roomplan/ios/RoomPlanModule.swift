import ExpoModulesCore
import Foundation
import UIKit

// Device-only: the RoomCapture* symbols are absent from the simulator SDK even
// though `canImport(RoomPlan)` is true there, so exclude the simulator.
#if canImport(RoomPlan) && !targetEnvironment(simulator)
import RoomPlan
#endif

/**
 * Expo module wrapping Apple RoomPlan (iOS 16+ LiDAR).
 * v1: single-room capture → meters polygon JSON for Home Projects.
 */
public class RoomPlanModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RoomPlan")

    Function("isSupported") { () -> Bool in
      #if canImport(RoomPlan) && !targetEnvironment(simulator)
      if #available(iOS 16.0, *) {
        return RoomCaptureSession.isSupported
      }
      #endif
      return false
    }

    AsyncFunction("scanRoom") { (promise: Promise) in
      #if canImport(RoomPlan) && !targetEnvironment(simulator)
      if #available(iOS 16.0, *) {
        guard RoomCaptureSession.isSupported else {
          promise.reject("UNSUPPORTED", "RoomPlan requires a LiDAR device (iOS 16+)")
          return
        }
        DispatchQueue.main.async {
          guard let presenter = Self.topViewController() else {
            promise.reject("NO_UI", "No view controller available to present RoomPlan")
            return
          }
          let capture = RoomPlanCaptureViewController()
          capture.onComplete = { outcome in
            switch outcome {
            case .success(let payload):
              promise.resolve(payload)
            case .cancelled:
              promise.reject("CANCELLED", "Room scan cancelled")
            case .failed(let message):
              promise.reject("CAPTURE_FAILED", message)
            }
          }
          let nav = UINavigationController(rootViewController: capture)
          nav.modalPresentationStyle = .fullScreen
          presenter.present(nav, animated: true)
        }
        return
      }
      #endif
      promise.reject("UNSUPPORTED", "RoomPlan is not available on this platform")
    }
  }

  private static func topViewController(
    base: UIViewController? = {
      UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .flatMap { $0.windows }
        .first { $0.isKeyWindow }?
        .rootViewController
    }()
  ) -> UIViewController? {
    if let nav = base as? UINavigationController {
      return topViewController(base: nav.visibleViewController)
    }
    if let tab = base as? UITabBarController {
      return topViewController(base: tab.selectedViewController)
    }
    if let presented = base?.presentedViewController {
      return topViewController(base: presented)
    }
    return base
  }
}
