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
import android.os.SystemClock
import android.text.Editable
import android.text.InputFilter
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
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
import com.facebook.react.uimanager.drawable.CompositeBackgroundDrawable

/**
 * `<input>`'s textual types, backed by an [AppCompatEditText] so the element inherits selection
 * handles, the magnifier, IME behaviour, autofill and TalkBack. AppCompat specifically: a plain
 * [EditText] resolves `android:editTextStyle` against the platform theme, which under an AppCompat
 * theme leaves the field with no background. [commitProps] carries the controlled-input handshake;
 * see `ElementTextInputEventEmitter::onElementInput` for the event count.
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
  var propAutoCorrect: Boolean = true
  var propEnterKeyHint: String = ""
  var propValue: String? = null
  var propDefaultValue: String = ""
  var propMostRecentEventCount: Int = 0

  /**
   * Whether a `beforeinput` handler exists.
   *
   * The synchronous path blocks both threads for the duration of the handler, so it is only taken
   * when something is actually going to use it. A field without one types exactly as it did before.
   */
  var propHasBeforeInput: Boolean = false
    set(value) {
      if (field != value) {
        field = value
        applyFilters()
      }
    }

  /**
   * The input type last handed to [setInputType]; see [applyInputType] for why it is remembered.
   */
  private var appliedInputType: Int? = null

  private var hasAppliedDefaultValue = false

  /**
   * Suppresses the input callback while a prop write is in flight, so it is not read back as
   * typing.
   */
  private var isApplyingProps = false

  /** The text as it was when editing began, for deciding whether `change` is owed on blur. */
  private var textAtFocus: String = ""

  private var isReadOnly = false

  /**
   * The Material underline, which thickens and takes the accent colour on focus. Drawn rather than
   * inherited: `Widget.Material.EditText`'s background is an untinted alpha mask reached through an
   * InsetDrawable, and a view constructed programmatically under an AppCompat theme gets it tinted
   * by neither the platform nor AppCompat, so it is invisible. Every colour comes from the theme.
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
    platformFieldChrome = states
    background = states
    setPadding(padLeft, padTop, padRight, padBottom)
  }

  /** The rule above, kept so it can be taken away and put back. */
  private var platformFieldChrome: Drawable? = null

  /**
   * An author's border or background replaces the platform's underline, as an author box replaces a
   * browser's UA border. The signal is the composite background React Native builds for the view,
   * which grows a `border` layer for any stated border width, including zero, and a `background`
   * layer for a fill.
   */
  private fun syncPlatformFieldChrome() {
    val composite = background as? CompositeBackgroundDrawable ?: return
    val authorStatedTheBox = composite.border != null || composite.background != null
    val wanted = if (authorStatedTheBox) null else platformFieldChrome
    if (composite.originalBackground === wanted) {
      return
    }
    background = composite.withNewOriginalBackground(wanted)
  }

  init {
    applyPlatformFieldChrome()

    // A single-line field, unless a subclass says otherwise. Without this an `<input>` would accept
    // newlines and grow, which is what `<textarea>` is for.
    isSingleLine = !isMultiline
    if (!isMultiline) {
      // Material centres a filled field's text in its 56dp container; the
      // vertical position comes from gravity, not from padding, so the
      // Yoga-forwarded padding (inline 16dp, block none) lands on a field
      // whose text is already where the spec puts it.
      gravity = android.view.Gravity.CENTER_VERTICAL or android.view.Gravity.START
    }

    addTextChangedListener(
        object : TextWatcher {
          override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) =
              Unit

          override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit

          override fun afterTextChanged(s: Editable?) {
            if (isApplyingProps) {
              return
            }
            nativeEventCount++
            onTextInput?.invoke(s?.toString().orEmpty(), nativeEventCount)
          }
        }
    )

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
        // And the keyboard goes away: clearing focus alone does not dismiss the IME, and finishing
        // a single-line field is the moment a native app puts it away
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
   * Applies the staged props as a set. While [propMostRecentEventCount] trails [nativeEventCount]
   * there are keystrokes in flight and the incoming text was computed without them, so a stale
   * write is skipped; the update carrying the current count is on its way.
   */
  fun commitProps() {
    syncPlatformFieldChrome()
    applyInputType(
        propType,
        propInputMode,
        secure = propType == "password",
        spellCheck = propSpellCheck,
        autoCorrect = propAutoCorrect,
    )
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
    // Replace only the span that differs, through `Editable.replace`, so the caret keeps its place
    // as it does under `replaceRange:withText:` on iOS. Boundaries snap to whole code points
    val current = text?.toString() ?: ""
    val editable = editableText
    if (editable != null && current != value && current.isNotEmpty() && value.isNotEmpty()) {
      val span = DifferingSpan.between(current, value)
      try {
        editable.replace(span.start, span.endInCurrent, value.substring(span.start, span.endInNext))
      } finally {
        // The guard has to come off even if the buffer refuses the edit: leaving it on makes the
        // view ignore every edit the user makes from here, which is a worse failure than the one
        // that got us here.
        isApplyingProps = false
      }
      return
    }
    setText(value)
    // Clamped to what landed, since a filter may shorten the write and `setSelection` past the end
    // throws. Only while focused: on an unfocused EditText the selection decides the scroll
    // position, and a caret at the end would show the tail of an overflowing value where every
    // platform shows the start
    setSelection(if (isFocused) (text?.length ?: 0) else 0)
    isApplyingProps = false
  }

  /**
   * `readonly` keeps the field focusable and its text selectable. Android has no single flag for
   * that: clearing `isFocusable` is `disabled`, and clearing `inputType` loses the selection
   * handles, so a filter refuses the edit instead.
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
   * `beforeinput`, answered inside Android's own pre-commit hook: an `InputFilter` runs before the
   * change reaches the buffer and can substitute what goes in, so nothing intermediate is drawn.
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
              (UIManagerHelper.getUIManager(reactContext, UIManagerType.FABRIC) as? FabricUIManager)
                  ?.getEventEmitter(UIManagerHelper.getSurfaceId(this), id)
            } ?: return@InputFilter null

        val prefix = dest.subSequence(0, dstart).toString()
        val suffix = dest.subSequence(dend, dest.length).toString()
        val proposed = prefix + source.subSequence(start, end).toString() + suffix

        val params = Arguments.createMap().apply { putString("value", proposed) }
        when (
            val result =
                emitter.dispatchCancelable(
                    "topElementBeforeInput",
                    params,
                    SystemClock.uptimeMillis(),
                )
        ) {
          is CancelableResult.Proceed -> null
          // Refused: nothing replaces the span, so the edit does not happen.
          is CancelableResult.Prevented -> ""
          is CancelableResult.Replace -> {
            val wanted = result.value
            if (
                wanted.startsWith(prefix) &&
                    wanted.endsWith(suffix) &&
                    wanted.length >= prefix.length + suffix.length
            ) {
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
      // Reject the user's replacements by returning the existing text for the span; `readonly`
      // restrains the user, not the author's write in [writeText]
      filters.add(
          InputFilter { _, _, _, dest, dstart, dend ->
            if (isApplyingProps) null else dest.subSequence(dstart, dend)
          }
      )
    }
    setFilters(filters.toTypedArray())
  }

  /**
   * Maps the HTML type, or the more specific `inputmode`, onto the platform's input type and IME
   * action. Not shared with iOS: `search` is an IME action here and a return-key label there, and a
   * numeric field must ask for the sign and decimal separator explicitly.
   */
  private fun applyInputType(
      type: String,
      inputMode: String,
      secure: Boolean,
      spellCheck: Boolean,
      autoCorrect: Boolean,
  ) {
    val key = inputMode.ifEmpty { type }
    var inputTypeFlags =
        when (key) {
          // DOM-CSS-LIMITATION(android-no-spellcheck-on-email-or-url): `isSuggestionsEnabled()`
          // is false for every variation but plain text, so these keyboards turn the spell
          // checker off; the keyboard is the more visible half and wins
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
    } else if ((inputTypeFlags and InputType.TYPE_CLASS_TEXT) != 0) {
      if (autoCorrect) {
        inputTypeFlags = inputTypeFlags or InputType.TYPE_TEXT_FLAG_AUTO_CORRECT
      }
      // DOM-CSS-LIMITATION(android-spellcheck-implies-autocorrect):
      // `TextView.isSuggestionsEnabled()` gates the spell checker and the IME's suggestion strip
      // together, so `spellcheck="false"` takes autocorrection with it; turning off more than the
      // author asked beats leaving on the thing they named
      if (!spellCheck) {
        inputTypeFlags =
            (inputTypeFlags or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS) and
                InputType.TYPE_TEXT_FLAG_AUTO_CORRECT.inv()
      }
    }

    if (isMultiline) {
      inputTypeFlags = inputTypeFlags or InputType.TYPE_TEXT_FLAG_MULTI_LINE
    }

    // Applied only on change: `TextView.setInputType` ends with `imm.restartInput(this)` on every
    // call, which drops the IME's composing region, and [commitProps] runs on every prop update.
    // Tracked in a field rather than compared against `inputType` because the first application
    // must happen even when the flags match the widget's default
    if (appliedInputType != inputTypeFlags) {
      appliedInputType = inputTypeFlags
      // Preserved across the write: `setInputType` resets the caret to the start, which throws the
      // cursor to the beginning of the field whenever an unrelated prop changes the type
      // computation.
      val selection = selectionStart
      // Single line FIRST, then the type. `setSingleLine` installs a single-line transformation
      // method, and after the type it replaced the password one `setInputType` had just installed:
      // a `type="password"` field drew its value in the password font and in plain text. The type
      // derives single-line from the same flags, so it only confirms this.
      isSingleLine = !isMultiline
      setInputType(inputTypeFlags)
      if (selection in 0..text!!.length) {
        setSelection(selection)
      }
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

  /**
   * Reset for view recycling — the count must go with the text, or a reused view refuses writes.
   */
  fun resetForRecycle() {
    isApplyingProps = true
    setText("")
    isApplyingProps = false
    nativeEventCount = 0
    textAtFocus = ""
    hasAppliedDefaultValue = false
    // A recycled view is handed to a different element: the remembered type belongs to the old one,
    // and keeping it would skip the application the new element needs.
    appliedInputType = null
  }
}

/** The stretch of two strings that actually differs, in UTF-16 offsets. */
internal data class DifferingSpan(val start: Int, val endInCurrent: Int, val endInNext: Int) {

  companion object {
    /**
     * The span to replace so that `current` becomes `next` with everything either side untouched.
     * Testable on its own because many boundaries spell `next` and only a wrong one splits a
     * surrogate pair or drags the caret. Boundaries move off a partial character and may only
     * shrink the common run, never extend it.
     */
    fun between(current: String, next: String): DifferingSpan {
      val shorter = minOf(current.length, next.length)

      var prefix = 0
      while (prefix < shorter && current[prefix] == next[prefix]) {
        prefix++
      }
      // A low surrogate here means the common run ends INSIDE a pair: give the high half back.
      if (
          prefix > 0 &&
              prefix < current.length &&
              Character.isLowSurrogate(current[prefix]) &&
              Character.isHighSurrogate(current[prefix - 1])
      ) {
        prefix--
      }

      var suffix = 0
      while (
          suffix < shorter - prefix &&
              current[current.length - 1 - suffix] == next[next.length - 1 - suffix]
      ) {
        suffix++
      }
      // Same test at the other end, and note which surrogate is asked about. The suffix runs from
      // this index to the end, so a HIGH surrogate here is a whole pair already inside it and needs
      // nothing; it is a LOW one — its partner left outside — that straddles the boundary. Nudging
      // on the high surrogate instead splits the very pair the snap exists to protect.
      val boundary = current.length - suffix
      if (
          suffix > 0 &&
              boundary > 0 &&
              Character.isLowSurrogate(current[boundary]) &&
              Character.isHighSurrogate(current[boundary - 1])
      ) {
        suffix--
      }

      return DifferingSpan(prefix, current.length - suffix, next.length - suffix)
    }
  }
}
