/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import com.facebook.react.bridge.ReadableArray
import android.view.inputmethod.InputMethodManager
import android.content.Context
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.bridge.Dynamic
import com.facebook.react.uimanager.ViewProps
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.annotations.ReactPropGroup
import com.facebook.react.uimanager.events.Event

@ReactModule(name = ElementTextInputViewManager.REACT_CLASS)
internal class ElementTextInputViewManager : SimpleViewManager<ElementTextInputView>() {

  public companion object {
    public const val REACT_CLASS: String = "element-text-input"
  }

  override fun getName(): String = REACT_CLASS

  override fun createViewInstance(context: ThemedReactContext): ElementTextInputView {
    val view = ElementTextInputView(context)

    fun dispatch(event: Event<*>) {
      UIManagerHelper.getEventDispatcher(context)?.dispatchEvent(event)
    }

    view.onTextInput = { text, count ->
      dispatch(ElementTextInputEvent(UIManagerHelper.getSurfaceId(view), view.id, text, count))
    }
    view.onTextChangeCommitted = { text ->
      dispatch(ElementTextChangeEvent(UIManagerHelper.getSurfaceId(view), view.id, text))
    }
    view.onFocusGained = {
      dispatch(ElementTextSimpleEvent(UIManagerHelper.getSurfaceId(view), view.id, "topElementFocus"))
    }
    view.onFocusLost = {
      dispatch(ElementTextSimpleEvent(UIManagerHelper.getSurfaceId(view), view.id, "topElementBlur"))
    }
    view.onSubmit = { text ->
      dispatch(ElementTextSubmitEvent(UIManagerHelper.getSurfaceId(view), view.id, text))
    }
    view.onSelectionUpdate = { start, end ->
      dispatch(ElementTextSelectionEvent(UIManagerHelper.getSurfaceId(view), view.id, start, end))
    }
    return view
  }

  /**
   * Fabric delivers the Yoga-computed padding of a LEAF view here, and the base ViewManager DROPS
   * it — which is how the user-agent sheet's Material 16dp field inset (`FIELD_SURFACE.paddingInline`
   * in uaStyles.js) never reached the EditText: the field rendered with the platform drawable's
   * ~4dp and the placeholder sat nearly on the edge. Forwarding is the same contract the
   * framework's own `ReactTextInputManager.setPadding` implements.
   */
  override fun setPadding(view: ElementTextInputView, left: Int, top: Int, right: Int, bottom: Int) {
    view.setPadding(left, top, right, bottom)
  }

  /**
   * The props are staged as they arrive and applied here, after React has set all of them for this
   * update. Several are only meaningful together — see [ElementTextInputView.commitProps] — and
   * applying each as it lands would let the order React happens to use decide the result.
   */
  override fun onAfterUpdateTransaction(view: ElementTextInputView) {
    super.onAfterUpdateTransaction(view)
    view.commitProps()
  }

  /** The box props, which a field does not otherwise get — see [ElementFieldBox]. */
  @ReactPropGroup(
      names =
          [
              ViewProps.BORDER_WIDTH,
              ViewProps.BORDER_LEFT_WIDTH,
              ViewProps.BORDER_RIGHT_WIDTH,
              ViewProps.BORDER_TOP_WIDTH,
              ViewProps.BORDER_BOTTOM_WIDTH,
              ViewProps.BORDER_START_WIDTH,
              ViewProps.BORDER_END_WIDTH,
          ],
      defaultFloat = Float.NaN,
  )
  public open fun setBorderWidth(view: ElementTextInputView, index: Int, width: Float) {
    ElementFieldBox.setBorderWidth(view, index, width)
  }

  @ReactPropGroup(
      names =
          [
              ViewProps.BORDER_RADIUS,
              ViewProps.BORDER_TOP_LEFT_RADIUS,
              ViewProps.BORDER_TOP_RIGHT_RADIUS,
              ViewProps.BORDER_BOTTOM_RIGHT_RADIUS,
              ViewProps.BORDER_BOTTOM_LEFT_RADIUS,
          ]
  )
  public open fun setBorderRadius(view: ElementTextInputView, index: Int, radius: Dynamic) {
    ElementFieldBox.setBorderRadius(view, index, radius)
  }

  @ReactPropGroup(
      names =
          [
              ViewProps.BORDER_COLOR,
              ViewProps.BORDER_LEFT_COLOR,
              ViewProps.BORDER_RIGHT_COLOR,
              ViewProps.BORDER_TOP_COLOR,
              ViewProps.BORDER_BOTTOM_COLOR,
          ],
      customType = "Color",
  )
  public open fun setBorderColor(view: ElementTextInputView, index: Int, color: Int?) {
    ElementFieldBox.setBorderColor(view, index, color)
  }

  @ReactProp(name = "type")
  public fun setType(view: ElementTextInputView, type: String?) {
    view.propType = type ?: "text"
  }

  @ReactProp(name = "inputMode")
  public fun setInputMode(view: ElementTextInputView, inputMode: String?) {
    view.propInputMode = inputMode.orEmpty()
  }

  @ReactProp(name = "spellCheck")
  public fun setSpellCheck(view: ElementTextInputView, spellCheck: Boolean) {
    view.propSpellCheck = spellCheck
  }

  @ReactProp(name = "autoCorrect", defaultBoolean = true)
  public fun setAutoCorrect(view: ElementTextInputView, autoCorrect: Boolean) {
    view.propAutoCorrect = autoCorrect
  }

  @ReactProp(name = "enterKeyHint")
  public fun setEnterKeyHint(view: ElementTextInputView, hint: String?) {
    view.propEnterKeyHint = hint.orEmpty()
  }

