/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.InsetDrawable
import android.graphics.drawable.RippleDrawable
import com.facebook.react.uimanager.BackgroundStyleApplicator
import com.facebook.react.uimanager.PixelUtil
import com.facebook.react.uimanager.drawable.CompositeBackgroundDrawable
import kotlin.math.max
import kotlin.math.min

/**
 * The view backing `<button>`.
 *
 * Everything about *being pressed* — the state machine, the ripple, `touch-action`, the disabled
 * handling — lives in [ElementInteractiveBoxView] and is shared with `<a display:block>`, which
 * needs precisely the same behaviour. What is left here is what makes a button a button rather
 * than a pressable box: it announces itself as one, it is always interactive, and it can wear the
 * platform's own button chrome.
 */
internal class ElementButtonView(context: Context) : ElementInteractiveBoxView(context) {

  /**
   * The platform prominence ('prominent' | 'neutral'), and whether the author has claimed the
   * surface — both computed in JavaScript (Button.js), where the semantics and the style prop
   * live. Chrome is drawn only for a button that has a prominence and no author surface.
   */
  var buttonStyle: String? = null
  var hasAuthorChrome: Boolean = false

  /**
   * Whether the author's own styles answer a press (an `:active` rule, or any declaration varying
   * with the interaction state). When they do, the ripple stays away: two feedbacks arrive on
   * different clocks — the ripple at once, the author's over its transition — and the pair reads
   * as a glitch rather than as a response.
   */
  var authorStatesPressFeedback: Boolean = false
    set(value) {
      if (field != value) {
        field = value
        updatePressFeedback()
      }
    }

  /**
   * The button's menu, if it has one. A `<button>` containing a `<menu>` is a MENU BUTTON: one
   * tap opens the list, which is what the element means and what both platforms draw.
   */
  var menuCommands: List<MenuCommand> = emptyList()

  /** Reports the chosen command's `id` — not its index, which a re-render could invalidate. */
  var onCommand: ((String) -> Unit)? = null

  private var installedChrome = false
  private var installedChromeFill = 0
  private var installedChromeInset = -1
  private var installedChromeInsetH = -1

  init {
    // A button is interactive by definition; a box has to earn it.
    interactive = true
    // The user-agent accessibility default, matching what `ElementButtonProps`
    // sets for iOS. Android view props are applied by the ViewManager from the
    // JS payload rather than from the C++ props object, so the C++ default does
    // not reach this platform and has to be stated here as well.
    //
    // Both halves are needed: `getAccessibilityClassName()` only decides how the
    // node is *described*, and without being focusable and important the button
    // is not an accessibility node at all — TalkBack saw straight through it to
    // the `TextView` inside, which is how this was found.
    isFocusable = true
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
  }

  /**
   * Announce as a button to TalkBack, the counterpart of `UIAccessibilityTraitButton` on iOS.
   *
   * A `<button>` is a styled box rather than a `MaterialButton`, so nothing about the view itself
   * tells the accessibility framework what it is — without this it is read as a plain view and its
   * `disabled` state is not announced as a *button* being unavailable.
   */
  override fun getAccessibilityClassName(): CharSequence = "android.widget.Button"

  override fun updatePressFeedback() {
    if (!ripplesEnabled) {
      return
    }
    if (buttonStyle != null && !hasAuthorChrome) {
      updateMaterialChrome()
      return
    }
    // The author owns the surface (or this box is not a chrome-wearing button
    // at all): the box draws its own background and border, and the ripple
    // composites above them, masked to whatever shape they draw.
    if (installedChrome) {
      setPlatformChrome(null)
      installedChrome = false
      hasRipple = false
    }
    if (authorStatesPressFeedback) {
      // The author is drawing the press themselves; adding a ripple on top puts two answers to
      // one touch on the screen.
      if (hasRipple) {
        BackgroundStyleApplicator.setFeedbackUnderlay(this, null)
        hasRipple = false
      }
      return
    }
    installPlainRipple()
  }

