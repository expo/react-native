/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// `setBoundsInParent` is deprecated, and still what ExploreByTouchHelper requires of a virtual node
@file:Suppress("DEPRECATION")

package com.facebook.react.views.view

import android.content.Context
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.os.Bundle
import android.text.SpannableString
import android.text.Spanned
import android.text.style.LocaleSpan
import android.view.MotionEvent
import android.view.View
import android.view.accessibility.AccessibilityEvent
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import androidx.customview.widget.ExploreByTouchHelper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.PointerEvents
import com.facebook.react.uimanager.ReactAccessibilityDelegate
import com.facebook.react.uimanager.ReactPointerEventsView
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.floor

/**
 * A childless host for the virtual accessibility leaves of painted anonymous text, satisfying
 * [ExploreByTouchHelper]'s invariant. One host holds the leaves between two inline attachments,
 * since a virtual node cannot be ordered around a mounted view; the owning [ReactViewGroup] lists
 * hosts and attachment views in the model's order, see [inlineTextReadingOrder].
 */
internal class InlineTextAccessibilityHost(context: Context) :
    View(context), ReactPointerEventsView {
  private val helper = InlineTextAccessibilityHelper(this)
  override val pointerEvents: PointerEvents = PointerEvents.NONE

  init {
    isFocusable = false
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
    ViewCompat.setAccessibilityDelegate(this, helper)
    setWillNotDraw(true)
  }

  fun update(leaves: List<InlineTextLeaf>) {
    helper.update(leaves)
    invalidate()
    sendAccessibilityEvent(AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED)
  }

  override fun dispatchHoverEvent(event: MotionEvent): Boolean =
      helper.dispatchHoverEvent(event) || super.dispatchHoverEvent(event)
}

/**
 * One authored accessibility leaf of a text run, as serialized by `ViewState::getMapBuffer` (see
 * `ReactViewManager.readInlineAccessibilityItems`). Mirrors C++ `InlineAccessibilityElement`.
 */
public data class InlineAccessibilityItem(
    /** [KIND_STATIC_TEXT], [KIND_ELEMENT] or [KIND_ATTACHMENT]. */
    val kind: Int,
    val tag: Int,
    val label: String,
    val role: String,
    val hint: String,
    val language: String,
    val disabled: Boolean,
    val selected: Boolean,
    /** C++ `AccessibilityState::CheckedState`: [CHECKED_UNCHECKED] through [CHECKED_NONE]. */
    val checked: Int,
    val fragmentIndices: IntArray,
    /** C++ `AccessibilityLiveRegion`: 0 none, 1 polite, 2 assertive. */
    val liveRegion: Int,
    val busy: Boolean,
    val expanded: Boolean?,
    val valueMin: Int?,
    val valueMax: Int?,
    val valueNow: Int?,
    val valueText: String?,
    /** Pairs of authored action name and spoken label. */
    val actions: List<Pair<String, String>>,
    /**
     * The mounted attachment views this leaf presents, in order: for a [KIND_ATTACHMENT] leaf the
     * view that IS the leaf, for an element the ones it wraps, presented right after it.
     */
    val attachmentTags: IntArray = IntArray(0),
) {
  public companion object {
    public const val KIND_STATIC_TEXT: Int = 0
    public const val KIND_ELEMENT: Int = 1
    public const val KIND_ATTACHMENT: Int = 2

    public const val CHECKED_UNCHECKED: Int = 0
    public const val CHECKED_CHECKED: Int = 1
    public const val CHECKED_MIXED: Int = 2
    public const val CHECKED_NONE: Int = 3
  }
}

/** A model leaf that becomes a virtual node, with the run whose [android.text.Layout] places it. */
internal class InlineTextLeaf(
    val run: ReactViewGroup.TextRunLayout,
    val item: InlineAccessibilityItem,
)

/** One stop in a run's reading order, as the owning [ReactViewGroup] presents it. */
internal sealed interface InlineTextReadingStop {
  /** Consecutive leaves that become virtual nodes of one [InlineTextAccessibilityHost]. */
  class Segment(val leaves: List<InlineTextLeaf>) : InlineTextReadingStop

  /** A mounted attachment view, presented here and nowhere else. */
  class Attachment(val tag: Int) : InlineTextReadingStop
}

/**
 * A run's reading order, straight from its model: every leaf, in order, with each attachment view
 * where its leaf stands. The platform decides nothing here — which leaves exist is the model's
 * answer — it only groups the leaves between two attachments into one segment, because a virtual
 * node cannot be ordered around a real view and a host per segment can.
 */
