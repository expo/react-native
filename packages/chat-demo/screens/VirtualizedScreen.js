/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 * @format
 */

'use strict';

import '@react-native/expo-intrinsics-poc';

import NativeChatBubble from '../../expo-intrinsics/src/NativeChatBubble';
import NativeSafeArea from '../../expo-intrinsics/src/NativeSafeArea';
import NativeScroll from '../../expo-intrinsics/src/NativeScroll';
/*
 * A PRIVATE import, deliberately.
 *
 * `VirtualView` is not exported from `react-native` — it lives under
 * `src/private` — and this screen exists to prove that `<native:scroll>` can
 * host one. Reaching for the real component rather than a stand-in is the whole
 * point: a stand-in would test the stand-in.
 */
import {createHiddenVirtualView} from '../../react-native/src/private/components/virtualview/VirtualView';
import {accentColor, uiColor} from '../uiColors';
import * as React from 'react';
import {useRef} from 'react';
import {StyleSheet} from 'react-native';

/**
 * A long list of virtualized rows, inside `<native:scroll>`.
 *
 * ## What it is for
 *
 * `VirtualView` renders its children only while they are near the viewport, and
 * it finds out where the viewport IS by walking up to the first ancestor that
 * answers `virtualViewContainerState`. `EXPScrollViewComponentView` answers it;
 * a `VirtualView` that finds no container never receives a mode, so it stays
 * rendered forever and costs more than a plain `<div>` while appearing to work.
 *
 * That is the failure this screen makes visible. Everything renders either way;
 * what differs is whether the rows a long way off are still in the tree.
 *
 * ## Why the list is this long
 *
 * `virtualViewPrerenderRatio` is **5.0**, and the prerender rectangle is the
 * viewport inflated by that on EACH side — so a row has to be more than five
 * viewport-heights from the edge of the screen before it is `Hidden`. On this
 * window that is about four thousand points, or sixty-odd rows. A ten-row demo
 * would look identical whether or not any of this works, which is exactly the
 * kind of test that passes forever and proves nothing.
 *
 * TEN THOUSAND rows of sixty-four points is six hundred and forty thousand
 * points of content — a hundred and sixty times the prerender band, and about
 * seven hundred screens. Four hundred is enough to make the far end `Hidden`;
 * ten thousand is enough to make the COST of not virtualizing visible, which is
 * the question this number is chosen for. Everything outside the band renders
 * `null`, so the tree stays about the size a four-hundred-row list's would be
 * while the array behind it is twenty-five times longer.
 *
 * What that stresses is the part virtualization does NOT help with: ten
 * thousand `VirtualView` elements are still created on every render of this
 * screen, and ten thousand shadow nodes still exist to be laid out. If this
 * screen becomes slow to open, that is where it is — not in the rows you can
 * see.
 *
 * ## What it found
 *
 * The container asks EVERY registered `VirtualView` for its rect on every
 * `scrollViewDidScroll:`, so the sweep is linear in the list's length whatever
 * is rendered — and at ten thousand rows it is the largest thing on the main
 * thread while the list moves. Measured here, in Release, normalised by rows
 * actually scrolled: **35.6 sample-milliseconds per row unoptimised, 3.03 with
 * the four costs below removed**, or roughly six and a half milliseconds a
 * frame down to half of one.
 *
 * Four separate costs, each invisible until the one above it is removed:
 * `-convertRect:toView:`'s layer geometry, `-[UIView superview]`'s lock, ARC
 * autoreleasing a returned view ten thousand times a frame, and
 * `CGRectGetMinY` being a real call into CoreGraphics. See
 * `RCTVirtualViewProtocol.h`, where the struct that removes the third one is.
 *
 * ## The two buttons
 *
 * `scrollToTop` and `scrollToLatest` rather than a gesture. A test that swiped
 * would need hundreds of swipes and would measure the swipe; these are the
 * element's own commands, they land exactly, and they leave the scroll position
 * unambiguous.
 */