  /**
   * The Material button construction, from the platform's own recipe.
   *
   * Material 3's button is not a coloured rectangle: it is a **pill inset 4dp top and bottom
   * inside a 48dp touch target** — the visible container is 40dp — with the ripple clipped to
   * that pill. CSS cannot inset a background from its own box, which is exactly why this is
   * drawn here rather than described in the user-agent stylesheet, and why the previous
   * CSS-described chrome was a Material-2-era 4dp rectangle filling the whole box.
   *
   * The colours are the theme's Material roles — filled is `colorPrimary`, tonal is
   * `colorSecondaryContainer` — resolved by NAME so this file takes no dependency on the
   * material library: the attributes exist in the app's merged resources whenever its theme is
   * a Material one, which is where they belong. A host app with no Material theme falls back
   * to the framework's own `colorButtonNormal`, which is that app's actual button colour.
   */
  /**
   * The tap opens the menu, drawn by the shared builder — see `presentElementMenu`.
   *
   * Opened HERE rather than from JavaScript's `click`. The list is already native — it arrives
   * as `menuCommands` — so going out to JavaScript and back would only put a round trip between
   * the finger and the menu.
   */
  override fun onActivated() {
    presentElementMenu(menuCommands) { id -> onCommand?.invoke(id) }
  }

  private fun updateMaterialChrome() {
    val prominent = buttonStyle == "prominent"
    val fill =
        (if (prominent) resolveThemeColorByName("colorPrimary")
        else resolveThemeColorByName("colorSecondaryContainer"))
            ?: resolveThemeColor(android.R.attr.colorButtonNormal)
            ?: return
    val insetV = chromeInset()
    // A SQUARE button is an icon button, and Material's container for one is 40dp on both axes
    // inside its 48dp target — so the inset applies to the width as well, and the pill it leaves
    // is a circle. A wider button is a text button, whose container is as wide as the box.
    val insetH = if (width == height) insetV else 0
    if (installedChrome &&
        installedChromeFill == fill &&
        installedChromeInset == insetV &&
        installedChromeInsetH == insetH) {
      return
    }
    fun pill(color: Int): Drawable =
        InsetDrawable(
            GradientDrawable().apply {
              setColor(color)
              // A capsule at any height: the radius is clamped to half the bounds.
              cornerRadius = 1e4f
            },
            insetH,
            insetV,
            insetH,
            insetV,
        )
    setPlatformChrome(pill(fill))
    val highlight = resolveThemeColor(android.R.attr.colorControlHighlight)
    if (highlight != null) {
      BackgroundStyleApplicator.setFeedbackUnderlay(
          this,
          RippleDrawable(ColorStateList.valueOf(highlight), null, pill(Color.WHITE)),
      )
    }
    installedChrome = true
    installedChromeFill = fill
    installedChromeInset = insetV
    installedChromeInsetH = insetH
    hasRipple = highlight != null
  }

  /**
   * How far the pill sits inside this button's box, top and bottom.
   *
   * The 4dp is the difference between Material's 48dp touch target and the 40dp container inside
   * it, so it is only there to be given away by a box that big. A button the author sized smaller
   * has nothing to spare, and insetting anyway draws a lozenge where the platform's own icon
   * button is a circle — 40dp wide and 32 tall, at the size a composer's `+` is.
   */
  private fun chromeInset(): Int =
      min(PixelUtil.toPixelFromDIP(4f), max(0f, (height - PixelUtil.toPixelFromDIP(40f)) / 2f))
          .toInt()

  /**
   * Install or remove this button's own platform chrome, UNDER everything React draws.
   *
   * Not `background = drawable`. React keeps the view's background colour, border, radii and
   * shadows inside one `CompositeBackgroundDrawable` held in that same slot, so assigning it
   * replaces all of them and assigning `null` destroys them — and nothing rebuilds them, because
   * no prop changed. The chrome belongs in the composite's own "background this view already had"
   * layer, which is exactly what it is.
   *
   * This is not hypothetical: a `<button>` whose fill comes from a stylesheet gets that fill a
   * render AFTER its first, so it wears the Material chrome briefly and then takes it off — and
   * taking it off used to take the author's fill with it. Every shadcn button rendered with no
   * background at all on Android while looking correct on iOS.
   */
  private fun setPlatformChrome(chrome: Drawable?) {
    val existing = background
    background =
        if (existing is CompositeBackgroundDrawable) existing.withNewOriginalBackground(chrome)
        else chrome
  }

  private fun resolveThemeColorByName(name: String): Int? {
    @SuppressLint("DiscouragedApi")
    val attr = context.resources.getIdentifier(name, "attr", context.packageName)
    if (attr == 0) {
      return null
    }
    return resolveThemeColor(attr)
  }
}
