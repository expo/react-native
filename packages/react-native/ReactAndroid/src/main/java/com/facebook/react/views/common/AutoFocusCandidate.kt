/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.common

import android.view.View
import android.view.ViewTreeObserver

/**
 * A field's `autoFocus`, processed as HTML processes `autofocus`: the field becomes a candidate when
 * it is first attached, the candidate is flushed at the next rendering opportunity (the first draw
 * after the attach, when the mount that attached it has also hidden or shown its ancestors), and
 * the field is focused then only if it is being rendered. Otherwise the candidate is dropped.
 *
 * `display: none` mounts as an INVISIBLE view, and Android lets a view under an invisible ancestor
 * take focus, after which the keyboard comes up for a field nobody can see: a closed dialog's field
 * on the page that holds the dialog. The dialog focuses that field when it opens, as the dialog
 * focusing steps do.
 *
 * [focus] is how the field takes focus.
 */
internal class AutoFocusCandidate(private val view: View, private val focus: () -> Unit) {

  /** The `autoFocus` prop. */
  var isRequested: Boolean = false
    set(value) {
      field = value
      awaitFlush()
    }

  // Whether the candidate was flushed, focused or dropped: once in the view's life
  private var isFlushed = false

  // The observer whose next draw flushes the candidate, while one is awaited
  private var observer: ViewTreeObserver? = null

  private val flushAtDraw =
      ViewTreeObserver.OnPreDrawListener {
        flush()
        true
      }

  init {
    view.addOnAttachStateChangeListener(
        object : View.OnAttachStateChangeListener {
          override fun onViewAttachedToWindow(attached: View) {
            awaitFlush()
          }

          override fun onViewDetachedFromWindow(detached: View) {
            stopAwaitingFlush()
          }
        }
    )
  }

  private fun awaitFlush() {
    if (!isRequested || isFlushed || !view.isAttachedToWindow || observer != null) {
      return
    }
    observer = view.viewTreeObserver.also { it.addOnPreDrawListener(flushAtDraw) }
  }

  private fun stopAwaitingFlush() {
    observer?.let {
      if (it.isAlive) {
        it.removeOnPreDrawListener(flushAtDraw)
      }
    }
    observer = null
  }

  private fun flush() {
    stopAwaitingFlush()
    isFlushed = true
    if (isRequested && view.isShown) {
      focus()
    }
  }
}
