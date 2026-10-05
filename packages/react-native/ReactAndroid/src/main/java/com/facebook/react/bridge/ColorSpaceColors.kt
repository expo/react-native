/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.bridge

import android.graphics.Color
import android.graphics.ColorSpace
import android.os.Build
import androidx.annotation.ColorLong
import androidx.annotation.RequiresApi
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.cos
import kotlin.math.sin

/**
 * Colors in their own color space, as `processColor` passes them: `{space, alpha}` plus the
 * channels CSS's relative color syntax names (`r g b`, `l a b`, `l c h` or `x y z`). Each space is
 * the platform's own [ColorSpace], asked for by name at run time; a space CSS defines that the OS
 * lacks is built from one it has, and Lab, and Oklab where the OS lacks it, go by CSS's arithmetic.
 * [Color.pack] tags the color with its space; the platform converts it where it draws.
 */
@RequiresApi(Build.VERSION_CODES.O)
internal object ColorSpaceColors {

  /** The color as a color long in its own space, or null when this device can't show it. */
  @ColorLong
  fun toColorLong(value: ReadableMap): Long? {
    val name = if (value.hasKey("space")) value.getString("space") else null
    // `a` is alpha in an RGB object (the legacy Display P3 shape) but a channel in Lab
    val isLab = name == "lab" || name == "oklab"
    val alpha = channel(value, "alpha") ?: (if (isLab) null else channel(value, "a")) ?: 1f
    val names =
        when (name) {
          "lab",
          "oklab" -> listOf("l", "a", "b")
          "lch",
          "oklch" -> listOf("l", "c", "h")
          "xyz-d50",
          "xyz-d65" -> listOf("x", "y", "z")
          null -> return null
          else -> listOf("r", "g", "b")
        }
    val channels = names.map { channel(value, it) ?: return null }
    return toColorLong(name, channels[0], channels[1], channels[2], alpha)
  }

  /**
   * The color with the given space and channels, in CSS's order for the space's model (r g b, l a
   * b, l c h, or x y z), as a color long; null when this device can't show it
   */
  @ColorLong
  fun toColorLong(name: String, c0: Float, c1: Float, c2: Float, rawAlpha: Float): Long? {
    val alpha = rawAlpha.coerceIn(0f, 1f)
    return when (name) {
      "lab",
      "oklab" -> packLab(name, c0, c1, c2, alpha)
      "lch",
      "oklch" -> {
        val l = c0
        val c = c1
        val h = c2
        val hue = Math.toRadians(h.toDouble())
        packLab(
            if (name == "lch") "lab" else "oklab",
            l,
            (c * cos(hue)).toFloat(),
            (c * sin(hue)).toFloat(),
            alpha,
        )
      }
      "xyz-d50",
      "xyz-d65" -> {
        val x = c0
        val y = c1
        val z = c2
        val space = colorSpace("xyz-d50") ?: return null
        if (name == "xyz-d65") {
          // Android's XYZ is D50; Bradford adaptation from D65 (CSS Color 4 §10.7)
          pack(
              1.0479298208405488f * x + 0.022946793341019088f * y - 0.05019222954313557f * z,
              0.029627815688159344f * x + 0.990434484573249f * y - 0.01707382502938514f * z,
              -0.009243058152591178f * x + 0.015055144896577895f * y + 0.7518742899580008f * z,
              alpha,
              space,
          )
        } else {
          pack(x, y, z, alpha, space)
        }
      }
      else -> {
        val space = colorSpace(name) ?: return null
        pack(c0, c1, c2, alpha, space)
      }
    }
  }

  // A color long names only a platform space, and a paint draws only an RGB one, so a space
  // built here, Lab or XYZ goes through extended linear sRGB, which holds any color
  private fun pack(c0: Float, c1: Float, c2: Float, alpha: Float, space: ColorSpace): Long {
    if (space.id >= 0 && space.model == ColorSpace.Model.RGB) {
      return Color.pack(c0, c1, c2, alpha, space)
    }
    val target = ColorSpace.get(ColorSpace.Named.LINEAR_EXTENDED_SRGB)
    val (r, g, b) = ColorSpace.connect(space, target).transform(c0, c1, c2)
    return Color.pack(r, g, b, alpha, target)
  }

  private fun channel(value: ReadableMap, key: String): Float? =
      if (value.hasKey(key) && value.getType(key) == ReadableType.Number) {
        value.getDouble(key).toFloat()
      } else {
        null
      }

  // Android's CIE Lab clamps a and b to ±128 and CSS doesn't, so Lab goes by CSS's arithmetic
  private fun packLab(name: String, l: Float, a: Float, b: Float, alpha: Float): Long? {
    if (name == "lab") {
      return packCIELab(l, a, b, alpha)
    }
    val space = colorSpace(name)
    if (space != null) {
      return pack(l, a, b, alpha, space)
    }
    // Oklab to linear sRGB, CSS Color 4 §9.2's arithmetic (Björn Ottosson's matrices)
    val l1 = l + 0.3963377774f * a + 0.2158037573f * b
    val m1 = l - 0.1055613458f * a - 0.0638541728f * b
    val s1 = l - 0.0894841775f * a - 1.2914855480f * b
    val lCubed = l1 * l1 * l1
    val mCubed = m1 * m1 * m1
    val sCubed = s1 * s1 * s1
    return Color.pack(
        4.0767416621f * lCubed - 3.3077115913f * mCubed + 0.2309699292f * sCubed,
        -1.2684380046f * lCubed + 2.6097574011f * mCubed - 0.3413193965f * sCubed,
        -0.0041960863f * lCubed - 0.7034186147f * mCubed + 1.7076147010f * sCubed,
        alpha,
        ColorSpace.get(ColorSpace.Named.LINEAR_EXTENDED_SRGB),
    )
  }

