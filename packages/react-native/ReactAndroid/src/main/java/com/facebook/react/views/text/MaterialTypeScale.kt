/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.text

import android.content.Context
import android.util.TypedValue
import androidx.annotation.VisibleForTesting

/**
 * Material's type scale, read from the app's THEME rather than copied into this file.
 *
 * An element names a role — `headlineLarge`, `titleMedium` — and this resolves what the theme says
 * that role is. Reading the theme rather than a table is the point: an app that customises its
 * typography, or a device applying its own Material You font, changes the answer here without this
 * code knowing either exists. A copy of Material's published numbers would be right until the
 * moment either happened.
 *
 * ## Why it is a cache primed from outside rather than a lookup
 *
 * Resolving a theme attribute needs a [Context], and React Native's Android text pipeline
 * deliberately has none: [TextLayoutManager] and the span builders take an `AssetManager`, never a
 * `Context`, so by the time a font is chosen the theme is out of reach. [FabricUIManager] does hold
 * one at the measure entry — it already derives `fontWeightAdjustment` from it there — so the scale
 * is resolved once at that point and read here as plain numbers afterwards.
 *
 * No `Context` is retained. Resolution produces sizes and weights and nothing else, so priming
 * cannot leak an Activity.
 *
 * ## Resolved by NAME, not by R.attr
 *
 * React Native does not depend on `com.google.android.material`, and adding that dependency to the
 * core for a type scale would be a heavier change than this feature warrants. The attribute names
 * are stable public API of the Material theme, so they are resolved through `getIdentifier`. An app
 * on a non-Material theme finds nothing under those names and falls back to the FRAMEWORK's own
 * text appearances, which every theme has — see [FRAMEWORK_FALLBACK].
 */
public object MaterialTypeScale {

  /**
   * What a theme says a role is. Sizes are in scaled pixels, as the theme states them.
   *
   * The LINE HEIGHT is part of the answer, not a detail. Material states one for every step —
   * Headline Large is 32sp of type on 40sp of line, Title Large 22 on 28, Body Large 16 on 24 —
   * and it is the vertical rhythm that belongs to the type we just took from the theme. Taking the
   * size and leaving the leading behind gets text that is the right size and sits wrongly, which
   * is the kind of thing that reads as "not quite a native app" without being nameable.
   *
   * `lineHeightSp` is NaN where the theme states none; the font's own leading then applies, which
   * is what a text appearance without a line height is asking for.
   */
  public data class Appearance(
      val textSizeSp: Float,
      val fontWeight: Int,
      val lineHeightSp: Float,
  )

  /**
   * The roles the element vocabulary names. Deliberately short: these are the six a heading can
   * take, not the whole scale, and an unresolvable name simply has no entry.
   */
  private val ROLES: List<String> =
      listOf(
          "displaySmall",
          "headlineLarge",
          "headlineMedium",
          "headlineSmall",
          "titleLarge",
          "titleMedium",
          "titleSmall",
          "bodyLarge",
          "bodySmall",
          "labelSmall",
      )

  /** The attributes read from a text appearance, sorted as the framework requires. */
  private val ATTRS: IntArray =
      intArrayOf(
              android.R.attr.textSize,
              android.R.attr.textFontWeight,
              android.R.attr.fontFamily,
              android.R.attr.lineHeight,
          )
          .sortedArray()

  @Volatile private var resolved: Map<String, Appearance>? = null

  /**
   * Whether what is cached came from MATERIAL rather than the framework fallback.
   *
   * The distinction is what lets a later, better context upgrade the answer. Priming happens first
   * from the Application, whose theme may not carry the Material attributes even though the app
   * uses them — that attempt still succeeds through [FRAMEWORK_FALLBACK], and latching on it would
   * freeze a three-step scale in place while the Activity's theme had the full six.
   */
  @Volatile private var resolvedFromMaterial: Boolean = false

