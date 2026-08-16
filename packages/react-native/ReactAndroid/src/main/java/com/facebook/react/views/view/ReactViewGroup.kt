/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

@file:Suppress("DEPRECATION")

package com.facebook.react.views.view

import android.annotation.SuppressLint
import android.annotation.TargetApi
import android.content.Context
import android.content.res.Configuration
import android.graphics.BlendMode
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.drawable.Drawable
import android.os.Build
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewStructure
import android.view.accessibility.AccessibilityManager
import com.facebook.common.logging.FLog
import com.facebook.react.R
import com.facebook.react.bridge.ReactNoCrashSoftException
import com.facebook.react.bridge.ReactSoftExceptionLogger
import com.facebook.react.bridge.ReactSoftExceptionLogger.logSoftException
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil.assertOnUiThread
import com.facebook.react.bridge.UiThreadUtil.runOnUiThread
import com.facebook.react.common.ReactConstants.TAG
import com.facebook.react.common.mapbuffer.MapBuffer
import com.facebook.react.config.ReactFeatureFlags
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlags
import com.facebook.react.touch.OnInterceptTouchEventListener
import com.facebook.react.touch.ReactHitSlopView
import com.facebook.react.touch.ReactInterceptingViewGroup
import com.facebook.react.uimanager.BackgroundStyleApplicator.clipToPaddingBox
import com.facebook.react.uimanager.BackgroundStyleApplicator.getPaddingBoxRect
import com.facebook.react.uimanager.BackgroundStyleApplicator.setBackgroundColor
import com.facebook.react.uimanager.BackgroundStyleApplicator.setBorderColor
import com.facebook.react.uimanager.BackgroundStyleApplicator.setBorderRadius
import com.facebook.react.uimanager.BackgroundStyleApplicator.setBorderStyle
import com.facebook.react.uimanager.BackgroundStyleApplicator.setBorderWidth
import com.facebook.react.uimanager.BackgroundStyleApplicator.setFeedbackUnderlay
import com.facebook.react.uimanager.BlendModeHelper.needsIsolatedLayer
import com.facebook.react.uimanager.LengthPercentage
import com.facebook.react.uimanager.LengthPercentageType
import com.facebook.react.uimanager.MeasureSpecAssertions.assertExplicitMeasureSpec
import com.facebook.react.uimanager.PixelUtil.toDIPFromPixel
import com.facebook.react.uimanager.PointerEvents
import com.facebook.react.uimanager.PointerEvents.Companion.canBeTouchTarget
import com.facebook.react.uimanager.PointerEvents.Companion.canChildrenBeTouchTarget
import com.facebook.react.uimanager.ReactAxOrderHelper
import com.facebook.react.uimanager.ReactClippingProhibitedView
import com.facebook.react.uimanager.ReactClippingViewGroup
import com.facebook.react.uimanager.ReactClippingViewGroupHelper.calculateClippingRect
import com.facebook.react.uimanager.ReactCompoundViewGroup
import com.facebook.react.views.text.internal.span.ReactTagSpan
import com.facebook.react.uimanager.ReactOverflowViewWithInset
import com.facebook.react.uimanager.ReactPointerEventsView
import com.facebook.react.uimanager.style.BorderRadiusProp
import com.facebook.react.uimanager.style.BorderStyle
import com.facebook.react.uimanager.style.LogicalEdge
import com.facebook.react.uimanager.style.Overflow
import com.facebook.react.views.text.internal.span.CanvasEffectSpan
import com.facebook.react.views.text.internal.span.TextInlineViewPlaceholderSpan
import com.facebook.react.views.view.CanvasUtil.enableZ
import java.util.ArrayList
import kotlin.concurrent.Volatile
import kotlin.math.max
import kotlin.math.min

/**
 * Backing for a React View. Has support for borders, but since borders aren't common, lazy
 * initializes most of the storage needed for them.
 *
 * @param context A [Context] instance. It's Nullable to not break compatibility with OSS users
 *   (could be made non-null in the future but requires proper comms).
 */