  // CIE Lab relative to D50 to extended linear sRGB, CSS Color 4 §9.3 and §10.7's arithmetic
  private fun packCIELab(l: Float, a: Float, b: Float, alpha: Float): Long {
    val kappa = 24389.0 / 27.0
    val epsilon = 216.0 / 24389.0
    val f1 = (l + 16.0) / 116.0
    val f0 = a / 500.0 + f1
    val f2 = f1 - b / 200.0
    val x =
        (if (f0 * f0 * f0 > epsilon) f0 * f0 * f0 else (116 * f0 - 16) / kappa) * (0.3457 / 0.3585)
    val y = if (l > kappa * epsilon) f1 * f1 * f1 else l / kappa
    val z =
        (if (f2 * f2 * f2 > epsilon) f2 * f2 * f2 else (116 * f2 - 16) / kappa) *
            ((1.0 - 0.3457 - 0.3585) / 0.3585)
    // Bradford, D50 to D65
    val x65 = 0.955473421488075 * x - 0.02309845494876471 * y + 0.06325924320057072 * z
    val y65 = -0.0283697093338637 * x + 1.0099953980813041 * y + 0.021041441191917323 * z
    val z65 = 0.012314014864481998 * x - 0.020507649298898964 * y + 1.330365926242124 * z
    return Color.pack(
        (3.2409699419045226 * x65 - 1.537383177570094 * y65 - 0.4986107602930034 * z65).toFloat(),
        (-0.9692436362808796 * x65 + 1.8759675015077202 * y65 + 0.04155505740717559 * z65)
            .toFloat(),
        (0.05563007969699366 * x65 - 0.20397695888897652 * y65 + 1.0569715142428786 * z65)
            .toFloat(),
        alpha,
        ColorSpace.get(ColorSpace.Named.LINEAR_EXTENDED_SRGB),
    )
  }

  // A `Named` constant this Android version lacks is reported unavailable, not assumed from an
  // API level
  private val NAMED_SPACES: Map<String, String> =
      mapOf(
          "srgb" to "EXTENDED_SRGB",
          "srgb-linear" to "LINEAR_EXTENDED_SRGB",
          "display-p3" to "DISPLAY_P3",
          "a98-rgb" to "ADOBE_RGB",
          "prophoto-rgb" to "PRO_PHOTO_RGB",
          "rec2020" to "BT2020",
          "rec2100-pq" to "BT2020_PQ",
          "rec2100-hlg" to "BT2020_HLG",
          "oklab" to "OK_LAB",
          "xyz-d50" to "CIE_XYZ",
          "--dci-p3" to "DCI_P3",
          "--rec709" to "BT709",
          "--aces" to "ACES",
          "--aces-cg" to "ACESCG",
          "--ntsc-1953" to "NTSC_1953",
          "--smpte-c" to "SMPTE_C",
      )

  private val resolved = ConcurrentHashMap<String, Any>()
  private val UNAVAILABLE = Any()

  /** The OS's color space for a CSS space name, asked once and kept; null where it has none. */
  fun colorSpace(name: String): ColorSpace? {
    val cached = resolved[name]
    if (cached != null) {
      return cached as? ColorSpace
    }
    val space = resolve(name)
    resolved[name] = space ?: UNAVAILABLE
    return space
  }

  private fun resolve(name: String): ColorSpace? {
    NAMED_SPACES[name]?.let { named ->
      return try {
        ColorSpace.get(ColorSpace.Named.valueOf(named))
      } catch (e: IllegalArgumentException) {
        null
      }
    }
    // The spaces CSS defines and Android doesn't name, built from ones it does
    return when (name) {
      "display-p3-linear" -> linearOf("display-p3")
      "rec2100-linear" -> linearOf("rec2020")
      else -> null
    }
  }

  // The same primaries and white point with a linear transfer, over the platform's extended
  // range; a channel beyond it clips.
  // DOM-CSS-LIMITATION(android-linear-channels-stop-at-the-extended-range)
  private fun linearOf(name: String): ColorSpace? {
    val rgb = colorSpace(name) as? ColorSpace.Rgb ?: return null
    return ColorSpace.Rgb(
        "$name (linear)",
        rgb.primaries,
        rgb.whitePoint,
        { x -> x },
        { x -> x },
        EXTENDED_MIN,
        EXTENDED_MAX,
    )
  }

  // `LINEAR_EXTENDED_SRGB`'s range
  private const val EXTENDED_MIN = -0.5f
  private const val EXTENDED_MAX = 7.499f
}
