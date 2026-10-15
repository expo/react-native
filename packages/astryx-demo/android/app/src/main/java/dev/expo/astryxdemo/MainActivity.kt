/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package dev.expo.astryxdemo

import android.os.Bundle
import androidx.core.view.WindowCompat
import com.facebook.react.ReactActivity

class MainActivity : ReactActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    /*
     * Draw under the system bars, as the iOS app does, so a template's
     * safe-area insets are real
     */
    WindowCompat.setDecorFitsSystemWindows(window, false)
    super.onCreate(savedInstanceState)
  }

  override fun getMainComponentName(): String = "main"
}
