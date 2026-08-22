/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.fabric.events

import android.annotation.SuppressLint
import com.facebook.jni.HybridClassBase
import com.facebook.proguard.annotations.DoNotStripAny
import com.facebook.react.bridge.NativeMap
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap
import com.facebook.react.fabric.FabricSoLoader.staticInit
import com.facebook.react.uimanager.events.EventCategoryDef

/**
 * This class holds reference to the C++ EventEmitter object. Instances of this class are created in
 * FabricMountingManager.cpp, where the pointer to the C++ event emitter is set.
 */
@DoNotStripAny
@SuppressLint("MissingNativeLoadLibrary")
/** What JavaScript decided about an event dispatched through [EventEmitterWrapper.dispatchCancelable]. */
internal sealed interface CancelableResult {
  /** Nobody objected; carry on. */
  object Proceed : CancelableResult

  /** `preventDefault()` — the default action must not happen. */
  object Prevented : CancelableResult

  /** `setValue(text)` — the default action happens with this value instead. */
  data class Replace(val value: String) : CancelableResult
}

internal class EventEmitterWrapper private constructor() : HybridClassBase() {


  private external fun dispatchEvent(
      eventName: String,
      params: NativeMap?,
      @EventCategoryDef category: Int,
      eventTimestamp: Long,
  )

  /*
   * Returns the decision, encoded: null means proceed unchanged, "\u0001" means
   * refused, and anything else is the value to use instead. See the C++ side.
   */
  private external fun dispatchCancelableEventSynchronously(
      eventName: String,
      params: NativeMap?,
      eventTimestamp: Long,
  ): String?

  private external fun dispatchEventSynchronously(
      eventName: String,
      params: NativeMap?,
      eventTimestamp: Long,
  )

  private external fun dispatchUniqueEvent(
      eventName: String,
      params: NativeMap?,
      eventTimestamp: Long,
  )

  /**
   * Invokes the execution of the C++ EventEmitter.
   *
   * @param eventName [String] name of the event to execute.
   * @param params [WritableMap] payload of the event
   * @param eventCategory event category
   * @param eventTimestamp timestamp when the event was triggered (in milliseconds since boot)
   */
  @Synchronized
  fun dispatch(
      eventName: String,
      params: WritableMap?,
      @EventCategoryDef eventCategory: Int,
      eventTimestamp: Long,
  ) {
    if (!isValid) {
      return
    }
    dispatchEvent(eventName, params as NativeMap?, eventCategory, eventTimestamp)
  }

  @Synchronized
  /**
   * Asks JavaScript about something that has not happened yet, and waits.
   *
   * Only for a platform callback that must answer before it returns — a control
   * asking whether an edit may be applied. Blocks both threads for the duration
   * of the handler.
   */
  fun dispatchCancelable(
      eventName: String,
      params: WritableMap?,
      eventTimestamp: Long,
  ): CancelableResult {
    if (!isValid) {
      return CancelableResult.Proceed
    }
    val encoded =
        dispatchCancelableEventSynchronously(eventName, params as NativeMap?, eventTimestamp)
    return when {
      encoded == null -> CancelableResult.Proceed
      encoded == PREVENTED -> CancelableResult.Prevented
      else -> CancelableResult.Replace(encoded)
    }
  }

  fun dispatchEventSynchronously(eventName: String, params: WritableMap?, eventTimestamp: Long) {
    if (!isValid) {
      return
    }
    UiThreadUtil.assertOnUiThread()
    dispatchEventSynchronously(eventName, params as NativeMap?, eventTimestamp)
  }

  /**
   * Invokes the execution of the C++ EventEmitter. C++ will coalesce events sent to the same
   * target.
   *
   * @param eventName [String] name of the event to execute.
   * @param params [WritableMap] payload of the event
   * @param eventTimestamp timestamp when the event was triggered (in milliseconds since boot)
   */
  @Synchronized
  fun dispatchUnique(eventName: String, params: WritableMap?, eventTimestamp: Long) {
    if (!isValid) {
      return
    }
    dispatchUniqueEvent(eventName, params as NativeMap?, eventTimestamp)
  }

  @Synchronized
  fun destroy() {
    if (isValid) {
      resetNative()
    }
  }

  private companion object {
    /** Matches the marker the C++ side writes; see its comment for why a control character. */
    const val PREVENTED: String = "\u0001"

    init {
      staticInit()
    }
  }
}
