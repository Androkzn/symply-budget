import UIKit

// RoomPlan's RoomCaptureView/RoomCaptureSession are device-only — the symbols are
// unavailable in the simulator SDK even though `canImport(RoomPlan)` is true there,
// so gate the capture code on a real device to keep simulator builds compiling.
#if canImport(RoomPlan) && !targetEnvironment(simulator)
import RoomPlan

/**
 * Full-screen RoomPlan capture. Resolves with TRD §4.5-shaped vector JSON (meters).
 */
@available(iOS 16.0, *)
final class RoomPlanCaptureViewController: UIViewController, RoomCaptureViewDelegate {
  enum Outcome {
    case success([String: Any])
    case cancelled
    case failed(String)
  }

  var onComplete: ((Outcome) -> Void)?

  private var roomCaptureView: RoomCaptureView!
  private var isScanning = false
  private var finishing = false

  override func viewDidLoad() {
    super.viewDidLoad()
    title = "Scan room"
    view.backgroundColor = .black
    navigationItem.leftBarButtonItem = UIBarButtonItem(
      barButtonSystemItem: .cancel,
      target: self,
      action: #selector(cancelTapped)
    )
    navigationItem.rightBarButtonItem = UIBarButtonItem(
      title: "Done",
      style: .done,
      target: self,
      action: #selector(doneTapped)
    )

    roomCaptureView = RoomCaptureView(frame: view.bounds)
    roomCaptureView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    roomCaptureView.delegate = self
    view.addSubview(roomCaptureView)
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    startSession()
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    if isScanning {
      roomCaptureView?.captureSession.stop()
      isScanning = false
    }
  }

  private func startSession() {
    guard RoomCaptureSession.isSupported else {
      finish(.failed("RoomPlan requires a LiDAR device (iOS 16+)"))
      return
    }
    var config = RoomCaptureSession.Configuration()
    config.isCoachingEnabled = true
    roomCaptureView.captureSession.run(configuration: config)
    isScanning = true
  }

  @objc private func cancelTapped() {
    finishing = true
    finish(.cancelled)
  }

  @objc private func doneTapped() {
    guard !finishing else { return }
    finishing = true
    navigationItem.rightBarButtonItem?.isEnabled = false
    roomCaptureView.captureSession.stop()
    isScanning = false
  }

  func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
    true
  }

  func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
    if let error {
      finish(.failed(error.localizedDescription))
      return
    }
    finish(.success(Self.normalize(processedResult)))
  }

  private func finish(_ outcome: Outcome) {
    if isScanning {
      roomCaptureView?.captureSession.stop()
      isScanning = false
    }
    dismiss(animated: true) { [weak self] in
      self?.onComplete?(outcome)
    }
  }

  /// Normalize CapturedRoom → Home Projects ManualGeometryPayload-compatible dict.
  static func normalize(_ room: CapturedRoom) -> [String: Any] {
    var width: Double = 3.0
    var depth: Double = 3.0
    var wallHeight: Double = 2.4

    if #available(iOS 17.0, *), let floor = room.floors.first {
      width = Double(max(floor.dimensions.x, 0.5))
      depth = Double(max(floor.dimensions.z, 0.5))
    } else if room.walls.count >= 2 {
      width = Double(max(room.walls[0].dimensions.x, 0.5))
      depth = Double(max(room.walls[1].dimensions.x, 0.5))
    }
    if let wall = room.walls.first {
      wallHeight = Double(max(wall.dimensions.y, 2.0))
    }

    width = min(width, 30)
    depth = min(depth, 30)
    let area = (width * depth * 100).rounded() / 100

    let doorOpenings: [[String: Any]] = room.doors.map { door in
      [
        "type": "door",
        "wallId": "w1",
        "width_m": Double(door.dimensions.x),
      ]
    }
    let windowOpenings: [[String: Any]] = room.windows.map { window in
      [
        "type": "window",
        "wallId": "w1",
        "width_m": Double(window.dimensions.x),
      ]
    }
    let openings = doorOpenings + windowOpenings

    return [
      "units": "m",
      "floor": [
        "polygon": [[0.0, 0.0], [width, 0.0], [width, depth], [0.0, depth]],
        "area_m2": area,
        "openings": openings,
      ],
      "walls": [
        ["id": "w1", "label": "North", "width_m": width, "height_m": wallHeight, "openings": [] as [Any]],
        ["id": "w2", "label": "East", "width_m": depth, "height_m": wallHeight, "openings": [] as [Any]],
        ["id": "w3", "label": "South", "width_m": width, "height_m": wallHeight, "openings": [] as [Any]],
        ["id": "w4", "label": "West", "width_m": depth, "height_m": wallHeight, "openings": [] as [Any]],
      ],
      "ceiling": ["area_m2": area],
      "source_meta": [
        "captured_at": ISO8601DateFormatter().string(from: Date()),
        "estimator": "roomplan",
        "wall_count": room.walls.count,
        "door_count": room.doors.count,
        "window_count": room.windows.count,
      ],
    ]
  }
}
#endif
