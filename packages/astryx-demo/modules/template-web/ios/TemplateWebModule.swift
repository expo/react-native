// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

import ExpoModulesCore
import UIKit

/// Show a template from the bundled Astryx web viewer (`web/`).
public final class TemplateWebModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TemplateWeb")

    View(TemplateWebView.self) {
      // Use the app's slug as the directory under the viewer's `pages/`.
      Prop("slug") { (view, slug: String) in
        view.load(slug: slug)
      }
    }
    View(SplitPolicyView.self) {
      ViewName("SplitPolicy")
      Events("onModeChange")
      AsyncFunction("toggleSidebar") { (view: SplitPolicyView) in
        view.toggleSidebar()
      }
    }
  }
}

/// Presentation policy only: UISplitViewController owns layout and transitions.
final class SplitPolicyView: ExpoView {
  let onModeChange = EventDispatcher()
  private var lastPresentation: [CGFloat]?
  private weak var splitController: UISplitViewController?
  private var sidebarPreference = UserDefaults.standard.object(forKey: "AstryxSidebarPreferred") as? Bool

  func toggleSidebar() {
    guard let splitController, !splitController.isCollapsed else { return }
    let show = splitController.displayMode == .secondaryOnly
    sidebarPreference = show
    UserDefaults.standard.set(show, forKey: "AstryxSidebarPreferred")
    // These native commands own the animation. Setting preferredDisplayMode
    // first would install its final layout before show/hide can animate it.
    if show { splitController.show(.primary) } else { splitController.hide(.primary) }
    setNeedsLayout()
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isAccessibilityElement = false
    if #available(iOS 27.1, *) {
      addInteraction(
        UIHingeInteraction { [weak self] _, _ in
          self?.setNeedsLayout()
        })
    }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    lastPresentation = nil
    setNeedsLayout()
  }

  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    setNeedsLayout()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    updatePresentation()
  }

  private func updatePresentation() {
    guard window != nil else { return }
    var responder: UIResponder? = self
    var split: UISplitViewController?
    while let current = responder {
      if let controller = current as? UIViewController {
        split = controller.splitViewController
        if split != nil { break }
      }
      responder = current.next
    }
    guard let split else { return }
    if splitController !== split {
      splitController = split
      // Seed the saved choice once. UIKit owns subsequent fold, rotation and
      // size-class transitions; a hinge update must not start another one.
      split.preferredSplitBehavior = .automatic
      split.preferredDisplayMode = sidebarPreference == true ? .automatic : .secondaryOnly
    }
    // Each column already contains its own navigation UI (the detail stack and
    // the catalog heading). Hide only the split's wrapping navigation bars.
    for column: UISplitViewController.Column in [.primary, .secondary] {
      if let navigation = split.viewController(for: column) as? UINavigationController,
        !navigation.isNavigationBarHidden
      {
        navigation.setNavigationBarHidden(true, animated: false)
      }
    }
    var division = CGRect.zero
    if #available(iOS 27.1, *) {
      let regions = split.view.reservedRegions(kind: .division)
      if let region = regions.first(where: { $0.frame.height > $0.frame.width }) {
        division = split.view.convert(region.frame, to: nil)
      }
    }
    let actual = split.displayMode
    let regularWidth = split.traitCollection.horizontalSizeClass == .regular
    let canToggle = !split.isCollapsed
    let sidebarShown = actual != .secondaryOnly && !split.isCollapsed
    // Only the gallery consumes division geometry. A full-width demo decides
    // for itself whether and how its content responds to a fold.
    let galleryFold = !sidebarShown && division.height > 0
    // Reported only while the gallery lays out around it. Otherwise a fold
    // moves a hinge nothing reads, and would hold up the frame for JavaScript.
    let galleryDivision = galleryFold ? division : .zero
    let presentation: [CGFloat] = [
      regularWidth ? 1 : 0, canToggle ? 1 : 0,
      sidebarShown ? 1 : 0, galleryFold ? 1 : 0,
      galleryDivision.minX, galleryDivision.width,
    ]
    if lastPresentation != presentation {
      // A fold, an unfold or a sidebar change lays the split out inside UIKit's
      // animation. JavaScript answers before this layout pass returns, so the
      // gallery's tracks mount inside the animation too rather than snapping a
      // frame later. The first presentation, and a change UIKit does not
      // animate, need not hold the main thread for JavaScript.
      let animated = lastPresentation != nil && UIView.inheritedAnimationDuration > 0
      lastPresentation = presentation
      let mode: [String: Any] = [
        "horizontalSizeClass": regularWidth ? "regular" : "compact",
        "canToggleSidebar": canToggle,
        "sidebarShown": sidebarShown,
        "galleryFold": galleryFold,
        "divisionStart": galleryDivision.minX,
        "divisionWidth": galleryDivision.width,
      ]
      if animated && dispatchEventNow("onModeChange", payload: mode) {
        return
      }
      DispatchQueue.main.async { [weak self] in
        self?.onModeChange(mode)
      }
    }
  }
}
