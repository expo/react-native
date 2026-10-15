/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package dev.expo.astryxdemo

import android.graphics.Rect
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import androidx.core.view.doOnPreDraw
import androidx.fragment.app.FragmentContainerView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.slidingpanelayout.widget.SlidingPaneLayout
import androidx.transition.ChangeBounds
import androidx.transition.TransitionManager
import androidx.window.layout.FoldingFeature
import androidx.window.layout.WindowInfoTracker
import com.facebook.react.ReactActivity
import kotlinx.coroutines.launch

/** Native list/detail screens; SlidingPaneLayout owns fold layout and animation. */
class MainActivity : ReactActivity() {
  private lateinit var panes: SlidingPaneLayout
  private var activeFold = false
  private var detailRequested = false
  private var lastTwoPane: Boolean? = null
  private var lastCanToggle: Boolean? = null
  private var lastGalleryFold: Boolean? = null
  private var lastDivision = Rect()
  private var division = Rect()
  private var pendingPresentation = false
  private var appliedPaneState: Triple<Boolean, Boolean, Boolean>? = null
  private var sidebarPreference: Boolean? = null
  private lateinit var back: OnBackPressedCallback

  val isTwoPane: Boolean
    get() =
        sidebarPreference == true && ::panes.isInitialized && panes.width > 0 && !panes.isSlideable

  val canToggleSidebar: Boolean
    get() = ::panes.isInitialized && panes.width >= dp(600)

  val isGalleryFold: Boolean
    get() = activeFold && sidebarPreference != true

  val divisionStart: Double
    get() = division.left / resources.displayMetrics.density.toDouble()

  val divisionWidth: Double
    get() = division.width() / resources.displayMetrics.density.toDouble()

