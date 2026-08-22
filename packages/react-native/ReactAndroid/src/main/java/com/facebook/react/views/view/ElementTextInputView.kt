/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import android.content.Context
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.LayerDrawable
import android.graphics.drawable.StateListDrawable
import android.view.Gravity
import android.text.Editable
import android.text.InputFilter
import android.text.InputType
import android.text.TextWatcher
import android.os.SystemClock
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import androidx.appcompat.widget.AppCompatEditText
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.fabric.FabricUIManager
import com.facebook.react.fabric.events.CancelableResult
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.common.UIManagerType

/**
 * `<input>` in its textual forms on Android, backed by a real [EditText].
 *
 * A framework `EditText` rather than a drawn approximation, so the element inherits the platform's
 * text selection handles, the magnifier, the context menu, IME behaviour, autofill, and TalkBack
 * support. None of those are things a reimplementation gets right, and all of them are things a user
 * of this platform notices the absence of immediately.
 *
 * [AppCompatEditText] specifically, which is the same base RN's own `TextInput` uses. The
 * difference is not compatibility shimming: constructing a plain [EditText] resolves
 * `android:editTextStyle` against the *platform* theme, which under an AppCompat theme leaves the
 * field with no background at all — laid out and fully functional, but invisible until focused. A
 * text field with no box does not read as a text field, and a browser's UA stylesheet draws one on
 * every platform. AppCompat resolves `editTextStyle` against the app's theme instead, so the field
 * gets that theme's own underline, tinted for light and dark, along with the matching cursor and
 * selection-handle tints. That is the platform's answer to "what does a text field look like", which
 * is the one worth inheriting.
 *
 * The interesting part is [commitProps], which carries the controlled-input handshake. See
 * `ElementTextInputEventEmitter::onElementInput` for what the event count is for.
 */
internal open class ElementTextInputView(context: Context) : AppCompatEditText(context) {

  /**
   * Whether this is a multi-line field. Android draws both with the same widget, so `<textarea>`
   * subclasses this one rather than duplicating the text handling — but the configuration has to
   * follow the distinction, or [applyInputType] would put a textarea back to single-line on the
   * next prop update, and [applyEnterKeyHint] would give it a Return key that submits instead of
   * inserting a newline.
   */
  protected open val isMultiline: Boolean
    get() = false

  /** Called for every accepted edit, with the count of edits sent so far — the DOM's `input`. */
  var onTextInput: ((String, Int) -> Unit)? = null

  /** Called when an edit is committed and the text actually differs — the DOM's `change`. */
  var onTextChangeCommitted: ((String) -> Unit)? = null

  var onFocusGained: (() -> Unit)? = null

  var onFocusLost: (() -> Unit)? = null

  /** Called when the IME action fires — the return key on a single-line field. */
  var onSubmit: ((String) -> Unit)? = null

  /** Named apart from the [onSelectionChanged] override below, which is the framework's hook. */
  var onSelectionUpdate: ((Int, Int) -> Unit)? = null

  /** The number of edits sent to JavaScript. Compared against the echo in [commitProps]. */
  private var nativeEventCount = 0

  /*
   * Props are staged here and applied together in [commitProps], because several of them are only
   * meaningful as a set. `type`, `inputMode` and `spellCheck` combine into one platform input type,
   * so applying whichever arrived last would let prop order decide the keyboard. `value` has to be
   * weighed against `mostRecentEventCount`, and React sets props one at a time in no guaranteed
   * order — read on its own, a `value` that arrived first would be judged against the previous
   * update's count.
   */
  var propType: String = "text"
  var propInputMode: String = ""
  var propSpellCheck: Boolean = true
  var propEnterKeyHint: String = ""
  var propValue: String? = null
  var propDefaultValue: String = ""
  var propMostRecentEventCount: Int = 0

