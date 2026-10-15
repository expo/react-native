// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

import ExpoModulesCore
import UniformTypeIdentifiers
import WebKit

/// The web view behind `TemplateWeb`. Pages load from the bundle through the
/// `astryx-web:` scheme rather than `file:` URLs, because the viewer is an ES
/// module app: WebKit refuses module scripts from `file:` origins, and the
/// viewer picks its template from the URL's path, which a file URL cannot
/// name.
public final class TemplateWebView: ExpoView {
  private let webView: WKWebView
  private var slug: String?

  public required init(appContext: AppContext? = nil) {
    let configuration = WKWebViewConfiguration()
    configuration.setURLSchemeHandler(
      BundledWebFolder(root: Bundle.main.resourceURL?.appendingPathComponent("web")),
      forURLScheme: BundledWebFolder.scheme
    )
    webView = WKWebView(frame: .zero, configuration: configuration)
    super.init(appContext: appContext)
    // The system background until the page paints, so a dark sheet does not
    // flash white
    webView.isOpaque = false
    webView.backgroundColor = .systemBackground
    webView.scrollView.backgroundColor = .systemBackground
    webView.isInspectable = true
    webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    webView.frame = bounds
    addSubview(webView)
  }

  func load(slug: String) {
    guard slug != self.slug else {
      return
    }
    self.slug = slug
    // The viewer renders the template whose directory the path ends with
    // (apps/template-viewer/src/App.tsx)
    guard let url = URL(string: "\(BundledWebFolder.scheme)://app/pages/\(slug)") else {
      return
    }
    webView.load(URLRequest(url: url))
  }
}

/// Serves `web/` from the app bundle to the web view.
///
/// The page's URL names the template (`/pages/<slug>`) while the viewer's
/// build refers to its files relative to the page (`./assets/…`), so a
/// request is answered with the longest trailing part of its path that names
/// a bundled file; a path naming no file is a page and gets `index.html`. The
/// templates ask for their pictures as `/template-assets/<name>.png`, and the
/// app carries its own resized copies under the same names, most of them
/// JPEG, so a picture is found by its name without the extension.
final class BundledWebFolder: NSObject, WKURLSchemeHandler {
  static let scheme = "astryx-web"

  private let root: URL?

  init(root: URL?) {
    self.root = root
  }

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    guard let url = task.request.url else {
      task.didFailWithError(URLError(.badURL))
      return
    }
    guard let root, let file = file(for: url.path, in: root) else {
      let response = HTTPURLResponse(
        url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: [:])!
      task.didReceive(response)
      task.didFinish()
      return
    }
    do {
      let data = try Data(contentsOf: file)
      let type = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType
      let response = HTTPURLResponse(
        url: url,
        statusCode: 200,
        httpVersion: "HTTP/1.1",
        headerFields: [
          "Content-Type": file.pathExtension == "js" ? "text/javascript" : (type ?? "application/octet-stream"),
          "Content-Length": String(data.count),
        ])!
      task.didReceive(response)
      task.didReceive(data)
      task.didFinish()
    } catch {
      task.didFailWithError(error)
    }
  }

  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

  private func file(for path: String, in root: URL) -> URL? {
    // Never leave the folder
    let parts = path.split(separator: "/").map(String.init).filter { $0 != ".." && $0 != "." }
    let manager = FileManager.default
    for start in parts.indices {
      let candidate = parts[start...].reduce(root) { $0.appendingPathComponent($1) }
      var isDirectory: ObjCBool = false
      if manager.fileExists(atPath: candidate.path, isDirectory: &isDirectory), !isDirectory.boolValue {
        return candidate
      }
    }
    if let index = parts.lastIndex(of: "template-assets"), index + 1 < parts.count {
      let stem = (parts[index + 1] as NSString).deletingPathExtension
      let folder = root.appendingPathComponent("template-assets")
      let names = (try? manager.contentsOfDirectory(atPath: folder.path)) ?? []
      if let name = names.first(where: { ($0 as NSString).deletingPathExtension == stem }) {
        return folder.appendingPathComponent(name)
      }
      return nil
    }
    if parts.last.map({ ($0 as NSString).pathExtension.isEmpty }) ?? true {
      return root.appendingPathComponent("index.html")
    }
    return nil
  }
}
