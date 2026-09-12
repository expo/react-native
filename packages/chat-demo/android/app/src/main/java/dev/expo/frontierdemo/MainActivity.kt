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
     * Edge to edge, deliberately and explicitly.
     *
     * This is the whole reason the app exists. In RN Tester nothing inside the
     * React Native surface ever overlaps a system bar — measured, the scroll view
     * sat at y=535 with a height of 1631 in a 2400-tall window whose bars were
     * [0,136,0,63], so the safe-area reservation correctly computes zero and
     * cannot be judged by looking. Why RN Tester's content lands there was not
     * established; what was established is that it does.
     */
    WindowCompat.setDecorFitsSystemWindows(window, false)
    super.onCreate(savedInstanceState)
  }

  override fun getMainComponentName(): String = "ChatDemo"

  /**
   * The collapsing toolbar is OPT-IN, and off by default:
   *
   *     adb shell am start -n dev.expo.frontierdemo/.MainActivity --ez toolbar true
   *
   * Because `CoordinatorLayout`'s scrolling-view behaviour gives its child the FULL window height
   * and then offsets it down by the bar — that is how content scrolls under a collapsing toolbar —
   * so the child extends below the window by exactly the bar's height. Correct for a list, and
   * wrong for anything pinned to the bottom: the chat's composer landed 168px below the screen and
   * only its top 22px were visible. It also inflated `env(safe-area-inset-bottom)` from 24 to 88
   * before that was clamped.
   *
   * That is Android behaving as documented, not a defect: a bottom bar belongs outside the
   * `CoordinatorLayout`. But it makes the toolbar the wrong default for an app whose other two
   * screens have a composer, so it is now something you ask for when you want to watch nested
   * scrolling work.
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      if (intent?.getBooleanExtra("toolbar", false) == true) {
        CollapsingToolbarDelegate(this, mainComponentName)
      } else {
        DefaultReactActivityDelegate(this, mainComponentName)
      }
}

/**
 * Puts the React surface inside native chrome instead of straight into the window.
 *
 * `ReactActivityDelegate.loadApp` calls `setContentView(reactRootView)`, so by default the React
 * surface IS the window's content and there is nothing native around it. Here it goes inside a
 * `CoordinatorLayout` with a real `AppBarLayout` above it — the ordinary shape of an Android
 * screen, and the one that cannot be faked from JavaScript.
 *
 * It is also the test. The toolbar collapses when the list inside the React surface is dragged,
 * and it can only learn about that drag if the scrolling view announces it through the platform's
 * nested-scrolling protocol. `<native:scroll>` does. `<ScrollView>` does not — it extends
 * `android.widget.ScrollView`, which implements none of it — so the same screen with the same
 * gesture leaves the toolbar exactly where it is.
 */
private class CollapsingToolbarDelegate(activity: ReactActivity, mainComponentName: String) :
    DefaultReactActivityDelegate(activity, mainComponentName) {

  override fun loadApp(appKey: String?) {
    val activity = plainActivity
    activity.setContentView(R.layout.main)
    reactDelegate!!.loadApp(requireNotNull(appKey))
    val root = requireNotNull(reactDelegate!!.reactRootView) { "React root view was not created." }
    // Removed from any previous parent first: a re-created activity reuses the delegate's root
    // view, and adding a view that still has a parent throws.
    (root.parent as? ViewGroup)?.removeView(root)
    activity.findViewById<FrameLayout>(R.id.react_container).addView(root)
  }
}
