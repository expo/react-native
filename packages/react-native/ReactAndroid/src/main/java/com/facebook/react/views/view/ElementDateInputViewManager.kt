/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.content.Context
import android.text.format.DateFormat
import android.widget.Button
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event
import java.util.Calendar

/**
 * `<input type="date">`, `"time"` and `"datetime-local"` on Android.
 *
 * A field showing the current value that opens the platform's own
 * [DatePickerDialog]/[TimePickerDialog] — which is what Android apps do, and what Chrome does for
 * these inputs. iOS uses a compact `UIDatePicker` that opens a calendar popover instead: the same
 * shape of interaction, drawn by each platform's own picker.
 *
 * `datetime-local` opens the two dialogs in sequence, date then time, because Android has no
 * combined picker. That is also the order Chrome uses.
 *
 * The value crosses as the DOM's string format, and is parsed and formatted here rather than passed
 * as a timestamp — see `ElementDateInputShadowNode.h` for why.
 */
internal class ElementDateInputView(context: Context) : Button(context) {

  /** Called with the value in HTML format when the user settles on one. */
  var onValueChosen: ((String) -> Unit)? = null

  var propType: String = "date"
  var propValue: String = ""
  var propMinimum: String = ""
  var propMaximum: String = ""

  private val calendar: Calendar = Calendar.getInstance()

  private val showsDate: Boolean
    get() = propType == "date" || propType == "datetime-local"

  private val showsTime: Boolean
    get() = propType == "time" || propType == "datetime-local"

  init {
    isAllCaps = false
    setOnClickListener { openFirstPicker() }
  }

  /**
   * Parses the DOM's format into [calendar]. Fixed patterns rather than a locale-aware parse: these
   * are wire formats, and a device on a non-Gregorian calendar would otherwise fail to read a value
   * that any browser can.
   */
  private fun parseInto(value: String) {
    if (value.isEmpty()) {
      return
    }
    runCatching {
      val datePart = value.substringBefore('T', if (showsDate) value else "")
      val timePart = if (value.contains('T')) value.substringAfter('T') else if (showsDate) "" else value

      if (datePart.isNotEmpty()) {
        val (y, m, d) = datePart.split('-').map { it.toInt() }
        calendar.set(Calendar.YEAR, y)
        // Calendar months are zero-based; HTML's are not.
        calendar.set(Calendar.MONTH, m - 1)
        calendar.set(Calendar.DAY_OF_MONTH, d)
      }
      if (timePart.isNotEmpty()) {
        val parts = timePart.split(':').map { it.toInt() }
        calendar.set(Calendar.HOUR_OF_DAY, parts[0])
        calendar.set(Calendar.MINUTE, parts.getOrElse(1) { 0 })
      }
      calendar.set(Calendar.SECOND, 0)
      calendar.set(Calendar.MILLISECOND, 0)
    }
  }

  private fun formatted(): String {
    val y = calendar.get(Calendar.YEAR)
    val m = calendar.get(Calendar.MONTH) + 1
    val d = calendar.get(Calendar.DAY_OF_MONTH)
    val h = calendar.get(Calendar.HOUR_OF_DAY)
    val min = calendar.get(Calendar.MINUTE)
    val date = "%04d-%02d-%02d".format(y, m, d)
    val time = "%02d:%02d".format(h, min)
    return when {
      showsDate && showsTime -> "${date}T$time"
      showsTime -> time
      else -> date
    }
  }

  /** Millis for a bound, or null when it is absent or unparseable. */
  private fun boundMillis(bound: String): Long? {
    if (bound.isEmpty()) {
      return null
    }
    val saved = calendar.timeInMillis
    parseInto(bound)
    val millis = calendar.timeInMillis
    calendar.timeInMillis = saved
    return millis
  }

  private fun openFirstPicker() {
    parseInto(propValue)
    if (showsDate) {
      openDatePicker()
    } else {
      openTimePicker()
    }
  }

  private fun openDatePicker() {
    val dialog =
        DatePickerDialog(
            context,
            { _, year, month, day ->
              calendar.set(Calendar.YEAR, year)
              calendar.set(Calendar.MONTH, month)
              calendar.set(Calendar.DAY_OF_MONTH, day)
              // `datetime-local` asks for the time next; a plain date is settled here.
              if (showsTime) openTimePicker() else report()
            },
            calendar.get(Calendar.YEAR),
            calendar.get(Calendar.MONTH),
            calendar.get(Calendar.DAY_OF_MONTH),
        )
    boundMillis(propMinimum)?.let { dialog.datePicker.minDate = it }
    boundMillis(propMaximum)?.let { dialog.datePicker.maxDate = it }
    dialog.show()
  }

