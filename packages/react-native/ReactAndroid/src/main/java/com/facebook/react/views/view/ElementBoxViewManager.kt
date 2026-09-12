/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlags
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event
import com.facebook.react.uimanager.annotations.ReactProp

/**
 * View manager for `element-box`, the box a block-level element generates.
 *
 * `element-box` used to be mapped straight onto `RCTView`, which meant Android had no seam of its
 * own for it at all and `href` — carried natively on iOS since the anchor work — was dropped on
 * the floor here. This is that seam. It inherits everything from [ReactViewManager]: layout,
 * borders, backgrounds, clipping and every existing prop behave exactly as they did, because the
 * view is a [ReactViewGroup] until a prop says otherwise.
 */
@ReactModule(name = ElementBoxViewManager.REACT_CLASS)
internal class ElementBoxViewManager : ReactViewManager() {

  public companion object {
    public const val REACT_CLASS: String = "element-box"
  }

  override fun getName(): String = REACT_CLASS

  override fun createViewInstance(context: ThemedReactContext): ReactViewGroup {
    val view = ElementBoxView(context)
    // Same gate as `<button>`: the ripple is what a tracked press *looks like*, so a build with
    // the recognizers off must not grow one that nothing drives.
    if (ReactNativeFeatureFlags.enableNativeGestureRecognizers()) {
      view.ripplesEnabled = true
    }
    return view
  }

  /**
   * The ripple's mask follows the background's shape, and the background is built from props — so
   * it can only be shaped once the whole transaction has been applied. Doing it per-prop would
   * rebuild the ripple several times per update and, worse, read a border radius that a later prop
   * in the same batch was about to change.
   */
  override fun onAfterUpdateTransaction(view: ReactViewGroup) {
    super.onAfterUpdateTransaction(view)
    (view as? ElementBoxView)?.onPropsApplied()
  }

  @ReactProp(name = "href")
  public fun setHref(view: ReactViewGroup, href: String?) {
    (view as? ElementBoxView)?.href = href
  }

  @ReactProp(name = "touchAction")
  public fun setTouchAction(view: ReactViewGroup, touchAction: String?) {
    (view as? ElementBoxView)?.touchAction = touchAction
  }

  @ReactProp(name = "wantsContextMenu")
  public fun setWantsContextMenu(view: ReactViewGroup, wantsContextMenu: Boolean) {
    val box = view as? ElementBoxView ?: return
    box.wantsContextMenu = wantsContextMenu
    val context = box.context as? ThemedReactContext ?: return
    box.onContextMenu = { emitContextMenu(context, box) }
    box.onCommand = { id -> emitCommand(context, box, id) }
  }

  @ReactProp(name = "menuCommands")
  public fun setMenuCommands(view: ReactViewGroup, commands: ReadableArray?) {
    val box = view as? ElementBoxView ?: return
    if (commands == null) {
      box.menuCommands = emptyList()
      return
    }
    val parsed = ArrayList<ElementInteractiveBoxView.MenuCommand>(commands.size())
    for (index in 0 until commands.size()) {
      val command = commands.getMap(index) ?: continue
      val label = command.getString("label") ?: continue
      parsed.add(
          ElementInteractiveBoxView.MenuCommand(
              id = command.getString("id") ?: label,
              label = label,
              disabled = command.hasKey("disabled") && command.getBoolean("disabled"),
              destructive = command.hasKey("destructive") && command.getBoolean("destructive")))
    }
    box.menuCommands = parsed
  }

  private fun emitContextMenu(context: ThemedReactContext, view: ReactViewGroup) {
    val surfaceId = UIManagerHelper.getSurfaceId(view)
    UIManagerHelper.getEventDispatcher(context)
        ?.dispatchEvent(ElementContextMenuEvent(surfaceId, view.id))
  }

  private fun emitCommand(context: ThemedReactContext, view: ReactViewGroup, id: String) {
    val surfaceId = UIManagerHelper.getSurfaceId(view)
    UIManagerHelper.getEventDispatcher(context)
        ?.dispatchEvent(ElementBoxCommandEvent(surfaceId, view.id, id))
  }

  /**
   * The names the box's view config already declares, in `expo-intrinsics/src/index.js`, as
   * BUBBLING events — `contextmenu` bubbles on the web, so a handler on a container hears a hold
   * on anything inside it, and a chosen command bubbles with it.
   */
  override fun getExportedCustomBubblingEventTypeConstants(): MutableMap<String, Any>? {
    val export = super.getExportedCustomBubblingEventTypeConstants() ?: mutableMapOf()
    export["topContextMenu"] =
        mapOf(
            "phasedRegistrationNames" to
                mapOf("bubbled" to "onContextMenu", "captured" to "onContextMenuCapture"))
    export["topCommand"] =
        mapOf(
            "phasedRegistrationNames" to
                mapOf("bubbled" to "onCommand", "captured" to "onCommandCapture"))
    return export
  }
}

private class ElementContextMenuEvent(surfaceId: Int, viewTag: Int) :
    Event<ElementContextMenuEvent>(surfaceId, viewTag) {

  override fun getEventName(): String = "topContextMenu"

  /**
   * A hold is something the reader did on purpose, so it is never merged with another. The same
   * rule the press and command events take, and for the same reason: coalescing is right for a
   * stream where only the newest matters.
   */
  override fun canCoalesce(): Boolean = false

  override fun getEventData(): WritableMap = Arguments.createMap()
}

private class ElementBoxCommandEvent(surfaceId: Int, viewTag: Int, private val id: String) :
    Event<ElementBoxCommandEvent>(surfaceId, viewTag) {

  override fun getEventName(): String = "topCommand"

  override fun canCoalesce(): Boolean = false

  override fun getEventData(): WritableMap = Arguments.createMap().apply { putString("id", id) }
}
