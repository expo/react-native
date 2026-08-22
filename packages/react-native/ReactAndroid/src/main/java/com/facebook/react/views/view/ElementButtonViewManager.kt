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
 * View manager for `element-button`, the interactive flavor of the generic box.
 *
 * It is the plain box in every respect except three: it reports press state, it tracks that state
 * through Android's own touch dispatch (see [ElementButtonView]) rather than the JS responder
 * system, and that state draws the platform's own press feedback — a ripple tinted with the
 * theme's `colorControlHighlight`, exactly what the framework's `Widget.Material.Button` uses.
 * Layout, borders, backgrounds and clipping are inherited unchanged from [ReactViewManager]:
 * a `<button>` is still an author-styleable box rather than a `MaterialButton` skin, but its
 * *behaviour under the finger* is the platform's, which is what makes it read as native.
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

  /**
   * Press transitions must never be coalesced.
   *
   * [Event.canCoalesce] defaults to `true` with a constant coalescing key, which is right for a
   * stream of scroll offsets — only the newest matters — and wrong for a state change. A press-in
   * and the press-out that follows it are dispatched within the same frame on a quick tap, so with
   * coalescing on they collapse into one event and only the final `pressed=false` survives: the
   * element never observes the press at all. Verified exactly that way on the emulator, where the
   * press was reported natively but never reached JavaScript.
   */
  override fun canCoalesce(): Boolean = false

  override fun getEventData(): WritableMap =
      Arguments.createMap().apply { putBoolean("pressed", pressed) }
}