internal fun inlineTextReadingOrder(
    run: ReactViewGroup.TextRunLayout
): List<InlineTextReadingStop> {
  val stops = ArrayList<InlineTextReadingStop>()
  var segment = ArrayList<InlineTextLeaf>()
  fun closeSegment() {
    if (segment.isNotEmpty()) {
      stops.add(InlineTextReadingStop.Segment(segment))
      segment = ArrayList()
    }
  }
  for (item in run.accessibilityItems.orEmpty()) {
    if (item.kind != InlineAccessibilityItem.KIND_ATTACHMENT) {
      segment.add(InlineTextLeaf(run, item))
    }
    if (item.attachmentTags.isNotEmpty()) {
      closeSegment()
      item.attachmentTags.forEach { stops.add(InlineTextReadingStop.Attachment(it)) }
    }
  }
  closeSegment()
  return stops
}

/**
 * Where a leaf is drawn, in the owning view's pixels: the painted run's own [android.text.Layout],
 * over the character ranges of the leaf's fragments. The same layout paints the run, so a node's
 * rectangle follows wrapping, bidi and font scaling. Null when the run carries no fragment offsets
 * or the leaf covers no characters.
 */
internal fun inlineTextLeafBounds(
    run: ReactViewGroup.TextRunLayout,
    item: InlineAccessibilityItem,
): Rect? {
  val offsets = run.fragmentOffsets ?: return null
  val layout = run.layout
  val path = Path()
  val lineBounds = RectF()
  var result: Rect? = null
  for (fragmentIndex in item.fragmentIndices) {
    if (fragmentIndex < 0 || fragmentIndex + 1 >= offsets.size) {
      continue
    }
    val start = offsets[fragmentIndex]
    val end = offsets[fragmentIndex + 1]
    if (end <= start) {
      continue
    }
    // Per line, so a range that wraps is the lines it is on rather than the box between them
    for (line in layout.getLineForOffset(start)..layout.getLineForOffset(end - 1)) {
      val lineStart = maxOf(start, layout.getLineStart(line))
      val lineEnd = minOf(end, layout.getLineEnd(line))
      if (lineEnd <= lineStart) {
        continue
      }
      path.reset()
      layout.getSelectionPath(lineStart, lineEnd, path)
      path.computeBounds(lineBounds, true)
      val rect =
          Rect(
              floor(run.left + lineBounds.left).toInt(),
              floor(run.top + layout.getLineTop(line)).toInt(),
              ceil(run.left + lineBounds.right).toInt(),
              ceil(run.top + layout.getLineBottom(line)).toInt(),
          )
      // A zero-width range (a lone space at a line end) still needs a box a node can occupy
      if (rect.width() == 0) {
        rect.right = rect.left + 1
      }
      result = result?.also { it.union(rect) } ?: rect
    }
  }
  return result
}

/** The whole run's box, for a leaf [inlineTextLeafBounds] cannot place. */
private fun inlineTextRunBounds(run: ReactViewGroup.TextRunLayout): Rect =
    Rect(
        floor(run.left).toInt(),
        floor(run.top).toInt(),
        ceil(run.left + run.layout.width).toInt(),
        ceil(run.top + run.layout.height).toInt(),
    )

