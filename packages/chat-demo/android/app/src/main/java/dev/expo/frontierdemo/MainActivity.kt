/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package dev.expo.frontierdemo

import android.os.Bundle
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.core.view.WindowCompat
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    /*
     * Draw under the system bars, so the safe-area insets this demo tests are
     * non-zero. See ui-metrics.md, "RN Tester content never reaches the system
     * bars".
     */
    WindowCompat.setDecorFitsSystemWindows(window, false)
    super.onCreate(savedInstanceState)
  }

  override fun getMainComponentName(): String = "ChatDemo"

  /**
   * The collapsing toolbar, for testing nested scrolling, is off unless the activity is started
   * with:
   *
   *     adb shell am start -n dev.expo.frontierdemo/.MainActivity --ez toolbar true
   *
   * It is off by default because `CoordinatorLayout` makes the React surface as tall as the window
   * and shifts it down by the toolbar's height, which pushes the chat's composer off the bottom of
   * the screen. See ui-metrics.md, "Composer under the collapsing toolbar".
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      if (intent?.getBooleanExtra("toolbar", false) == true) {
        CollapsingToolbarDelegate(this, mainComponentName)
      } else {
        DefaultReactActivityDelegate(this, mainComponentName)
      }
}

/**
 * Puts the React surface in a `CoordinatorLayout` below a native `AppBarLayout`
 * (`res/layout/main.xml`). The toolbar collapses only if the scrolling view inside the surface
 * supports Android nested scrolling: `<native:scroll>` does, `<ScrollView>` doesn't.
 */
private class CollapsingToolbarDelegate(activity: ReactActivity, mainComponentName: String) :
    DefaultReactActivityDelegate(activity, mainComponentName) {

  override fun loadApp(appKey: String?) {
    val activity = plainActivity
    activity.setContentView(R.layout.main)
    reactDelegate!!.loadApp(requireNotNull(appKey))
    val root = requireNotNull(reactDelegate!!.reactRootView) { "React root view was not created." }
    // A re-created activity reuses the delegate's root view, and `addView` throws if the view still
    // has a parent.
    (root.parent as? ViewGroup)?.removeView(root)
    activity.findViewById<FrameLayout>(R.id.react_container).addView(root)
  }
}
