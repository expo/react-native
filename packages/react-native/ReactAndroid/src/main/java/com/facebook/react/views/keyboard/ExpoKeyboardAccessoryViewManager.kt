/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.keyboard

import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewGroupManager

/**
 * View manager for `<native:keyboardaccessory>`.
 *
 * No props. The element takes none: a bar docked to the keyboard is one behaviour, not a family
 * of them, and everything an author would want to vary — where it sits, how tall it is, what is in
 * it — is style and children.
 *
 * One EVENT, though: whether the bar is resting on the screen or docked to the keys. That cannot be
 * style, because nothing in the shadow tree knows it — see [ExpoKeyboardDockEvent].
 */
@ReactModule(name = ExpoKeyboardAccessoryViewManager.REACT_CLASS)
public class ExpoKeyboardAccessoryViewManager : ViewGroupManager<ExpoKeyboardAccessoryView>() {

  public companion object {
    /** Matches `ExpoKeyboardAccessoryComponentName` in C++. */
    public const val REACT_CLASS: String = "native-keyboardaccessory"
  }

  override fun getName(): String = REACT_CLASS

  override fun createViewInstance(context: ThemedReactContext): ExpoKeyboardAccessoryView =
      ExpoKeyboardAccessoryView(context)

  /*
   * Declared here or the event is dropped on the way to JavaScript, exactly as an
   * undeclared PROP is dropped on the way down. Two registries, one rule.
   */
  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> =
      mutableMapOf(
          ExpoKeyboardDockEvent.EVENT_NAME to mapOf("registrationName" to "onDockChange"))
}