  /**
   * Whether a `beforeinput` handler exists.
   *
   * The synchronous path blocks both threads for the duration of the handler, so
   * it is only taken when something is actually going to use it. A field without
   * one types exactly as it did before.
   */
  var propHasBeforeInput: Boolean = false
    set(value) {
      if (field != value) {
        field = value
        applyFilters()
      }
    }

  private var hasAppliedDefaultValue = false

  /** Suppresses the input callback while a prop write is in flight, so it is not read back as typing. */
  private var isApplyingProps = false

  /** The text as it was when editing began, for deciding whether `change` is owed on blur. */
  private var textAtFocus: String = ""

  private var isReadOnly = false

  /**
   * Gives the field the platform's own text-field chrome: a bottom rule that thickens and takes the
   * accent colour on focus.
   *
   * A browser's user-agent stylesheet draws a border on `<input>`, and it is not decoration — an
   * unmarked strip of page does not read as somewhere to type. The platform's own answer is the
   * Material underline, so that is what is drawn here rather than a copy of iOS's rounded rect.
   *
   * It is drawn rather than inherited because inheriting does not work here. `android:editTextStyle`
   * supplies `Widget.Material.EditText`, whose background is an alpha-mask nine-patch: it carries
   * the shape of the underline and none of its colour. The platform tints that mask when it inflates
   * an EditText from a layout, and AppCompat tints backgrounds that came from AppCompat's own styles;
   * a view constructed programmatically under an AppCompat theme falls between the two and the mask
   * is drawn untinted, which is to say invisible. Setting a tint list on it does not help, since the
   * mask is reached through an InsetDrawable the tint does not propagate into. The field was laid
   * out, focusable and fully functional the whole time — only unmarked.
   *
   * Every colour and thickness comes from the theme, so the field follows the app's light and dark
   * palettes and its accent colour and matches the other controls on the screen. That is the reason
   * to use the platform's widget at all, and hardcoding the colours here would throw it away.
   */
  private fun applyPlatformFieldChrome() {
    val attrs =
        intArrayOf(
            androidx.appcompat.R.attr.colorControlNormal,
            androidx.appcompat.R.attr.colorControlActivated,
        )
    val typed = context.theme.obtainStyledAttributes(attrs)
    val normal = typed.getColor(0, 0)
    val activated = typed.getColor(1, normal)
    typed.recycle()
    if (normal == 0) {
      return
    }
    // The platform's convention for an inert control: its own colour, faded.
    val disabled = (normal and 0x00FFFFFF) or (((normal ushr 24) * 38 / 100) shl 24)

    val density = resources.displayMetrics.density
    val thin = Math.max(1, Math.round(density))
    val thick = Math.max(2, Math.round(2 * density))

    fun rule(color: Int, thickness: Int): Drawable {
      val line = GradientDrawable()
      line.setColor(color)
      val layer = LayerDrawable(arrayOf<Drawable>(line))
      layer.setLayerGravity(0, Gravity.BOTTOM)
      layer.setLayerHeight(0, thickness)
      return layer
    }

    val states = StateListDrawable()
    states.addState(intArrayOf(-android.R.attr.state_enabled), rule(disabled, thin))
    states.addState(intArrayOf(android.R.attr.state_focused), rule(activated, thick))
    states.addState(intArrayOf(), rule(normal, thin))

    // The platform background reserved room for its own underline through the drawable's padding,
    // and replacing it drops that. Keeping the padding keeps the text off the rule.
    val padLeft = paddingLeft
    val padTop = paddingTop
    val padRight = paddingRight
    val padBottom = paddingBottom
    background = states
    setPadding(padLeft, padTop, padRight, padBottom)
  }

