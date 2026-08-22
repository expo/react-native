/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import android.content.Context
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Spinner
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event

/** One `<option>`, flattened onto its `<select>` — see `ElementSelectShadowNode.h` for why. */
internal data class ElementSelectOption(
    val value: String,
    val label: String,
    val disabled: Boolean,
)

/**
 * `<select>` on Android, backed by a real [Spinner].
 *
 * `MODE_DIALOG` rather than a dropdown, which is both the platform's modal list and what Chrome
 * itself shows for a `<select>` on Android. iOS uses a pop-up `UIMenu` on a button instead —
 * different controls, each the one its platform reaches for when choosing from a short list.
 * Neither is a wheel: the wheel is what Safari shows for `<select>` on iOS, which is a web
 * affordance rather than a native one.
 */
internal class ElementSelectView(context: Context) : Spinner(context, MODE_DIALOG) {

  /** Called with the chosen option's value and index — the DOM's `change`. */
  var onOptionChosen: ((String, Int) -> Unit)? = null

  /*
   * The dropdown caret, drawn by this view itself rather than left to the
   * Spinner's default background.
   *
   * The caret a bare Spinner shows lives in its background DRAWABLE — so the
   * moment the user-agent sheet (or any author style) gives the element a
   * `backgroundColor`, React's background applicator replaces that drawable
   * and the affordance silently vanishes: a `<select>` that reads as a plain
   * word. A control's affordance must not depend on nobody styling it.
   * Material 3's exposed-dropdown field puts a trailing arrow in the
   * on-surface-variant role; this draws that triangle at the trailing edge,
   * theme-derived so Material You recolours it, RTL-aware like the field.
   */
  private val caretPaint =
      android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
        style = android.graphics.Paint.Style.FILL
        color = resolveCaretColor()
      }
  private val caretPath = android.graphics.Path()

  private fun resolveCaretColor(): Int {
    @Suppress("DiscouragedApi")
    val attr =
        context.resources.getIdentifier("colorOnSurfaceVariant", "attr", context.packageName)
    val tv = android.util.TypedValue()
    if (attr != 0 && context.theme.resolveAttribute(attr, tv, true)) {
      return tv.data
    }
    if (context.theme.resolveAttribute(android.R.attr.textColorSecondary, tv, true)) {
      if (tv.resourceId != 0) {
        val csl = context.resources.getColorStateList(tv.resourceId, context.theme)
        return csl.defaultColor
      }
      return tv.data
    }
    return 0xFF49454F.toInt()
  }

  override fun onDraw(canvas: android.graphics.Canvas) {
    super.onDraw(canvas)
    val density = context.resources.displayMetrics.density
    val half = 5f * density // a 10dp-wide, 5dp-tall triangle: M3's arrow glyph footprint
    val inset = 4f * density
    val cx = if (layoutDirection == LAYOUT_DIRECTION_RTL) inset + half else width - inset - half
    val cy = height / 2f
    caretPath.reset()
    caretPath.moveTo(cx - half, cy - half / 2f)
    caretPath.lineTo(cx + half, cy - half / 2f)
    caretPath.lineTo(cx, cy + half / 2f)
    caretPath.close()
    canvas.drawPath(caretPath, caretPaint)
  }

  var propOptions: List<ElementSelectOption> = emptyList()
  var propValue: String? = null

  /**
   * The position this view last selected *itself*, from a prop rather than from the user.
   *
   * A simple "applying props" flag does not work here, and that is worth knowing: `Spinner`
   * delivers `onItemSelected` asynchronously, on a later layout pass, so any flag set around the
   * `setSelection` call has already been cleared by the time the callback arrives. The programmatic
   * selection was therefore reported back as a user choice — observed as a `<select>` firing
   * `change` once for its own initial value, before the user had touched it. Matching on the
   * position survives the delay.
   */
  private var programmaticSelection: Int? = null

  /** Guards the adapter swap, which does run synchronously. */
  private var isApplyingProps = false

  /**
   * An adapter that refuses to enable a disabled `<option>`. The option stays listed — it is part of
   * the choice on offer — but cannot be picked, which is what HTML means by it.
   */
  private inner class OptionAdapter(labels: List<String>) :
      ArrayAdapter<String>(context, android.R.layout.simple_spinner_item, labels) {

    override fun isEnabled(position: Int): Boolean =
        propOptions.getOrNull(position)?.disabled?.not() ?: true

    override fun areAllItemsEnabled(): Boolean = false
  }

  /**
   * A `Spinner` announces its selection from a LAYOUT pass, and inside React nothing lays it out.
   *
   * `AdapterView` fires `onItemSelected` from `onLayout`; `setSelection` only asks for a layout.
   * React Native positions views itself, from the shadow tree, so a view's own `requestLayout` has
   * nothing behind it — a choice made in the dropdown moved the selection and was never announced.
   * The `<select>` looked inert on Android: picking 3000 messages left the app on 3, with no event
   * and nothing in the log to say why.
   *
   * So the layout the notification rides is posted here. Both paths come through this method — the
   * dropdown's own choice and `commitProps`' programmatic one — and the measure is EXACTLY the size
   * React already gave the view, so it moves nothing.
   */
  override fun setSelection(position: Int) {
    super.setSelection(position)
    post(measureAndLayout)
  }

  private val measureAndLayout = Runnable {
    measure(
        MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
        MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY),
    )
    layout(left, top, right, bottom)
  }

  init {
    onItemSelectedListener =
        object : AdapterView.OnItemSelectedListener {
          override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
            if (isApplyingProps) {
              return
            }
            if (programmaticSelection == position) {
              programmaticSelection = null
              return
            }
            programmaticSelection = null
            propOptions.getOrNull(position)?.let { onOptionChosen?.invoke(it.value, position) }
          }

          override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }
  }

  /**
   * Applied as a set once React has finished this update: the options and the value are only
   * meaningful together, and setting a selection against a list that has not arrived yet would
   * either land on the wrong row or be dropped.
   */
  fun commitProps() {
    val labels = propOptions.map { it.label.ifEmpty { it.value } }
    val existing = (0 until count).map { getItemAtPosition(it) as? String }
    if (existing != labels) {
      isApplyingProps = true
      val adapter = OptionAdapter(labels)
      adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
      setAdapter(adapter)
      isApplyingProps = false
    }

    // HTML's rule: a `<select>` whose value matches no option shows its first one, which is why an
    // untouched `<select>` is never blank.
    val target = propOptions.indexOfFirst { it.value == propValue }.let { if (it >= 0) it else 0 }
    if (target in propOptions.indices && target != selectedItemPosition) {
      programmaticSelection = target
      setSelection(target)
    }
  }
}