const ROW_HEIGHT = 64;
/*
 * Half the bubble's own height, which is what makes it a capsule: the label's
 * line box at 17 points is about 20.3, and 8 above and below it comes to 36.
 * The renderer clamps a radius to half the body's height anyway, so this is the
 * value it would arrive at — stated because a number the reader can check beats
 * one the renderer picks.
 */
const BUBBLE_RADIUS = 18;
/*
 * Ten thousand. See "Why the list is this long" above — and keep
 * `VirtualizedCheck.swift`'s `lastRow` in step, because a test that names a row
 * this screen no longer has fails as "virtualization is broken".
 */
const ROW_COUNT = 10000;
const ROWS = Array.from({length: ROW_COUNT}, (_, index) => index);
/*
 * A row starts HIDDEN, and it has to.
 *
 * `VirtualView`'s default export starts in the NOT-hidden state — it renders
 * its children and waits to be told it is off screen. That is right for a
 * handful of expensive subtrees and wrong for ten thousand rows: the first
 * commit builds every one of them in full — a `<div>`, a `<native:chatbubble>`
 * and a `<p>` whose text is laid out — and the first layout then tells nine
 * thousand nine hundred of them to unmount again. Opening this screen that way
 * takes **13.6 seconds** in Debug, all of it in that first commit, on rows that
 * are never seen.
 *
 * `createHiddenVirtualView` is the other starting point, and the placeholder it
 * is given is the row's own stated height — the same `ROW_HEIGHT` the visible
 * row uses, so the scroll range is exact from the first frame and the two
 * buttons still land where they say they do. What arrives near the viewport is
 * told so by `-updateLayoutMetrics:`, which runs for every row on that same
 * first layout, so nothing waits for a scroll.
 *
 * This is `content-visibility: auto` with a `contain-intrinsic-size`, which is
 * what the CSS property was added for and the same bargain: the box is real and
 * takes up its space, and its contents do not exist until they are close.
 */
const HiddenRow = createHiddenVirtualView({minHeight: ROW_HEIGHT});

export default function VirtualizedScreen({onExit}: {onExit?: () => void}) {
  const list = useRef(null);
  return (
    <div style={styles.screen}>
      <NativeScroll
        edgeEffects={{top: 'soft'}}
        ref={list}
        /*
         * No `contentAnchor`, deliberately. This screen is a virtualization
         * test, and a list like this one is the ordinary list the default
         * anchor is for: it opens at the top and stays where it is put. Adding
         * the bottom anchor here would test two things at once and tell you
         * which of them failed only by luck.
         *
         * What DOES need proving about the pair — that rows materialising above
         * the viewport do not carry the reader — is the anchor's own property
         * and belongs with the anchor's own tests, where the prepend is real
         * rather than a side effect of scrolling.
         */
        style={styles.list}
        contentContainerStyle={styles.content}>
        {ROWS.map(index => (
          /*
           * `nativeID` is what `VirtualView`'s own logging keys off, and it
           * costs nothing to name them. The TEST looks for the row's text
           * instead: a hidden `VirtualView` renders `null` for its children, so
           * the label is genuinely out of the tree rather than merely off
           * screen — which is the difference `exists` can see and a screenshot
           * cannot.
           */
          <HiddenRow key={index} nativeID={`row-${index}`}>
            <div
              style={[
                styles.row,
                index % 2 === 0 ? styles.rowTheirs : styles.rowMine,
              ]}>
              <NativeChatBubble
                tail={index % 2 === 0 ? 'leading' : 'trailing'}
                radius={BUBBLE_RADIUS}
                style={styles.bubble}
                surfaceStyle={
                  index % 2 === 0 ? styles.theirsSurface : styles.mineSurface
                }>
                <p
                  style={[
                    styles.label,
                    index % 2 === 0 ? styles.theirsLabel : styles.mineLabel,
                  ]}>
                  {`Row ${index}`}
                </p>
              </NativeChatBubble>
            </div>
          </HiddenRow>
        ))}
      </NativeScroll>
      {/*
        The controls sit INSIDE the safe area, and the wrapper is how that is
        said.

        A `<native:scroll>` reserves the safe area itself, as content inset, so
        that its rows scroll under the home indicator while staying reachable.
        Nothing else in this element set does — a `<div>` at the bottom of a
        screen is exactly as tall as its content, and its content ends up under
        the indicator. That is what happened here, and it is worth naming rather
        than quietly fixing: the safe area is OPT-IN everywhere except the
        scroll view, so "correct" costs the author a decision on every screen
        edge. See `SafeAreaDefaults.md` for what the platforms do instead and
        what it would take to make the default the safe one.

        The bottom edge only. The sides are zero in portrait and the top belongs
        to the scroll view above, which reserves its own.
      */}
      <NativeSafeArea
        edges={{top: false, left: false, right: false}}
        style={styles.controlBar}>
        <div style={styles.controls}>
          <button
            type="button"
            style={styles.control}
            onClick={() => list.current?.scrollToTop(false)}>
            <span style={styles.controlLabel}>To the start</span>
          </button>
          <button
            type="button"
            style={styles.control}
            onClick={() => list.current?.scrollToLatest(false)}>
            <span style={styles.controlLabel}>To the end</span>
          </button>
          {onExit != null && (
            <button type="button" style={styles.control} onClick={onExit}>
              <span style={styles.controlLabel}>Back</span>
            </button>
          )}
        </div>
      </NativeSafeArea>
    </div>
  );
}

