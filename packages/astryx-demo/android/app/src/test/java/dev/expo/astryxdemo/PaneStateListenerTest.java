/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * This source code is licensed under the MIT license in the root directory.
 */

package dev.expo.astryxdemo;

import static org.junit.Assert.assertEquals;

import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;

public class PaneStateListenerTest {
  @Test
  public void acceptsAnAbortedSlidesMissingPanel() {
    AtomicInteger changes = new AtomicInteger();
    PaneStateListener listener = new PaneStateListener(changes::incrementAndGet);
    listener.onPanelSlide(null, 0);
    listener.onPanelOpened(null);
    listener.onPanelClosed(null);
    assertEquals(3, changes.get());
  }
}