  init {
    applyPlatformFieldChrome()

    // A single-line field, unless a subclass says otherwise. Without this an `<input>` would accept
    // newlines and grow, which is what `<textarea>` is for.
    isSingleLine = !isMultiline

    addTextChangedListener(
        object : TextWatcher {
          override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit

          override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit

          override fun afterTextChanged(s: Editable?) {
            if (isApplyingProps) {
              return
            }
            nativeEventCount++
            onTextInput?.invoke(s?.toString().orEmpty(), nativeEventCount)
          }
        })

    setOnFocusChangeListener { _, hasFocus ->
      if (hasFocus) {
        textAtFocus = text?.toString().orEmpty()
        onFocusGained?.invoke()
      } else {
        val current = text?.toString().orEmpty()
        // `change` on commit, and only on a real change — the DOM's rule, not `input`'s.
        if (current != textAtFocus) {
          onTextChangeCommitted?.invoke(current)
        }
        onFocusLost?.invoke()
      }
    }

    setOnEditorActionListener { _, actionId, _ ->
      if (actionId == EditorInfo.IME_ACTION_UNSPECIFIED) {
        false
      } else {
        onSubmit?.invoke(text?.toString().orEmpty())
        // Clearing focus is what commits the edit, and it is also what fires `change`: the focus
        // listener above is the single place that decision lives, so submitting and tapping away
        // cannot disagree about whether the value changed.
        clearFocus()
        // And the keyboard goes away. Clearing focus alone does not dismiss the IME — observed
        // exactly that way, with the field reporting `focused: no` under a keyboard still covering
        // half the form. Finishing a single-line field is the moment a native app puts it away.
        context
            .getSystemService(InputMethodManager::class.java)
            ?.hideSoftInputFromWindow(windowToken, 0)
        true
      }
    }
  }

  override fun onSelectionChanged(selStart: Int, selEnd: Int) {
    super.onSelectionChanged(selStart, selEnd)
    // Guarded because this fires during construction, before the callback is attached.
    onSelectionUpdate?.invoke(selStart, selEnd)
  }

  /**
   * Applies the staged props as a set, once React has finished setting them for this update.
   *
   * The controlled write is the part worth reading. [propMostRecentEventCount] is how many of this
   * field's edits JavaScript has processed. While it trails [nativeEventCount] the incoming text was
   * computed without the keystrokes still on their way, and writing it would rewind the field under
   * the user's fingers — which is how a controlled input drops and transposes characters when
   * someone types quickly. A stale write is skipped rather than applied late: the update carrying
   * the current count is already coming.
   */
  fun commitProps() {
    applyInputType(propType, propInputMode, secure = propType == "password", spellCheck = propSpellCheck)
    applyEnterKeyHint(propEnterKeyHint, propType)

    val value = propValue
    if (value == null) {
      // Uncontrolled: `defaultValue` seeds the field once and is never written again, exactly as in
      // HTML — re-applying it on later updates would undo the user's typing.
      if (!hasAppliedDefaultValue) {
        hasAppliedDefaultValue = true
        writeText(propDefaultValue)
      }
      return
    }

    hasAppliedDefaultValue = true
    if (propMostRecentEventCount < nativeEventCount) {
      return
    }
    if (text?.toString().orEmpty() == value) {
      return
    }
    writeText(value)
  }

  private fun writeText(value: String) {
    isApplyingProps = true
    // The caret is placed rather than left where it was: after a write the old offset may not exist
    // in the new text. Holding it at the end matches what a field does when its value is replaced,
    // and a controlled field that echoes the value back unchanged never reaches here at all,
    // because of the equality check in [commitProps].
    setText(value)
    // Clamped to what actually landed, not to what was asked for. A filter may shorten the write —
    // `maxLength` truncates it, and read-only refused it outright before the guard in [applyFilters]
    // — and `setSelection` past the end of the buffer throws rather than clamping:
    // `setSpan (9 ... 9) ends beyond length 0`, which is a crash on the very first render of
    // `<textarea readOnly defaultValue="Read-only">`.
    //
    // But only while FOCUSED. On an unfocused EditText the selection also decides the scroll
    // position, and a caret parked at the end scrolled every overflowing value to show its TAIL —
    // `<input readOnly value="You can select this, not edit it"/>` rendered as ":an select this,
    // not edit it". A browser, a UITextField and Android's own unfocused fields all show the START
    // of an overflowing value; the caret's resting place only matters once the field has focus,
    // and a tap places it under the finger anyway.
    setSelection(if (isFocused) (text?.length ?: 0) else 0)
    isApplyingProps = false
  }

