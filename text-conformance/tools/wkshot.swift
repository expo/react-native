/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/*
 * Full-page WebKit screenshots at an arbitrary scale.
 *
 * Exists because safaridriver's screenshot is bounded by the physical display:
 * it captures the Safari window, so on this machine's 1x 1080p display every
 * capture came out at 402px wide and visibly softer than the 3x device
 * screenshots it sits beside in the comparison report. A WKWebView renders the
 * SAME WebKit build Safari.app links (the system WebKit.framework), and its
 * snapshot API rasterises at any requested width with no window, no display
 * and no height limit — so the page is laid out at the device's CSS width and
 * drawn at the device's density.
 *
 * Layout happens at `width` CSS px (matching the device viewport, so wrapping
 * is comparable) and the raster is `width * scale` px wide. The view is resized
 * to the document's full height before capture, so nothing is cut.
 *
 * Usage: wkshot <width> <scale> then lines of "<url>\t<outPath>" on stdin.
 * One process for the whole batch — WebKit startup is the slow part.
 */

import AppKit
import WebKit

let args = CommandLine.arguments
guard args.count >= 3, let width = Int(args[1]), let scale = Double(args[2]) else {
  FileHandle.standardError.write("usage: wkshot <cssWidth> <scale> (jobs on stdin)\n".data(using: .utf8)!)
  exit(2)
}

struct Job { let url: URL; let out: String }
var jobs: [Job] = []
while let line = readLine(strippingNewline: true) {
  let parts = line.split(separator: "\t", maxSplits: 1).map(String.init)
  guard parts.count == 2, let u = URL(string: parts[0]) else { continue }
  jobs.append(Job(url: u, out: parts[1]))
}

final class Shooter: NSObject, WKNavigationDelegate {
  let webView: WKWebView
  var queue: [Job]
  let width: Int
  let scale: Double
  var settleMs: UInt64 = 400_000_000

  init(jobs: [Job], width: Int, scale: Double) {
    self.width = width
    self.scale = scale
    let config = WKWebViewConfiguration()
    webView = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: 1200), configuration: config)
    queue = jobs
    super.init()
    webView.navigationDelegate = self
    // A window keeps WebKit's compositor willing to draw; it is never shown.
    let win = NSWindow(contentRect: webView.frame, styleMask: [.borderless], backing: .buffered, defer: false)
    win.contentView = webView
  }

  func next() {
    guard let job = queue.first else { exit(0) }
    webView.load(URLRequest(url: job.url))
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    let job = queue.removeFirst()
    Task { @MainActor in
      // Fonts and images settle after didFinish.
      try? await Task.sleep(nanoseconds: settleMs)
      let heightAny = try? await webView.evaluateJavaScript("document.documentElement.scrollHeight")
      let height = max(200, (heightAny as? Double) ?? Double(truncating: (heightAny as? NSNumber) ?? 1200))
      webView.frame = NSRect(x: 0, y: 0, width: Double(width), height: height)
      // A layout at the new height needs a beat before the snapshot.
      try? await Task.sleep(nanoseconds: 150_000_000)

      let cfg = WKSnapshotConfiguration()
      cfg.rect = webView.bounds
      // Points; the image keeps the aspect ratio, so this IS the scale factor.
      cfg.snapshotWidth = NSNumber(value: Double(width) * scale)
      cfg.afterScreenUpdates = true
      webView.takeSnapshot(with: cfg) { image, error in
        guard let image, let tiff = image.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:]) else {
          FileHandle.standardError.write("FAIL \(job.out): \(error.map(String.init(describing:)) ?? "no image")\n".data(using: .utf8)!)
          self.next()
          return
        }
        do {
          try png.write(to: URL(fileURLWithPath: job.out))
          print("wrote \(job.out) \(Int(rep.pixelsWide))x\(Int(rep.pixelsHigh))")
        } catch {
          FileHandle.standardError.write("FAIL \(job.out): \(error)\n".data(using: .utf8)!)
        }
        self.next()
      }
    }
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    let job = queue.removeFirst()
    FileHandle.standardError.write("FAIL \(job.out): \(error)\n".data(using: .utf8)!)
    next()
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let shooter = Shooter(jobs: jobs, width: width, scale: scale)
DispatchQueue.main.async { shooter.next() }
app.run()
