/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.bridge

/** Crashy crashy exception handler. */
public class DefaultJSExceptionHandler : JSExceptionHandler {
  public override fun handleException(e: Exception) {
    try {
        run {
            if (e is RuntimeException) {
                throw e
            } else {
                throw RuntimeException(e)
            }
        }
    } catch (expoException: RuntimeException) {
        try {
            Class.forName("host.exp.exponent.ReactNativeStaticHelpers").getMethod(
                "handleReactNativeError",
                String::class.java,
                Any::class.java,
                Int::class.java,
                Boolean::class.java
            ).invoke(null, expoException.message, null, -1, true)
        } catch (expoHandleErrorException: Exception) {
            expoHandleErrorException.printStackTrace()
        }
    }
}
}
