/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import android.content.Context
import android.os.Build
import android.util.Log
import android.util.TypedValue
import android.view.LayoutInflater
import android.view.View.MeasureSpec
import android.view.ViewGroup
import android.widget.TextView
import androidx.appcompat.view.ContextThemeWrapper
import com.facebook.proguard.annotations.DoNotStrip
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.fabric.FabricSoLoader

/**
 * The Android half of `EXPPrewarmElementControlMetrics`, run once at package creation, before
 * JavaScript. The views are built in a themed context (the activity, else the app's declared theme)
 * because a field's padding and text size come from `android:editTextStyle` resolved against the
 * theme.
 */
@DoNotStrip
internal object ElementControlMetricsProbe {
  private var done = false

  @JvmStatic
  fun prewarm(reactContext: ReactApplicationContext) {
    if (done) {
      return
    }
    done = true
    try {
      val context: Context =
          reactContext.currentActivity
              ?: ContextThemeWrapper(reactContext, reactContext.applicationInfo.theme)
      val density = context.resources.displayMetrics.density
      val unspecified = MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
      val wrap =
          ViewGroup.LayoutParams(
              ViewGroup.LayoutParams.WRAP_CONTENT,
              ViewGroup.LayoutParams.WRAP_CONTENT,
          )

      /*
       * `<textarea>`: one line and two, so both terms come from the control — the line box is what a
       * second line cost, the inset is what was left.
       */
      val textArea = ElementTextAreaView(context)
      textArea.layoutParams = wrap
      val width = MeasureSpec.makeMeasureSpec((240 * density).toInt(), MeasureSpec.EXACTLY)
      textArea.setText("Xg")
      textArea.measure(width, unspecified)
      val oneLine = textArea.measuredHeight / density
      textArea.setText("Xg\nXg")
      textArea.measure(width, unspecified)
      val twoLines = textArea.measuredHeight / density
      val lineBox = twoLines - oneLine

      // `<input>`: a single-line field, as tall as the control draws it.
      val field = ElementTextInputView(context)
      field.layoutParams = wrap
      // Twenty characters wide, HTML's default `size`; as tall as the empty field.
      field.setText("0".repeat(20))
      field.measure(unspecified, unspecified)
      val fieldWidth = field.measuredWidth / density
      field.setText("")
      field.measure(unspecified, unspecified)
      // Its text baseline, at that size: a TextView reports it once laid out.
      field.layout(0, 0, field.measuredWidth, field.measuredHeight)
      val fieldBaseline = if (field.baseline > 0) field.baseline / density else 0f

      // The element draws Material 3's exposed dropdown, so its height is the text field's and
      // its inline chrome is the sheet's field padding plus the caret it draws
      val selectLabelFontSize =
          orNull {
            val row =
                LayoutInflater.from(context).inflate(android.R.layout.simple_spinner_item, null)
                    as TextView
            spFromPixels(row.textSize, context)
          } ?: 0f

      // `<input type=file>` and the date types before they have a value; mounted, each reports its
      // own size as its label changes.
      val (fileWidth, fileHeight) =
          orNull { ElementControlSizeReporter.measureIntrinsic(ElementFileInputView(context)) }
              ?: NOT_MEASURED
      // One per type: the node knows its type before the first layout, and the three are three
      // different labels — "--:--" is a third of "yyyy-mm-dd --:--".
      fun dateInput(type: String) =
          orNull {
            val date = ElementDateInputView(context)
            date.propType = type
            date.updateLabel()
            val (w, h) = ElementControlSizeReporter.measureIntrinsic(date)
            // The label's baseline, at that size: the picker is a Button, so a TextView
            date.layout(0, 0, date.measuredWidth, date.measuredHeight)
            Triple(w, h, if (date.baseline > 0) date.baseline / density else 0f)
          } ?: Triple(0f, 0f, 0f)
      val (dateWidth, dateHeight, dateBaseline) = dateInput("date")
      val (timeWidth, timeHeight, timeBaseline) = dateInput("time")
      val (dateTimeWidth, dateTimeHeight, dateTimeBaseline) = dateInput("datetime-local")

      val textAreaMeasured = lineBox > 0 && oneLine - lineBox >= 0
      FabricSoLoader.staticInit()
      nativePublish(
          if (textAreaMeasured) oneLine - lineBox else 0f,
          if (textAreaMeasured) lineBox else 0f,
          // An EditText's inset IS its padding; layout has to state it or it arrives as zero.
          textArea.paddingTop / density,
          textArea.paddingBottom / density,
          fieldWidth,
          field.measuredHeight / density,
          selectLabelFontSize,
          field.measuredHeight / density,
          fileWidth,
          fileHeight,
          dateWidth,
          dateHeight,
          timeWidth,
          timeHeight,
          dateTimeWidth,
          dateTimeHeight,
          // The select is drawn as the text field's surface at the field's height, with its
          // label where the field's text would be, so it shares the field's baseline
          fieldBaseline,
          fieldBaseline,
          dateBaseline,
          timeBaseline,
          dateTimeBaseline,
      )
    } catch (e: RuntimeException) {
      // A control that cannot be built here leaves the defaults in place rather than taking the
      // app down: the defaults are what every layout used before this existed.
      Log.w("ElementControlMetrics", "probe failed; keeping defaults", e)
    }
  }

  /** Zeros, which the binding reads as "keep this control's default" */
  private val NOT_MEASURED = Pair(0f, 0f)

  /**
   * One control's answer, or null when it cannot be built here, so one control failing does not
   * throw away what the others measured.
   */
  private inline fun <T> orNull(measure: () -> T): T? =
      try {
        measure()
      } catch (e: RuntimeException) {
        Log.w("ElementControlMetrics", "probe of one control failed; keeping its default", e)
        null
      }

  /**
   * A text size in pixels as the font size layout would have to be given to draw it: layout scales
   * font sizes by the reader's text-size setting, non-linearly since API 34, so the scaling is
   * undone the same way rather than by dividing by one factor.
   */
  private fun spFromPixels(pixels: Float, context: Context): Float {
    val metrics = context.resources.displayMetrics
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      TypedValue.deriveDimension(TypedValue.COMPLEX_UNIT_SP, pixels, metrics)
    } else {
      @Suppress("DEPRECATION")
      pixels / metrics.scaledDensity
    }
  }

  @DoNotStrip
  @JvmStatic
  private external fun nativePublish(
      textAreaInsetBlock: Float,
      textAreaLineBox: Float,
      textAreaPaddingTop: Float,
      textAreaPaddingBottom: Float,
      textFieldWidth: Float,
      textFieldHeight: Float,
      selectLabelFontSize: Float,
      selectBlockSize: Float,
      fileDefaultWidth: Float,
      fileDefaultHeight: Float,
      datePickerDefaultWidth: Float,
      datePickerDefaultHeight: Float,
      timePickerDefaultWidth: Float,
      timePickerDefaultHeight: Float,
      dateTimePickerDefaultWidth: Float,
      dateTimePickerDefaultHeight: Float,
      selectBaseline: Float,
      textFieldBaseline: Float,
      datePickerBaseline: Float,
      timePickerBaseline: Float,
      dateTimePickerBaseline: Float,
  )
}
