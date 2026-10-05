/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import android.content.Context
import android.view.Gravity
import android.view.MotionEvent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event

/**
 * `<textarea>` on Android: the same [EditText][android.widget.EditText] as `<input>`, told to be
 * multi-line.
 *
 * Unlike iOS, where single-line and multi-line text are two unrelated classes, Android has one
 * widget for both, so this reuses [ElementTextInputView] rather than duplicating the text handling,
 * the controlled-value handshake, and the read-only filter. What differs is the configuration:
 * newlines are accepted, text starts at the top rather than centred vertically, and there is no IME
 * action to submit with, because Return has to insert a newline.
 */
internal class ElementTextAreaView(context: Context) : ElementTextInputView(context) {

  override val isMultiline: Boolean
    get() = true

  init {
    // Multi-line text starts at the top of its box. Without this it is centred, which looks like a
    // rendering mistake in a tall textarea.
    gravity = Gravity.TOP or Gravity.START
  }

  /**
   * A textarea scrolls its own content, so a drag inside one belongs to it once there is more text
   * than fits — otherwise an ancestor scroll container carries the page away and the rest of what
   * the user wrote is unreachable. When the text does fit, the gesture is the page's.
   */
  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (event.actionMasked == MotionEvent.ACTION_DOWN && canScrollVertically(1).or(canScrollVertically(-1))) {
      parent?.requestDisallowInterceptTouchEvent(true)
    }
    return super.onTouchEvent(event)
  }
}

@ReactModule(name = ElementTextAreaViewManager.REACT_CLASS)
internal class ElementTextAreaViewManager : SimpleViewManager<ElementTextAreaView>() {

  public companion object {
    public const val REACT_CLASS: String = "element-textarea"
  }

  override fun getName(): String = REACT_CLASS

  override fun createViewInstance(context: ThemedReactContext): ElementTextAreaView {
    val view = ElementTextAreaView(context)

    fun dispatch(event: Event<*>) {
      UIManagerHelper.getEventDispatcher(context)?.dispatchEvent(event)
    }

    view.onTextInput = { text, count ->
      dispatch(ElementTextAreaInputEvent(UIManagerHelper.getSurfaceId(view), view.id, text, count))
    }
    view.onTextChangeCommitted = { text ->
      dispatch(ElementTextAreaChangeEvent(UIManagerHelper.getSurfaceId(view), view.id, text))
    }
    view.onFocusGained = {
      dispatch(ElementTextAreaSimpleEvent(UIManagerHelper.getSurfaceId(view), view.id, "topElementFocus"))
    }
    view.onFocusLost = {
      dispatch(ElementTextAreaSimpleEvent(UIManagerHelper.getSurfaceId(view), view.id, "topElementBlur"))
    }
    return view
  }

  override fun onAfterUpdateTransaction(view: ElementTextAreaView) {
    super.onAfterUpdateTransaction(view)
    view.commitProps()
  }

  @ReactProp(name = "value")
  public fun setValue(view: ElementTextAreaView, value: String?) {
    view.propValue = value
  }

  @ReactProp(name = "defaultValue")
  public fun setDefaultValue(view: ElementTextAreaView, defaultValue: String?) {
    view.propDefaultValue = defaultValue.orEmpty()
  }

  @ReactProp(name = "mostRecentEventCount", defaultInt = 0)
  public fun setMostRecentEventCount(view: ElementTextAreaView, count: Int) {
    view.propMostRecentEventCount = count
  }

  @ReactProp(name = "placeholder")
  public fun setPlaceholder(view: ElementTextAreaView, placeholder: String?) {
    view.hint = placeholder
  }

  @ReactProp(name = "spellCheck")
  public fun setSpellCheck(view: ElementTextAreaView, spellCheck: Boolean) {
    view.propSpellCheck = spellCheck
  }

  @ReactProp(name = "autoCorrect", defaultBoolean = true)
  public fun setAutoCorrect(view: ElementTextAreaView, autoCorrect: Boolean) {
    view.propAutoCorrect = autoCorrect
  }

  /** HTML's height in lines. Both bounds are set so the box neither collapses nor grows past it. */
  @ReactProp(name = "rows", defaultInt = 2)
  public fun setRows(view: ElementTextAreaView, rows: Int) {
    view.setLines(rows.coerceAtLeast(1))
  }

  @ReactProp(name = "disabled")
  public fun setDisabled(view: ElementTextAreaView, disabled: Boolean) {
    view.isEnabled = !disabled
    view.isFocusable = !disabled
    view.isFocusableInTouchMode = !disabled
    if (disabled && view.hasFocus()) {
      view.clearFocus()
    }
  }

  @ReactProp(name = "readOnly")
  public fun setReadOnly(view: ElementTextAreaView, readOnly: Boolean) {
    view.setReadOnly(readOnly)
  }

  @ReactProp(name = "maxLength", defaultInt = -1)
  public fun setMaxLength(view: ElementTextAreaView, maxLength: Int) {
    view.setMaxLength(maxLength)
  }

  @ReactProp(name = "autoFocus")
  public fun setAutoFocus(view: ElementTextAreaView, autoFocus: Boolean) {
    if (autoFocus) {
      view.requestFocus()
    }
  }

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any>? {
    val export = super.getExportedCustomDirectEventTypeConstants() ?: mutableMapOf()
    export["topElementInput"] = mapOf("registrationName" to "onInput")
    export["topElementChange"] = mapOf("registrationName" to "onChange")
    export["topElementFocus"] = mapOf("registrationName" to "onFocus")
    export["topElementBlur"] = mapOf("registrationName" to "onBlur")
    return export
  }
}

private class ElementTextAreaInputEvent(
    surfaceId: Int,
    viewTag: Int,
    private val text: String,
    private val eventCount: Int
) : Event<ElementTextAreaInputEvent>(surfaceId, viewTag) {
  override fun getEventName(): String = "topElementInput"

  override fun canCoalesce(): Boolean = false

  override fun getEventData(): WritableMap =
      Arguments.createMap().apply {
        putString("value", text)
        putInt("eventCount", eventCount)
      }
}

private class ElementTextAreaChangeEvent(surfaceId: Int, viewTag: Int, private val text: String) :
    Event<ElementTextAreaChangeEvent>(surfaceId, viewTag) {
  override fun getEventName(): String = "topElementChange"

  override fun canCoalesce(): Boolean = false

  override fun getEventData(): WritableMap =
      Arguments.createMap().apply { putString("value", text) }
}

private class ElementTextAreaSimpleEvent(surfaceId: Int, viewTag: Int, private val name: String) :
    Event<ElementTextAreaSimpleEvent>(surfaceId, viewTag) {
  override fun getEventName(): String = name

  override fun canCoalesce(): Boolean = false

  override fun getEventData(): WritableMap = Arguments.createMap()
}