@ReactModule(name = ElementSelectViewManager.REACT_CLASS)
internal class ElementSelectViewManager : SimpleViewManager<ElementSelectView>() {

  public companion object {
    public const val REACT_CLASS: String = "element-select"
  }

  override fun getName(): String = REACT_CLASS

  override fun createViewInstance(context: ThemedReactContext): ElementSelectView {
    val view = ElementSelectView(context)
    view.onOptionChosen = { value, index ->
      UIManagerHelper.getEventDispatcher(context)
          ?.dispatchEvent(
              ElementSelectChangeEvent(UIManagerHelper.getSurfaceId(view), view.id, value, index))
    }
    return view
  }

  override fun onAfterUpdateTransaction(view: ElementSelectView) {
    super.onAfterUpdateTransaction(view)
    view.commitProps()
  }

  @ReactProp(name = "options")
  public fun setOptions(view: ElementSelectView, options: ReadableArray?) {
    view.propOptions =
        (0 until (options?.size() ?: 0)).mapNotNull { index ->
          options?.getMap(index)?.let { map ->
            val value = if (map.hasKey("value")) map.getString("value").orEmpty() else ""
            val label = if (map.hasKey("label")) map.getString("label").orEmpty() else ""
            ElementSelectOption(
                // An `<option>` with no `value` takes its text as its value, as in HTML.
                value = value.ifEmpty { label },
                label = label,
                disabled = map.hasKey("disabled") && map.getBoolean("disabled"),
            )
          }
        }
  }

  @ReactProp(name = "value")
  public fun setValue(view: ElementSelectView, value: String?) {
    view.propValue = value
  }

  @ReactProp(name = "disabled")
  public fun setDisabled(view: ElementSelectView, disabled: Boolean) {
    view.isEnabled = !disabled
  }

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any>? {
    val export = super.getExportedCustomDirectEventTypeConstants() ?: mutableMapOf()
    export["topElementChange"] = mapOf("registrationName" to "onChange")
    return export
  }
}

private class ElementSelectChangeEvent(
    surfaceId: Int,
    viewTag: Int,
    private val value: String,
    private val index: Int
) : Event<ElementSelectChangeEvent>(surfaceId, viewTag) {
  override fun getEventName(): String = "topElementChange"

  /** Choosing is a discrete act; coalescing two choices would lose one. */
  override fun canCoalesce(): Boolean = false

  override fun getEventData(): WritableMap =
      Arguments.createMap().apply {
        putString("value", value)
        putInt("selectedIndex", index)
      }
}