  /**
   * Resolves the scale from [context]'s theme.
   *
   * Cheap to call repeatedly — once Material has answered, the common case is a single volatile
   * read. Until then each call is another chance at a context whose theme carries the Material
   * attributes, because the first context offered is an Application and its theme may not.
   */
  @JvmStatic
  public fun primeFrom(context: Context) {
    if (resolvedFromMaterial) {
      return
    }
    synchronized(this) {
      if (resolvedFromMaterial) {
        return
      }
      val material = mutableSetOf<String>()
      val attempt = resolveAll(context, material)
      // Kept only if it is the first answer or a better one: a fallback result
      // must not freeze out the Material scale a later context can still give.
      if (attempt.isNotEmpty() && (resolved == null || material.isNotEmpty())) {
        resolved = attempt
        resolvedFromMaterial = material.size == ROLES.size
      }
    }
  }

  /**
   * The Material appearance a TEXT ROLE maps to, or null where the theme defines none.
   *
   * The role vocabulary is shared with iOS — `title1`, `headline` — because one property carries it
   * to both platforms. What differs is where it lands: iOS asks `preferredFontForTextStyle:` for the
   * same name, and here it is mapped onto Material's scale first.
   *
   * The mapping is a design decision and the two scales made the heading half an easy one: Material
   * has six steps that fit a document's headings — Headline Large/Medium/Small then Title
   * Large/Medium/Small — against iOS's four above body text, so where iOS runs out and falls to
   * secondary-text roles, Material still has titles.
   *
   * EVERY role is mapped, not only the six a heading uses, and that is a correctness requirement
   * rather than completeness for its own sake. The style key accepts all eleven of React Native's
   * ramps; naming one clears the size the cascade would otherwise have carried, on the promise that
   * the platform supplies a replacement. A role that resolved to nothing left the text with NO SIZE
   * AT ALL, which surfaces as `FontSize should be a positive value` from a letter-spacing
   * calculation — a crash reachable from a plain, valid stylesheet.
   */
  @JvmStatic
  public fun forRole(role: String): Appearance? {
    val materialRole =
        when (role) {
          "largeTitle" -> "displaySmall"
          "title1" -> "headlineLarge"
          "title2" -> "headlineMedium"
          "title3" -> "headlineSmall"
          "headline" -> "titleLarge"
          "subheadline" -> "titleMedium"
          "footnote" -> "titleSmall"
          "body" -> "bodyLarge"
          "callout" -> "bodyLarge"
          "caption1" -> "bodySmall"
          "caption2" -> "labelSmall"
          else -> return null
        }
    return resolved?.get(materialRole)
  }

  /** Test seam: forget what was resolved, so a different theme can be measured. */
  @JvmStatic
  @VisibleForTesting
  public fun resetForTests() {
    synchronized(this) { resolved = null }
  }

  private fun resolveAll(context: Context, material: MutableSet<String>): Map<String, Appearance> {
    val out = mutableMapOf<String, Appearance>()
    for (role in ROLES) {
      resolveOne(context, role, material)?.let { out[role] = it }
    }
    return out
  }

  /**
   * What a non-Material theme is asked for instead.
   *
   * `textAppearanceLarge/Medium/Small` are framework attributes and exist in every theme, including
   * the AppCompat ones a great many apps still use. Without this, an app on such a theme would name
   * a role, resolve nothing, and render every heading at the default text size — a regression for
   * doing nothing wrong.
   *
   * Six roles collapse onto three steps, so the hierarchy is coarser than Material's. That is a
   * judgement rather than a platform fact, and it only applies where the platform has nothing
   * finer to say.
   */
  private val FRAMEWORK_FALLBACK: Map<String, Int> =
      mapOf(
          "displaySmall" to android.R.attr.textAppearanceLarge,
          "headlineLarge" to android.R.attr.textAppearanceLarge,
          "headlineMedium" to android.R.attr.textAppearanceLarge,
          "headlineSmall" to android.R.attr.textAppearanceMedium,
          "titleLarge" to android.R.attr.textAppearanceMedium,
          "titleMedium" to android.R.attr.textAppearanceMedium,
          "titleSmall" to android.R.attr.textAppearanceSmall,
          "bodyLarge" to android.R.attr.textAppearanceMedium,
          "bodySmall" to android.R.attr.textAppearanceSmall,
          "labelSmall" to android.R.attr.textAppearanceSmall,
      )