  /**
   * `readonly`, as distinct from `disabled`: the field can still be focused, and its text selected
   * and copied — it just cannot be edited.
   *
   * Android has no single flag for this. Clearing `isFocusable` would make it `disabled`, and
   * clearing `inputType` alone would take the text selection handles with it, so the edit is refused
   * by a filter while everything else about the field stays live.
   */
  fun setReadOnly(readOnly: Boolean) {
    if (isReadOnly == readOnly) {
      return
    }
    isReadOnly = readOnly
    applyFilters()
    showSoftInputOnFocus = !readOnly
  }

  private var maxLength: Int = -1

  fun setMaxLength(length: Int) {
    if (maxLength == length) {
      return
    }
    maxLength = length
    applyFilters()
  }

  /**
   * Asks JavaScript whether an edit may be applied, before the text is committed.
   *
   * `InputFilter` is Android's own pre-commit hook — it runs before the change
   * reaches the buffer and can substitute what goes in — which is why the answer
   * can be exact: refuse and nothing appears, substitute and only the
   * substitution appears. Nothing intermediate is ever drawn, which is the whole
   * point; correcting the field afterwards shows the rejected character for a
   * frame and reads as a glitch.
   */
  private fun beforeInputFilter(): InputFilter =
      InputFilter { source, start, end, dest, dstart, dend ->
        // Not for a prop write. `beforeinput` describes an edit the *user* is about to make; the
        // DOM does not fire it when the author assigns to `value`, and firing it here would both
        // report a change JavaScript itself just made and let a handler refuse it.
        if (isApplyingProps) {
          return@InputFilter null
        }
        val emitter =
            (context as? ReactContext)?.let { reactContext ->
              (UIManagerHelper.getUIManager(reactContext, UIManagerType.FABRIC)
                      as? FabricUIManager)
                  ?.getEventEmitter(UIManagerHelper.getSurfaceId(this), id)
            }
                ?: return@InputFilter null

        val prefix = dest.subSequence(0, dstart).toString()
        val suffix = dest.subSequence(dend, dest.length).toString()
        val proposed = prefix + source.subSequence(start, end).toString() + suffix

        val params = Arguments.createMap().apply { putString("value", proposed) }
        when (val result =
            emitter.dispatchCancelable(
                "topElementBeforeInput", params, SystemClock.uptimeMillis())) {
          is CancelableResult.Proceed -> null
          // Refused: nothing replaces the span, so the edit does not happen.
          is CancelableResult.Prevented -> ""
          is CancelableResult.Replace -> {
            val wanted = result.value
            if (wanted.startsWith(prefix) && wanted.endsWith(suffix) &&
                wanted.length >= prefix.length + suffix.length) {
              // The substitution only touches the edited span, which is the case
              // a filter can express exactly.
              wanted.substring(prefix.length, wanted.length - suffix.length)
            } else {
              // It changes text outside the edit — a filter cannot say that, so
              // the whole buffer is rewritten just after this returns. This is
              // the one path that can show a frame of the un-substituted text.
              post {
                if (text?.toString() != wanted) {
                  isApplyingProps = true
                  setText(wanted)
                  setSelection(wanted.length)
                  isApplyingProps = false
                }
              }
              null
            }
          }
        }
      }