const styles = StyleSheet.create({
  screen: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: uiColor('systemBackground'),
  },
  list: {flexGrow: 1},
  content: {paddingBottom: 16},
  /*
   * A STATED height, so the list's scroll range is known before anything is
   * hidden. `VirtualView`'s default hidden style is `minHeight` taken from the
   * last measured rectangle, so a row that has never been measured would
   * collapse — and a list whose content shrinks as you scroll it is a list that
   * fights its own scroll position.
   *
   * `display: 'flex'`, and it is not decoration. A `<div>` is `display: block`,
   * and the alignment properties do nothing to a block box — without this line
   * they are inert and the text sits at the top of every row rather than
   * centred in it. The composer's own pill carries the same line for the same
   * reason.
   */
  row: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    height: ROW_HEIGHT,
    paddingHorizontal: 16,
  },
  /*
   * The rows read as a CONVERSATION rather than as a table, which is what the
   * rest of this app is about — and it costs the virtualization test nothing,
   * because the row's height is still stated and still the only thing the scroll
   * range is computed from.
   *
   * `<native:chatbubble>` rather than a rounded `<div>`: it is the element the
   * chat screen uses, so this screen exercises the real one under
   * virtualization instead of a lookalike. A bubble whose tail draws on a row
   * that has just come back into the tree is a thing worth being able to see.
   */
  rowTheirs: {justifyContent: 'flex-start'},
  rowMine: {justifyContent: 'flex-end'},
  bubble: {paddingVertical: 8, paddingHorizontal: 12},
  /*
   * Both fills are semantic, for the reason the chat screen's are: a literal
   * grey is correct in light mode and a pale slab in dark. `secondarySystemFill`
   * is the received balloon's own colour there, and `systemBlue` comes from the
   * ACCENT vocabulary rather than `uiColor` — a palette, not a role.
   */
  theirsSurface: {backgroundColor: uiColor('secondarySystemFill')},
  mineSurface: {backgroundColor: accentColor('systemBlue')},
  label: {marginBlock: 0, fontSize: 17},
  theirsLabel: {color: uiColor('label')},
  /* White on the accent, which is the one literal the chat screen keeps too:
     there is no semantic "on the accent" colour in either platform's set. */
  mineLabel: {color: '#ffffff'},
  /*
   * The bar, which owns the rule above the controls and the safe area below
   * them — so the hairline sits at the top of the whole bar and the reserved
   * strip is inside it rather than under it.
   */
  controlBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: uiColor('separator'),
  },
  controls: {
    display: 'flex',
    flexDirection: 'row',
    gap: 8,
    padding: 12,
  },
  control: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: uiColor('systemGray5'),
  },
  controlLabel: {fontSize: 15, color: uiColor('label')},
});
