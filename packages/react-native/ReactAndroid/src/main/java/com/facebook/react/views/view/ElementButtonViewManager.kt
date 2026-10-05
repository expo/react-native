/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlags
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event

/**
 * The generic box plus press state, tracked through Android's own touch dispatch
 * ([ElementButtonView]) and drawn as the theme's ripple; layout, borders and clipping come from
 * [ReactViewManager].
 */
@ReactModule(name = ElementButtonViewManager.REACT_CLASS)
internal class ElementButtonViewManager : ReactViewManager() {

  public companion object {
    public const val REACT_CLASS: String = "element-button"
  }

  override fun getName(): String = REACT_CLASS

  override fun createViewInstance(context: ThemedReactContext): ReactViewGroup {
    val view = ElementButtonView(context)
    if (ReactNativeFeatureFlags.enableNativeGestureRecognizers()) {
      view.onPressChange = { pressed -> emitPressChange(context, view, pressed) }
      view.ripplesEnabled = true
    }
    return view
  }

  /**
   * The ripple's shape follows the background's, and the background is built from props — so it can
   * only be sized once the whole transaction has been applied. Doing it per-prop would rebuild the
   * ripple several times per update and, worse, read a border radius that a later prop in the same
   * batch was about to change.
   */
  override fun onAfterUpdateTransaction(view: ReactViewGroup) {
    super.onAfterUpdateTransaction(view)
    (view as? ElementButtonView)?.onPropsApplied()
  }

  private fun emitPressChange(
      context: ThemedReactContext,
      view: ElementButtonView,
      pressed: Boolean
  ) {
    val surfaceId = UIManagerHelper.getSurfaceId(view)
    UIManagerHelper.getEventDispatcher(context)
        ?.dispatchEvent(ElementPressChangeEvent(surfaceId, view.id, pressed))
  }

  @ReactProp(name = "disabled")
  public fun setDisabled(view: ReactViewGroup, disabled: Boolean) {
    view.isEnabled = !disabled
  }

  @ReactProp(name = "touchAction")
  public fun setTouchAction(view: ReactViewGroup, touchAction: String?) {
    (view as? ElementButtonView)?.touchAction = touchAction
  }

  @ReactProp(name = "buttonStyle")
  public fun setButtonStyle(view: ReactViewGroup, buttonStyle: String?) {
    (view as? ElementButtonView)?.buttonStyle = buttonStyle
  }

  @ReactProp(name = "hasAuthorChrome")
  public fun setHasAuthorChrome(view: ReactViewGroup, hasAuthorChrome: Boolean) {
    (view as? ElementButtonView)?.hasAuthorChrome = hasAuthorChrome
  }

  @ReactProp(name = "authorStatesPressFeedback")
  public fun setAuthorStatesPressFeedback(view: ReactViewGroup, authorStatesPressFeedback: Boolean) {
    (view as? ElementButtonView)?.authorStatesPressFeedback = authorStatesPressFeedback
  }

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any>? {
    val export = super.getExportedCustomDirectEventTypeConstants() ?: mutableMapOf()
    export["topElementPressChange"] = mapOf("registrationName" to "onPressChange")
    return export
  }
}

private class ElementPressChangeEvent(
    surfaceId: Int,
    viewTag: Int,
    private val pressed: Boolean
) : Event<ElementPressChangeEvent>(surfaceId, viewTag) {

  override fun getEventName(): String = "topElementPressChange"

  // Never coalesced: a quick tap's press-in and press-out land in one frame, and
  // [Event.canCoalesce]'s default would keep only the final `pressed=false`
  override fun canCoalesce(): Boolean = false

  override fun getEventData(): WritableMap =
      Arguments.createMap().apply { putBoolean("pressed", pressed) }
}