  /** The style a theme attribute points at, or null where the theme states none. */
  private fun resolveStyle(context: Context, attrId: Int): Int? {
    if (attrId == 0) {
      return null
    }
    val value = TypedValue()
    if (!context.theme.resolveAttribute(attrId, value, true) || value.resourceId == 0) {
      return null
    }
    return value.resourceId
  }

  private fun resolveOne(context: Context, role: String, material: MutableSet<String>): Appearance? {
    val attrName = "textAppearance" + role.replaceFirstChar { it.uppercase() }
    val materialAttr = context.resources.getIdentifier(attrName, "attr", context.packageName)

    /*
     * Two chances, and the second is not about the name being missing.
     *
     * A Material attribute can EXIST in the app's resources — `getIdentifier`
     * finds it — while the context's theme does not define it, which is what a
     * non-Material theme looks like and also what an Application context can
     * look like. So the fallback keys on the theme failing to RESOLVE, not on
     * the name failing to exist; keying it on the name left the framework
     * appearances unused in exactly the case they were written for.
     */
    val fromMaterial = resolveStyle(context, materialAttr)
    if (fromMaterial != null) {
      material.add(role)
    }
    val styleRes = fromMaterial ?: resolveStyle(context, FRAMEWORK_FALLBACK[role] ?: 0)
    if (styleRes == null) {
      return null
    }
    val value = TypedValue().apply { resourceId = styleRes }

    /*
     * SORTED, because `obtainStyledAttributes(int, int[])` requires it.
     *
     * The array is used as a lookup key into the style, and an unsorted one
     * does not fail — it silently returns nothing. Passing textSize,
     * textFontWeight, fontFamily in that readable order resolved every role to
     * null, which surfaced much later as a heading with no size at all and an
     * `IllegalArgumentException` from a letter-spacing calculation.
     */
    val attrs = ATTRS
    val typed = context.obtainStyledAttributes(value.resourceId, attrs)
    try {
      val sizePx = typed.getDimension(attrs.indexOf(android.R.attr.textSize), 0f)
      if (sizePx <= 0f) {
        return null
      }
      val density = context.resources.displayMetrics.scaledDensity
      val sizeSp = if (density > 0f) sizePx / density else sizePx

      /*
       * The weight is read the way the theme happens to state it, which is not
       * uniform. Material 3 gives Headline and Title Large a `fontFamily` of
       * `sans-serif` and Title Medium/Small `sans-serif-medium`, and states
       * `textFontWeight` on neither — so a style that only read `textFontWeight`
       * would report every Material role as regular and silently lose the one
       * distinction the small titles carry.
       */
      val statedWeight = typed.getInt(attrs.indexOf(android.R.attr.textFontWeight), 0)
      val family = typed.getString(attrs.indexOf(android.R.attr.fontFamily))
      val weight =
          when {
            statedWeight > 0 -> statedWeight
            family != null && family.endsWith("-medium") -> 500
            family != null && family.endsWith("-black") -> 900
            family != null && family.endsWith("-bold") -> 700
            family != null && family.endsWith("-light") -> 300
            family != null && family.endsWith("-thin") -> 100
            else -> 400
          }
      /*
       * `android:lineHeight` is API 28 and Material states it alongside the
       * appcompat-namespaced `lineHeight`; a theme older than that, or one
       * that states neither, leaves this at zero and the font's own leading
       * stands.
       */
      val lineHeightPx = typed.getDimension(attrs.indexOf(android.R.attr.lineHeight), 0f)
      val lineHeightSp =
          if (lineHeightPx > 0f && density > 0f) lineHeightPx / density else Float.NaN

      return Appearance(sizeSp, weight, lineHeightSp)
    } finally {
      typed.recycle()
    }
  }
}
