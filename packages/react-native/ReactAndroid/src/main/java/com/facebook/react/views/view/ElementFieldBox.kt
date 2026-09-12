/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import android.view.View
import com.facebook.react.bridge.Dynamic
import com.facebook.react.uimanager.BackgroundStyleApplicator
import com.facebook.react.uimanager.LengthPercentage
import com.facebook.react.uimanager.style.BorderRadiusProp
import com.facebook.react.uimanager.style.LogicalEdge

/**
 * A field's own box: its border and its corners.
 *
 * `ReactViewManager` declares these props for plain views and `BaseViewManager` carries only the
 * background colour, so nothing declared them for `<input>` and `<textarea>`. Their borders and
 * radii reached the shadow node, where they laid the field out, and never reached the view, where
 * they would be drawn — an author could neither give a field a box of its own nor take the
 * platform's away. A composer styled as a filled, rounded pill still wore the Material underline,
 * and the rule that stands that chrome down for an author's box never saw one.
 *
 * The work is the same as every other box's, so it goes through the same applicator; this exists
 * only because a `@ReactProp` has to be declared on each manager and the two field managers are
 * siblings rather than one class.
 */
internal object ElementFieldBox {

  fun setBorderWidth(view: View, index: Int, width: Float) {
    BackgroundStyleApplicator.setBorderWidth(view, LogicalEdge.values()[index], width)
  }

  fun setBorderRadius(view: View, index: Int, radius: Dynamic) {
    BackgroundStyleApplicator.setBorderRadius(
        view,
        BorderRadiusProp.values()[index],
        LengthPercentage.setFromDynamic(radius),
    )
  }

  fun setBorderColor(view: View, index: Int, color: Int?) {
    BackgroundStyleApplicator.setBorderColor(view, LogicalEdge.values()[index], color)
  }
}
