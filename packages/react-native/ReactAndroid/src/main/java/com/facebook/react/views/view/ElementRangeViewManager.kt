/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import android.widget.SeekBar
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event

/**
 * View manager for `element-range`, the backing of `<input type="range">`.
 *
 * The props are HTML's, not the platform's: `min`, `max`, `step` and `value` as doubles. The
 * translation to `SeekBar`'s integer steps lives in [ElementRangeView], so that this stays a
 * straight mapping of the element's attribute surface.
 */
@ReactModule(name = ElementRangeViewManager.REACT_CLASS)
internal class ElementRangeViewManager : SimpleViewManager<ElementRangeView>() {

  public companion object {
    public const val REACT_CLASS: String = "element-range"
  }

  override fun getName(): String = REACT_CLASS

  override fun createViewInstance(context: ThemedReactContext): ElementRangeView {
    val view = ElementRangeView(context)
    view.onValueInput = { value -> emit(context, view, "topElementInput", value) }
    view.onValueChange = { value -> emit(context, view, "topElementChange", value) }
    return view
  }

  private fun emit(context: ThemedReactContext, view: SeekBar, name: String, value: Double) {
    val surfaceId = UIManagerHelper.getSurfaceId(view)
    UIManagerHelper.getEventDispatcher(context)
        ?.dispatchEvent(ElementRangeEvent(surfaceId, view.id, name, value))
  }

  // `min`, `max` and `step` are applied together with `value` because they are coupled: `SeekBar`
  // rescales its progress when its maximum changes, so applying them independently moves the thumb
  // depending on prop order. Each setter re-applies the whole range from the current props.
  @ReactProp(name = "min", defaultDouble = 0.0)
  public fun setMin(view: ElementRangeView, min: Double) {
    pending(view).min = min
    flush(view)
  }

  @ReactProp(name = "max", defaultDouble = 100.0)
  public fun setMax(view: ElementRangeView, max: Double) {
    pending(view).max = max
    flush(view)
  }

  @ReactProp(name = "step", defaultDouble = 1.0)
  public fun setStep(view: ElementRangeView, step: Double) {
    pending(view).step = step
    flush(view)
  }

  @ReactProp(name = "value", defaultDouble = 50.0)
  public fun setValue(view: ElementRangeView, value: Double) {
    pending(view).value = value
    flush(view)
  }

  @ReactProp(name = "disabled")
  public fun setDisabled(view: ElementRangeView, disabled: Boolean) {
    view.isEnabled = !disabled
  }

  private class Pending {
    var min: Double = 0.0
    var max: Double = 100.0
    var step: Double = 1.0
    var value: Double = 50.0
  }

  private val pendingByView = HashMap<Int, Pending>()

  private fun pending(view: ElementRangeView): Pending =
      pendingByView.getOrPut(System.identityHashCode(view)) { Pending() }

  private fun flush(view: ElementRangeView) {
    val p = pending(view)
    view.setRange(p.min, p.max, p.step, p.value)
  }

  override fun onDropViewInstance(view: ElementRangeView) {
    pendingByView.remove(System.identityHashCode(view))
    super.onDropViewInstance(view)
  }

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any>? {
    val export = super.getExportedCustomDirectEventTypeConstants() ?: mutableMapOf()
    export["topElementInput"] = mapOf("registrationName" to "onInput")
    export["topElementChange"] = mapOf("registrationName" to "onChange")
    return export
  }
}

private class ElementRangeEvent(
    surfaceId: Int,
    viewTag: Int,
    private val name: String,
    private val value: Double
) : Event<ElementRangeEvent>(surfaceId, viewTag) {

  override fun getEventName(): String = name

  /**
   * `input` fires for every intermediate value of a scrub, and coalescing would collapse a drag into
   * its last frame — the same trap that silently swallowed press transitions on the button.
   */
  override fun canCoalesce(): Boolean = false

  override fun getEventData(): WritableMap =
      Arguments.createMap().apply { putDouble("value", value) }
}