  private fun openTimePicker() {
    TimePickerDialog(
            context,
            { _, hour, minute ->
              calendar.set(Calendar.HOUR_OF_DAY, hour)
              calendar.set(Calendar.MINUTE, minute)
              report()
            },
            calendar.get(Calendar.HOUR_OF_DAY),
            calendar.get(Calendar.MINUTE),
            // Follows the device's own 12/24-hour setting rather than forcing one.
            DateFormat.is24HourFormat(context),
        )
        .show()
  }

  private fun report() {
    val value = formatted()
    propValue = value
    updateLabel()
    onValueChosen?.invoke(value)
  }

  /**
   * The field's own text is the current value, the way a date field reads before it is opened.
   *
   * Shown in the device's own date and time format, not the HTML one. The wire format is what
   * crosses to JavaScript — `2026-03-14` — but showing that to the user would be a form field that
   * reads like a database column, and neither an Android app nor Chrome does it: both display the
   * locale's own arrangement, and honour the 12- or 24-hour setting.
   */
  fun updateLabel() {
    if (propValue.isEmpty()) {
      text = placeholderForType()
      return
    }
    parseInto(propValue)
    val date = calendar.time
    text =
        when {
          showsDate && showsTime ->
              DateFormat.getDateFormat(context).format(date) +
                  " " +
                  DateFormat.getTimeFormat(context).format(date)
          showsTime -> DateFormat.getTimeFormat(context).format(date)
          else -> DateFormat.getDateFormat(context).format(date)
        }
  }

  private fun placeholderForType(): String =
      when {
        showsDate && showsTime -> "yyyy-mm-dd --:--"
        showsTime -> "--:--"
        else -> "yyyy-mm-dd"
      }
}

@ReactModule(name = ElementDateInputViewManager.REACT_CLASS)
internal class ElementDateInputViewManager : SimpleViewManager<ElementDateInputView>() {

  public companion object {
    public const val REACT_CLASS: String = "element-date-input"
  }

  override fun getName(): String = REACT_CLASS

  override fun createViewInstance(context: ThemedReactContext): ElementDateInputView {
    val view = ElementDateInputView(context)
    view.onValueChosen = { value ->
      val dispatcher = UIManagerHelper.getEventDispatcher(context)
      val surfaceId = UIManagerHelper.getSurfaceId(view)
      // A picker has no separate commit step, so both DOM events fire together — the same
      // reasoning as on iOS.
      dispatcher?.dispatchEvent(ElementDateEvent(surfaceId, view.id, "topElementInput", value))
      dispatcher?.dispatchEvent(ElementDateEvent(surfaceId, view.id, "topElementChange", value))
    }
    return view
  }

  override fun onAfterUpdateTransaction(view: ElementDateInputView) {
    super.onAfterUpdateTransaction(view)
    view.updateLabel()
  }

  @ReactProp(name = "type")
  public fun setType(view: ElementDateInputView, type: String?) {
    view.propType = type ?: "date"
  }

  @ReactProp(name = "value")
  public fun setValue(view: ElementDateInputView, value: String?) {
    view.propValue = value.orEmpty()
  }

  @ReactProp(name = "min")
  public fun setMin(view: ElementDateInputView, min: String?) {
    view.propMinimum = min.orEmpty()
  }

  @ReactProp(name = "max")
  public fun setMax(view: ElementDateInputView, max: String?) {
    view.propMaximum = max.orEmpty()
  }

  @ReactProp(name = "disabled")
  public fun setDisabled(view: ElementDateInputView, disabled: Boolean) {
    view.isEnabled = !disabled
  }

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any>? {
    val export = super.getExportedCustomDirectEventTypeConstants() ?: mutableMapOf()
    export["topElementInput"] = mapOf("registrationName" to "onInput")
    export["topElementChange"] = mapOf("registrationName" to "onChange")
    return export
  }
}

private class ElementDateEvent(
    surfaceId: Int,
    viewTag: Int,
    private val name: String,
    private val value: String
) : Event<ElementDateEvent>(surfaceId, viewTag) {
  override fun getEventName(): String = name

  override fun canCoalesce(): Boolean = false

  override fun getEventData(): WritableMap =
      Arguments.createMap().apply { putString("value", value) }
}
