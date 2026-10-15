/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * This source code is licensed under the MIT license in the root directory.
 */
package dev.expo.astryxdemo

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.fragment.app.Fragment
import com.facebook.react.interfaces.fabric.ReactSurface

/** A stable native screen with a surface measured by its actual pane. */
class ReactPaneFragment : Fragment() {
  private var surface: ReactSurface? = null

  override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, state: Bundle?): View {
    val host = (requireActivity().application as MainApplication).reactHost
    val next = host.createSurface(requireActivity(), requireArguments().getString("module")!!, null)
    surface = next
    next.start()
    // Own the screen's accessibility visibility outside Fabric and outside
    // SlidingPaneLayout's direct children (its accessibility delegate resets
    // those children's importance while constructing its own node).
    return FrameLayout(requireContext()).apply {
      addView(
          requireNotNull(next.view),
          FrameLayout.LayoutParams(
              ViewGroup.LayoutParams.MATCH_PARENT,
              ViewGroup.LayoutParams.MATCH_PARENT,
          ),
      )
    }
  }

  override fun onDestroyView() {
    surface?.stop()
    surface = null
    super.onDestroyView()
  }

  companion object {
    fun create(module: String) =
        ReactPaneFragment().apply { arguments = Bundle().apply { putString("module", module) } }
  }
}
