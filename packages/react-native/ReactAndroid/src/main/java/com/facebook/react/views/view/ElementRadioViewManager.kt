/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import android.content.Context
import android.widget.RadioButton
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event

/**
 * `<input type="radio">` on Android, backed by a real [RadioButton].
 *
 * Android has the control, so the element uses it. iOS does not have one at all and draws its own —
 * see `ElementRadioShadowNode.h`. This is the same reasoning that gives `<input type="checkbox">` a
 * `CheckBox` here and a `UISwitch` there.
 *
 * The exclusivity is deliberately not enforced. `RadioButton` normally gets it from being inside a
 * `RadioGroup`, but HTML's radios are separate elements tied together only by a shared `name`, and
 * they need not be siblings — so there is no group to put them in. The DOM leaves that to the form,
 * and so does this.
 */
internal class ElementRadioView(context: Context) : RadioButton(context) {

  /** Called when the user chooses this radio — never when a prop writes the state. */
  var onChoose: (() -> Unit)? = null

  private var isApplyingProps = false

  init {
    setOnCheckedChangeListener { _, checked ->
      if (!isApplyingProps && checked) {
        onChoose?.invoke()
      }
    }
  }

  fun setCheckedFromProps(checked: Boolean) {
    if (isChecked == checked) {
      return
    }
    isApplyingProps = true
    isChecked = checked
    isApplyingProps = false
  }

  /**
   * A radio cannot be turned off by tapping it, only by another in its group being chosen — HTML's
   * rule, and the platform's too. Without this, tapping the chosen radio would clear it, because
   * `CompoundButton.toggle` flips unconditionally.
   */
  override fun toggle() {
    if (!isChecked) {
      super.toggle()
    }
  }
}

@ReactModule(name = ElementRadioViewManager.REACT_CLASS)
internal class ElementRadioViewManager : SimpleViewManager<ElementRadioView>() {

  public companion object {
    public const val REACT_CLASS: String = "element-radio"
  }

  override fun getName(): String = REACT_CLASS

  override fun createViewInstance(context: ThemedReactContext): ElementRadioView {
    val view = ElementRadioView(context)
    view.onChoose = {
      UIManagerHelper.getEventDispatcher(context)
          ?.dispatchEvent(ElementRadioChangeEvent(UIManagerHelper.getSurfaceId(view), view.id))
    }
    return view
  }

  @ReactProp(name = "checked")
  public fun setChecked(view: ElementRadioView, checked: Boolean) {
    view.setCheckedFromProps(checked)
  }

  @ReactProp(name = "disabled")
  public fun setDisabled(view: ElementRadioView, disabled: Boolean) {
    view.isEnabled = !disabled
  }

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any>? {
    val export = super.getExportedCustomDirectEventTypeConstants() ?: mutableMapOf()
    export["topElementChange"] = mapOf("registrationName" to "onChange")
    return export
  }
}

private class ElementRadioChangeEvent(surfaceId: Int, viewTag: Int) :
    Event<ElementRadioChangeEvent>(surfaceId, viewTag) {

  override fun getEventName(): String = "topElementChange"

  override fun canCoalesce(): Boolean = false

  /** Always true: a radio reports being chosen, and never reports being un-chosen by a tap. */
  override fun getEventData(): WritableMap =
      Arguments.createMap().apply { putBoolean("checked", true) }
}
