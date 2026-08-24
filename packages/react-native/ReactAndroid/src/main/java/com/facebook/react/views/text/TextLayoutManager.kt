/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.text

import android.content.res.AssetManager
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.text.BoringLayout
import android.text.Layout
import android.text.Spannable
import android.text.SpannableString
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.StaticLayout
import android.text.TextDirectionHeuristics
import android.text.TextPaint
import android.text.TextUtils
import android.text.style.LeadingMarginSpan
import android.util.LayoutDirection
import android.view.Gravity
import android.view.View
import androidx.annotation.VisibleForTesting
import com.facebook.common.logging.FLog
import com.facebook.infer.annotation.Assertions
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.common.ReactConstants
import com.facebook.react.common.annotations.UnstableReactNativeAPI
import com.facebook.react.common.mapbuffer.MapBuffer
import com.facebook.react.common.mapbuffer.ReadableMapBuffer
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlags
import com.facebook.react.uimanager.DisplayMetricsHolder
import com.facebook.react.uimanager.PixelUtil
import com.facebook.react.uimanager.PixelUtil.dpToPx
import com.facebook.react.uimanager.PixelUtil.pxToDp
import com.facebook.react.uimanager.ReactAccessibilityDelegate
import android.text.style.SubscriptSpan
import android.text.style.SuperscriptSpan
import com.facebook.react.views.text.internal.span.CustomLetterSpacingSpan
import com.facebook.react.views.text.internal.span.CustomLineHeightSpan
import com.facebook.react.views.text.internal.span.CustomStyleSpan
import com.facebook.react.views.text.internal.span.InlineBoxDecorationSpan
import com.facebook.react.views.text.internal.span.InlineBoxSpacingSpan
import com.facebook.react.views.text.internal.span.ReactAbsoluteSizeSpan
import com.facebook.react.views.text.internal.span.ReactBackgroundColorSpan
import com.facebook.react.views.text.internal.span.ReactClickableSpan
import com.facebook.react.views.text.internal.span.ReactForegroundColorSpan
import com.facebook.react.views.text.internal.span.ReactFragmentIndexSpan
import com.facebook.react.views.text.internal.span.ReactLinkSpan
import com.facebook.react.views.text.internal.span.ReactOpacitySpan
import com.facebook.react.views.text.internal.span.ReactStrikethroughSpan
import com.facebook.react.views.text.internal.span.ReactTagSpan
import com.facebook.react.views.text.internal.span.ReactTextPaintHolderSpan
import com.facebook.react.views.text.internal.span.ReactUnderlineSpan
import com.facebook.react.views.text.internal.span.SetSpanOperation
import com.facebook.react.views.text.internal.span.ShadowStyleSpan
import com.facebook.react.views.text.internal.span.TextInlineViewPlaceholderSpan
import com.facebook.yoga.YogaMeasureMode
import com.facebook.yoga.YogaMeasureOutput
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import org.json.JSONArray
import org.json.JSONObject

/** Class responsible of creating [Spanned] object for the JS representation of Text */
internal object TextLayoutManager {

  // constants for AttributedString serialization
  const val AS_KEY_HASH: Int = 0
  const val AS_KEY_STRING: Int = 1
  const val AS_KEY_FRAGMENTS: Int = 2
  const val AS_KEY_CACHE_ID: Int = 3
  const val AS_KEY_BASE_ATTRIBUTES: Int = 4
  // The owning anonymous run box's tag; present only on text-run content.
  // Keys the measure->mount layout handoff (run-layout-reuse-plan.md).
  const val AS_KEY_RUN_TAG: Int = 5

  // constants for Fragment serialization
  const val FR_KEY_STRING: Int = 0
  const val FR_KEY_REACT_TAG: Int = 1
  const val FR_KEY_IS_ATTACHMENT: Int = 2
  const val FR_KEY_WIDTH: Int = 3
  const val FR_KEY_HEIGHT: Int = 4
  const val FR_KEY_TEXT_ATTRIBUTES: Int = 5
  // Inline box decorations (box-model-scope.md G2); present only on fragments of a decorated
  // inline element. Keys must match `attributedstring/conversions.h`.
  const val FR_KEY_INLINE_BOX: Int = 6
  const val FR_KEY_IS_INLINE_BOX_START: Int = 7
  const val FR_KEY_IS_INLINE_BOX_END: Int = 8
  // The attachment's own baseline, from the box's top (CSS2 §10.8.1).
  const val FR_KEY_ATOMIC_INLINE_BASELINE: Int = 9
  // An inline element that contributed no text of its own — `<span></span>`.
  // Its fragment is empty on purpose and still has a box on the line.
  const val FR_KEY_IS_EMPTY_ELEMENT: Int = 10
  // CSS `vertical-align` for an atomic inline: 0 baseline, 1 top, 2 bottom,
  // 3 middle.
  const val FR_KEY_ATOMIC_INLINE_VERTICAL_ALIGN: Int = 11

  const val IB_KEY_MARGIN_LEFT: Int = 0
  const val IB_KEY_MARGIN_RIGHT: Int = 1
  const val IB_KEY_PADDING_LEFT: Int = 2
  const val IB_KEY_PADDING_TOP: Int = 3
  const val IB_KEY_PADDING_RIGHT: Int = 4
  const val IB_KEY_PADDING_BOTTOM: Int = 5
  const val IB_KEY_BORDER_LEFT_WIDTH: Int = 6
  const val IB_KEY_BORDER_TOP_WIDTH: Int = 7
  const val IB_KEY_BORDER_RIGHT_WIDTH: Int = 8
  const val IB_KEY_BORDER_BOTTOM_WIDTH: Int = 9
  const val IB_KEY_BORDER_LEFT_COLOR: Int = 10
  const val IB_KEY_BORDER_TOP_COLOR: Int = 11
  const val IB_KEY_BORDER_RIGHT_COLOR: Int = 12
  const val IB_KEY_BORDER_BOTTOM_COLOR: Int = 13
  const val IB_KEY_BORDER_RADIUS: Int = 14
  const val IB_KEY_OUTLINE_COLOR: Int = 15
  const val IB_KEY_OUTLINE_WIDTH: Int = 16
  const val IB_KEY_OUTLINE_OFFSET: Int = 17

  // constants for ParagraphAttributes serialization
  const val PA_KEY_MAX_NUMBER_OF_LINES: Int = 0
  const val PA_KEY_ELLIPSIZE_MODE: Int = 1
  const val PA_KEY_TEXT_BREAK_STRATEGY: Int = 2
  const val PA_KEY_ADJUST_FONT_SIZE_TO_FIT: Int = 3
  const val PA_KEY_INCLUDE_FONT_PADDING: Int = 4
  const val PA_KEY_HYPHENATION_FREQUENCY: Int = 5
  const val PA_KEY_MINIMUM_FONT_SIZE: Int = 6
  const val PA_KEY_MAXIMUM_FONT_SIZE: Int = 7
  const val PA_KEY_TEXT_ALIGN_VERTICAL: Int = 8

  private val TAG: String = TextLayoutManager::class.java.simpleName

  // Each thread has its own copy of scratch TextPaint so that TextLayoutManager
  // measurement/Spannable creation can be free-threaded.
  private val textPaintInstance: ThreadLocal<TextPaint> =
      object : ThreadLocal<TextPaint>() {
        override fun initialValue(): TextPaint = TextPaint(TextPaint.ANTI_ALIAS_FLAG)
      }

  private const val DEFAULT_INCLUDE_FONT_PADDING = true

  private const val DEFAULT_ADJUST_FONT_SIZE_TO_FIT = false

  private val tagToSpannableCache = ConcurrentHashMap<Int, Spannable>()

  // Lazily cached Method for StaticLayout.Builder.setUseBoundsForWidth (API 35+).
  // Reflection is needed because some internal targets compile against an SDK older than 35.
  private val setUseBoundsForWidthMethod: java.lang.reflect.Method? by lazy {
    try {
      StaticLayout.Builder::class
          .java
          .getMethod("setUseBoundsForWidth", Boolean::class.javaPrimitiveType)
    } catch (_: ReflectiveOperationException) {
      null
    }
  }

  fun setCachedSpannableForTag(reactTag: Int, sp: Spannable): Unit {
    tagToSpannableCache[reactTag] = sp
  }

  fun deleteCachedSpannableForTag(reactTag: Int): Unit {
    tagToSpannableCache.remove(reactTag)
  }

  fun isRTL(attributedString: MapBuffer): Boolean {
    // TODO: Don't read AS_KEY_FRAGMENTS, which may be expensive, and is not present when using
    // cached Spannable
    if (!attributedString.contains(AS_KEY_FRAGMENTS)) {
      return false
    }

    val fragments = attributedString.getMapBuffer(AS_KEY_FRAGMENTS)
    if (fragments.count == 0) {
      return false
    }

    val fragment = fragments.getMapBuffer(0)
    val textAttributes = fragment.getMapBuffer(FR_KEY_TEXT_ATTRIBUTES)

    if (!textAttributes.contains(TextAttributeProps.TA_KEY_LAYOUT_DIRECTION.toInt())) {
      return false
    }

    return TextAttributeProps.getLayoutDirection(
        textAttributes.getString(TextAttributeProps.TA_KEY_LAYOUT_DIRECTION.toInt())
    ) == LayoutDirection.RTL
  }

  private fun getTextAlignmentAttr(attributedString: MapBuffer): String? {
    // TODO: Don't read AS_KEY_FRAGMENTS, which may be expensive, and is not present when using
    // cached Spannable
    if (!attributedString.contains(AS_KEY_FRAGMENTS)) {
      return null
    }

    val fragments = attributedString.getMapBuffer(AS_KEY_FRAGMENTS)
    if (fragments.count != 0) {
      val fragment = fragments.getMapBuffer(0)
      val textAttributes = fragment.getMapBuffer(FR_KEY_TEXT_ATTRIBUTES)

      if (textAttributes.contains(TextAttributeProps.TA_KEY_ALIGNMENT.toInt())) {
        return textAttributes.getString(TextAttributeProps.TA_KEY_ALIGNMENT.toInt())
      }
    }

    return null
  }

  /**
   * Whether the run's `white-space` forbids wrapping (css-text-3 §3) — `pre` or `nowrap`. A line
   * then ends only where the source has a segment break, and a long one overflows its container
   * rather than folding onto the next line.
   *
   * The other four values all wrap; they differ from each other in which whitespace survives, which
   * is settled before this point, in the collapsing pass.
   *
   * Read off the first fragment because `white-space` is inherited and applies to the whole run,
   * the same way [getTextAlignmentAttr] reads `textAlign`.
   */
  @JvmStatic
  public fun forbidsWrapping(attributedString: MapBuffer): Boolean {
    if (!attributedString.contains(AS_KEY_FRAGMENTS)) {
      return false
    }

    val fragments = attributedString.getMapBuffer(AS_KEY_FRAGMENTS)
    if (fragments.count == 0) {
      return false
    }

    val textAttributes = fragments.getMapBuffer(0).getMapBuffer(FR_KEY_TEXT_ATTRIBUTES)
    if (!textAttributes.contains(TextAttributeProps.TA_KEY_WHITE_SPACE)) {
      return false
    }
    return when (textAttributes.getString(TextAttributeProps.TA_KEY_WHITE_SPACE)) {
      "pre",
      "nowrap" -> true
      else -> false
    }
  }

  private fun getTextJustificationMode(alignmentAttr: String?): Int {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return -1
    }

