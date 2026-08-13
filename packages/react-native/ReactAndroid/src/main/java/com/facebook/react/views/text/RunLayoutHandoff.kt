/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.text

import android.text.Layout
import android.text.Spannable
import android.util.LruCache
import com.facebook.react.common.mapbuffer.MapBuffer

/**
 * The measure->mount layout handoff for anonymous text runs
 * (run-layout-reuse-plan.md).
 *
 * Measuring a run already builds the full spannable and platform [Layout] on
 * the layout thread, then discards them; mounting rebuilt both on the UI
 * thread. This registry parks the measurement's layout under the run box's
 * React tag so the mounting layer can claim it instead.
 *
 * [take] removes the entry — an entry is the product of one measurement and
 * is consumed by at most one mount, never a long-lived content cache. The
 * taker must verify the entry matches what it is mounting (the serialized
 * attributed string compares content-equal, the density is unchanged, and
 * the layout is valid at the mount width); any mismatch — an async mount
 * racing a newer commit's measure, a density change mid-flight, a tag
 * collision across React instances — degrades to the mount-side rebuild,
 * never to wrong content.
 *
 * The LRU bound (by character count) covers entries whose mount never
 * arrives: measurements Yoga discards, aborted commits, torn-down surfaces.
 */
internal object RunLayoutHandoff {

  internal class Entry(
      @JvmField val attributedString: MapBuffer,
      @JvmField val layout: Layout,
      @JvmField val density: Float,
      /**
       * True when no line of the layout was broken by the width constraint
       * (every line boundary is a preserved hard break). Such a layout, when
       * left-aligned, paints identically at any width at least as wide as
       * its longest line — which is what lets a layout measured at the
       * text's desired width serve a box that stretched wider. A
       * soft-wrapped layout's line breaks depend on its exact width, so it
       * may only be reused at that width.
       */
      @JvmField val notSoftWrapped: Boolean,
  ) {
    val spannable: Spannable
      get() = layout.text as Spannable
  }

  /** Bound by character count: entries hold whole spannables and layouts. */
  private const val MAX_CHARS = 65536

  private val entries =
      object : LruCache<Int, Entry>(MAX_CHARS) {
        override fun sizeOf(key: Int, value: Entry): Int =
            value.layout.text.length.coerceAtLeast(1)
      }

  @JvmStatic
  fun store(tag: Int, attributedString: MapBuffer, layout: Layout, density: Float) {
    val text = layout.text
    var notSoftWrapped = true
    for (line in 0 until layout.lineCount - 1) {
      if (text[layout.getLineEnd(line) - 1] != '\n') {
        notSoftWrapped = false
        break
      }
    }
    synchronized(entries) {
      entries.put(tag, Entry(attributedString, layout, density, notSoftWrapped))
    }
  }

  @JvmStatic
  fun take(tag: Int): Entry? =
      synchronized(entries) { entries.remove(tag) }

  /**
   * Deep content equality over two MapBuffers. `ReadableMapBuffer.equals`
   * cannot be used here: a nested buffer (the run's attributed string inside
   * the ViewState buffer) is a duplicate of its WHOLE parent buffer with an
   * offset, and `equals` rewinds and compares entire backing buffers.
   * Doubles compare by canonical bits so NaN-carrying attributes (e.g. an
   * unset fontSizeMultiplier) compare equal to themselves. Unknown data
   * types compare unequal — degrading to a rebuild, never to wrong content.
   */
  @JvmStatic
  fun contentEquals(a: MapBuffer, b: MapBuffer): Boolean {
    if (a.count != b.count) {
      return false
    }
    val ib = b.iterator()
    for (ea in a) {
      val eb = ib.next()
      if (ea.key != eb.key || ea.type != eb.type) {
        return false
      }
      when (ea.type) {
        MapBuffer.DataType.BOOL -> if (ea.booleanValue != eb.booleanValue) return false
        MapBuffer.DataType.INT -> if (ea.intValue != eb.intValue) return false
        MapBuffer.DataType.LONG -> if (ea.longValue != eb.longValue) return false
        MapBuffer.DataType.DOUBLE ->
            if (ea.doubleValue.toBits() != eb.doubleValue.toBits()) return false
        MapBuffer.DataType.STRING -> if (ea.stringValue != eb.stringValue) return false
        MapBuffer.DataType.MAP ->
            if (!contentEquals(ea.mapBufferValue, eb.mapBufferValue)) return false
        MapBuffer.DataType.MAP_BUFFER_LIST -> {
          val la = a.getMapBufferList(ea.key)
          val lb = b.getMapBufferList(eb.key)
          if (la.size != lb.size) return false
          for (i in la.indices) {
            if (!contentEquals(la[i], lb[i])) return false
          }
        }
        else -> return false
      }
    }
    return true
  }
}
