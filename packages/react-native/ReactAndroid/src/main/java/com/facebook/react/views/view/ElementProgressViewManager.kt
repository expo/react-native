/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import android.content.Context
import android.widget.ProgressBar
import com.facebook.react.bridge.Dynamic
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

/**
 * `<progress>` and `<meter>` on Android, backed by a real horizontal [ProgressBar].
 *
 * One view for both elements, for the same reason as on iOS: they differ in what they mean, not in
 * what the platform draws. `min` matters only to `<meter>` — a `<progress>` is defined from zero.
 *
 * `ProgressBar` counts in integers, so the 0–1 fraction the element computes is scaled onto a fixed
 * resolution here. A thousand steps is far finer than a bar a few hundred pixels wide can show, so
 * nothing visible is lost to rounding.
 */
internal class ElementProgressView(context: Context) :
    ProgressBar(context, null, android.R.attr.progressBarStyleHorizontal) {

  public companion object {
    /** Integer steps the 0–1 fraction is mapped onto. */
    public const val RESOLUTION: Int = 1000
  }

  /* Staged as props arrive and applied together in [commitProps]; see there for why. */
  var propValue: Double = 0.0
  var propHasValue: Boolean = false
  var propMinimum: Double = 0.0
  var propMaximum: Double = 1.0

  init {
    max = RESOLUTION
  }

  /**
   * Applied as a set once React has finished this update, because indeterminacy, the range and the
   * value are only meaningful together — a `value` arriving before its `max` would briefly show a
   * bar at the wrong fraction.
   */
  fun commitProps() {
    // An absent `value` on a `<progress>` means indeterminate: a task running with no known end,
    // which the platform draws as its own animation rather than as a bar sitting at zero.
    isIndeterminate = !propHasValue
    if (propHasValue) {
      val span = propMaximum - propMinimum
      val fraction = if (span <= 0.0) 0.0 else ((propValue - propMinimum) / span).coerceIn(0.0, 1.0)
      progress = (fraction * RESOLUTION).toInt()
    }
  }
}

@ReactModule(name = ElementProgressViewManager.REACT_CLASS)
internal class ElementProgressViewManager : SimpleViewManager<ElementProgressView>() {

  public companion object {
    public const val REACT_CLASS: String = "element-progress"
  }

  override fun getName(): String = REACT_CLASS

  override fun createViewInstance(context: ThemedReactContext): ElementProgressView =
      ElementProgressView(context)

  override fun onAfterUpdateTransaction(view: ElementProgressView) {
    super.onAfterUpdateTransaction(view)
    view.commitProps()
  }

  /**
   * Taken as [Dynamic] rather than a number because the *absence* of a value is the meaningful
   * case: a `<progress>` with no `value` is indeterminate. A nullable `Double` cannot express that
   * here — React Native's prop setters reject `java.lang.Double` outright, which is how this was
   * found, as a hard crash the first time an indeterminate `<progress>` mounted.
   */
  @ReactProp(name = "value")
  public fun setValue(view: ElementProgressView, value: Dynamic) {
    val hasValue = !value.isNull
    view.propHasValue = hasValue
    view.propValue = if (hasValue) value.asDouble() else 0.0
  }

  @ReactProp(name = "min", defaultDouble = 0.0)
  public fun setMin(view: ElementProgressView, min: Double) {
    view.propMinimum = min
  }

  @ReactProp(name = "max", defaultDouble = 1.0)
  public fun setMax(view: ElementProgressView, max: Double) {
    view.propMaximum = max
  }

  @ReactProp(name = "disabled")
  public fun setDisabled(view: ElementProgressView, disabled: Boolean) {
    view.isEnabled = !disabled
  }
}