public open class ReactViewGroup public constructor(context: Context?) :
    ViewGroup(context),
    ReactInterceptingViewGroup,
    ReactClippingViewGroup,
    ReactPointerEventsView,
    ReactHitSlopView,
    ReactCompoundViewGroup,
    ReactOverflowViewWithInset {

  public override val overflowInset: Rect = Rect()

  /**
   * This listener will be set for child views when `removeClippedSubview` property is enabled. When
   * children layout is updated, it will call [updateSubviewClipStatus] to notify parent view about
   * that fact so that view can be attached/detached if necessary.
   *
   * TODO(7728005): Attach/detach views in batch - once per frame in case when multiple children
   *   update their layout.
   */
  private class ChildrenLayoutChangeListener(private var parent: ReactViewGroup?) :
      OnLayoutChangeListener {
    override fun onLayoutChange(
        v: View,
        left: Int,
        top: Int,
        right: Int,
        bottom: Int,
        oldLeft: Int,
        oldTop: Int,
        oldRight: Int,
        oldBottom: Int,
    ) {
      if (parent?.removeClippedSubviews == true) {
        parent?.updateSubviewClipStatus(v)
      }
    }

    fun shutdown() {
      parent = null
    }
  }

  private var recycleCount = 0

  /**
   * Following properties are here to support the option [removeClippedSubviews]. This is a
   * temporary optimization/hack that is mainly applicable to the large list of images. The way it's
   * implemented is that we store an additional array of children in view node. We selectively
   * remove some of the views (detach) from it while still storing them in that additional array. We
   * override all possible add methods for [ViewGroup] so that we can control this process whenever
   * the option is set. We also override [ViewGroup#getChildAt] and [ViewGroup#getChildCount] so
   * those methods may return views that are not attached. This is risky but allows us to perform a
   * correct cleanup.
   */
  internal var _removeClippedSubviews = false

  @Volatile private var inSubviewClippingLoop = false
  private var allChildren: Array<View?>? = null
  internal var allChildrenCount: Int = 0
    private set

  internal var clippingRect: Rect? = null

  public override var hitSlopRect: Rect? = null
  public override var pointerEvents: PointerEvents = PointerEvents.AUTO

  public var axOrderList: MutableList<String>? = null

  private var childrenLayoutChangeListener: ChildrenLayoutChangeListener? = null
  private var onInterceptTouchEventListener: OnInterceptTouchEventListener? = null
  private var needsOffscreenAlphaCompositing = false
  private var backfaceOpacity = 0f
  private var backfaceVisible = false
  private var childrenRemovedWhileTransitioning: MutableSet<Int>? = null
  private var accessibilityStateChangeListener:
      AccessibilityManager.AccessibilityStateChangeListener? =
      null
  private var focusOnAttach = false

  internal var nativeBackgroundMap: ReadableMap? = null
  internal var nativeForegroundMap: ReadableMap? = null

  init {
    initView()
  }

  /**
   * Set all default values here as opposed to in the constructor or field defaults. It is important
   * that these properties are set during the constructor, but also on-demand whenever an existing
   * ReactViewGroup is recycled.
   */
  private fun initView() {
    clipChildren = false

    _removeClippedSubviews = false
    inSubviewClippingLoop = false
    allChildren = null
    allChildrenCount = 0
    clippingRect = null
    hitSlopRect = null
    _overflow = Overflow.VISIBLE
    pointerEvents = PointerEvents.AUTO
    ImportantForInteractionHelper.setImportantForInteraction(this, pointerEvents)
    childrenLayoutChangeListener = null
    onInterceptTouchEventListener = null
    needsOffscreenAlphaCompositing = false
    backfaceOpacity = 1f
    backfaceVisible = true
    childrenRemovedWhileTransitioning = null
    nativeBackgroundMap = null
    nativeForegroundMap = null
    // A recycled view must not paint (or dedupe against) the previous
    // occupant's text runs.
    textRunLayouts = null
    mountedTextRunsState = null
  }

  internal open fun recycleView() {
    recycleCount++

    // Remove dangling listeners
    val allChildren = allChildren
    if (allChildren != null && childrenLayoutChangeListener != null) {
      childrenLayoutChangeListener?.shutdown()
      for (i in 0..<allChildrenCount) {
        allChildren[i]?.removeOnLayoutChangeListener(childrenLayoutChangeListener)
      }
    }

    // Set default field values
    initView()
    overflowInset.setEmpty()

    // A recycled View keeps neither the selection nor a toolbar over text that is about to be
    // something else.
    textIsSelectable = false

    // Remove any children
    removeAllViews()

    // If the view is still attached to a parent, we need to remove it from the parent
    // before we can recycle it.
    if (parent != null) {
      (parent as ViewGroup).removeView(this)
    }

    // Reset background, borders
    updateBackgroundDrawable(null)

    resetPointerEvents()

    // In case a focus was attempted but the view never attached, reset to false
    focusOnAttach = false
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    assertExplicitMeasureSpec(widthMeasureSpec, heightMeasureSpec)

    setMeasuredDimension(
        MeasureSpec.getSize(widthMeasureSpec),
        MeasureSpec.getSize(heightMeasureSpec),
    )
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    // No-op since UIManager handles actually laying out children.
  }

  @SuppressLint("MissingSuperCall")
  override fun requestLayout() {
    // No-op, terminate `requestLayout` here, UIManager handles laying out children and
    // `layout` is called on all RN-managed views by the UIManager
  }

  @TargetApi(23)
  override fun dispatchProvideStructure(structure: ViewStructure) {
    try {
      super.dispatchProvideStructure(structure)
    } catch (e: NullPointerException) {
      FLog.e(TAG, "NullPointerException when executing dispatchProvideStructure", e)
    }
  }

  override fun setBackgroundColor(color: Int) {
    setBackgroundColor(this, color)
  }

  @Deprecated(
      "setTranslucentBackgroundDrawable is deprecated since React Native 0.76.0 and will be removed in a future version"
  )
  public fun setTranslucentBackgroundDrawable(background: Drawable?) {
    setFeedbackUnderlay(this, background)
  }

  public override fun setOnInterceptTouchEventListener(listener: OnInterceptTouchEventListener) {
    onInterceptTouchEventListener = listener
  }

  override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
    if (onInterceptTouchEventListener?.onInterceptTouchEvent(this, event) == true) {
      return true
    }
    // We intercept the touch event if the children are not supposed to receive it.
    if (!canChildrenBeTouchTarget(pointerEvents)) {
      return true
    }
    return super.onInterceptTouchEvent(event)
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    // We do not accept the touch event if this view is not supposed to receive it.
    if (!canBeTouchTarget(pointerEvents)) {
      return false
    }
    if (textIsSelectable) {
      trackTextSelectionLongPress(event)
    }
    // The root view always assumes any view that was tapped wants the touch
    // and sends the event to JS as such.
    // We don't need to do bubbling in native (it's already happening in JS).
    // For an explanation of bubbling and capturing, see
    // http://javascript.info/tutorial/bubbling-and-capturing#capturing
    return true
  }

  override fun onHoverEvent(event: MotionEvent): Boolean {
    @Suppress("DEPRECATION")
    if (ReactFeatureFlags.dispatchPointerEvents) {
      // Match the logic from onTouchEvent if pointer events are enabled
      return canBeTouchTarget(pointerEvents)
    }
    return super.onHoverEvent(event)
  }

  override fun dispatchGenericMotionEvent(ev: MotionEvent): Boolean {
    // We do not dispatch the motion event if its children are not supposed to receive it
    if (!canChildrenBeTouchTarget(pointerEvents)) {
      return false
    }

    return super.dispatchGenericMotionEvent(ev)
  }

  /**
   * We override this to allow developers to determine whether they need offscreen alpha compositing
   * or not. See the documentation of needsOffscreenAlphaCompositing in View.js.
   */
  override fun hasOverlappingRendering(): Boolean = needsOffscreenAlphaCompositing

  /** See the documentation of needsOffscreenAlphaCompositing in View.js. */
  public fun setNeedsOffscreenAlphaCompositing(needsOffscreenAlphaCompositing: Boolean) {
    this.needsOffscreenAlphaCompositing = needsOffscreenAlphaCompositing
  }

  public fun setBorderWidth(position: Int, width: Float) {
    setBorderWidth(this, LogicalEdge.entries[position], toDIPFromPixel(width))
  }

  public fun setBorderColor(position: Int, color: Int?) {
    setBorderColor(this, LogicalEdge.entries[position], color)
  }

  @Deprecated(
      message = "setBorderRadius(Float) is deprecated and will be removed in the future.",
      replaceWith = ReplaceWith("setBorderRadius(Float,LengthPercentage)"),
  )
  public fun setBorderRadius(borderRadius: Float) {
    val radius =
        if (borderRadius.isNaN()) null
        else LengthPercentage(borderRadius, LengthPercentageType.POINT)
    setBorderRadius(this, BorderRadiusProp.BORDER_RADIUS, radius)
  }

  @Deprecated(
      message = "setBorderRadius(Float) is deprecated and will be removed in the future.",
      replaceWith = ReplaceWith("setBorderRadius(Float,LengthPercentage)"),
  )
  public fun setBorderRadius(borderRadius: Float, position: Int) {
    val radius =
        if (borderRadius.isNaN()) null
        else LengthPercentage(borderRadius, LengthPercentageType.POINT)
    setBorderRadius(this, BorderRadiusProp.entries[position], radius)
  }

  public fun setBorderRadius(property: BorderRadiusProp, borderRadius: LengthPercentage?) {
    setBorderRadius(this, property, borderRadius)
  }

  public fun setBorderStyle(style: String?) {
    setBorderStyle(this, style?.let { BorderStyle.fromString(it) })
  }

  override var removeClippedSubviews: Boolean
    get() {
      if (ReactNativeFeatureFlags.disableSubviewClippingAndroid()) {
        return false
      }
      return _removeClippedSubviews
    }
    set(newValue) {
      if (ReactNativeFeatureFlags.disableSubviewClippingAndroid()) {
        return
      }

      if (newValue == _removeClippedSubviews) {
        return
      }
      _removeClippedSubviews = newValue
      childrenRemovedWhileTransitioning = null
      if (newValue) {
        val clippingRect = Rect()
        calculateClippingRect(this, clippingRect)
        this.clippingRect = clippingRect

        allChildrenCount = childCount
        val allChildren = arrayOfNulls<View?>(max(12, allChildrenCount))
        childrenLayoutChangeListener = ChildrenLayoutChangeListener(this)
        for (i in 0..<allChildrenCount) {
          val child = getChildAt(i)
          allChildren[i] = child
          child.addOnLayoutChangeListener(childrenLayoutChangeListener)
          setViewClipped(child, false)
        }
        this.allChildren = allChildren
        updateClippingRect()
      } else {
        // Add all clipped views back, deallocate additional arrays, remove layoutChangeListener
        val childArray = checkNotNull(allChildren)
        checkNotNull(childrenLayoutChangeListener)
        for (i in 0..<allChildrenCount) {
          childArray[i]?.removeOnLayoutChangeListener(childrenLayoutChangeListener)
        }
        val clippingRect = checkNotNull(clippingRect)
        getDrawingRect(clippingRect)
        updateClippingToRect(clippingRect)
        this.allChildren = null
        this.clippingRect = null
        allChildrenCount = 0
        childrenLayoutChangeListener = null
      }
    }

  override fun getClippingRect(outClippingRect: Rect) {
    outClippingRect.set(checkNotNull(clippingRect))
  }

  override fun updateClippingRect() {
    updateClippingRect(null)
  }

  override fun updateClippingRect(excludedViews: Set<Int>?) {
    if (!_removeClippedSubviews) {
      return
    }

    val clippingRect = checkNotNull(clippingRect)
    calculateClippingRect(this, clippingRect)
    updateClippingToRect(clippingRect, excludedViews)
  }

  internal fun requestFocusFromJS() {
    if (isAttachedToWindow) {
      super.requestFocus(FOCUS_DOWN, null)
    } else {
      focusOnAttach = true
    }
  }

  internal fun clearFocusFromJS() {
    focusOnAttach = false
    super.clearFocus()
  }

  override fun endViewTransition(view: View) {
    super.endViewTransition(view)
    childrenRemovedWhileTransitioning?.remove(view.id)
  }

  private fun trackChildViewTransition(childId: Int) {
    if (childrenRemovedWhileTransitioning == null) {
      childrenRemovedWhileTransitioning = mutableSetOf()
    }
    childrenRemovedWhileTransitioning?.add(childId)
  }

  private fun isChildRemovedWhileTransitioning(child: View): Boolean =
      childrenRemovedWhileTransitioning?.contains(child.id) == true

  internal fun updateClippingToRect(clippingRect: Rect, excludedViewsSet: Set<Int>? = null) {
    val childArray = checkNotNull(allChildren)
    inSubviewClippingLoop = true
    var clippedSoFar = 0
    for (i in 0..<allChildrenCount) {
      try {
        updateSubviewClipStatus(clippingRect, i, clippedSoFar, excludedViewsSet)
      } catch (ex: IndexOutOfBoundsException) {
        var realClippedSoFar = 0
        val uniqueViews: MutableSet<View?> = HashSet()
        var j = 0
        while (j < i) {
          realClippedSoFar += if (isViewClipped(childArray[j], j)) 1 else 0
          uniqueViews.add(childArray[j])
          j++
        }

        throw IllegalStateException(
            "Invalid clipping state. i=$i clippedSoFar=$clippedSoFar count=$childCount allChildrenCount=$allChildrenCount recycleCount=$recycleCount realClippedSoFar=$realClippedSoFar uniqueViewsCount=${uniqueViews.size} excludedViews=${excludedViewsSet?.size ?: 0}",
            ex,
        )
      }
      if (isViewClipped(childArray[i], i)) {
        clippedSoFar++
      }
      if (i - clippedSoFar > childCount) {
        throw IllegalStateException(
            "Invalid clipping state. i=$i clippedSoFar=$clippedSoFar count=$childCount allChildrenCount=$allChildrenCount recycleCount=$recycleCount  excludedViews=${excludedViewsSet?.size ?: 0}"
        )
      }
    }
    inSubviewClippingLoop = false
  }

  private fun updateSubviewClipStatus(
      clippingRect: Rect,
      idx: Int,
      clippedSoFar: Int,
      excludedViewsSet: Set<Int>? = null,
  ) {
    assertOnUiThread()

    val child = checkNotNull(allChildren?.get(idx))
    val intersects = clippingRect.intersects(child.left, child.top, child.right, child.bottom)
    var needUpdateClippingRecursive = false

    // We never want to clip children that are being animated, as this can easily break layout :
    // when layout animation changes size and/or position of views contained inside a listview that
    // clips offscreen children, we need to ensure that, when view exits the viewport, final size
    // and position is set prior to removing the view from its listview parent.
    // Otherwise, when view gets re-attached again, i.e when it re-enters the viewport after scroll,
    // it won't be size and located properly.
    val isAnimating = child.animation?.hasEnded() == false

    val shouldSkipView = excludedViewsSet?.contains(child.id) == true
    if (excludedViewsSet != null) {
      needUpdateClippingRecursive = true
    }
    // We don't want to clip a view that is currently focused at that might break focus navigation
    if (
        !intersects &&
            !isViewClipped(child, idx) &&
            !isAnimating &&
            child !== focusedChild &&
            !shouldSkipView
    ) {
      setViewClipped(child, true)
      // We can try saving on invalidate call here as the view that we remove is out of visible area
      // therefore invalidation is not necessary.
      removeViewInLayout(child)
      needUpdateClippingRecursive = true
    } else if ((shouldSkipView || intersects) && isViewClipped(child, idx)) {
      val adjustedIdx = idx - clippedSoFar
      check(adjustedIdx >= 0)
      setViewClipped(child, false)
      addViewInLayout(child, adjustedIdx, defaultLayoutParam, true)
      invalidate()
      needUpdateClippingRecursive = true
    } else if (intersects) {
      // If there is any intersection we need to inform the child to update its clipping rect
      needUpdateClippingRecursive = true
    }

    if (needUpdateClippingRecursive) {
      if ((child as? ReactClippingViewGroup)?.removeClippedSubviews == true) {
        child.updateClippingRect(excludedViewsSet)
      }
    }
  }

  private fun updateSubviewClipStatus(subview: View) {
    if (!_removeClippedSubviews || parent == null) {
      return
    }

    val clippingRect = checkNotNull(clippingRect)
    val allChildren = checkNotNull(allChildren)

    // do fast check whether intersect state changed
    val intersects =
        clippingRect.intersects(subview.left, subview.top, subview.right, subview.bottom)

    // If it was intersecting before, should be attached to the parent
    val oldIntersects = !isViewClipped(subview, null)

    if (intersects != oldIntersects) {
      inSubviewClippingLoop = true
      var clippedSoFar = 0
      for (i in 0..<allChildrenCount) {
        if (allChildren[i] === subview) {
          updateSubviewClipStatus(clippingRect, i, clippedSoFar)
          break
        }
        if (isViewClipped(allChildren[i], i)) {
          clippedSoFar++
        }
      }
      inSubviewClippingLoop = false
    }
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    if (_removeClippedSubviews) {
      updateClippingRect()
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (_removeClippedSubviews) {
      updateClippingRect()
    }

    if (focusOnAttach) {
      requestFocusFromJS()
      focusOnAttach = false
    }
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    if (nativeBackgroundMap != null) {
      applyNativeBackground(nativeBackgroundMap)
    }
    if (nativeForegroundMap != null) {
      applyNativeForeground(nativeForegroundMap)
    }
  }

  internal fun applyNativeBackground(map: ReadableMap?) {
    nativeBackgroundMap = map
    setFeedbackUnderlay(
        this,
        map?.let { ReactDrawableHelper.createDrawableFromJSDescription(context, it) },
    )
  }

  internal fun applyNativeForeground(map: ReadableMap?) {
    nativeForegroundMap = map
    foreground = map?.let { ReactDrawableHelper.createDrawableFromJSDescription(context, it) }
  }

  override fun onViewAdded(child: View) {
    assertOnUiThread()
    checkViewClippingTag(child, false)
    super.onViewAdded(child)
  }

  override fun onViewRemoved(child: View) {
    assertOnUiThread()
    checkViewClippingTag(child, true)

    // The parent might not be null in case the child is transitioning.
    if (child.parent != null) {
      trackChildViewTransition(child.id)
    }

    super.onViewRemoved(child)
  }

  private fun checkViewClippingTag(child: View, expectedTag: Boolean) {
    if (inSubviewClippingLoop) {
      val tag = child.getTag(R.id.view_clipped)
      if (expectedTag != tag) {
        logSoftException(
            ReactSoftExceptionLogger.Categories.RVG_ON_VIEW_REMOVED,
            ReactNoCrashSoftException("View clipping tag mismatch: tag=$tag expected=$expectedTag"),
        )
      }
    }
    if (_removeClippedSubviews) {
      child.setTag(R.id.view_clipped, expectedTag)
    } else {
      child.setTag(R.id.view_clipped, null)
    }
  }

  override fun shouldDelayChildPressedState(): Boolean = false

  override fun dispatchSetPressed(pressed: Boolean) {
    // Prevents the ViewGroup from dispatching the pressed state
    // to it's children.
  }

  private fun resetPointerEvents() {
    pointerEvents = PointerEvents.AUTO
  }

  internal fun getChildAtWithSubviewClippingEnabled(index: Int): View? =
      if (index in 0..<allChildrenCount) checkNotNull(allChildren)[index] else null

  internal fun addViewWithSubviewClippingEnabled(
      child: View,
      index: Int,
  ) {
    check(_removeClippedSubviews)
    setViewClipped(child, true) // the view has not been added, so it is "clipped"
    addInArray(child, index)

    // we add view as "clipped" and then run {@link #updateSubviewClipStatus} to conditionally
    // attach it
    val clippingRect = checkNotNull(clippingRect)
    val allChildren = checkNotNull(allChildren)
    inSubviewClippingLoop = true
    var clippedSoFar = 0
    for (i in 0..<index) {
      if (isViewClipped(allChildren[i], i)) {
        clippedSoFar++
      }
    }
    updateSubviewClipStatus(clippingRect, index, clippedSoFar)
    inSubviewClippingLoop = false
    child.addOnLayoutChangeListener(childrenLayoutChangeListener)

    if (child is ReactClippingProhibitedView) {
      runOnUiThread(
          object : Runnable {
            override fun run() {
              if (!child.isShown) {
                logSoftException(
                    ReactSoftExceptionLogger.Categories.CLIPPING_PROHIBITED_VIEW,
                    ReactNoCrashSoftException(
                        "Child view has been added to Parent view in which it is clipped and not visible. This is not legal for this particular child view. Child: [${child.id}] $child Parent: [$id] ${toString()}"
                    ),
                )
              }
            }
          }
      )
    }
  }

  internal fun removeViewWithSubviewClippingEnabled(view: View) {
    assertOnUiThread()

    check(_removeClippedSubviews)
    val allChildren = checkNotNull(allChildren)
    view.removeOnLayoutChangeListener(childrenLayoutChangeListener)
    val index = indexOfChildInAllChildren(view)
    if (!isViewClipped(allChildren[index], index)) {
      var clippedSoFar = 0
      for (i in 0..<index) {
        if (isViewClipped(allChildren[i], i)) {
          clippedSoFar++
        }
      }
      removeViewsInLayout(index - clippedSoFar, 1)
      invalidate()
    }
    removeFromArray(index)
  }

  internal fun removeAllViewsWithSubviewClippingEnabled() {
    check(_removeClippedSubviews)
    val allChildren = checkNotNull(allChildren)
    for (i in 0..<allChildrenCount) {
      allChildren[i]?.removeOnLayoutChangeListener(childrenLayoutChangeListener)
    }
    removeAllViewsInLayout()
    allChildrenCount = 0
  }

  /**
   * @param index For logging - index of the view in `allChildren`, or `null` to skip logging.
   * @return `true` if the view has been removed from the ViewGroup.
   */
  private fun isViewClipped(view: View?, index: Int?): Boolean {
    val view = checkNotNull(view)
    val tag = view.getTag(R.id.view_clipped)
    if (tag != null) {
      return tag as Boolean
    }

    val parent = view.parent
    val transitioning = isChildRemovedWhileTransitioning(view)
    if (index != null) {
      logSoftException(
          ReactSoftExceptionLogger.Categories.RVG_IS_VIEW_CLIPPED,
          ReactNoCrashSoftException(
              "View missing clipping tag: index=$index parentNull=${parent == null} parentThis=${parent === this} transitioning=$transitioning"
          ),
      )
    }
    // fallback - should be transitioning or have no parent if the view was removed
    if (parent == null || transitioning) {
      return true
    } else {
      check(parent === this)
      return false
    }
  }

  private fun indexOfChildInAllChildren(child: View): Int {
    val count = allChildrenCount
    val childArray = checkNotNull(allChildren)
    for (i in 0..<count) {
      if (childArray[i] === child) {
        return i
      }
    }
    return -1
  }

  private fun addInArray(child: View, index: Int) {
    var childArray = checkNotNull(allChildren)
    val count = allChildrenCount
    val size = childArray.size
    if (index == count) {
      if (size == count) {
        val allChildren = arrayOfNulls<View?>(size + ARRAY_CAPACITY_INCREMENT)
        System.arraycopy(childArray, 0, allChildren, 0, size)
        childArray = allChildren
        this.allChildren = childArray
      }
      childArray[allChildrenCount++] = child
    } else if (index < count) {
      if (size == count) {
        val allChildren = arrayOfNulls<View?>(size + ARRAY_CAPACITY_INCREMENT)
        System.arraycopy(childArray, 0, allChildren, 0, index)
        System.arraycopy(childArray, index, allChildren, index + 1, count - index)
        childArray = allChildren
        this.allChildren = childArray
      } else {
        System.arraycopy(childArray, index, childArray, index + 1, count - index)
      }
      childArray[index] = child
      allChildrenCount++
    } else {
      throw IndexOutOfBoundsException("index=$index count=$count")
    }
  }

  private fun removeFromArray(index: Int) {
    val childArray = checkNotNull(allChildren)
    val count = allChildrenCount
    when (index) {
      count - 1 -> childArray[--allChildrenCount] = null
      in 0..<count -> {
        System.arraycopy(childArray, index + 1, childArray, index, count - index - 1)
        childArray[--allChildrenCount] = null
      }
      else -> throw IndexOutOfBoundsException()
    }
  }

  private var _overflow: Overflow = Overflow.VISIBLE
  override var overflow: String?
    get() =
        when (_overflow) {
          Overflow.HIDDEN -> "hidden"
          Overflow.SCROLL -> "scroll"
          Overflow.VISIBLE -> "visible"
        }
    set(overflow) {
      _overflow = Overflow.fromString(overflow)
      invalidate()
    }

  /**
   * Returns the clip bounds for this view based on the overflow property.
   *
   * When overflow is hidden or scroll, returns the padding box rect (the area inside the borders)
   * so that systems querying [View.getClipBounds] can determine the view's clipping region. Returns
   * null when overflow is visible (no clipping).
   */
  override fun getClipBounds(): Rect? {
    if (
        ReactNativeFeatureFlags.syncAndroidClipBoundsWithOverflow() && _overflow != Overflow.VISIBLE
    ) {
      val rect = Rect()
      getPaddingBoxRect(this, rect)
      return rect
    }
    return super.getClipBounds()
  }

  /** See [getClipBounds]. */
  override fun getClipBounds(outRect: Rect): Boolean {
    if (
        ReactNativeFeatureFlags.syncAndroidClipBoundsWithOverflow() && _overflow != Overflow.VISIBLE
    ) {
      getPaddingBoxRect(this, outRect)
      return true
    }
    return super.getClipBounds(outRect)
  }

  override fun setOverflowInset(left: Int, top: Int, right: Int, bottom: Int) {
    if (
        needsIsolatedLayer(this) &&
            (overflowInset.left != left ||
                overflowInset.top != top ||
                overflowInset.right != right ||
                overflowInset.bottom != bottom)
    ) {
      invalidate()
    }
    overflowInset[left, top, right] = bottom
  }

  /**
   * Set the background for the view or remove the background. It calls [setBackground].
   *
   * @param drawable The [Drawable] to use as the background, or null to remove the background
   */
  private fun updateBackgroundDrawable(drawable: Drawable?) {
    super.setBackground(drawable)
  }

  override fun draw(canvas: Canvas) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && needsIsolatedLayer(this)) {
      // Check if the view is a stacking context and has children, if it does, do the rendering
      // offscreen and then composite back. This follows the idea of group isolation on blending
      // https://www.w3.org/TR/compositing-1/#isolationblending

      val overflowInset = overflowInset
      canvas.saveLayer(
          overflowInset.left.toFloat(),
          overflowInset.top.toFloat(),
          (width + -overflowInset.right).toFloat(),
          (height + -overflowInset.bottom).toFloat(),
          null,
      )
      super.draw(canvas)
      canvas.restore()
    } else {
      super.draw(canvas)
    }
  }

  override fun dispatchDraw(canvas: Canvas) {
    if (_overflow != Overflow.VISIBLE || getTag(R.id.filter) != null) {
      clipToPaddingBox(this, canvas)
    }
    // Interleave the text runs with the mounted child views by document order (CSS paint order): a
    // run paints right after the block child it follows, so text before a box paints under it and
    // text after paints over it. Runs before any child (documentOrder 0) paint first (under all
    // children); drawChild paints the runs that follow each child as it is drawn.
    drawnChildCount = 0
    drawTextRunsWithDocumentOrder(canvas, 0)
    super.dispatchDraw(canvas)
    // Safety: any run whose document order exceeds the drawn child count paints above everything.
    drawTextRunsAboveDocumentOrder(canvas, drawnChildCount)
  }

  /**
   * Text children (expo-intrinsics): the laid-out text runs of this View's anonymous inline
   * formatting context, computed natively and delivered via [ViewState]/MapBuffer. Interleaved with
   * the View's child views by document order, mirroring iOS's RCTViewComponentView text-run painting.
   */
  private var textRunLayouts: List<TextRunLayout>? = null
  private var drawnChildCount = 0

  /**
   * The serialized ViewState the current [textRunLayouts] were built from. Fabric can deliver the
   * same state more than once (initial mount plus the state-update mount item of the very commit
   * that computed the runs); comparing against this lets `updateState` keep the mounted layouts
   * instead of rebuilding identical ones on the UI thread (run-layout-reuse-plan.md).
   */
  @JvmField internal var mountedTextRunsState: MapBuffer? = null

  /**
   * A single laid-out text run: an Android [Layout] positioned at [left]/[top] in pixels.
   * [documentOrder] is the number of mounted child views that precede the run, so it can be painted
   * in the correct z-order relative to those children.
   */
  public class TextRunLayout(
      @JvmField public val layout: android.text.Layout,
      @JvmField public val left: Float,
      @JvmField public val top: Float,
      @JvmField public val documentOrder: Int,
  )

  public fun setTextRunLayouts(runs: List<TextRunLayout>?) {
    textRunLayouts = runs
    invalidate()
  }

  /**
   * `user-select` (css-ui-4 §5.1) on the text this View paints itself.
   *
   * A View is not a `TextView`, so the drag handles and range selection that `<Text selectable>`
   * gets on Android are not available here — those belong to `TextView` and its `Editor`. What is
   * available, and what this does, is the other half of selection: a long press offers **Copy**,
   * and copies the View's text. That is exactly what `<Text selectable>` does on iOS, so bare
   * strings behave the same way on both platforms.
   *
   * DOM-CSS-LIMITATION(no-range-selection-on-runs): the web selects a range; this copies all of
   * the element's text. Range selection would mean hosting a real `TextView` per run — a bigger
   * change than it looks, because hosted views land in the same child list Fabric mounts into, so
   * every index it uses would need translating. That is the bug class that already bit the iOS run
   * views once.
   */
  internal var textIsSelectable: Boolean = false
    set(value) {
      if (field == value) {
        return
      }
      field = value
      if (!value) {
        cancelTextSelectionLongPress()
        textSelectionActionMode?.finish()
      }
    }

  /** `internal` so [ReactViewGroupTextSelectionTest] can see that a long press offered Copy. */
  internal var textSelectionActionMode: android.view.ActionMode? = null
    private set

  private var textSelectionLongPress: Runnable? = null
  private var textSelectionDownX = 0f
  private var textSelectionDownY = 0f

  private fun trackTextSelectionLongPress(event: MotionEvent) {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        textSelectionDownX = event.x
        textSelectionDownY = event.y
        cancelTextSelectionLongPress()
        // `onTouchEvent` above always consumes, so View's own long-press detection never runs on a
        // React view — the timing has to be kept here.
        val pending = Runnable { startTextSelectionActionMode() }
        textSelectionLongPress = pending
        postDelayed(pending, android.view.ViewConfiguration.getLongPressTimeout().toLong())
      }
      MotionEvent.ACTION_MOVE -> {
        val slop = android.view.ViewConfiguration.get(context).scaledTouchSlop
        if (Math.abs(event.x - textSelectionDownX) > slop ||
            Math.abs(event.y - textSelectionDownY) > slop) {
          cancelTextSelectionLongPress()
        }
      }
      MotionEvent.ACTION_UP,
      MotionEvent.ACTION_CANCEL -> cancelTextSelectionLongPress()
    }
  }

  private fun cancelTextSelectionLongPress() {
    textSelectionLongPress?.let { removeCallbacks(it) }
    textSelectionLongPress = null
  }

  /**
   * Every run this View paints, in authored document order, joined by newlines — the text a reader
   * sees, in the order they see it. `documentOrder` counts the mounted children before a run, which
   * is exactly the key that puts runs interleaved with child views back into reading order.
   *
   * `internal` rather than private so the ordering can be asserted directly; going through the
   * clipboard to check it would test the platform instead.
   */
  internal fun selectableText(): CharSequence? {
    val runs = textRunLayouts ?: return null
    val ordered = runs.sortedBy { it.documentOrder }
    val builder = StringBuilder()
    for (run in ordered) {
      val text = run.layout.text ?: continue
      if (text.isEmpty()) {
        continue
      }
      if (builder.isNotEmpty()) {
        builder.append('\n')
      }
      builder.append(text)
    }
    return if (builder.isEmpty()) null else builder
  }

  private fun startTextSelectionActionMode() {
    textSelectionLongPress = null
    val text = selectableText() ?: return
    textSelectionActionMode?.finish()
    val callback =
        object : android.view.ActionMode.Callback2() {
          override fun onCreateActionMode(
              mode: android.view.ActionMode,
              menu: android.view.Menu,
          ): Boolean {
            menu.add(0, TEXT_SELECTION_COPY_ITEM, 0, android.R.string.copy)
            return true
          }

          override fun onPrepareActionMode(
              mode: android.view.ActionMode,
              menu: android.view.Menu,
          ): Boolean = false

          override fun onActionItemClicked(
              mode: android.view.ActionMode,
              item: android.view.MenuItem,
          ): Boolean {
            if (item.itemId != TEXT_SELECTION_COPY_ITEM) {
              return false
            }
            val clipboard =
                context.getSystemService(Context.CLIPBOARD_SERVICE)
                    as? android.content.ClipboardManager
            clipboard?.setPrimaryClip(android.content.ClipData.newPlainText(null, text))
            mode.finish()
            return true
          }

          override fun onDestroyActionMode(mode: android.view.ActionMode) {
            if (textSelectionActionMode === mode) {
              textSelectionActionMode = null
            }
          }

          // A floating action mode anchors to this rect; without it the toolbar lands at the top of
          // the window instead of over the text.
          override fun onGetContentRect(
              mode: android.view.ActionMode,
              view: View,
              outRect: Rect,
          ) {
            val runs = textRunLayouts
            if (runs.isNullOrEmpty()) {
              outRect.set(0, 0, width, height)
              return
            }
            var left = Int.MAX_VALUE
            var top = Int.MAX_VALUE
            var right = Int.MIN_VALUE
            var bottom = Int.MIN_VALUE
            for (run in runs) {
              left = min(left, run.left.toInt())
              top = min(top, run.top.toInt())
              right = max(right, run.left.toInt() + run.layout.width)
              bottom = max(bottom, run.top.toInt() + run.layout.height)
            }
            outRect.set(left, top, right, bottom)
          }
        }
    textSelectionActionMode =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          startActionMode(callback, android.view.ActionMode.TYPE_FLOATING)
        } else {
          startActionMode(callback)
        }
  }

  private fun drawTextRun(canvas: Canvas, run: TextRunLayout) {
    canvas.save()
    canvas.translate(run.left, run.top)
    val layout = run.layout
    // Text-decoration (underline/strikethrough) and text shadow are CanvasEffectSpans: they are not
    // drawn by Layout.draw but painted around it — onPreDraw before, onDraw after — exactly as
    // PreparedLayoutTextView does for a normal <Text>. Without this pass a <u>/<s> in the anonymous
    // IFC would flow inline but show no decoration.
    val spanned = layout.text as? android.text.Spanned
    val effectSpans =
        spanned?.getSpans(0, spanned.length, CanvasEffectSpan::class.java) ?: emptyArray()
    if (spanned != null) {
      for (span in effectSpans) {
        span.onPreDraw(spanned.getSpanStart(span), spanned.getSpanEnd(span), canvas, layout)
      }
    }
    layout.draw(canvas)
    if (spanned != null) {
      for (span in effectSpans) {
        span.onDraw(spanned.getSpanStart(span), spanned.getSpanEnd(span), canvas, layout)
      }
    }
    canvas.restore()
  }

  private fun drawTextRunsWithDocumentOrder(canvas: Canvas, documentOrder: Int) {
    val runs = textRunLayouts ?: return
    for (run in runs) {
      if (run.documentOrder == documentOrder) {
        drawTextRun(canvas, run)
      }
    }
  }

  private fun drawTextRunsAboveDocumentOrder(canvas: Canvas, documentOrder: Int) {
    val runs = textRunLayouts ?: return
    for (run in runs) {
      if (run.documentOrder > documentOrder) {
        drawTextRun(canvas, run)
      }
    }
  }

  // ReactCompoundViewGroup: the painted text runs are not real child views, so touch targeting must
  // resolve a point inside a run to the react tag of the inline element (or bare-text fragment) under
  // it — the same ReactTagSpan lookup ReactTextView does. This is what lets a tap on an inline
  // <b onClick> fire the <b>'s own handler (and bubble) rather than only hitting the container View.
  private fun reactTagForTextRunTouch(touchX: Float, touchY: Float): Int? {
    val runs = textRunLayouts ?: return null
    for (run in runs) {
      val layout = run.layout
      val localX = touchX - run.left
      val localY = touchY - run.top
      if (localX < 0f || localY < 0f || localY > layout.height.toFloat()) {
        continue
      }
      val text = layout.text
      if (text !is android.text.Spanned) {
        continue
      }
      val line = layout.getLineForVertical(localY.toInt())
      if (localX < layout.getLineLeft(line) || localX > layout.getLineRight(line)) {
        continue
      }
      val index =
          try {
            layout.getOffsetForHorizontal(line, localX)
          } catch (e: ArrayIndexOutOfBoundsException) {
            continue
          }
      // An atomic inline — an <img>, an inline-block, an inline-flex — is an
      // attachment in the run AND a real mounted child view sitting on top of
      // it. Claiming the point here would intercept the touch before that child
      // ever sees it, so a tap on the box resolved to this View instead of to
      // the box. Decline, and let the ordinary child hit-test run.
      // The offset is a CURSOR position, so a point over the attachment can
      // resolve to either side of it; look at the character on both.
      val attachmentFrom = (index - 1).coerceAtLeast(0)
      val attachmentTo = (index + 1).coerceAtMost(text.length)
      if (attachmentFrom < attachmentTo &&
          text.getSpans(attachmentFrom, attachmentTo, TextInlineViewPlaceholderSpan::class.java)
              .isNotEmpty()) {
        return null
      }

      // Most-inner (shortest) ReactTagSpan at the offset is the innermost react element. Skip
      // non-positive tags: bare-text (#text) nodes carry no event emitter by design, so a click on
      // bare text must resolve to the nearest real ancestor element (the container View, `id`) —
      // matching the web/iOS, where bare text hits only its container while an inline <b>/<span>
      // hits the element and bubbles.
      var target = id
      var targetLen = text.length
      for (span in text.getSpans(index, index, ReactTagSpan::class.java)) {
        if (span.reactTag <= 0) {
          continue
        }
        val start = text.getSpanStart(span)
        val end = text.getSpanEnd(span)
        if (end >= index && (end - start) <= targetLen) {
          target = span.reactTag
          targetLen = end - start
        }
      }
      return target
    }
    return null
  }

  override fun reactTagForTouch(touchX: Float, touchY: Float): Int =
      reactTagForTextRunTouch(touchX, touchY) ?: id

  override fun interceptsTouchEvent(touchX: Float, touchY: Float): Boolean =
      reactTagForTextRunTouch(touchX, touchY) != null

  override fun drawChild(canvas: Canvas, child: View, drawingTime: Long): Boolean {
    val drawWithZ = child.elevation > 0

    if (drawWithZ) {
      enableZ(canvas, true)
    }

    var mixBlendMode: BlendMode? = null
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && needsIsolatedLayer(this)) {
      mixBlendMode = child.getTag(R.id.mix_blend_mode) as? BlendMode
      if (mixBlendMode != null) {
        val p = Paint()
        p.blendMode = mixBlendMode
        val overflowInset = overflowInset
        canvas.saveLayer(
            overflowInset.left.toFloat(),
            overflowInset.top.toFloat(),
            (width + -overflowInset.right).toFloat(),
            (height + -overflowInset.bottom).toFloat(),
            p,
        )
      }
    }

    val result = super.drawChild(canvas, child, drawingTime)

    if (mixBlendMode != null) {
      canvas.restore()
    }

    if (drawWithZ) {
      enableZ(canvas, false)
    }

    // Paint the text runs that follow this child in document order (see dispatchDraw).
    drawnChildCount++
    drawTextRunsWithDocumentOrder(canvas, drawnChildCount)
    return result
  }

  public fun setOpacityIfPossible(opacity: Float) {
    backfaceOpacity = opacity
    setBackfaceVisibilityDependantOpacity()
  }

  public fun setBackfaceVisibility(backfaceVisibility: String) {
    backfaceVisible = "visible" == backfaceVisibility
    setBackfaceVisibilityDependantOpacity()
  }

  public fun setBackfaceVisibilityDependantOpacity() {
    if (backfaceVisible) {
      alpha = backfaceOpacity
      return
    }

    val rotationX = rotationX
    val rotationY = rotationY

    val isFrontfaceVisible =
        (rotationX >= -90f && rotationX < 90f) && (rotationY >= -90f && rotationY < 90f)

    if (isFrontfaceVisible) {
      alpha = backfaceOpacity
      return
    }

    alpha = 0f
  }

  override fun addChildrenForAccessibility(outChildren: ArrayList<View>) {
    val axOrderParent = getTag(R.id.accessibility_order_parent)
    var axOrderParentOrderList: MutableList<String>? = null
    if (axOrderParent is ReactViewGroup) {
      axOrderParentOrderList = (axOrderParent as ReactViewGroup?)?.axOrderList
    }

    val axOrder: MutableList<*>? = axOrderList
    if (axOrder != null) {

      val am: AccessibilityManager? =
          this.context.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager?
      if (accessibilityStateChangeListener == null && am != null) {
        val newAccessibilityStateChangeListener =
            AccessibilityManager.AccessibilityStateChangeListener { enabled ->
              if (!enabled) {
                for (i in 0..<childCount) {
                  ReactAxOrderHelper.restoreFocusability(getChildAt(i))
                }
              }
            }

        am.addAccessibilityStateChangeListener(newAccessibilityStateChangeListener)
        accessibilityStateChangeListener = newAccessibilityStateChangeListener
      }

      val result = arrayOfNulls<View?>(axOrder.size)

      for (i in 0..<childCount) {
        ReactAxOrderHelper.buildAxOrderList(getChildAt(i), this, axOrder, result)
      }

      for (i in result.indices) {
        val view = result[i]
        if (view != null) {
          if (view.isFocusable) {
            outChildren.add(view)
          } else {
            view.addChildrenForAccessibility(outChildren)
          }
        }
      }
    } else if (axOrderParentOrderList != null) {
      // view is a container so add its children normally
      if (!isFocusable) {
        safeAddChildrenForAccessibility(outChildren)
        return

        // If this view can coopt, turn the focusability off its children but add them to the tree
      } else if (isFocusable && (contentDescription == null || contentDescription == "")) {
        safeAddChildrenForAccessibility(outChildren)
        for (i in 0..<childCount) {
          ReactAxOrderHelper.disableFocusForSubtree(getChildAt(i), axOrderParentOrderList)
        }
        // if this view is focusable and has a contentDescription then we don't care about its
        // descendants for accessibility
      } else if (isFocusable && !(contentDescription == null || contentDescription == "")) {
        return
      }
    } else {
      safeAddChildrenForAccessibility(outChildren)
    }
  }

  private fun safeAddChildrenForAccessibility(outChildren: ArrayList<View>) {
    try {
      super.addChildrenForAccessibility(outChildren)
    } catch (error: IllegalArgumentException) {
      // Android 16 can race while building accessibility child lists during fast re-parenting.
      if (error.message?.contains("descendant of this view") == true) {
        logSoftException(
            ReactSoftExceptionLogger.Categories.RVG_ADD_CHILDREN_FOR_ACCESSIBILITY,
            error,
        )
      } else {
        throw error
      }
    }
  }

  public fun cleanUpAxOrderListener() {
    val am = this.context.getSystemService(Context.ACCESSIBILITY_SERVICE) as? AccessibilityManager
    if (am != null) {
      accessibilityStateChangeListener?.let { am.removeAccessibilityStateChangeListener(it) }
    }
    accessibilityStateChangeListener = null
  }

  private companion object {
    private const val ARRAY_CAPACITY_INCREMENT = 12
    private const val TEXT_SELECTION_COPY_ITEM = 1
    private val defaultLayoutParam = LayoutParams(0, 0)

    private fun setViewClipped(view: View, clipped: Boolean) {
      view.setTag(R.id.view_clipped, clipped)
    }
  }
}