  private fun applyFilters() {
    val filters = mutableListOf<InputFilter>()
    if (propHasBeforeInput) {
      // First, so JavaScript sees the edit before length and read-only rules
      // trim it — the same order the DOM uses.
      filters.add(beforeInputFilter())
    }
    if (maxLength >= 0) {
      filters.add(InputFilter.LengthFilter(maxLength))
    }
    if (isReadOnly) {
      // Rejecting every replacement by returning the existing text for the replaced span.
      //
      // Every replacement the *user* makes. `readonly` restrains the user, not the author: a
      // read-only field still shows its value, and in HTML it is submitted with the form. Without
      // the guard this filter also refused the write in [writeText], so
      // `<input readOnly defaultValue="…">` rendered permanently empty — and, because the caret
      // was then placed past the end of a buffer that had stayed empty, crashed before anyone
      // could see it.
      filters.add(
          InputFilter { _, _, _, dest, dstart, dend ->
            if (isApplyingProps) null else dest.subSequence(dstart, dend)
          })
    }
    setFilters(filters.toTypedArray())
  }

  /**
   * Maps the HTML type — or `inputmode`, which HTML defines as the more specific instruction — onto
   * the platform's input type and IME action.
   *
   * The mapping is stated here rather than shared with iOS because the platforms genuinely differ:
   * `search` is an IME action on Android and a return-key label on iOS, and a numeric field here
   * must ask for the sign and decimal separator explicitly or the user cannot type "-1.5".
   */
  private fun applyInputType(type: String, inputMode: String, secure: Boolean, spellCheck: Boolean) {
    val key = inputMode.ifEmpty { type }
    var inputTypeFlags =
        when (key) {
          "email" -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
          "url" -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
          "tel" -> InputType.TYPE_CLASS_PHONE
          "number",
          "numeric",
          "decimal" ->
              InputType.TYPE_CLASS_NUMBER or
                  InputType.TYPE_NUMBER_FLAG_DECIMAL or
                  InputType.TYPE_NUMBER_FLAG_SIGNED
          else -> InputType.TYPE_CLASS_TEXT
        }

    if (secure) {
      inputTypeFlags = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
    } else if (!spellCheck && (inputTypeFlags and InputType.TYPE_CLASS_TEXT) != 0) {
      inputTypeFlags = inputTypeFlags or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
    }

    if (isMultiline) {
      inputTypeFlags = inputTypeFlags or InputType.TYPE_TEXT_FLAG_MULTI_LINE
    }

    // Preserved across the write: `setInputType` resets the caret to the start, which throws the
    // cursor to the beginning of the field whenever an unrelated prop changes the type computation.
    val selection = selectionStart
    setInputType(inputTypeFlags)
    isSingleLine = !isMultiline
    if (selection in 0..text!!.length) {
      setSelection(selection)
    }
  }

  private fun applyEnterKeyHint(hint: String, type: String) {
    if (isMultiline) {
      // Return has to insert a newline. Any IME action here would take that key away and end the
      // edit instead, which makes a textarea impossible to type more than one line into.
      imeOptions = EditorInfo.IME_ACTION_NONE
      return
    }
    imeOptions =
        when (hint) {
          "done" -> EditorInfo.IME_ACTION_DONE
          "go" -> EditorInfo.IME_ACTION_GO
          "next" -> EditorInfo.IME_ACTION_NEXT
          "search" -> EditorInfo.IME_ACTION_SEARCH
          "send" -> EditorInfo.IME_ACTION_SEND
          "enter" -> EditorInfo.IME_ACTION_UNSPECIFIED
          // `<input type="search">` gets a search key without being asked, which is what the type
          // means and what a native search field does.
          else -> if (type == "search") EditorInfo.IME_ACTION_SEARCH else EditorInfo.IME_ACTION_DONE
        }
  }

  /** Reset for view recycling — the count must go with the text, or a reused view refuses writes. */
  fun resetForRecycle() {
    isApplyingProps = true
    setText("")
    isApplyingProps = false
    nativeEventCount = 0
    textAtFocus = ""
    hasAppliedDefaultValue = false
  }
}