    if (alignmentAttr != null && alignmentAttr == "justified") {
      return Layout.JUSTIFICATION_MODE_INTER_WORD
    }

    return Layout.JUSTIFICATION_MODE_NONE
  }

  private fun getTextAlignment(
      attributedString: MapBuffer,
      spanned: Spannable,
      alignmentAttr: String?,
  ): Layout.Alignment {
    // Android will align text based on the script, so normal and opposite alignment needs to be
    // swapped when the directions of paragraph and script don't match.
    // I.e. paragraph is LTR but script is RTL, text needs to be aligned to the left, which means
    // ALIGN_OPPOSITE needs to be used to align RTL script to the left
    val isParagraphRTL = isRTL(attributedString)
    val isScriptRTL = TextDirectionHeuristics.FIRSTSTRONG_LTR.isRtl(spanned, 0, spanned.length)
    val swapNormalAndOpposite = isParagraphRTL != isScriptRTL

    var alignment =
        if (swapNormalAndOpposite) Layout.Alignment.ALIGN_OPPOSITE
        else Layout.Alignment.ALIGN_NORMAL

    if (alignmentAttr == null) {
      return alignment
    }

    if (alignmentAttr == "center") {
      alignment = Layout.Alignment.ALIGN_CENTER
    } else if (alignmentAttr == "right" || alignmentAttr == "end") {
      alignment =
          if (swapNormalAndOpposite) Layout.Alignment.ALIGN_NORMAL
          else Layout.Alignment.ALIGN_OPPOSITE
    }

    return alignment
  }

  @JvmStatic
  fun getTextGravity(attributedString: MapBuffer, spanned: Spannable): Int {
    val alignmentAttr = getTextAlignmentAttr(attributedString)
    val alignment = getTextAlignment(attributedString, spanned, alignmentAttr)

    // depending on whether the script is LTR or RTL, ALIGN_NORMAL and ALIGN_OPPOSITE may mean
    // different things
    val swapLeftAndRight = TextDirectionHeuristics.FIRSTSTRONG_LTR.isRtl(spanned, 0, spanned.length)

    return when (alignment) {
      Layout.Alignment.ALIGN_NORMAL -> if (swapLeftAndRight) Gravity.RIGHT else Gravity.LEFT
      Layout.Alignment.ALIGN_OPPOSITE -> if (swapLeftAndRight) Gravity.LEFT else Gravity.RIGHT
      Layout.Alignment.ALIGN_CENTER -> Gravity.CENTER_HORIZONTAL
    }
  }

  /**
   * The element's box decorations, as a span that paints them
   * (box-model-scope.md G4/G5). Null when the element has nothing to draw, so
   * undecorated text pays nothing.
   */
  private fun inlineBoxDecorationSpan(
      box: MapBuffer,
      leadingSpaceInsideAdvance: Boolean,
  ): InlineBoxDecorationSpan? {
    fun px(key: Int): Float =
        if (box.contains(key)) PixelUtil.toPixelFromDIP(box.getDouble(key)) else 0f
    fun color(key: Int): Int? = if (box.contains(key)) box.getInt(key) else null

    val borderWidths =
        listOf(
            px(IB_KEY_BORDER_LEFT_WIDTH),
            px(IB_KEY_BORDER_TOP_WIDTH),
            px(IB_KEY_BORDER_RIGHT_WIDTH),
            px(IB_KEY_BORDER_BOTTOM_WIDTH),
        )
    val outlineWidth = px(IB_KEY_OUTLINE_WIDTH)
    if (borderWidths.all { it == 0f } && outlineWidth == 0f) {
      // Padding and margin alone change the advance but draw nothing.
      return null
    }

    return InlineBoxDecorationSpan(
        paddingLeft = px(IB_KEY_PADDING_LEFT),
        paddingTop = px(IB_KEY_PADDING_TOP),
        paddingRight = px(IB_KEY_PADDING_RIGHT),
        paddingBottom = px(IB_KEY_PADDING_BOTTOM),
        borderLeftWidth = borderWidths[0],
        borderTopWidth = borderWidths[1],
        borderRightWidth = borderWidths[2],
        borderBottomWidth = borderWidths[3],
        borderLeftColor = color(IB_KEY_BORDER_LEFT_COLOR),
        borderTopColor = color(IB_KEY_BORDER_TOP_COLOR),
        borderRightColor = color(IB_KEY_BORDER_RIGHT_COLOR),
        borderBottomColor = color(IB_KEY_BORDER_BOTTOM_COLOR),
        borderRadius = px(IB_KEY_BORDER_RADIUS),
        outlineColor = color(IB_KEY_OUTLINE_COLOR),
        outlineWidth = outlineWidth,
        outlineOffset = px(IB_KEY_OUTLINE_OFFSET),
        marginLeft = px(IB_KEY_MARGIN_LEFT),
        marginRight = px(IB_KEY_MARGIN_RIGHT),
        leadingSpaceInsideAdvance = leadingSpaceInsideAdvance,
    )
  }

  /**
   * One edge's reserve — an inline element's inline-axis margin + border + padding, in px, kept as
   * PARTS because painting needs them apart (background covers padding only) while advance needs
   * their sum. THE INLINE RESERVE MODEL is documented on [InlineBoxSpacingSpan].
   */
  internal class InlineReserve(val margin: Float, val border: Float, val padding: Float) {
    val total: Float
      get() = margin + border + padding

    companion object {
      val NONE: InlineReserve = InlineReserve(0f, 0f, 0f)
    }
  }

  /**
   * The inline-axis space an inline element reserves at its leading and trailing edges: margin +
   * border + padding (box-model-scope.md G3, CSS2 §10.6.1). Block-axis values deliberately do not
   * appear — they paint but never change line height.
   */
  private fun leadingInlineSpace(fragment: MapBuffer): InlineReserve {
    if (!fragment.contains(FR_KEY_INLINE_BOX) ||
        !(fragment.contains(FR_KEY_IS_INLINE_BOX_START) &&
            fragment.getBoolean(FR_KEY_IS_INLINE_BOX_START))) {
      return InlineReserve.NONE
    }
    val box = fragment.getMapBuffer(FR_KEY_INLINE_BOX)
    return InlineReserve(
        margin = PixelUtil.toPixelFromDIP(box.getDouble(IB_KEY_MARGIN_LEFT)),
        border = PixelUtil.toPixelFromDIP(box.getDouble(IB_KEY_BORDER_LEFT_WIDTH)),
        padding = PixelUtil.toPixelFromDIP(box.getDouble(IB_KEY_PADDING_LEFT)),
    )
  }

  /**
   * How far a fragment's border box extends above and below the line box, in
   * pixels. The mirror of `AttributedString::Fragment::blockAxisBoxEdges`.
   *
   * Unlike the inline-axis edges this is NOT gated on the element's first or
   * last fragment: a wrapped inline is one box per line and
   * `box-decoration-break: slice` (CSS §8.6, the initial value) draws the
   * block-axis padding and border on every one of them.
   *
   * Margin is excluded — this is the border box.
   */
  private fun blockAxisBoxEdges(fragment: MapBuffer): Pair<Float, Float> {
    if (!fragment.contains(FR_KEY_INLINE_BOX)) {
      return 0f to 0f
    }
    val box = fragment.getMapBuffer(FR_KEY_INLINE_BOX)
    return PixelUtil.toPixelFromDIP(
        box.getDouble(IB_KEY_PADDING_TOP) + box.getDouble(IB_KEY_BORDER_TOP_WIDTH)
    ) to
        PixelUtil.toPixelFromDIP(
            box.getDouble(IB_KEY_PADDING_BOTTOM) + box.getDouble(IB_KEY_BORDER_BOTTOM_WIDTH)
        )
  }

  private fun trailingInlineSpace(fragment: MapBuffer): InlineReserve {
    if (!fragment.contains(FR_KEY_INLINE_BOX) ||
        !(fragment.contains(FR_KEY_IS_INLINE_BOX_END) &&
            fragment.getBoolean(FR_KEY_IS_INLINE_BOX_END))) {
      return InlineReserve.NONE
    }
    val box = fragment.getMapBuffer(FR_KEY_INLINE_BOX)
    return InlineReserve(
        margin = PixelUtil.toPixelFromDIP(box.getDouble(IB_KEY_MARGIN_RIGHT)),
        border = PixelUtil.toPixelFromDIP(box.getDouble(IB_KEY_BORDER_RIGHT_WIDTH)),
        padding = PixelUtil.toPixelFromDIP(box.getDouble(IB_KEY_PADDING_RIGHT)),
    )
  }

  /**
   * Turns an inline element's inline-axis space into real advance, without adding characters —
   * see [InlineBoxSpacingSpan] for why that constraint matters.
   *
   * Emits `(start, end, span)` rather than applying anything, because there are two Spannable
   * construction paths — `enableAndroidTextMeasurementOptimizations` chooses between them — and
   * this rule is subtle enough that writing it twice is precisely how it comes out right in one and
   * wrong in the other. It lives here once and both paths apply whatever it yields.
   *
   * `InlineBoxSpacingSpansAgreeTest` holds them to that by running the same fragments through both.
   *
   * The leading space hangs off the character *preceding* the element. Two cases cannot use one:
   * - There is no preceding character when the element starts the text. A leading margin is used
   *   instead: such an element necessarily starts the first line, and `LeadingMarginSpan` indents
   *   only that line, which is right because a leading edge applies once no matter how often the
   *   box wraps.
   * - The preceding character is an attachment placeholder, which is a `ReplacementSpan` and owns
   *   its character's advance outright. A second one fights it and the attachment loses its width.
   *   The space goes on this element's own first character instead, drawn ahead of the glyph, which
   *   puts it in the same place on screen.
   *
   * An attachment fragment emits nothing at all: [TextInlineViewPlaceholderSpan] already takes its
   * leading and trailing space and builds them into its own advance. Adding a second span for that
   * same space used to be harmless because this was a `MetricAffectingSpan` and a ReplacementSpan's
   * size wins, so it was silently discarded — the duplication was real but inert. It is a
   * ReplacementSpan now, and the two fought: a box 40 wide measured 6.
   */
  private inline fun inlineBoxSpacingSpans(
      leading: InlineReserve,
      trailing: InlineReserve,
      start: Int,
      end: Int,
      isAttachment: Boolean,
      previousWasAttachment: Boolean,
      emit: (start: Int, end: Int, span: Any) -> Unit,
  ) {
    if (isAttachment || end <= start) {
      return
    }
    if (leading.total > 0f) {
      when {
        start == 0 -> emit(0, end, LeadingMarginSpan.Standard(Math.round(leading.total), 0))
        previousWasAttachment ->
            emit(
                start,
                start + 1,
                InlineBoxSpacingSpan(
                    leading.margin, leading.border, leading.padding, spaceBefore = true))
        else ->
            emit(
                start - 1,
                start,
                InlineBoxSpacingSpan(
                    leading.margin,
                    leading.border,
                    leading.padding,
                    spacingTakesFollowingBackground = true))
      }
    }
    if (trailing.total > 0f) {
      emit(end - 1, end, InlineBoxSpacingSpan(trailing.margin, trailing.border, trailing.padding))
    }
  }

  /**
   * Emits the box-painting span for a whole inline element.
   *
   * The decorations are stamped on *every* fragment of an element, so adding a
   * span per fragment paints one box per fragment — visibly, two overlapping
   * boxes for an element that produced two fragments. The box belongs to the
   * element, so it is emitted once, spanning from the fragment flagged as the
   * element's start to the one flagged as its end. That is the same grouping
   * the iOS painting pass does.
   *
   * Returns the still-open element, or null when none is open. Shared by BOTH
   * Spannable construction paths, like [inlineBoxSpacingSpans] and for the
   * same reason: a rule applied on one path only is invisible on screen when
   * the other is enabled.
   */
  private inline fun applyInlineBoxDecoration(
      box: MapBuffer?,
      isStart: Boolean,
      isEnd: Boolean,
      start: Int,
      end: Int,
      pending: PendingInlineBox?,
      followsAttachment: Boolean,
      emit: (start: Int, end: Int, span: Any) -> Unit,
  ): PendingInlineBox? {
    if (box == null) {
      return pending
    }
    val open = if (isStart) PendingInlineBox(start, followsAttachment) else pending
    if (!isEnd) {
      return open
    }
    if (open != null && end > open.start) {
      inlineBoxDecorationSpan(box, open.followsAttachment)?.let { emit(open.start, end, it) }
    }
    return null
  }

  /** An inline element whose box has opened but not yet closed. */
  private class PendingInlineBox(val start: Int, val followsAttachment: Boolean)

  private fun inlineBoxOf(fragment: MapBuffer): MapBuffer? =
      if (fragment.contains(FR_KEY_INLINE_BOX)) fragment.getMapBuffer(FR_KEY_INLINE_BOX) else null

  private fun isInlineBoxStart(fragment: MapBuffer): Boolean =
      fragment.contains(FR_KEY_IS_INLINE_BOX_START) &&
          fragment.getBoolean(FR_KEY_IS_INLINE_BOX_START)

  private fun isInlineBoxEnd(fragment: MapBuffer): Boolean =
      fragment.contains(FR_KEY_IS_INLINE_BOX_END) && fragment.getBoolean(FR_KEY_IS_INLINE_BOX_END)

  @OptIn(UnstableReactNativeAPI::class)
  private fun buildSpannableFromFragments(
      assets: AssetManager,
      fontWeightAdjustment: Int,
      fragments: MapBuffer,
      sb: SpannableStringBuilder,
      ops: MutableList<SetSpanOperation>,
      outputReactTags: IntArray?,
      textEffectRegistry: TextEffectRegistry?,
  ) {
    // Track pending text effects to coalesce consecutive fragments with the same effects into
    // single spans, avoiding duplicate draws (e.g. multiple accent marks in HighlighterTextSpan).
    var pendingEffects: List<TextAttributeProps.TextEffectEntry> = emptyList()
    var pendingEffectStart = 0
    // The inline element whose box is still open, or null.
    var openInlineBox: PendingInlineBox? = null
    var previousWasAttachment = false

    for (i in 0 until fragments.count) {
      val fragment = fragments.getMapBuffer(i)
      val start = sb.length

      val textAttributes =
          TextAttributeProps.fromMapBuffer(fragment.getMapBuffer(FR_KEY_TEXT_ATTRIBUTES))

      sb.append(
          TextTransform.apply(fragment.getString(FR_KEY_STRING), textAttributes.textTransform)
      )

      val end = sb.length
      val isAttachment =
          fragment.contains(FR_KEY_IS_ATTACHMENT) && fragment.getBoolean(FR_KEY_IS_ATTACHMENT)
      inlineBoxSpacingSpans(
          leadingInlineSpace(fragment),
          trailingInlineSpace(fragment),
          start,
          end,
          isAttachment,
          previousWasAttachment,
      ) { spanStart, spanEnd, span ->
        ops.add(SetSpanOperation(spanStart, spanEnd, span))
      }
      openInlineBox =
          applyInlineBoxDecoration(
              inlineBoxOf(fragment),
              isInlineBoxStart(fragment),
              isInlineBoxEnd(fragment),
              start,
              end,
              openInlineBox,
              previousWasAttachment,
          ) { spanStart, spanEnd, span ->
            ops.add(SetSpanOperation(spanStart, spanEnd, span))
          }
      previousWasAttachment = isAttachment
      val reactTag =
          if (fragment.contains(FR_KEY_REACT_TAG)) fragment.getInt(FR_KEY_REACT_TAG) else View.NO_ID
      if (isAttachment) {
        val width = PixelUtil.toPixelFromSP(fragment.getDouble(FR_KEY_WIDTH))
        val height = PixelUtil.toPixelFromSP(fragment.getDouble(FR_KEY_HEIGHT))
        val baselineFromTop =
            if (fragment.contains(FR_KEY_ATOMIC_INLINE_BASELINE))
                PixelUtil.toPixelFromSP(fragment.getDouble(FR_KEY_ATOMIC_INLINE_BASELINE))
            else height
        ops.add(
            SetSpanOperation(
                sb.length - 1,
                sb.length,
                TextInlineViewPlaceholderSpan(
                    reactTag,
                    width.toInt(),
                    height.toInt(),
                    baselineFromTop.toInt(),
                    if (fragment.contains(FR_KEY_ATOMIC_INLINE_VERTICAL_ALIGN))
                        fragment.getInt(FR_KEY_ATOMIC_INLINE_VERTICAL_ALIGN)
                    else 0,
                    leadingInlineSpace(fragment).total.toInt(),
                    trailingInlineSpace(fragment).total.toInt(),
                ),
            )
        )
        // The strut. Every line box has one, whether or not text sits on it
        // (CSS2 §10.8), but the line-height span is applied in the text branch
        // below — so a line of only atomic inlines had none and collapsed to
        // its tallest box: a 10pt box on a 20pt line measured 10.
        //
        // Expand-only, because unlike text an atomic inline may legitimately be
        // taller than the strut and must then define the line rather than be
        // clamped into it.
        if (!textAttributes.lineHeight.isNaN()) {
          ops.add(
              SetSpanOperation(
                  start,
                  end,
                  CustomLineHeightSpan(textAttributes.lineHeight, expandOnly = true),
              )
          )
        }
      } else if (end >= start) {
        val roleIsLink =
            if (textAttributes.role != null)
                (textAttributes.role == ReactAccessibilityDelegate.Role.LINK)
            else
                (textAttributes.accessibilityRole ==
                    ReactAccessibilityDelegate.AccessibilityRole.LINK)
        if (roleIsLink) {
          if (ReactNativeFeatureFlags.enablePreparedTextLayout()) {
            ops.add(SetSpanOperation(start, end, ReactLinkSpan(i)))
          } else {
            ops.add(SetSpanOperation(start, end, ReactClickableSpan(reactTag)))
          }
        }
        if (textAttributes.isColorSet) {
          textAttributes.color
              ?.let { ReactForegroundColorSpan(it) }
              ?.let { SetSpanOperation(start, end, it) }
              ?.let { ops.add(it) }
        }
        if (textAttributes.isBackgroundColorSet) {
          textAttributes.backgroundColor
              ?.let { ReactBackgroundColorSpan(it) }
              ?.let { SetSpanOperation(start, end, it) }
              ?.let { ops.add(it) }
        }
        if (!textAttributes.opacity.isNaN()) {
          ops.add(SetSpanOperation(start, end, ReactOpacitySpan(textAttributes.opacity)))
        }
        if (!textAttributes.letterSpacing.isNaN()) {
          ops.add(
              SetSpanOperation(start, end, CustomLetterSpacingSpan(textAttributes.letterSpacing))
          )
        }
        /*
         * `<sup>` / `<sub>`, through Android's own spans.
         *
         * `SuperscriptSpan` and `SubscriptSpan` derive the shift from the font,
         * the same way CoreText's superscript attribute does on iOS, so both
         * platforms follow the typeface rather than a shared guess at an em
         * fraction. The size reduction is the user-agent sheet's
         * `font-size: 0.83em`, which is what a browser applies too.
         */
        when (textAttributes.verticalAlign) {
          "super" -> ops.add(SetSpanOperation(start, end, SuperscriptSpan()))
          "sub" -> ops.add(SetSpanOperation(start, end, SubscriptSpan()))
          else -> Unit
        }
        ops.add(SetSpanOperation(start, end, ReactAbsoluteSizeSpan(textAttributes.fontSize)))
        if (
            textAttributes.fontStyle != ReactConstants.UNSET ||
                textAttributes.fontWeight != ReactConstants.UNSET ||
                textAttributes.fontFamily != null
        ) {
          ops.add(
              SetSpanOperation(
                  start,
                  end,
                  CustomStyleSpan(
                      textAttributes.fontStyle,
                      textAttributes.fontWeight,
                      textAttributes.fontFeatureSettings,
                      textAttributes.fontFamily,
                      assets,
                      fontWeightAdjustment,
                  ),
              )
          )
        }
        if (textAttributes.isUnderlineTextDecorationSet) {
          ops.add(
              SetSpanOperation(
                  start,
                  end,
                  ReactUnderlineSpan(
                      textAttributes.textDecorationColor,
                      textAttributes.textDecorationStyle,
                  ),
              )
          )
        }
        if (textAttributes.isLineThroughTextDecorationSet) {
          ops.add(
              SetSpanOperation(
                  start,
                  end,
                  ReactStrikethroughSpan(
                      textAttributes.textDecorationColor,
                      textAttributes.textDecorationStyle,
                  ),
              )
          )
        }
        if (
            (textAttributes.textShadowOffsetDx != 0f ||
                textAttributes.textShadowOffsetDy != 0f ||
                textAttributes.textShadowRadius != 0f) &&
                Color.alpha(textAttributes.textShadowColor) != 0
        ) {
          ops.add(
              SetSpanOperation(
                  start,
                  end,
                  ShadowStyleSpan(
                      textAttributes.textShadowOffsetDx,
                      textAttributes.textShadowOffsetDy,
                      textAttributes.textShadowRadius,
                      textAttributes.textShadowColor,
                  ),
              )
          )
        }
        if (!textAttributes.lineHeight.isNaN()) {
          ops.add(SetSpanOperation(start, end, CustomLineHeightSpan(textAttributes.lineHeight)))
        }

        if (ReactNativeFeatureFlags.enablePreparedTextLayout()) {
          ops.add(SetSpanOperation(start, end, ReactFragmentIndexSpan(i)))
          if (outputReactTags != null) {
            outputReactTags[i] = reactTag
          }
        } else {
          ops.add(SetSpanOperation(start, end, ReactTagSpan(reactTag)))
        }
      }

      // Coalesce consecutive fragments with the same text effects into single spans.
      val effects = textAttributes.textEffects
      if (effects != pendingEffects) {
        // Flush the previous pending effects
        if (pendingEffects.isNotEmpty() && textEffectRegistry != null) {
          for (effect in pendingEffects) {
            val effectProps = jsonStringToReadableMap(effect.props)
            val span = textEffectRegistry.createSpan(effect.name, effectProps)
            if (span != null) {
              ops.add(SetSpanOperation(pendingEffectStart, start, span))
            }
          }
        }
        pendingEffects = effects
        pendingEffectStart = start
      }
    }

    // Flush any remaining pending effects after the last fragment
    if (pendingEffects.isNotEmpty() && textEffectRegistry != null) {
      for (effect in pendingEffects) {
        val effectProps = jsonStringToReadableMap(effect.props)
        val span = textEffectRegistry.createSpan(effect.name, effectProps)
        if (span != null) {
          ops.add(SetSpanOperation(pendingEffectStart, sb.length, span))
        }
      }
    }
  }

  private class FragmentAttributes(
      val props: TextAttributeProps,
      val length: Int,
      val reactTag: Int,
      val isAttachment: Boolean,
      val width: Double,
      val height: Double,
      // The box's own baseline, from its top, in the same units as `height`.
      val atomicInlineBaseline: Double,
      // CSS `vertical-align`: 0 baseline, 1 top, 2 bottom, 3 middle.
      val atomicInlineVerticalAlign: Int,
      // box-model-scope.md G3, in px.
      val leadingInlineSpace: InlineReserve,
      val trailingInlineSpace: InlineReserve,
      // G4/G5: the element's painted box, carried so this path emits the
      // decoration span too — a rule applied on one construction path only is
      // invisible on screen when the other is enabled.
      val inlineBox: MapBuffer?,
      val isInlineBoxStart: Boolean,
      val isInlineBoxEnd: Boolean,
  )

  @OptIn(UnstableReactNativeAPI::class)
  private fun buildSpannableFromFragmentsOptimized(
      assets: AssetManager,
      fontWeightAdjustment: Int,
      fragments: MapBuffer,
      outputReactTags: IntArray?,
      textEffectRegistry: TextEffectRegistry?,
  ): Spannable {
    val text = StringBuilder()
    val parsedFragments = ArrayList<FragmentAttributes>(fragments.count)

    for (i in 0 until fragments.count) {
      val fragment = fragments.getMapBuffer(i)
      val props = TextAttributeProps.fromMapBuffer(fragment.getMapBuffer(FR_KEY_TEXT_ATTRIBUTES))
      val fragmentText = TextTransform.apply(fragment.getString(FR_KEY_STRING), props.textTransform)
      text.append(fragmentText)
      parsedFragments.add(
          FragmentAttributes(
              props = props,
              length = fragmentText.length,
              reactTag =
                  if (fragment.contains(FR_KEY_REACT_TAG)) {
                    fragment.getInt(FR_KEY_REACT_TAG)
                  } else {
                    View.NO_ID
                  },
              isAttachment =
                  fragment.contains(FR_KEY_IS_ATTACHMENT) &&
                      fragment.getBoolean(FR_KEY_IS_ATTACHMENT),
              width =
                  if (fragment.contains(FR_KEY_WIDTH)) {
                    fragment.getDouble(FR_KEY_WIDTH)
                  } else {
                    Double.NaN
                  },
              height =
                  if (fragment.contains(FR_KEY_HEIGHT)) {
                    fragment.getDouble(FR_KEY_HEIGHT)
                  } else {
                    Double.NaN
                  },
              atomicInlineVerticalAlign =
                  if (fragment.contains(FR_KEY_ATOMIC_INLINE_VERTICAL_ALIGN)) {
                    fragment.getInt(FR_KEY_ATOMIC_INLINE_VERTICAL_ALIGN)
                  } else {
                    0
                  },
              atomicInlineBaseline =
                  if (fragment.contains(FR_KEY_ATOMIC_INLINE_BASELINE)) {
                    fragment.getDouble(FR_KEY_ATOMIC_INLINE_BASELINE)
                  } else if (fragment.contains(FR_KEY_HEIGHT)) {
                    // No baseline of its own: the bottom edge is the baseline.
                    fragment.getDouble(FR_KEY_HEIGHT)
                  } else {
                    Double.NaN
                  },
              leadingInlineSpace = leadingInlineSpace(fragment),
              trailingInlineSpace = trailingInlineSpace(fragment),
              inlineBox = inlineBoxOf(fragment),
              isInlineBoxStart = isInlineBoxStart(fragment),
              isInlineBoxEnd = isInlineBoxEnd(fragment),
          )
      )
    }

    val spannable = SpannableString(text)

    // Track pending text effects to coalesce consecutive fragments with the same effects into
    // single spans, avoiding duplicate draws (e.g. multiple accent marks in HighlighterTextSpan).
    var pendingEffects: List<TextAttributeProps.TextEffectEntry> = emptyList()
    var pendingEffectStart = 0
    var previousWasAttachment = false
    // The inline element whose box is still open, or null.
    var openInlineBox: PendingInlineBox? = null

    var start = 0
    for ((i, fragment) in parsedFragments.withIndex()) {
      val end = start + fragment.length
      val spanFlags =
          if (start == 0) Spannable.SPAN_INCLUSIVE_INCLUSIVE else Spannable.SPAN_EXCLUSIVE_INCLUSIVE

      // G3: inline-axis space as advance, expressed without adding characters.
      inlineBoxSpacingSpans(
          fragment.leadingInlineSpace,
          fragment.trailingInlineSpace,
          start,
          end,
          fragment.isAttachment,
          previousWasAttachment,
      ) { spanStart, spanEnd, span ->
        spannable.setSpan(
            span,
            spanStart,
            spanEnd,
            // The same rule `SetSpanOperation` applies on the other path: a span at the very
            // start of the text extends left too, everything else only right.
            if (spanStart == 0) Spannable.SPAN_INCLUSIVE_INCLUSIVE
            else Spannable.SPAN_EXCLUSIVE_INCLUSIVE,
        )
      }
      openInlineBox =
          applyInlineBoxDecoration(
              fragment.inlineBox,
              fragment.isInlineBoxStart,
              fragment.isInlineBoxEnd,
              start,
              end,
              openInlineBox,
              previousWasAttachment,
          ) { spanStart, spanEnd, span ->
            spannable.setSpan(
                span,
                spanStart,
                spanEnd,
                if (spanStart == 0) Spannable.SPAN_INCLUSIVE_INCLUSIVE
                else Spannable.SPAN_EXCLUSIVE_INCLUSIVE,
            )
          }
      previousWasAttachment = fragment.isAttachment

      if (fragment.isAttachment) {
        spannable.setSpan(
            TextInlineViewPlaceholderSpan(
                fragment.reactTag,
                PixelUtil.toPixelFromSP(fragment.width).toInt(),
                PixelUtil.toPixelFromSP(fragment.height).toInt(),
                PixelUtil.toPixelFromSP(fragment.atomicInlineBaseline).toInt(),
                fragment.atomicInlineVerticalAlign,
                fragment.leadingInlineSpace.total.toInt(),
                fragment.trailingInlineSpace.total.toInt(),
            ),
            start,
            end,
            spanFlags,
        )
        // The strut, expand-only — see the other construction site. This is the
        // path `enablePreparedTextLayout` takes, and it builds the Spannable the
        // final Layout is made from, so anything applied only to the other one
        // is invisible on screen.
        if (!fragment.props.lineHeight.isNaN()) {
          spannable.setSpan(
              CustomLineHeightSpan(fragment.props.lineHeight, expandOnly = true),
              start,
              end,
              spanFlags,
          )
        }
      } else {
        val roleIsLink =
            if (fragment.props.role != null)
                (fragment.props.role == ReactAccessibilityDelegate.Role.LINK)
            else
                (fragment.props.accessibilityRole ==
                    ReactAccessibilityDelegate.AccessibilityRole.LINK)

        if (roleIsLink) {
          if (ReactNativeFeatureFlags.enablePreparedTextLayout()) {
            spannable.setSpan(ReactLinkSpan(i), start, end, spanFlags)
          } else {
            spannable.setSpan(ReactClickableSpan(fragment.reactTag), start, end, spanFlags)
          }
        }

        if (fragment.props.isColorSet) {
          spannable.setSpan(
              fragment.props.color?.let { ReactForegroundColorSpan(it) },
              start,
              end,
              spanFlags,
          )
        }

        if (fragment.props.isBackgroundColorSet) {
          spannable.setSpan(
              fragment.props.backgroundColor?.let { ReactBackgroundColorSpan(it) },
              start,
              end,
              spanFlags,
          )
        }

        if (!fragment.props.opacity.isNaN()) {
          spannable.setSpan(ReactOpacitySpan(fragment.props.opacity), start, end, spanFlags)
        }

        if (!fragment.props.letterSpacing.isNaN()) {
          spannable.setSpan(
              CustomLetterSpacingSpan(fragment.props.letterSpacing),
              start,
              end,
              spanFlags,
          )
        }

        spannable.setSpan(ReactAbsoluteSizeSpan(fragment.props.fontSize), start, end, spanFlags)

        if (
            fragment.props.fontStyle != ReactConstants.UNSET ||
                fragment.props.fontWeight != ReactConstants.UNSET ||
                fragment.props.fontFamily != null
        ) {
          spannable.setSpan(
              CustomStyleSpan(
                  fragment.props.fontStyle,
                  fragment.props.fontWeight,
                  fragment.props.fontFeatureSettings,
                  fragment.props.fontFamily,
                  assets,
                  fontWeightAdjustment,
              ),
              start,
              end,
              spanFlags,
          )
        }

        if (fragment.props.isUnderlineTextDecorationSet) {
          spannable.setSpan(
              ReactUnderlineSpan(
                  fragment.props.textDecorationColor,
                  fragment.props.textDecorationStyle,
              ),
              start,
              end,
              spanFlags,
          )
        }

        if (fragment.props.isLineThroughTextDecorationSet) {
          spannable.setSpan(
              ReactStrikethroughSpan(
                  fragment.props.textDecorationColor,
                  fragment.props.textDecorationStyle,
              ),
              start,
              end,
              spanFlags,
          )
        }

        if (
            (fragment.props.textShadowOffsetDx != 0f ||
                fragment.props.textShadowOffsetDy != 0f ||
                fragment.props.textShadowRadius != 0f) &&
                Color.alpha(fragment.props.textShadowColor) != 0
        ) {
          spannable.setSpan(
              ShadowStyleSpan(
                  fragment.props.textShadowOffsetDx,
                  fragment.props.textShadowOffsetDy,
                  fragment.props.textShadowRadius,
                  fragment.props.textShadowColor,
              ),
              start,
              end,
              spanFlags,
          )
        }

        if (!fragment.props.lineHeight.isNaN()) {
          spannable.setSpan(CustomLineHeightSpan(fragment.props.lineHeight), start, end, spanFlags)
        }

        if (ReactNativeFeatureFlags.enablePreparedTextLayout()) {
          spannable.setSpan(ReactFragmentIndexSpan(i), start, end, spanFlags)
          if (outputReactTags != null) {
            outputReactTags[i] = fragment.reactTag
          }
        } else {
          spannable.setSpan(ReactTagSpan(fragment.reactTag), start, end, spanFlags)
        }
      }

      // Coalesce consecutive fragments with the same text effects into single spans.
      val effects = fragment.props.textEffects
      if (effects != pendingEffects) {
        if (pendingEffects.isNotEmpty() && textEffectRegistry != null) {
          for (effect in pendingEffects) {
            val effectProps = jsonStringToReadableMap(effect.props)
            val span = textEffectRegistry.createSpan(effect.name, effectProps)
            if (span != null) {
              spannable.setSpan(span, pendingEffectStart, start, Spannable.SPAN_EXCLUSIVE_INCLUSIVE)
            }
          }
        }
        pendingEffects = effects
        pendingEffectStart = start
      }

      start = end
    }

    // Flush any remaining pending effects after the last fragment
    if (pendingEffects.isNotEmpty() && textEffectRegistry != null) {
      for (effect in pendingEffects) {
        val effectProps = jsonStringToReadableMap(effect.props)
        val span = textEffectRegistry.createSpan(effect.name, effectProps)
        if (span != null) {
          spannable.setSpan(span, pendingEffectStart, start, Spannable.SPAN_EXCLUSIVE_INCLUSIVE)
        }
      }
    }

    return spannable
  }

  @OptIn(UnstableReactNativeAPI::class)
  fun getOrCreateSpannableForText(
      assets: AssetManager,
      attributedString: MapBuffer,
      reactTextViewManagerCallback: ReactTextViewManagerCallback?,
  ): Spannable =
      getOrCreateSpannableForText(assets, attributedString, reactTextViewManagerCallback, null)

  @OptIn(UnstableReactNativeAPI::class)
  fun getOrCreateSpannableForText(
      assets: AssetManager,
      fontWeightAdjustment: Int,
      attributedString: MapBuffer,
      reactTextViewManagerCallback: ReactTextViewManagerCallback?,
  ): Spannable = getOrCreateSpannableForText(
      assets,
      fontWeightAdjustment,
      attributedString,
      reactTextViewManagerCallback,
      null,
  )

  @OptIn(UnstableReactNativeAPI::class)
  internal fun getOrCreateSpannableForText(
      assets: AssetManager,
      attributedString: MapBuffer,
      reactTextViewManagerCallback: ReactTextViewManagerCallback?,
      textEffectRegistry: TextEffectRegistry?,
  ): Spannable = getOrCreateSpannableForText(
      assets,
      0,
      attributedString,
      reactTextViewManagerCallback,
      textEffectRegistry,
  )

  @OptIn(UnstableReactNativeAPI::class)
  internal fun getOrCreateSpannableForText(
      assets: AssetManager,
      fontWeightAdjustment: Int,
      attributedString: MapBuffer,
      reactTextViewManagerCallback: ReactTextViewManagerCallback?,
      textEffectRegistry: TextEffectRegistry?,
  ): Spannable {
    var text: Spannable?
    if (attributedString.contains(AS_KEY_CACHE_ID)) {
      val cacheId = attributedString.getInt(AS_KEY_CACHE_ID)
      text = checkNotNull(tagToSpannableCache[cacheId])
    } else {
      text =
          createSpannableFromAttributedString(
              assets,
              fontWeightAdjustment,
              attributedString.getMapBuffer(AS_KEY_FRAGMENTS),
              reactTextViewManagerCallback,
              null,
              textEffectRegistry,
          )
    }

    return text
  }

  @OptIn(UnstableReactNativeAPI::class)
  private fun createSpannableFromAttributedString(
      assets: AssetManager,
      fontWeightAdjustment: Int,
      fragments: MapBuffer,
      reactTextViewManagerCallback: ReactTextViewManagerCallback?,
      outputReactTags: IntArray?,
      textEffectRegistry: TextEffectRegistry? = null,
  ): Spannable {
    if (ReactNativeFeatureFlags.enableAndroidTextMeasurementOptimizations()) {
      val spannable = buildSpannableFromFragmentsOptimized(
          assets,
          fontWeightAdjustment,
          fragments,
          outputReactTags,
          textEffectRegistry,
      )

      reactTextViewManagerCallback?.onPostProcessSpannable(spannable)
      return spannable
    } else {
      val sb = SpannableStringBuilder()

      // The [SpannableStringBuilder] implementation require setSpan operation to be called
      // up-to-bottom, otherwise all the spannables that are within the region for which one may set
      // a new spannable will be wiped out
      val ops: MutableList<SetSpanOperation> = ArrayList()

      buildSpannableFromFragments(
          assets,
          fontWeightAdjustment,
          fragments,
          sb,
          ops,
          outputReactTags,
          textEffectRegistry,
      )

      // TODO T31905686: add support for inline Images
      // While setting the Spans on the final text, we also check whether any of them are images.
      for (priorityIndex in ops.indices) {
        val op = ops[ops.size - priorityIndex - 1]

        // Actual order of calling {@code execute} does NOT matter,
        // but the {@code priorityIndex} DOES matter.
        op.execute(sb, priorityIndex)
      }

      reactTextViewManagerCallback?.onPostProcessSpannable(sb)
      return sb
    }
  }

  private fun createLayout(
      text: Spannable,
      boring: BoringLayout.Metrics?,
      width: Float,
      widthYogaMeasureMode: YogaMeasureMode,
      includeFontPadding: Boolean,
      textBreakStrategy: Int,
      hyphenationFrequency: Int,
      alignment: Layout.Alignment,
      justificationMode: Int,
      ellipsizeMode: TextUtils.TruncateAt?,
      maxNumberOfLines: Int,
      paint: TextPaint,
  ): Layout {
    // If our text is boring, and fully fits in the available space, we can represent the text
    // layout as a BoringLayout
    if (
        boring != null &&
            (widthYogaMeasureMode == YogaMeasureMode.UNDEFINED || boring.width <= floor(width))
    ) {
      // Guard uses floor() but layout width below uses ceil() for EXACTLY mode intentionally:
      // text that barely fails the floor-based guard falls through to StaticLayout, which also
      // ceils for EXACTLY — no wrapping results, just a slightly less optimal layout class in a
      // rare subpixel edge case.
      val layoutWidth =
          if (widthYogaMeasureMode == YogaMeasureMode.EXACTLY) ceil(width).toInt() else boring.width
      return BoringLayout.make(
          text,
          paint,
          layoutWidth,
          alignment,
          1f,
          0f,
          boring,
          includeFontPadding,
      )
    }

    val desiredWidth = ceil(Layout.getDesiredWidth(text, paint)).toInt()

    val layoutWidth =
        when (widthYogaMeasureMode) {
          YogaMeasureMode.EXACTLY -> ceil(width).toInt()
          YogaMeasureMode.AT_MOST -> min(desiredWidth, floor(width).toInt())
          else -> desiredWidth
        }
    return buildLayout(
        text,
        layoutWidth,
        includeFontPadding,
        textBreakStrategy,
        hyphenationFrequency,
        alignment,
        justificationMode,
        ellipsizeMode,
        maxNumberOfLines,
        paint,
    )
  }

  private fun buildLayout(
      text: Spannable,
      layoutWidth: Int,
      includeFontPadding: Boolean,
      textBreakStrategy: Int,
      hyphenationFrequency: Int,
      alignment: Layout.Alignment,
      justificationMode: Int,
      ellipsizeMode: TextUtils.TruncateAt?,
      maxNumberOfLines: Int,
      paint: TextPaint,
  ): Layout {
    val builder =
        StaticLayout.Builder.obtain(text, 0, text.length, paint, layoutWidth)
            .setAlignment(alignment)
            .setLineSpacing(0f, 1f)
            .setIncludePad(includeFontPadding)
            .setBreakStrategy(textBreakStrategy)
            .setHyphenationFrequency(hyphenationFrequency)

    if (maxNumberOfLines != ReactConstants.UNSET && maxNumberOfLines != 0) {
      builder.setEllipsize(ellipsizeMode).setMaxLines(maxNumberOfLines)
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      builder.setJustificationMode(justificationMode)
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      builder.setUseLineSpacingFromFallbacks(true)
    }

    return builder.build()
  }

  /**
   * Sets attributes on the TextPaint, used for content outside the Spannable text, like for empty
   * strings, or newlines after the last trailing character
   */
  @VisibleForTesting
  internal fun updateTextPaint(
      paint: TextPaint,
      baseTextAttributes: TextAttributeProps,
      assets: AssetManager,
      fontWeightAdjustment: Int,
  ) {
    if (baseTextAttributes.fontSize != ReactConstants.UNSET) {
      paint.textSize = baseTextAttributes.fontSize.toFloat()
    }

    if (
        baseTextAttributes.fontStyle != ReactConstants.UNSET ||
            baseTextAttributes.fontWeight != ReactConstants.UNSET ||
            baseTextAttributes.fontFamily != null
    ) {
      val typeface =
          ReactTypefaceUtils.applyStyles(
              null,
              baseTextAttributes.fontStyle,
              baseTextAttributes.fontWeight,
              baseTextAttributes.fontFamily,
              assets,
          )
      paint.setTypeface(
          ReactTypefaceUtils.applyFontWeightAdjustment(typeface, fontWeightAdjustment)
      )

      if (
          baseTextAttributes.fontStyle != ReactConstants.UNSET &&
              baseTextAttributes.fontStyle != typeface.style
      ) {
        // https://cs.android.com/android/platform/superproject/main/+/main:frameworks/base/core/java/android/widget/TextView.java;l=2536;drc=d262a68a1e0c3b640274b094a7f1e3a5b75563e9
        val missingStyle = baseTextAttributes.fontStyle and typeface.style.inv()
        paint.isFakeBoldText = missingStyle and Typeface.BOLD != 0
        paint.textSkewX = if ((missingStyle and Typeface.ITALIC) != 0) -0.25f else 0f
      }
    } else {
      val typeface = ReactTypefaceUtils.applyFontWeightAdjustment(null, fontWeightAdjustment)
      if (typeface != null) {
        paint.setTypeface(typeface)
      }
    }
  }

  /**
   * WARNING: This paint should not be used for any layouts which may escape TextLayoutManager, as
   * they may need to be drawn later, and may not safely be reused
   */
  private fun scratchPaintWithAttributes(
      baseTextAttributes: TextAttributeProps,
      assets: AssetManager,
      fontWeightAdjustment: Int,
  ): TextPaint {
    val paint = checkNotNull(textPaintInstance.get())
    paint.setTypeface(null)
    paint.textSize = 12f
    paint.isFakeBoldText = false
    paint.textSkewX = 0f
    updateTextPaint(paint, baseTextAttributes, assets, fontWeightAdjustment)
    return paint
  }

  private fun newPaintWithAttributes(
      baseTextAttributes: TextAttributeProps,
      assets: AssetManager,
      fontWeightAdjustment: Int,
  ): TextPaint {
    val paint = TextPaint(TextPaint.ANTI_ALIAS_FLAG)
    updateTextPaint(paint, baseTextAttributes, assets, fontWeightAdjustment)
    return paint
  }

  @OptIn(UnstableReactNativeAPI::class)
  private fun createLayoutForMeasurement(
      assets: AssetManager,
      fontWeightAdjustment: Int,
      attributedString: MapBuffer,
      paragraphAttributes: MapBuffer,
      width: Float,
      widthYogaMeasureMode: YogaMeasureMode,
      height: Float,
      heightYogaMeasureMode: YogaMeasureMode,
      reactTextViewManagerCallback: ReactTextViewManagerCallback?,
      textEffectRegistry: TextEffectRegistry? = null,
  ): Layout {
    val text = getOrCreateSpannableForText(
        assets,
        fontWeightAdjustment,
        attributedString,
        reactTextViewManagerCallback,
        textEffectRegistry,
    )

    val paint: TextPaint
    if (attributedString.contains(AS_KEY_CACHE_ID)) {
      paint = text.getSpans(0, 0, ReactTextPaintHolderSpan::class.java)[0].textPaint
    } else {
      val baseTextAttributes =
          TextAttributeProps.fromMapBuffer(attributedString.getMapBuffer(AS_KEY_BASE_ATTRIBUTES))
      val scratch = scratchPaintWithAttributes(baseTextAttributes, assets, fontWeightAdjustment)
      // A run-tagged layout outlives the measurement (the run handoff parks
      // it for mounting), and Layout retains its paint — it cannot share the
      // thread-local scratch paint the next measurement will mutate.
      paint =
          if (attributedString.contains(AS_KEY_RUN_TAG)) TextPaint().apply { set(scratch) }
          else scratch
    }

    return createLayout(
        text,
        paint,
        attributedString,
        paragraphAttributes,
        width,
        widthYogaMeasureMode,
        height,
        heightYogaMeasureMode,
    )
        .layout
  }

  private fun createLayout(
      text: Spannable,
      paint: TextPaint,
      attributedString: MapBuffer,
      paragraphAttributes: MapBuffer,
      width: Float,
      widthYogaMeasureMode: YogaMeasureMode,
      height: Float,
      heightYogaMeasureMode: YogaMeasureMode,
  ): CreateLayoutResult {
    val boring = isBoring(text, paint)

    val textBreakStrategy =
        TextAttributeProps.getTextBreakStrategy(
            paragraphAttributes.getString(PA_KEY_TEXT_BREAK_STRATEGY)
        )
    val includeFontPadding =
        if (paragraphAttributes.contains(PA_KEY_INCLUDE_FONT_PADDING))
            paragraphAttributes.getBoolean(PA_KEY_INCLUDE_FONT_PADDING)
        else DEFAULT_INCLUDE_FONT_PADDING
    val hyphenationFrequency =
        TextAttributeProps.getHyphenationFrequency(
            paragraphAttributes.getString(PA_KEY_HYPHENATION_FREQUENCY)
        )
    val adjustFontSizeToFit =
        if (paragraphAttributes.contains(PA_KEY_ADJUST_FONT_SIZE_TO_FIT))
            paragraphAttributes.getBoolean(PA_KEY_ADJUST_FONT_SIZE_TO_FIT)
        else DEFAULT_ADJUST_FONT_SIZE_TO_FIT
    val maximumNumberOfLines =
        if (paragraphAttributes.contains(PA_KEY_MAX_NUMBER_OF_LINES))
            paragraphAttributes.getInt(PA_KEY_MAX_NUMBER_OF_LINES)
        else ReactConstants.UNSET
    val ellipsizeMode =
        if (paragraphAttributes.contains(PA_KEY_ELLIPSIZE_MODE))
            TextAttributeProps.getEllipsizeMode(
                paragraphAttributes.getString(PA_KEY_ELLIPSIZE_MODE)
            )
        else null

    // T226571629: textAlign should be moved to ParagraphAttributes
    val alignmentAttr = getTextAlignmentAttr(attributedString)
    val alignment = getTextAlignment(attributedString, text, alignmentAttr)
    val justificationMode = getTextJustificationMode(alignmentAttr)

    if (adjustFontSizeToFit) {
      val minimumFontSize =
          if (paragraphAttributes.contains(PA_KEY_MINIMUM_FONT_SIZE))
              paragraphAttributes.getDouble(PA_KEY_MINIMUM_FONT_SIZE).toFloat()
          else Float.NaN

      adjustSpannableFontToFit(
          text,
          width,
          YogaMeasureMode.EXACTLY,
          height,
          heightYogaMeasureMode,
          minimumFontSize,
          maximumNumberOfLines,
          includeFontPadding,
          textBreakStrategy,
          hyphenationFrequency,
          alignment,
          justificationMode,
          paint,
      )
    }

    // A `white-space` that forbids wrapping lays out as though there were no available width at
    // all, so the only line breaks are the ones in the text. The container still clips it — the
    // text overflows rather than reflowing, which is what the web does. Only elements carry the
    // attribute; a `<Text>` never does (see ____TextStyle_InternalBase.whiteSpace).
    val layoutWidthMode =
        if (forbidsWrapping(attributedString)) YogaMeasureMode.UNDEFINED else widthYogaMeasureMode

    return CreateLayoutResult(
        createLayout(
            text,
            boring,
            width,
            layoutWidthMode,
            includeFontPadding,
            textBreakStrategy,
            hyphenationFrequency,
            alignment,
            justificationMode,
            ellipsizeMode,
            maximumNumberOfLines,
            paint,
        ),
        textBreakStrategy,
        justificationMode,
    )
  }

  @JvmStatic
  @OptIn(UnstableReactNativeAPI::class)
  fun createPreparedLayout(
      assets: AssetManager,
      attributedString: ReadableMapBuffer,
      paragraphAttributes: ReadableMapBuffer,
      width: Float,
      widthYogaMeasureMode: YogaMeasureMode,
      height: Float,
      heightYogaMeasureMode: YogaMeasureMode,
      reactTextViewManagerCallback: ReactTextViewManagerCallback?,
      textEffectRegistry: TextEffectRegistry? = null,
  ): PreparedLayout = createPreparedLayout(
      assets,
      0,
      attributedString,
      paragraphAttributes,
      width,
      widthYogaMeasureMode,
      height,
      heightYogaMeasureMode,
      reactTextViewManagerCallback,
      textEffectRegistry,
  )

  @JvmStatic
  @OptIn(UnstableReactNativeAPI::class)
  fun createPreparedLayout(
      assets: AssetManager,
      fontWeightAdjustment: Int,
      attributedString: ReadableMapBuffer,
      paragraphAttributes: ReadableMapBuffer,
      width: Float,
      widthYogaMeasureMode: YogaMeasureMode,
      height: Float,
      heightYogaMeasureMode: YogaMeasureMode,
      reactTextViewManagerCallback: ReactTextViewManagerCallback?,
      textEffectRegistry: TextEffectRegistry? = null,
  ): PreparedLayout {
    val fragments = attributedString.getMapBuffer(AS_KEY_FRAGMENTS)
    val reactTags = IntArray(fragments.count)
    val text = createSpannableFromAttributedString(
        assets,
        fontWeightAdjustment,
        fragments,
        reactTextViewManagerCallback,
        reactTags,
        textEffectRegistry,
    )
    val baseTextAttributes =
        TextAttributeProps.fromMapBuffer(attributedString.getMapBuffer(AS_KEY_BASE_ATTRIBUTES))
    val result = createLayout(
        text,
        newPaintWithAttributes(baseTextAttributes, assets, fontWeightAdjustment),
        attributedString,
        paragraphAttributes,
        width,
        widthYogaMeasureMode,
        height,
        heightYogaMeasureMode,
    )

    val maximumNumberOfLines =
        if (paragraphAttributes.contains(PA_KEY_MAX_NUMBER_OF_LINES))
            paragraphAttributes.getInt(PA_KEY_MAX_NUMBER_OF_LINES)
        else ReactConstants.UNSET

    var verticalOffset = getVerticalOffset(
        result.layout,
        paragraphAttributes,
        height,
        heightYogaMeasureMode,
        maximumNumberOfLines,
    )
    // The run box RESERVES baseline-shift ink at its top
    // (InlineContentShadowNode::measureContent adds
    // AttributedString::baselineShiftInkOverflow to the measured height), so
    // the first baseline sits a reserve lower and a superscript's ink lands
    // inside the box instead of painting over the sibling above. This is the
    // Android half of that agreement — the same rule as the C++ side: half
    // the shifted fragment's font size.
    verticalOffset += baselineShiftInkTop(fragments)

    return PreparedLayout(
        result.layout,
        maximumNumberOfLines,
        verticalOffset,
        reactTags,
        result.textBreakStrategy,
        result.justificationMode,
    )
  }

  @JvmStatic
  fun adjustSpannableFontToFit(
      text: Spannable,
      width: Float,
      widthYogaMeasureMode: YogaMeasureMode,
      height: Float,
      heightYogaMeasureMode: YogaMeasureMode,
      minimumFontSizeAttr: Float,
      maximumNumberOfLines: Int,
      includeFontPadding: Boolean,
      textBreakStrategy: Int,
      hyphenationFrequency: Int,
      alignment: Layout.Alignment,
      justificationMode: Int,
      paint: TextPaint,
  ): Unit {
    var boring = isBoring(text, paint)
    var layout: Layout

    // Minimum font size is 4pts to match the iOS implementation.
    val minimumFontSize =
        (if (minimumFontSizeAttr.isNaN()) 4.dpToPx() else minimumFontSizeAttr).toInt()

    // Find the largest font size used in the spannable to use as a starting point.
    var currentFontSize = minimumFontSize
    val spans = text.getSpans(0, text.length, ReactAbsoluteSizeSpan::class.java)
    for (span in spans) {
      currentFontSize = max(currentFontSize, span.size).toInt()
    }

    var intervalStart = minimumFontSize
    var intervalEnd = currentFontSize
    var previousFontSize = currentFontSize

    // `true` instead of `intervalStart != intervalEnd` so that the last iteration where both are at
    // the same size goes through and updates all relevant objects with the final font size
    while (true) {
      // Always use the point closer to the end of the interval, this way at the end when
      // end - start == 1, we land at current = end instead of current = start. In the first case
      // one measurement may be enough if intervalEnd is small enough to fit. In the second case
      // we always end up doing two measurements to check whether intervalEnd would fit.
      val currentFontSize = (intervalStart + intervalEnd + 1) / 2

      val ratio = currentFontSize.toFloat() / previousFontSize.toFloat()
      paint.textSize = max((paint.textSize * ratio).toInt(), minimumFontSize).toFloat()

      val sizeSpans = text.getSpans(0, text.length, ReactAbsoluteSizeSpan::class.java)
      for (span in sizeSpans) {
        text.setSpan(
            ReactAbsoluteSizeSpan(max((span.size * ratio).toInt(), minimumFontSize)),
            text.getSpanStart(span),
            text.getSpanEnd(span),
            text.getSpanFlags(span),
        )
        text.removeSpan(span)
      }
      if (boring != null) {
        boring = isBoring(text, paint)
      }
      layout =
          createLayout(
              text,
              boring,
              width,
              widthYogaMeasureMode,
              includeFontPadding,
              textBreakStrategy,
              hyphenationFrequency,
              alignment,
              justificationMode,
              null,
              ReactConstants.UNSET,
              paint,
          )

      if (intervalStart == intervalEnd) {
        // everything is updated at this point
        break
      }

      val singleLineTextExceedsWidth = text.length == 1 && layout.getLineWidth(0) > width
      val exceedsHeight =
          heightYogaMeasureMode != YogaMeasureMode.UNDEFINED && layout.height > height
      val exceedsMaximumNumberOfLines =
          maximumNumberOfLines != ReactConstants.UNSET &&
              maximumNumberOfLines != 0 &&
              layout.lineCount > maximumNumberOfLines

      if (
          currentFontSize > minimumFontSize &&
              (exceedsMaximumNumberOfLines || exceedsHeight || singleLineTextExceedsWidth)
      ) {
        // Text doesn't fit the constraints. If intervalEnd - intervalStart == 1, it's known that
        // the correct font size is intervalStart. Set intervalEnd to match intervalStart and do one
        // more iteration to update layout correctly.
        intervalEnd = if (intervalEnd - intervalStart == 1) intervalStart else currentFontSize
      } else {
        // Text fits the constraints
        intervalStart = currentFontSize
      }

      previousFontSize = currentFontSize
    }
  }

  /**
   * The top share of the baseline-shift ink reserve — the Kotlin mirror of
   * `AttributedString::baselineShiftInkOverflow().top`, computed from the
   * same per-fragment facts (a `super` fragment reserves half its already
   * pixel-converted font size) so the measured box (C++) and the drawn
   * layout (here) cannot disagree.
   */
  private fun baselineShiftInkTop(fragments: MapBuffer): Float {
    var top = 0f
    for (i in 0 until fragments.count) {
      val fragment = fragments.getMapBuffer(i)
      val props =
          TextAttributeProps.fromMapBuffer(fragment.getMapBuffer(FR_KEY_TEXT_ATTRIBUTES))
      if (props.verticalAlign == "super" && props.fontSize > 0) {
        top = maxOf(top, props.fontSize / 2f)
      }
    }
    return top
  }

  @JvmStatic
  @OptIn(UnstableReactNativeAPI::class)
  fun measureText(
      assets: AssetManager,
      attributedString: MapBuffer,
      paragraphAttributes: MapBuffer,
      width: Float,
      widthYogaMeasureMode: YogaMeasureMode,
      height: Float,
      heightYogaMeasureMode: YogaMeasureMode,
      reactTextViewManagerCallback: ReactTextViewManagerCallback?,
      attachmentsPositions: FloatArray?,
      textEffectRegistry: TextEffectRegistry? = null,
  ): Long = measureText(
      assets,
      0,
      attributedString,
      paragraphAttributes,
      width,
      widthYogaMeasureMode,
      height,
      heightYogaMeasureMode,
      reactTextViewManagerCallback,
      attachmentsPositions,
      textEffectRegistry,
  )

  /**
   * Returns the laid-out rect of each fragment of [attributedString], as a flat
   * array of `[x, y, width, height]` per fragment in fragment order.
   *
   * This is what lets an inline element (`<b>`, `<span>`, a nested `<Text>`)
   * report a real box from `getBoundingClientRect()`: the containing
   * Paragraph/View unions the rects of the fragments belonging to an element
   * and stamps the result onto it (text-children-plan.md 3.G).
   *
   * A fragment spanning several lines reports the union of its line pieces —
   * the same box the web reports for a wrapped inline element.
   *
   * Called only when a string actually has multiple fragments (i.e. contains
   * inline elements), so plain text pays nothing for it.
   */
  @JvmStatic
  @OptIn(UnstableReactNativeAPI::class)
  fun measureFragmentRects(
      assets: AssetManager,
      attributedString: MapBuffer,
      paragraphAttributes: MapBuffer,
      width: Float,
      widthYogaMeasureMode: YogaMeasureMode,
      height: Float,
      heightYogaMeasureMode: YogaMeasureMode,
  ): FloatArray {
    if (!attributedString.contains(AS_KEY_FRAGMENTS)) {
      return FloatArray(0)
    }
    val fragments = attributedString.getMapBuffer(AS_KEY_FRAGMENTS)
    if (fragments.count == 0) {
      return FloatArray(0)
    }

    val layout =
        createLayoutForMeasurement(
            assets,
            0,
            attributedString,
            paragraphAttributes,
            width,
            widthYogaMeasureMode,
            height,
            heightYogaMeasureMode,
            null,
        )

    val rects = FloatArray(fragments.count * 4)
    val text = layout.text
    var offset = 0
    var index = 0
    // The attachment-preceded reserve placement shifts where the start pen
    // sits — see the border-box correction below.
    var previousWasAttachment = false
    for (fragment in fragments) {
      val fragmentText = fragment.mapBufferValue.getString(FR_KEY_STRING)
      // An attachment is represented by a single placeholder character.
      val length = fragmentText.length
      val start = offset
      val end = (offset + length).coerceAtMost(text.length)
      offset += length
      val followsAttachment = previousWasAttachment
      previousWasAttachment =
          fragment.mapBufferValue.contains(FR_KEY_IS_ATTACHMENT) &&
              fragment.mapBufferValue.getBoolean(FR_KEY_IS_ATTACHMENT)

      if (length == 0) {
        // An inline element with no text of its own still has a box: zero wide,
        // on the line it sits on, as tall as that line (CSSOM-View §4). There
        // are no glyphs to measure, so it is built from the line the element's
        // position falls in and the caret position within it.
        val isEmptyElement =
            fragment.mapBufferValue.contains(FR_KEY_IS_EMPTY_ELEMENT) &&
                fragment.mapBufferValue.getBoolean(FR_KEY_IS_EMPTY_ELEMENT)
        if (isEmptyElement && text.isNotEmpty()) {
          val at = start.coerceAtMost(text.length)
          val line = layout.getLineForOffset(at.coerceAtMost(text.length - 1))
          // Pixels here, points on the C++ side, like every other rect below.
          rects[index] = layout.getPrimaryHorizontal(at).pxToDp()
          rects[index + 1] = layout.getLineTop(line).toFloat().pxToDp()
          rects[index + 2] = 0f
          rects[index + 3] =
              (layout.getLineBottom(line) - layout.getLineTop(line)).toFloat().pxToDp()
        }
        index += 4
        continue
      }
      if (start >= text.length) {
        index += 4
        continue
      }

      val firstLine = layout.getLineForOffset(start)
      val lastLine = layout.getLineForOffset(end - 1)

      // Horizontal extent: the fragment's own edges on its first and last
      // line, widened to the full line box for any line it spans entirely —
      // which is what makes a wrapped element's union match the web's.
      var left: Float
      var right: Float
      if (firstLine == lastLine) {
        val startX = layout.getPrimaryHorizontal(start)
        val endX = layout.getPrimaryHorizontal(end)
        left = minOf(startX, endX)
        right = maxOf(startX, endX)
      } else {
        left = layout.getLineLeft(firstLine)
        right = layout.getLineRight(firstLine)
        for (line in firstLine..lastLine) {
          left = minOf(left, layout.getLineLeft(line))
          right = maxOf(right, layout.getLineRight(line))
        }
      }

      // An element's box is its *border* box. Pen positions include every
      // consumed reserved advance (THE INLINE RESERVE MODEL, documented on
      // InlineBoxSpacingSpan): at the element's start offset the pen sits at
      // its CONTENT left edge — the leading reserve was consumed by the
      // preceding character, outermost part first — and at its end offset at
      // the MARGIN's outer right edge. So the border box runs from
      // `left - (border + padding)` to `right - margin`. The one exception is
      // an element that follows an attachment: its leading reserve rides its
      // own first character ahead of the glyph, so the start pen sits at the
      // margin's outer LEFT edge and the border box starts `margin` inside it.
      val leadingReserve = leadingInlineSpace(fragment.mapBufferValue)
      if (followsAttachment) {
        left += leadingReserve.margin
      } else {
        left -= leadingReserve.border + leadingReserve.padding
      }
      if (firstLine == lastLine) {
        right -= trailingInlineSpace(fragment.mapBufferValue).margin
      }

      // Block-axis padding and borders belong to the border box the element
      // reports, even though CSS2 §10.6.1 has them overflow the line box
      // instead of growing it — so they are never inside the line extents.
      val (blockTop, blockBottom) = blockAxisBoxEdges(fragment.mapBufferValue)
      val top = layout.getLineTop(firstLine).toFloat() - blockTop
      val bottom = layout.getLineBottom(lastLine).toFloat() + blockBottom

      // `Layout` works in pixels; the C++ side consumes these as points, like
      // the attachment positions right below.
      rects[index] = left.pxToDp()
      rects[index + 1] = top.pxToDp()
      rects[index + 2] = (right - left).pxToDp()
      rects[index + 3] = (bottom - top).pxToDp()
      index += 4
    }

    return rects
  }

  @JvmStatic
  @OptIn(UnstableReactNativeAPI::class)
  fun measureText(
      assets: AssetManager,
      fontWeightAdjustment: Int,
      attributedString: MapBuffer,
      paragraphAttributes: MapBuffer,
      width: Float,
      widthYogaMeasureMode: YogaMeasureMode,
      height: Float,
      heightYogaMeasureMode: YogaMeasureMode,
      reactTextViewManagerCallback: ReactTextViewManagerCallback?,
      attachmentsPositions: FloatArray?,
      textEffectRegistry: TextEffectRegistry? = null,
  ): Long {
    // TODO(5578671): Handle text direction (see View#getTextDirectionHeuristic)
    val layout = createLayoutForMeasurement(
        assets,
        fontWeightAdjustment,
        attributedString,
        paragraphAttributes,
        width,
        widthYogaMeasureMode,
        height,
        heightYogaMeasureMode,
        reactTextViewManagerCallback,
        textEffectRegistry,
    )

    if (attributedString.contains(AS_KEY_RUN_TAG)) {
      // Park this run's layout for the mounting layer: the alternative is
      // rebuilding the identical spannable + layout on the UI thread at
      // mount (run-layout-reuse-plan.md).
      RunLayoutHandoff.store(
          attributedString.getInt(AS_KEY_RUN_TAG),
          attributedString,
          layout,
          PixelUtil.getDisplayMetricDensity(),
      )
    }

    val maximumNumberOfLines =
        if (paragraphAttributes.contains(PA_KEY_MAX_NUMBER_OF_LINES))
            paragraphAttributes.getInt(PA_KEY_MAX_NUMBER_OF_LINES)
        else ReactConstants.UNSET

    val text = layout.text as Spanned

    val calculatedLineCount = calculateLineCount(layout, maximumNumberOfLines)
    val calculatedWidth =
        calculateWidth(layout, text, width, widthYogaMeasureMode, calculatedLineCount)
    val calculatedHeight =
        calculateHeight(layout, height, heightYogaMeasureMode, calculatedLineCount)

    if (attachmentsPositions != null) {
      var attachmentIndex = 0
      var lastAttachmentFoundInSpan: Int

      val metrics = AttachmentMetrics()
      var i = 0
      while (i < text.length) {
        lastAttachmentFoundInSpan =
            nextAttachmentMetrics(
                layout,
                text,
                calculatedWidth,
                calculatedLineCount,
                i,
                0f,
                metrics,
            )
        if (metrics.wasFound) {
          attachmentsPositions[attachmentIndex] = metrics.top.pxToDp()
          attachmentsPositions[attachmentIndex + 1] = metrics.left.pxToDp()
          attachmentIndex += 2
        }
        i = lastAttachmentFoundInSpan
      }
    }

    val widthInSP = calculatedWidth.pxToDp()
    val heightInSP = calculatedHeight.pxToDp()

    return YogaMeasureOutput.make(widthInSP, heightInSP)
  }

  @JvmStatic
  fun measurePreparedLayout(
      preparedLayout: PreparedLayout,
      width: Float,
      widthYogaMeasureMode: YogaMeasureMode,
      height: Float,
      heightYogaMeasureMode: YogaMeasureMode,
  ): FloatArray {
    val layout = preparedLayout.layout
    val text = layout.text as Spanned
    val maximumNumberOfLines = preparedLayout.maximumNumberOfLines

    val calculatedLineCount = calculateLineCount(layout, maximumNumberOfLines)
    val calculatedWidth =
        calculateWidth(layout, text, width, widthYogaMeasureMode, calculatedLineCount)
    val calculatedHeight =
        calculateHeight(layout, height, heightYogaMeasureMode, calculatedLineCount)

    val retList = ArrayList<Float>()
    retList.add(calculatedWidth.pxToDp())
    retList.add(calculatedHeight.pxToDp())

    val metrics = AttachmentMetrics()
    var lastAttachmentFoundInSpan: Int
    run {
      var i = 0
      while (i < text.length) {
        lastAttachmentFoundInSpan =
            nextAttachmentMetrics(
                layout,
                text,
                calculatedWidth,
                calculatedLineCount,
                i,
                preparedLayout.verticalOffset,
                metrics,
            )
        if (metrics.wasFound) {
          retList.add(metrics.top.pxToDp())
          retList.add(metrics.left.pxToDp())
          retList.add(metrics.width.pxToDp())
          retList.add(metrics.height.pxToDp())
        }
        i = lastAttachmentFoundInSpan
      }
    }

    val ret = FloatArray(retList.size)
    for (i in retList.indices) {
      ret[i] = retList[i]
    }
    return ret
  }

  private fun getVerticalOffset(
      layout: Layout,
      paragraphAttributes: ReadableMapBuffer,
      height: Float,
      heightMeasureMode: YogaMeasureMode,
      maximumNumberOfLines: Int,
  ): Float {
    val textAlignVertical =
        if (paragraphAttributes.contains(PA_KEY_TEXT_ALIGN_VERTICAL))
            paragraphAttributes.getString(PA_KEY_TEXT_ALIGN_VERTICAL)
        else null

    if (textAlignVertical == null) {
      return 0f
    }

    val textHeight = layout.height
    val calculatedLineCount = calculateLineCount(layout, maximumNumberOfLines)
    val boxHeight = calculateHeight(layout, height, heightMeasureMode, calculatedLineCount)

    if (textHeight > boxHeight) {
      return 0f
    }

    when (textAlignVertical) {
      "auto",
      "top" -> return 0f
      "center" -> return (boxHeight - textHeight) / 2f
      "bottom" -> return boxHeight - textHeight
      else -> {
        FLog.w(ReactConstants.TAG, "Invalid textAlignVertical: $textAlignVertical")
        return 0f
      }
    }
  }

  private fun calculateLineCount(layout: Layout, maximumNumberOfLines: Int): Int =
      if (maximumNumberOfLines == ReactConstants.UNSET || maximumNumberOfLines == 0)
          layout.lineCount
      else min(maximumNumberOfLines, layout.lineCount)

  private fun calculateWidth(
      layout: Layout,
      text: Spanned,
      width: Float,
      widthYogaMeasureMode: YogaMeasureMode,
      calculatedLineCount: Int,
  ): Float {
    // Our layout must be created at a physical pixel boundary, so may be sized smaller by a
    // subpixel compared to the assigned layout width.
    if (widthYogaMeasureMode == YogaMeasureMode.EXACTLY) {
      return width
    }

    return layout.width.toFloat()
  }

  private fun calculateHeight(
      layout: Layout,
      height: Float,
      heightYogaMeasureMode: YogaMeasureMode,
      calculatedLineCount: Int,
  ): Float {
    var calculatedHeight = height
    if (heightYogaMeasureMode != YogaMeasureMode.EXACTLY) {
      // StaticLayout only seems to change its height in response to maxLines when ellipsizing, so
      // we must truncate
      calculatedHeight = layout.getLineBottom(calculatedLineCount - 1).toFloat()
      if (heightYogaMeasureMode == YogaMeasureMode.AT_MOST && calculatedHeight > height) {
        calculatedHeight = height
      }
    }
    return calculatedHeight
  }

  private fun nextAttachmentMetrics(
      layout: Layout,
      text: Spanned,
      calculatedWidth: Float,
      calculatedLineCount: Int,
      i: Int,
      verticalOffset: Float,
      metrics: AttachmentMetrics,
  ): Int {
    // Calculate the positions of the attachments (views) that will be rendered inside the
    // Spanned Text. The following logic is only executed when a text contains views inside.
    // This follows a similar logic than used in pre-fabric (see ReactTextView.onLayout method).
    val lastAttachmentFoundInSpan =
        text.nextSpanTransition(i, text.length, TextInlineViewPlaceholderSpan::class.java)
    val placeholders =
        text.getSpans(i, lastAttachmentFoundInSpan, TextInlineViewPlaceholderSpan::class.java)

    if (placeholders.size == 0) {
      metrics.wasFound = false
      return lastAttachmentFoundInSpan
    }

    Assertions.assertCondition(placeholders.size == 1)
    val placeholder = placeholders[0]

    val start = text.getSpanStart(placeholder)
    val line = layout.getLineForOffset(start)
    val isLineTruncated = layout.getEllipsisCount(line) > 0
    val isAttachmentTruncated =
        line > calculatedLineCount ||
            (isLineTruncated && start >= layout.getLineStart(line) + layout.getEllipsisStart(line))
    if (isAttachmentTruncated) {
      metrics.top = Float.NaN
      metrics.left = Float.NaN
    } else {
      val placeholderWidth = placeholder.width.toFloat()
      val placeholderHeight = placeholder.height.toFloat()
      val leadingSpace = placeholder.leadingSpace.toFloat()

      // Calculate if the direction of the placeholder character is Right-To-Left.
      val isRtlChar = layout.isRtlCharAt(start)
      val isRtlParagraph = layout.getParagraphDirection(line) == Layout.DIR_RIGHT_TO_LEFT

      // The direction of the paragraph may not be exactly the direction the string is heading in at
      // the position of the placeholder. So, if the direction of the character is the same as the
      // paragraph use primary, secondary otherwise.
      val characterAndParagraphDirectionMatch = isRtlParagraph == isRtlChar
      var placeholderLeftPosition =
          if (characterAndParagraphDirectionMatch) layout.getPrimaryHorizontal(start)
          else layout.getSecondaryHorizontal(start)
      if (isRtlChar) {
        placeholderLeftPosition -= placeholderWidth
      }

      // Vertically align the inline view to the baseline of the line of text.
      // The box's OWN baseline goes on the line's (CSS2 §10.8.1). Subtracting
      // the full height instead put its bottom edge there, which is only right
      // for a box with no line boxes of its own — for one containing text it
      // floated the whole box up by its descent, so its text sat above the
      // text around it.
      // `vertical-align` (CSS2 §10.8.1). Resolved here because `top` and
      // `bottom` are relative to the line box, which only exists once the
      // Layout has been built.
      val placeholderTopPosition =
          when (placeholder.verticalAlign) {
            1 -> layout.getLineTop(line).toFloat()
            2 -> layout.getLineBottom(line).toFloat() - placeholderHeight
            3 -> {
              // Centred on the baseline raised by half the parent's x-height —
              // not on the middle of the line box. Measured from the font
              // rather than approximated, since that is what CSS names.
              val bounds = android.graphics.Rect()
              layout.paint.getTextBounds("x", 0, 1, bounds)
              val xHeight = bounds.height().toFloat()
              layout.getLineBaseline(line) - xHeight / 2f - placeholderHeight / 2f
            }
            else -> layout.getLineBaseline(line) - placeholder.baselineFromTop.toFloat()
          }

      // The attachment array returns the positions of each of the attachments as
      metrics.top = placeholderTopPosition
      // The advance includes the enclosing inline box's leading space; the BOX
      // starts after it.
      metrics.left = placeholderLeftPosition + leadingSpace
    }

    // The text may be vertically aligned to the top, center, or bottom of the container. This is
    // not captured in the Layout, but rather applied separately. We need to account for this here.
    metrics.top += verticalOffset

    metrics.wasFound = true
    metrics.width = placeholder.width.toFloat()
    metrics.height = placeholder.height.toFloat()
    return lastAttachmentFoundInSpan
  }

  @JvmStatic
  @OptIn(UnstableReactNativeAPI::class)
  fun measureLines(
      assetManager: AssetManager,
      attributedString: MapBuffer,
      paragraphAttributes: MapBuffer,
      width: Float,
      height: Float,
      reactTextViewManagerCallback: ReactTextViewManagerCallback?,
      textEffectRegistry: TextEffectRegistry? = null,
  ): WritableArray = measureLines(
      assetManager,
      0,
      attributedString,
      paragraphAttributes,
      width,
      height,
      reactTextViewManagerCallback,
      textEffectRegistry,
  )

  @JvmStatic
  @OptIn(UnstableReactNativeAPI::class)
  fun measureLines(
      assetManager: AssetManager,
      fontWeightAdjustment: Int,
      attributedString: MapBuffer,
      paragraphAttributes: MapBuffer,
      width: Float,
      height: Float,
      reactTextViewManagerCallback: ReactTextViewManagerCallback?,
      textEffectRegistry: TextEffectRegistry? = null,
  ): WritableArray {
    val layout = createLayoutForMeasurement(
        assetManager,
        fontWeightAdjustment,
        attributedString,
        paragraphAttributes,
        width,
        YogaMeasureMode.EXACTLY,
        height,
        YogaMeasureMode.EXACTLY,
        reactTextViewManagerCallback,
        textEffectRegistry,
    )
    return FontMetricsUtil.getFontMetrics(
        layout.text,
        layout,
        DisplayMetricsHolder.getScreenDisplayMetrics(),
    )
  }

  private fun isBoring(text: Spannable, paint: TextPaint): BoringLayout.Metrics? {
    val metrics =
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
          BoringLayout.isBoring(text, paint)
        } else {
          // Default to include fallback line spacing on Android 13+, like TextView
          // https://cs.android.com/android/_/android/platform/frameworks/base/+/78c774defb238c05c42b34a12b6b3b0c64844ed7
          BoringLayout.isBoring(text, paint, TextDirectionHeuristics.FIRSTSTRONG_LTR, true, null)
        }

    // BoringLayout.isBoring() sometimes thinks text width is negative for some strings, even on
    // Android 15+. Fallback to StaticLayout.
    if (metrics == null || metrics.width < 0) {
      return null
    }

    return metrics
  }

  private class CreateLayoutResult(
      val layout: Layout,
      val textBreakStrategy: Int,
      val justificationMode: Int,
  )

  private class AttachmentMetrics {
    var wasFound: Boolean = false
    var top: Float = 0f
    var left: Float = 0f
    var width: Float = 0f
    var height: Float = 0f
  }

  private fun jsonStringToReadableMap(json: String?): ReadableMap? {
    if (json == null) return null
    return try {
      jsonObjectToReadableMap(JSONObject(json))
    } catch (_: Exception) {
      null
    }
  }

  private fun jsonObjectToReadableMap(jsonObject: JSONObject): JavaOnlyMap {
    val map = JavaOnlyMap()
    val keys = jsonObject.keys()
    while (keys.hasNext()) {
      val key = keys.next()
      putJsonValue(map, key, jsonObject.get(key))
    }
    return map
  }

  private fun jsonArrayToReadableArray(jsonArray: JSONArray): JavaOnlyArray {
    val array = JavaOnlyArray()
    for (i in 0 until jsonArray.length()) {
      pushJsonValue(array, jsonArray.get(i))
    }
    return array
  }

  private fun putJsonValue(map: JavaOnlyMap, key: String, value: Any) {
    when (value) {
      JSONObject.NULL -> map.putNull(key)
      is Boolean -> map.putBoolean(key, value)
      is Number -> map.putDouble(key, value.toDouble())
      is String -> map.putString(key, value)
      is JSONObject -> map.putMap(key, jsonObjectToReadableMap(value))
      is JSONArray -> map.putArray(key, jsonArrayToReadableArray(value))
      else ->
          FLog.w(
              ReactConstants.TAG,
              "Unsupported text effect prop type for key $key: ${value.javaClass.name}",
          )
    }
  }

  private fun pushJsonValue(array: JavaOnlyArray, value: Any) {
    when (value) {
      JSONObject.NULL -> array.pushNull()
      is Boolean -> array.pushBoolean(value)
      is Number -> array.pushDouble(value.toDouble())
      is String -> array.pushString(value)
      is JSONObject -> array.pushMap(jsonObjectToReadableMap(value))
      is JSONArray -> array.pushArray(jsonArrayToReadableArray(value))
      else ->
          FLog.w(
              ReactConstants.TAG,
              "Unsupported text effect prop type: ${value.javaClass.name}",
          )
    }
  }
}
