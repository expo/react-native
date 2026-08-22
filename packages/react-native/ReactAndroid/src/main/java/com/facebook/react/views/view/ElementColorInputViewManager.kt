/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import android.app.AlertDialog
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.GridLayout
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event
import kotlin.math.roundToInt

/**
 * `<input type="color">` on Android: a swatch that opens a grid of colours.
 *
 * This is the one element where the platforms are genuinely unequal. iOS has
 * `UIColorPickerViewController` — the system picker, with a spectrum, sliders and an eyedropper.
 * Android has no system colour picker at all, in neither the framework nor Material, so every app
 * that offers one has built it. A swatch grid is what most Android apps that need a colour actually
 * show, and it is what this offers.
 *
 * DOM-CSS-LIMITATION: an Android user therefore cannot pick an arbitrary colour the way an iOS or
 * desktop-browser user can. Recorded as a platform gap rather than hidden; closing it properly means
 * building a spectrum picker, which is a piece of UI in its own right.
 */
internal class ElementColorInputView(context: Context) : Button(context) {

  /** Called with the chosen colour as `#rrggbb`. */
  var onColorChosen: ((String) -> Unit)? = null

  var propValue: String = "#000000"

  private val swatchBackground = GradientDrawable()

  private companion object {
    /**
     * The grid. A spread of hues at two lightnesses plus a greyscale row, which covers the choices
     * a form usually wants without pretending to be a spectrum.
     */
    val SWATCHES: List<String> =
        listOf(
            "#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#00c7be", "#30b0c7",
            "#007aff", "#5856d6", "#af52de", "#ff2d55", "#a2845e", "#8e8e93",
            "#7f1d1d", "#7c2d12", "#713f12", "#14532d", "#134e4a", "#164e63",
            "#1e3a8a", "#312e81", "#4a044e", "#831843", "#442c1e", "#3a3a3c",
            "#000000", "#3a3a3c", "#8e8e93", "#c7c7cc", "#e5e5ea", "#ffffff",
        )
  }

  init {
    isAllCaps = false
    text = ""
    swatchBackground.cornerRadius = 12f
    swatchBackground.setStroke(2, Color.LTGRAY)
    background = swatchBackground
    contentDescription = "Colour"
    setOnClickListener { openPicker() }
  }

  fun applyValue() {
    swatchBackground.setColor(parseColor(propValue))
    // The value is what assistive technology should hear: a swatch has no text of its own.
    stateDescription = propValue
  }

  private fun parseColor(hex: String): Int =
      runCatching { Color.parseColor(hex) }.getOrDefault(Color.BLACK)

  private fun openPicker() {
    val density = resources.displayMetrics.density
    val cell = (44 * density).roundToInt()
    val margin = (4 * density).roundToInt()

    val grid =
        GridLayout(context).apply {
          columnCount = 6
          val pad = (12 * density).roundToInt()
          setPadding(pad, pad, pad, pad)
        }

    lateinit var dialog: AlertDialog
    SWATCHES.forEach { hex ->
      val cellView =
          View(context).apply {
            background =
                GradientDrawable().apply {
                  cornerRadius = 8f * density
                  setColor(parseColor(hex))
                  // The chosen colour is ringed rather than ticked: a tick would be invisible on
                  // a swatch close to its own colour.
                  setStroke(if (hex == propValue) (3 * density).roundToInt() else 1, Color.DKGRAY)
                }
            contentDescription = hex
            setOnClickListener {
              propValue = hex
              applyValue()
              onColorChosen?.invoke(hex)
              dialog.dismiss()
            }
          }
      grid.addView(
          cellView,
          GridLayout.LayoutParams().apply {
            width = cell
            height = cell
            setMargins(margin, margin, margin, margin)
          })
    }

    dialog =
        AlertDialog.Builder(context)
            .setTitle("Choose a colour")
            .setView(grid)
            .setNegativeButton(android.R.string.cancel, null)
            .create()
    dialog.window?.setGravity(Gravity.CENTER)
    dialog.show()
  }
}

@ReactModule(name = ElementColorInputViewManager.REACT_CLASS)
internal class ElementColorInputViewManager : SimpleViewManager<ElementColorInputView>() {

  public companion object {
    public const val REACT_CLASS: String = "element-color-input"
  }

  override fun getName(): String = REACT_CLASS

  override fun createViewInstance(context: ThemedReactContext): ElementColorInputView {
    val view = ElementColorInputView(context)
    view.onColorChosen = { hex ->
      val dispatcher = UIManagerHelper.getEventDispatcher(context)
      val surfaceId = UIManagerHelper.getSurfaceId(view)
      // A swatch grid has no intermediate values — tapping one both is the edit and settles it — so
      // both DOM events fire together, as they do for the date pickers.
      dispatcher?.dispatchEvent(ElementColorEvent(surfaceId, view.id, "topElementInput", hex))
      dispatcher?.dispatchEvent(ElementColorEvent(surfaceId, view.id, "topElementChange", hex))
    }
    return view
  }

  override fun onAfterUpdateTransaction(view: ElementColorInputView) {
    super.onAfterUpdateTransaction(view)
    view.applyValue()
  }

  @ReactProp(name = "value")
  public fun setValue(view: ElementColorInputView, value: String?) {
    view.propValue = value ?: "#000000"
  }

  @ReactProp(name = "disabled")
  public fun setDisabled(view: ElementColorInputView, disabled: Boolean) {
    view.isEnabled = !disabled
  }

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any>? {
    val export = super.getExportedCustomDirectEventTypeConstants() ?: mutableMapOf()
    export["topElementInput"] = mapOf("registrationName" to "onInput")
    export["topElementChange"] = mapOf("registrationName" to "onChange")
    return export
  }
}

private class ElementColorEvent(
    surfaceId: Int,
    viewTag: Int,
    private val name: String,
    private val value: String
) : Event<ElementColorEvent>(surfaceId, viewTag) {
  override fun getEventName(): String = name

  override fun canCoalesce(): Boolean = false

  override fun getEventData(): WritableMap =
      Arguments.createMap().apply { putString("value", value) }
}
