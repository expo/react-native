/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * This source code is licensed under the MIT license in the root directory.
 */

package dev.expo.astryxdemo;

import android.view.View;
import androidx.annotation.Nullable;
import androidx.slidingpanelayout.widget.SlidingPaneLayout;

/**
 * SlidingPaneLayout 1.2 can report a null panel when aborting a slide during measurement as a fold
 * makes the layout non-sliding. Its Java interface says non-null, so a Kotlin override throws
 * before our callback runs. We only need the pane state, not that transient panel.
 */
final class PaneStateListener implements SlidingPaneLayout.PanelSlideListener {
  private final Runnable onStateChanged;

  PaneStateListener(Runnable onStateChanged) {
    this.onStateChanged = onStateChanged;
  }

  @Override
  public void onPanelSlide(@Nullable View panel, float slideOffset) {
    onStateChanged.run();
  }

  @Override
  public void onPanelOpened(@Nullable View panel) {
    onStateChanged.run();
  }

  @Override
  public void onPanelClosed(@Nullable View panel) {
    onStateChanged.run();
  }
}
