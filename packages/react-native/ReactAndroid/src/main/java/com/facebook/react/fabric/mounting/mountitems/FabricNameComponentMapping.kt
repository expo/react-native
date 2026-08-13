/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.fabric.mounting.mountitems

/** Utility class for Fabric components, this will be removed */
internal object FabricNameComponentMapping {
  private val componentNames: Map<String, String> = mapOf(
      // TODO T97384889: unify component names between JS - Android - iOS - C++
      "View" to "RCTView",
      "Image" to "RCTImageView",
      // Intrinsic DOM elements (expo-intrinsics). <div> is a block View.
      // DOM-CSS-LIMITATION(android-img-is-a-plain-view): <img> mounts as a
      // plain View on Android rather than RCTImageView, which expects a
      // different `source` shape — so an <img> lays out but draws nothing
      // there. iOS renders it through the Image machinery.
      // <div> is an ordinary block element now, backed by the generic box.
      // The box-backed flavor an element is swapped onto when its display
      // generates a box (ElementBoxShadowNode.h). A plain view: everything
      // that distinguishes it is layout, not drawing.
      "element-box" to "RCTView",
      "img" to "RCTView",
      // The inline text intrinsics. Their content is absorbed into the
      // container's text runs and the mounted view draws nothing — but Android
      // still needs one, because `TextShadowNode` sets `FormsView` under
      // `#ifdef ANDROID` and every intrinsic is a `TextShadowNode` subclass, so
      // they are preallocated exactly like a nested <Text>. Without a mapping
      // that preallocation throws "Can't find ViewManager 'b'" and the whole
      // surface red-boxes. They therefore map where "Text" maps.
      //
      // This list is closed even though any lowercase tag is valid JSX: every
      // unregistered tag resolves to the single "unknown" component (see
      // the element catalog), which is why one entry covers all of them.
      "inline-text" to "RCTText",
      "ScrollView" to "RCTScrollView",
      "Slider" to "RCTSlider",
      "ModalHostView" to "RCTModalHostView",
      "Paragraph" to "RCTText",
      "SelectableParagraph" to "RCTSelectableText",
      "Text" to "RCTText",
      "ActivityIndicatorView" to "AndroidProgressBar",
      "ShimmeringView" to "RKShimmeringView",
      "TemplateView" to "RCTTemplateView",
      "AxialGradientView" to "RCTAxialGradientView",
      "Video" to "RCTVideo",
      "Map" to "RCTMap",
      "WebView" to "RCTWebView",
      "Keyframes" to "RCTKeyframes",
      "ImpressionTrackingView" to "RCTImpressionTrackingView",
  )

  /** @return the name of component in the Fabric environment */
  @JvmStatic
  fun getFabricComponentName(componentName: String): String {
    return componentNames[componentName] ?: componentName
  }
}
