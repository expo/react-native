/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.common.assets

import android.content.Context
import android.content.res.AssetManager
import android.graphics.Typeface
import android.os.Build
import android.util.Log
import android.util.SparseArray
import androidx.annotation.VisibleForTesting
import androidx.core.content.res.ResourcesCompat
import com.facebook.react.common.ReactConstants
import com.facebook.react.common.build.ReactBuildConfig

/**
 * Responsible for loading and caching Typeface objects.
 *
 * This will first try to load a typeface from the assets/fonts folder. If one is not found in that
 * folder, this will fallback to the best matching system typeface.
 *
 * Custom fonts support the extensions `.ttf` and `.otf` and the variants `bold`, `italic`, and
 * `bold_italic`. For example, given a font named "ExampleFontFamily", the following are supported:
 * * ExampleFontFamily.ttf (or .otf)
 * * ExampleFontFamily_bold.ttf (or .otf)
 * * ExampleFontFamily_italic.ttf (or .otf)
 * * ExampleFontFamily_bold_italic.ttf (or .otf)
 */
public class ReactFontManager {

  private val fontCache: MutableMap<String, AssetFontFamily> = mutableMapOf()
  private val customTypefaceCache: MutableMap<String, Typeface> = mutableMapOf()

  /** The set of font family names that have been registered via [addCustomFont]. */
  public val customFontFamilies: Set<String>
    get() = customTypefaceCache.keys.toSet()

  public fun getTypeface(
      fontFamilyName: String,
      style: Int,
      assetManager: AssetManager?,
  ): Typeface = getTypeface(fontFamilyName, TypefaceStyle(style), assetManager)

  public fun getTypeface(
      fontFamilyName: String,
      weight: Int,
      italic: Boolean,
      assetManager: AssetManager?,
  ): Typeface = getTypeface(fontFamilyName, TypefaceStyle(weight, italic), assetManager)

  public fun getTypeface(
      fontFamilyName: String,
      style: Int,
      weight: Int,
      assetManager: AssetManager?,
  ): Typeface = getTypeface(fontFamilyName, TypefaceStyle(style, weight), assetManager)

  public fun getTypeface(
      fontFamilyName: String,
      typefaceStyle: TypefaceStyle,
      assetManager: AssetManager?,
  ): Typeface {
    val family = firstAvailableFontFamily(fontFamilyName, assetManager)
    if (customTypefaceCache.containsKey(family)) {
      // Apply `typefaceStyle` because custom fonts configure variants using `app:fontStyle` and
      // `app:fontWeight` in their resource XML configuration file.
      return typefaceStyle.apply(customTypefaceCache[family])
    }

    val assetFontFamily = fontCache.getOrPut(family) { AssetFontFamily() }
    val style = typefaceStyle.nearestStyle
    return assetFontFamily.getTypefaceForStyle(style)
        ?: createAssetTypeface(family, style, assetManager).also {
          assetFontFamily.setTypefaceForStyle(style, it)
        }
  }

  /**
   * A `font-family` value as CSS writes it, a list of families with the first one the device has
   * winning (css-fonts-4 §2.1), generic families among them standing for the platform's own,
   * reduced to the one family name the lookup takes. A family is "had" when it was registered,
   * ships in the app's font assets, or the platform knows it by name; a value with no comma is a
   * family name as before. The web's per-character fallback, where a glyph the first family lacks
   * comes from the next, is the text system's own.
   */
  @VisibleForTesting
  internal fun firstAvailableFontFamily(list: String, assetManager: AssetManager?): String {
    if (!list.contains(',')) {
      return GENERIC_FAMILIES[list.lowercase()] ?: list
    }
    var first: String? = null
    for (raw in list.split(',')) {
      val name = raw.trim().trim('"', '\'')
      if (name.isEmpty()) {
        continue
      }
      if (first == null) {
        first = name
      }
      GENERIC_FAMILIES[name.lowercase()]?.let {
        return it
      }
      if (customTypefaceCache.containsKey(name) || fontCache.containsKey(name) ||
          hasAssetFont(name, assetManager) || isPlatformFamily(name)) {
        return name
      }
    }
    // Nothing available: the first name, whose absence the lookup reports as it did
    return first ?: list
  }

  private fun hasAssetFont(fontFamilyName: String, assetManager: AssetManager?): Boolean {
    if (assetManager == null) {
      return false
    }
    for (fileExtension in FILE_EXTENSIONS) {
      try {
        assetManager.open("$FONTS_ASSET_PATH$fontFamilyName$fileExtension").close()
        return true
      } catch (e: java.io.IOException) {
        continue
      }
    }
    return false
  }

  /** Whether the platform knows a family by name: an unknown one creates the default typeface */
  private fun isPlatformFamily(fontFamilyName: String): Boolean =
      Typeface.create(fontFamilyName, Typeface.NORMAL) != Typeface.defaultFromStyle(Typeface.NORMAL)

  /*
   * This method allows you to load custom fonts from res/font folder as provided font family name.
   * Fonts may be one of .ttf, .otf or XML (https://developer.android.com/guide/topics/ui/look-and-feel/fonts-in-xml).
   * To support multiple font styles or weights, you must provide a font in XML format.
   *
   * ReactFontManager.getInstance().addCustomFont(this, "Srisakdi", R.font.srisakdi);
   */
  public fun addCustomFont(context: Context, fontFamily: String, fontId: Int) {
    addCustomFont(fontFamily, ResourcesCompat.getFont(context, fontId))
  }