  override fun getMainComponentName(): String? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    WindowCompat.setDecorFitsSystemWindows(window, false)
    super.onCreate(savedInstanceState)
    val preferences = getPreferences(MODE_PRIVATE)
    sidebarPreference =
        if (preferences.contains("sidebar")) preferences.getBoolean("sidebar", false) else null
    panes = SlidingPaneLayout(this).apply { lockMode = SlidingPaneLayout.LOCK_MODE_LOCKED }
    val catalog = FragmentContainerView(this).apply { id = R.id.astryx_catalog }
    val detail = FragmentContainerView(this).apply { id = R.id.astryx_detail }
    panes.addView(
        catalog,
        SlidingPaneLayout.LayoutParams(dp(280), ViewGroup.LayoutParams.MATCH_PARENT).apply {
          weight = 1f
        },
    )
    panes.addView(
        detail,
        SlidingPaneLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            .apply { weight = 1f },
    )
    setContentView(panes)
    if (savedInstanceState == null) {
      supportFragmentManager
          .beginTransaction()
          .replace(R.id.astryx_catalog, ReactPaneFragment.create("AstryxCatalog"))
          .replace(R.id.astryx_detail, ReactPaneFragment.create("AstryxDetail"))
          .commitNow()
    }
    back =
        object : OnBackPressedCallback(false) {
          override fun handleOnBackPressed() {
            closeDetail()
          }
        }
    onBackPressedDispatcher.addCallback(this, back)
    panes.addPanelSlideListener(PaneStateListener { updateBack() })
    panes.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
      updatePolicy()
      schedulePresentation()
    }
    lifecycleScope.launch {
      repeatOnLifecycle(Lifecycle.State.STARTED) {
        WindowInfoTracker.getOrCreate(this@MainActivity)
            .windowLayoutInfo(this@MainActivity)
            .collect { info ->
              val fold =
                  info.displayFeatures.filterIsInstance<FoldingFeature>().firstOrNull {
                    it.orientation == FoldingFeature.Orientation.VERTICAL &&
                        it.state == FoldingFeature.State.HALF_OPENED
                  }
              activeFold = fold != null
              division = fold?.bounds ?: Rect()
              updatePolicy()
              schedulePresentation()
            }
      }
    }
  }

  private fun publishMode() {
    val twoPane = isTwoPane
    val canToggle = canToggleSidebar
    val galleryFold = isGalleryFold
    if (
        lastTwoPane != twoPane ||
            lastCanToggle != canToggle ||
            lastGalleryFold != galleryFold ||
            lastDivision != division
    ) {
      lastCanToggle = canToggle
      lastTwoPane = twoPane
      lastGalleryFold = galleryFold
      lastDivision = Rect(division)
      AstryxNavigationModule.publishMode(
          (application as MainApplication).reactHost.currentReactContext,
          twoPane,
          canToggle,
          galleryFold,
          divisionStart,
          divisionWidth,
      )
    }
  }

  private fun schedulePresentation() {
    if (pendingPresentation) return
    pendingPresentation = true
    panes.doOnPreDraw {
      pendingPresentation = false
      updatePane()
      updateBack()
      publishMode()
    }
    panes.invalidate()
  }

  private fun updatePane() {
    // openPane starts a drag animation. Wait until measurement has established
    // whether this is actually a sliding layout; a fold may make it tiled.
    // A folded full-width pane may have zero sliding range. Retry the native
    // request when unfolding even if isSlideable and the selected screen did
    // not change; the earlier openPane could not move it in that geometry.
    val next = Triple(panes.isSlideable, detailRequested, activeFold)
    if (appliedPaneState == next) return
    if (next.first) {
      val accepted = if (detailRequested) panes.openPane() else panes.closePane()
      // A zero-range request is not an applied state. A later native layout
      // must be able to retry it, after the widget's own fold observer runs.
      appliedPaneState = if (accepted || panes.isOpen == detailRequested) next else null
    } else {
      appliedPaneState = next
    }
  }

  private fun updatePolicy() {
    if (panes.width == 0) return
    // The user's sidebar choice is independent of posture. SlidingPaneLayout
    // owns pane sizing and its fold animation when both columns are visible.
    val detail = panes.getChildAt(1)
    val params = detail.layoutParams as SlidingPaneLayout.LayoutParams
    val singlePane = sidebarPreference != true
    val catalog = panes.getChildAt(0)
    val catalogParams = catalog.layoutParams as SlidingPaneLayout.LayoutParams
    val weight = if (singlePane) 1f else 0f
    if (catalogParams.weight != weight) {
      catalogParams.weight = weight
      catalog.layoutParams = catalogParams
    }
    val width = if (singlePane) panes.width else dp(320)
    if (params.width != width) {
      params.width = width
      detail.layoutParams = params
    }
  }

  private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

  private fun updateBack() {
    val singlePane = !isTwoPane
    back.isEnabled = detailRequested
    val catalog = supportFragmentManager.findFragmentById(R.id.astryx_catalog)?.view
    val detail = supportFragmentManager.findFragmentById(R.id.astryx_detail)?.view
    // At a fold a full-width pane can have no sliding range, even though the
    // widget is slideable. Keep only the requested screen visible in that
    // case, without removing either fragment or React surface. INVISIBLE
    // preserves both native frames so unfolding can resume the normal slide.
    val catalogBounds = Rect()
    val detailBounds = Rect()
    panes.getChildAt(0).getHitRect(catalogBounds)
    panes.getChildAt(1).getHitRect(detailBounds)
    // React surfaces are transparent native views, so the widget cannot
    // infer that the selected screen covers the gallery. Hide it only when
    // the native pane frames actually cover it; partial slides keep drawing
    // both screens until the native animation reaches its endpoint.
    catalog?.visibility =
        if (singlePane && detailRequested && detailBounds.contains(catalogBounds)) View.INVISIBLE
        else View.VISIBLE
    detail?.visibility =
        if (activeFold && singlePane && !detailRequested) View.INVISIBLE else View.VISIBLE
    // These are native fragment wrappers, outside both Fabric's props and
    // SlidingPaneLayout's direct-child accessibility importance overrides.
    catalog?.importantForAccessibility =
        if (singlePane && detailRequested) View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        else View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
    detail?.importantForAccessibility =
        if (singlePane && !detailRequested) View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        else View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
  }

  fun toggleSidebar() {
    sidebarPreference = sidebarPreference != true
    getPreferences(MODE_PRIVATE).edit().putBoolean("sidebar", sidebarPreference!!).apply()
    // Fabric owns descendant frames. An unrestricted ChangeBounds captures
    // those too and can restore old bounds after a React layout has mounted.
    // Animate only the native screen containers.
    TransitionManager.beginDelayedTransition(
        panes,
        ChangeBounds().addTarget(panes.getChildAt(0)).addTarget(panes.getChildAt(1)),
    )
    updatePolicy()
    schedulePresentation()
  }

  fun openDetail() {
    detailRequested = true
    updatePolicy()
    schedulePresentation()
  }

  fun closeDetail() {
    detailRequested = false
    updatePolicy()
    schedulePresentation()
  }
}