private class InlineTextAccessibilityHelper(host: InlineTextAccessibilityHost) :
    ExploreByTouchHelper(host) {
  private data class Leaf(
      val virtualId: Int,
      val run: ReactViewGroup.TextRunLayout,
      val item: InlineAccessibilityItem,
      val bounds: Rect,
  )

  private val owner = host
  private var leaves: List<Leaf> = emptyList()
  private var leavesById: Map<Int, Leaf> = emptyMap()

  fun update(segment: List<InlineTextLeaf>) {
    // A semantic element's tag is unique among the leaves, so it keys the node and keeps TalkBack's
    // focus on it across updates. Static text is not an authored element: two of its leaves can
    // start in the same `<b>`, so they are numbered instead.
    var fallbackId = FALLBACK_ID_BASE
    leaves =
        segment.map { leaf ->
          val item = leaf.item
          val virtualId =
              if (item.kind != InlineAccessibilityItem.KIND_STATIC_TEXT && item.tag > 0) item.tag
              else fallbackId++
          Leaf(
              virtualId,
              leaf.run,
              item,
              inlineTextLeafBounds(leaf.run, item) ?: inlineTextRunBounds(leaf.run),
          )
        }
    leavesById = leaves.associateBy(Leaf::virtualId)
    invalidateRoot()
  }

  override fun getVisibleVirtualViews(virtualViewIds: MutableList<Int>) {
    leaves.forEach { virtualViewIds.add(it.virtualId) }
  }

  override fun getVirtualViewAt(x: Float, y: Float): Int =
      leaves.firstOrNull { it.bounds.contains(x.toInt(), y.toInt()) }?.virtualId ?: INVALID_ID

  override fun onPopulateNodeForVirtualView(id: Int, node: AccessibilityNodeInfoCompat) {
    val leaf = leavesById[id]
    if (leaf == null) {
      node.contentDescription = ""
      node.setBoundsInParent(Rect(0, 0, 1, 1))
      return
    }
    val item = leaf.item
    val spokenLabel =
        if (item.language.isEmpty()) {
          item.label
        } else {
          SpannableString(item.label).apply {
            setSpan(
                LocaleSpan(Locale.forLanguageTag(item.language)),
                0,
                length,
                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
            )
          }
        }
    if (item.kind == InlineAccessibilityItem.KIND_STATIC_TEXT) {
      node.text = spokenLabel
      // Text is not a control. Left unfocusable, TalkBack reads it on its own where nothing
      // focusable contains it, and folds it into the name of a focusable box that does — the way
      // `<button>Save</button>` is named — instead of adding a stop inside the button.
      node.isFocusable = false
    } else {
      node.contentDescription = spokenLabel
    }
    node.tooltipText = item.hint.ifEmpty { null }
    node.setBoundsInParent(leaf.bounds)
    node.isEnabled = !item.disabled
    node.isSelected = item.selected
    node.isCheckable = item.checked != InlineAccessibilityItem.CHECKED_NONE
    node.isChecked = item.checked == InlineAccessibilityItem.CHECKED_CHECKED
    if (item.expanded != null) {
      node.addAction(
          if (item.expanded) AccessibilityNodeInfoCompat.ACTION_COLLAPSE
          else AccessibilityNodeInfoCompat.ACTION_EXPAND
      )
    }
    node.stateDescription =
        item.valueText
            ?: if (item.busy) "busy" else item.expanded?.let { if (it) "expanded" else "collapsed" }
    if (item.valueMin != null && item.valueMax != null && item.valueNow != null) {
      node.rangeInfo =
          AccessibilityNodeInfoCompat.RangeInfoCompat.obtain(
              AccessibilityNodeInfoCompat.RangeInfoCompat.RANGE_TYPE_INT,
              item.valueMin.toFloat(),
              item.valueMax.toFloat(),
              item.valueNow.toFloat(),
          )
    }
    node.liveRegion =
        when (item.liveRegion) {
          1 -> View.ACCESSIBILITY_LIVE_REGION_POLITE
          2 -> View.ACCESSIBILITY_LIVE_REGION_ASSERTIVE
          else -> View.ACCESSIBILITY_LIVE_REGION_NONE
        }
    val accessibilityRole =
        when (item.role) {
          "heading" -> ReactAccessibilityDelegate.AccessibilityRole.HEADER
          "img" -> ReactAccessibilityDelegate.AccessibilityRole.IMAGE
          "slider" -> ReactAccessibilityDelegate.AccessibilityRole.ADJUSTABLE
          else ->
              runCatching { ReactAccessibilityDelegate.AccessibilityRole.fromValue(item.role) }
                  .getOrNull()
        }
    ReactAccessibilityDelegate.setRole(node, accessibilityRole, owner.context)
    if (item.role == "button" || item.role == "link") {
      node.isClickable = !item.disabled
      if (!item.disabled) {
        node.addAction(AccessibilityNodeInfoCompat.ACTION_CLICK)
      }
    }
    item.actions.forEachIndexed { index, (_, label) ->
      node.addAction(
          AccessibilityNodeInfoCompat.AccessibilityActionCompat(
              customActionId(index),
              label,
          )
      )
    }
  }

  override fun onPerformActionForVirtualView(
      id: Int,
      action: Int,
      arguments: Bundle?,
  ): Boolean {
    val leaf = leavesById[id] ?: return false
    if (leaf.item.disabled || leaf.item.tag <= 0) {
      return false
    }
    val reactContext = owner.context as? ReactContext ?: return false
    val actionIndex = leaf.item.actions.indices.firstOrNull { customActionId(it) == action }
    val event =
        if (actionIndex != null) {
          InlineAccessibilityActionEvent(
              UIManagerHelper.getSurfaceId(reactContext),
              leaf.item.tag,
              leaf.item.actions[actionIndex].first,
          )
        } else if (action == AccessibilityNodeInfoCompat.ACTION_CLICK) {
          ViewGroupClickEvent(UIManagerHelper.getSurfaceId(reactContext), leaf.item.tag)
        } else {
          return false
        }
    UIManagerHelper.getEventDispatcherForReactTag(reactContext, leaf.item.tag)?.dispatchEvent(event)
    return true
  }

  private fun customActionId(actionIndex: Int): Int = CUSTOM_ACTION_BASE + actionIndex

  private companion object {
    const val CUSTOM_ACTION_BASE = 0x01000000
    const val FALLBACK_ID_BASE = 0x02000000
  }
}

private class InlineAccessibilityActionEvent(
    surfaceId: Int,
    viewId: Int,
    private val actionName: String,
) : Event<InlineAccessibilityActionEvent>(surfaceId, viewId) {
  override fun getEventName(): String = "topAccessibilityAction"

  override fun canCoalesce(): Boolean = false

  override fun getEventData() = Arguments.createMap().apply { putString("actionName", actionName) }
}