  /**
   * Equivalent method to {@see addCustomFont(Context, String, int)} which accepts a Typeface
   * object.
   */
  public fun addCustomFont(fontFamily: String, font: Typeface?) {
    if (font != null) {
      customTypefaceCache[fontFamily] = font
    }
  }

  /**
   * Add additional font family, or replace the exist one in the font memory cache.
   *
   * @see [Typeface.DEFAULT]
   * @see [Typeface.BOLD]
   * @see [Typeface.ITALIC]
   * @see [Typeface.BOLD_ITALIC]
   */
  public fun setTypeface(fontFamilyName: String, style: Int, typeface: Typeface?) {
    if (typeface != null) {
      fontCache.getOrPut(fontFamilyName) { AssetFontFamily() }.setTypefaceForStyle(style, typeface)
    }
  }

  /** Responsible for normalizing style and numeric weight for backward compatibility. */
  public class TypefaceStyle {
    private val italic: Boolean
    private val weight: Int

    public constructor(weight: Int, italic: Boolean) {
      this.italic = italic
      this.weight = if (weight == ReactConstants.UNSET) NORMAL else weight
    }

    /**
     * If `weight` is supplied, it will be combined with the italic bit from `style`. Otherwise, any
     * existing weight bit in `style` will be used.
     */
    @JvmOverloads
    public constructor(style: Int, weight: Int = ReactConstants.UNSET) {
      val fixedStyle = if (style == ReactConstants.UNSET) Typeface.NORMAL else style
      italic = (fixedStyle and Typeface.ITALIC) != 0
      this.weight =
          if (weight == ReactConstants.UNSET)
              (if ((fixedStyle and Typeface.BOLD) != 0) BOLD else NORMAL)
          else weight
    }

    public val nearestStyle: Int
      get() =
          if (weight < BOLD) {
            if (italic) Typeface.ITALIC else Typeface.NORMAL
          } else {
            if (italic) Typeface.BOLD_ITALIC else Typeface.BOLD
          }

    public fun apply(typeface: Typeface?): Typeface =
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
          Typeface.create(typeface, nearestStyle)
        } else {
          Typeface.create(typeface, weight, italic)
        }

    public companion object {
      public const val BOLD: Int = 700
      public const val NORMAL: Int = 400
    }
  }

  public companion object {

    // NOTE: Indices in `EXTENSIONS` correspond to the `TypeFace` style constants.
    private val EXTENSIONS = arrayOf("", "_bold", "_italic", "_bold_italic")
    private val FILE_EXTENSIONS = arrayOf(".ttf", ".otf")
    private const val FONTS_ASSET_PATH = "fonts/"
    // Android's default font family.
    private const val DEFAULT_FAMILY = "sans-serif"
    // What a CSS generic family stands for on this platform (the names Typeface knows)
    private val GENERIC_FAMILIES =
        mapOf(
            "sans-serif" to "sans-serif",
            "ui-sans-serif" to "sans-serif",
            "system-ui" to "sans-serif",
            "ui-rounded" to "sans-serif",
            "-apple-system" to "sans-serif",
            "blinkmacsystemfont" to "sans-serif",
            "serif" to "serif",
            "ui-serif" to "serif",
            "monospace" to "monospace",
            "ui-monospace" to "monospace",
            "cursive" to "cursive",
            "fantasy" to "sans-serif",
        )

    private val _instance = ReactFontManager()

    @JvmStatic public fun getInstance(): ReactFontManager = _instance

    private fun createAssetTypeface(
        fontFamilyName: String,
        style: Int,
        assetManager: AssetManager?,
    ): Typeface {
      if (assetManager != null) {
        val extension = EXTENSIONS[style]
        for (fileExtension in FILE_EXTENSIONS) {
          val fileName = "$FONTS_ASSET_PATH$fontFamilyName$extension$fileExtension"
          try {
            return Typeface.createFromAsset(assetManager, fileName)
          } catch (e: RuntimeException) {
            // If the typeface asset does not exist, try another extension.
            continue
          }
        }
      }

      val typeface = Typeface.create(fontFamilyName, style)
      // Like RCTLogInfo on iOS, only log in debug builds.
      if (ReactBuildConfig.DEBUG) {
        // Typeface.create returns the default typeface for unknown family names.
        if (fontFamilyName != DEFAULT_FAMILY && typeface == Typeface.defaultFromStyle(style)) {
          Log.i(ReactConstants.TAG, "Unrecognized font family '$fontFamilyName'")
        }
      }
      return typeface
    }
  }

  /** Responsible for caching typefaces for each custom font family. */
  private class AssetFontFamily {
    private val typefaceSparseArray: SparseArray<Typeface?> = SparseArray(4)

    fun getTypefaceForStyle(style: Int): Typeface? = typefaceSparseArray[style]

    fun setTypefaceForStyle(style: Int, typeface: Typeface?) {
      typefaceSparseArray.put(style, typeface)
    }
  }
}
