// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

import ExpoModulesCore

/// `TemplateWeb`: a web view showing the web version of one Astryx template,
/// from the copy of Astryx's template viewer bundled into the app (`web/`).
public final class TemplateWebModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TemplateWeb")

    View(TemplateWebView.self) {
      // The template's directory under the viewer's `pages/`, which is the
      // app's slug for it
      Prop("slug") { (view, slug: String) in
        view.load(slug: slug)
      }
    }
  }
}