  @ReactProp(name = "value")
  public fun setValue(view: ElementTextInputView, value: String?) {
    view.propValue = value
  }

  @ReactProp(name = "defaultValue")
  public fun setDefaultValue(view: ElementTextInputView, defaultValue: String?) {
    view.propDefaultValue = defaultValue.orEmpty()
  }

  @ReactProp(name = "mostRecentEventCount", defaultInt = 0)
  public fun setMostRecentEventCount(view: ElementTextInputView, count: Int) {
    view.propMostRecentEventCount = count
  }

  @ReactProp(name = "hasBeforeInput")
  public fun setHasBeforeInput(view: ElementTextInputView, hasBeforeInput: Boolean) {
    view.propHasBeforeInput = hasBeforeInput
  }

  @ReactProp(name = "placeholder")
  public fun setPlaceholder(view: ElementTextInputView, placeholder: String?) {
    view.hint = placeholder
  }

  @ReactProp(name = "disabled")
  public fun setDisabled(view: ElementTextInputView, disabled: Boolean) {
    view.isEnabled = !disabled
    // A disabled control is not an event target at all, and must not keep the keyboard up if it is
    // disabled while being edited.
    view.isFocusable = !disabled
    view.isFocusableInTouchMode = !disabled
    if (disabled && view.hasFocus()) {
      view.clearFocus()
    }
  }

  @ReactProp(name = "readOnly")
  public fun setReadOnly(view: ElementTextInputView, readOnly: Boolean) {
    view.setReadOnly(readOnly)
  }

  @ReactProp(name = "maxLength", defaultInt = -1)
  public fun setMaxLength(view: ElementTextInputView, maxLength: Int) {
    view.setMaxLength(maxLength)
  }

  @ReactProp(name = "autoFocus")
  public fun setAutoFocus(view: ElementTextInputView, autoFocus: Boolean) {
    if (autoFocus) {
      view.requestFocus()
    }
  }


  /**
   * `focus()` and `blur()`, the pair the DOM has and this element did not.
   *
   * `autoFocus` covered only the element that knows at mount that it wants the
   * keyboard. Nothing covered the ordinary case — a button that focuses a field,
   * a form moving to the next invalid input — so nothing could focus one of
   * these at all.
   *
   * `showSoftInput` as well as `requestFocus`: focus alone moves the cursor
   * without necessarily bringing the keyboard, which is not what a caller asking
   * for focus means.
   */
  override fun receiveCommand(view: ElementTextInputView, commandId: String, args: ReadableArray?) {
    when (commandId) {
      "focus" -> {
        view.requestFocus()
        val imm =
            view.context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
        imm?.showSoftInput(view, 0)
      }
      "blur" -> {
        view.clearFocus()
        val imm =
            view.context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
        imm?.hideSoftInputFromWindow(view.windowToken, 0)
      }
      else -> super.receiveCommand(view, commandId, args)
    }
  }

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any>? {
    val export = super.getExportedCustomDirectEventTypeConstants() ?: mutableMapOf()
    export["topElementBeforeInput"] = mapOf("registrationName" to "onBeforeInput")
    export["topElementInput"] = mapOf("registrationName" to "onInput")
    export["topElementChange"] = mapOf("registrationName" to "onChange")
    export["topElementFocus"] = mapOf("registrationName" to "onFocus")
    export["topElementBlur"] = mapOf("registrationName" to "onBlur")
    export["topElementSubmit"] = mapOf("registrationName" to "onSubmit")
    export["topElementSelectionChange"] = mapOf("registrationName" to "onSelect")
    return export
  }
}

/**
 * None of these coalesce. Text events are a sequence of distinct edits, and dropping one loses a
 * keystroke — the opposite of a scroll offset, where only the latest matters.
 */
private class ElementTextInputEvent(
    surfaceId: Int,
    viewTag: Int,
    private val text: String,
    private val eventCount: Int
) : Event<ElementTextInputEvent>(surfaceId, viewTag) {
  override fun getEventName(): String = "topElementInput"

  override fun canCoalesce(): Boolean = false

  override fun getEventData(): WritableMap =
      Arguments.createMap().apply {
        putString("value", text)
        putInt("eventCount", eventCount)
      }
}

private class ElementTextChangeEvent(surfaceId: Int, viewTag: Int, private val text: String) :
    Event<ElementTextChangeEvent>(surfaceId, viewTag) {
  override fun getEventName(): String = "topElementChange"

  override fun canCoalesce(): Boolean = false

  override fun getEventData(): WritableMap =
      Arguments.createMap().apply { putString("value", text) }
}

private class ElementTextSubmitEvent(surfaceId: Int, viewTag: Int, private val text: String) :
    Event<ElementTextSubmitEvent>(surfaceId, viewTag) {
  override fun getEventName(): String = "topElementSubmit"

  override fun canCoalesce(): Boolean = false

  override fun getEventData(): WritableMap =
      Arguments.createMap().apply { putString("value", text) }
}

private class ElementTextSelectionEvent(
    surfaceId: Int,
    viewTag: Int,
    private val start: Int,
    private val end: Int
) : Event<ElementTextSelectionEvent>(surfaceId, viewTag) {
  override fun getEventName(): String = "topElementSelectionChange"

  override fun getEventData(): WritableMap =
      Arguments.createMap().apply {
        putInt("selectionStart", start)
        putInt("selectionEnd", end)
      }
}

private class ElementTextSimpleEvent(
    surfaceId: Int,
    viewTag: Int,
    private val name: String
) : Event<ElementTextSimpleEvent>(surfaceId, viewTag) {
  override fun getEventName(): String = name

  override fun canCoalesce(): Boolean = false

  override fun getEventData(): WritableMap = Arguments.createMap()
}
