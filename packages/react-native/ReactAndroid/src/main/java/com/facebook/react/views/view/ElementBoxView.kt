/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import android.content.Context

/**
 * The view backing `element-box` — the box any block-level element generates.
 *
 * It is a plain [ReactViewGroup] for almost every element that reaches it, and deliberately so:
 * this backs every `<div>`, `<p>`, `<section>` and `<li>` on the screen, none of which should be
 * clickable, focusable, or draw feedback under a finger.
 *
 * The exception is `<a href>` with `display: block`. An anchor is not always a run of glyphs — an
 * author can make it a box, and then it is a tappable box, which on Android means a **ripple**.
 * That is not a house style: Material's press state *is* the ripple, and a tappable card or row
 * without one does not read as tappable. Feedback on this platform follows the SHAPE rather than
 * the semantic, which is why a block anchor ripples while an inline link — a run of glyphs — gets
 * nothing at all. Both were measured against the platform:
 *
 *  - a clickable box with `?attr/selectableItemBackground` ripples;
 *  - a `TextView` link under `LinkMovementMethod` shows nothing on press unless the view is
 *    focused, and Material 3's own link style in Compose supplies a colour and an underline and
 *    **no pressed style at all**.
 *
 * So the asymmetry between our two anchor shapes is Android's, not ours.
 */
internal class ElementBoxView(context: Context) : ElementInteractiveBoxView(context) {

  /**
   * The link's destination, or null for a box that is not a link.
   *
   * Only its presence is used here — following the link is done in JavaScript, where a `click`
   * arrives the same way for all three anchor shapes. What this decides is whether the box behaves
   * like something that can be pressed.
   */
  var href: String? = null
    set(value) {
      if (field == value) {
        return
      }
      field = value
      // Recycling matters here: a pooled view that was a link must stop being one, or a `<div>`
      // gets a ripple it never asked for.
      interactive = value != null
    }

  /**
   * Whether a hold on this box is a CONTEXT MENU — `contextmenu`, the event a browser fires when
   * a finger rests on an element.
   *
   * Android's answer to iOS's `UIContextMenuInteraction` is the long press, and the base class
   * tracks it on the platform's own clock and slop — see [holdable], and the note there on why
   * `setOnLongClickListener` cannot be used at all in a React Native view.
   *
   * A box does NOT become [interactive] for this. Interactive means pressable: clickable, and on
   * this platform a ripple, which is what a tappable card looks like. A box that can be held is
   * not a box that can be tapped, and giving every one of them a ripple would be exactly the
   * regression [ElementInteractiveBoxView] exists to avoid.
   */
  var wantsContextMenu: Boolean = false
    set(value) {
      if (field == value) {
        return
      }
      field = value
      holdable = value
    }

  /** What the hold PRESENTS, from a `<menu>` child. Empty is the report alone. */
  var menuCommands: List<MenuCommand> = emptyList()

  /** Reports the chosen command's `id` — not its index, which a re-render could invalidate. */
  var onCommand: ((String) -> Unit)? = null

  /** The hold completed. Published whether or not there was a menu to draw. */
  var onContextMenu: (() -> Unit)? = null

  /**
   * The hold's result: the platform's menu when there is one, the EVENT when there is not.
   *
   * Not both, and that is the same rule iOS takes. A box with a `<menu>` gets the platform's
   * menu, and that IS the event happening — an app told about it as well draws its own picker
   * over the platform's, which is exactly what it did here: the demo's replica and a `PopupMenu`
   * on screen together, from one press. A box with no menu gets nothing drawn, and then the app
   * is the only thing that can say what a hold means.
   */
  override fun onHeld() {
    if (menuCommands.isEmpty()) {
      onContextMenu?.invoke()
      return
    }
    presentElementMenu(menuCommands) { id -> onCommand?.invoke(id) }
  }
}
