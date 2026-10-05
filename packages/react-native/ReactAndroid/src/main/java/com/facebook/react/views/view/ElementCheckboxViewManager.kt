/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import android.content.Context
import android.widget.CheckBox
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event

/**
 * The view backing `<input type="checkbox">` on Android: a real [CheckBox].
 *
 * Android has a checkbox, so the element uses it. iOS does not, and uses a `UISwitch` there. Both
 * are correct for their platform, and picking one to impose on the other is how cross-platform UI
 * starts to feel imported.
 */
internal class ElementCheckboxView(context: Context) : CheckBox(context) {

  /** Called when the user toggles it — never when a prop writes the state. */
  var onToggle: ((Boolean) -> Unit)? = null

  private var isApplyingProps = false

  init {
    setOnCheckedChangeListener { _, checked ->
      if (!isApplyingProps) {
        onToggle?.invoke(checked)
      }
    }
  }

  /** Applies the checked state without reporting it back as user input. */
  fun setCheckedFromProps(checked: Boolean) {
    if (isChecked == checked) {
      return
    }
    isApplyingProps = true
    isChecked = checked
    isApplyingProps = false
  }
}

@ReactModule(name = ElementCheckboxViewManager.REACT_CLASS)
internal class ElementCheckboxViewManager : SimpleViewManager<ElementCheckboxView>() {

  public companion object {
    public const val REACT_CLASS: String = "element-checkbox"
  }

  override fun getName(): String = REACT_CLASS

  override fun createViewInstance(context: ThemedReactContext): ElementCheckboxView {
    val view = ElementCheckboxView(context)
    view.onToggle = { checked ->
      val surfaceId = UIManagerHelper.getSurfaceId(view)
      UIManagerHelper.getEventDispatcher(context)
          ?.dispatchEvent(ElementCheckboxEvent(surfaceId, view.id, checked))
    }
    return view
  }

  @ReactProp(name = "checked")
  public fun setChecked(view: ElementCheckboxView, checked: Boolean) {
    view.setCheckedFromProps(checked)
  }

  @ReactProp(name = "disabled")
  public fun setDisabled(view: ElementCheckboxView, disabled: Boolean) {
    view.isEnabled = !disabled
  }

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any>? {
    val export = super.getExportedCustomDirectEventTypeConstants() ?: mutableMapOf()
    export["topElementChange"] = mapOf("registrationName" to "onChange")
    return export
  }
}

private class ElementCheckboxEvent(surfaceId: Int, viewTag: Int, private val checked: Boolean) :
    Event<ElementCheckboxEvent>(surfaceId, viewTag) {

  override fun getEventName(): String = "topElementChange"

  /** A toggle is a state change, not a stream: coalescing would drop one of two rapid taps. */
  override fun canCoalesce(): Boolean = false

  override fun getEventData(): WritableMap =
      Arguments.createMap().apply { putBoolean("checked", checked) }
}
