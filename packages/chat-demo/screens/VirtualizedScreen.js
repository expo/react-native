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
// A private path: `createHiddenVirtualView` isn't exported from `react-native`.
import {createHiddenVirtualView} from '../../react-native/src/private/components/virtualview/VirtualView';
import useHeaderEdgeEffects from '../headerEdge';
import {accentColor, uiColor} from '../uiColors';
import * as React from 'react';
import {useRef} from 'react';
import {StyleSheet} from 'react-native';

/**
 * `VirtualView` rows inside `<native:scroll>`, to check that the scroll view
 * acts as their container (`EXPScrollViewComponentView` provides
 * `virtualViewContainerState`); without one, a `VirtualView` never receives a
 * mode. `VirtualizedCheck.swift` checks that a far-off row's text leaves the
 * tree and comes back when scrolled to.
 *
 * Rows are hidden only well outside the viewport (see ui-metrics.md,
 * "Virtualized prerender band"), hence 10,000 of them. At that length the
 * per-row costs that remain are visible: every render still creates 10,000
 * `VirtualView` elements, and on every scroll the container gets the rect of
 * every `VirtualView` (see `RCTVirtualViewProtocol.h` and ui-metrics.md,
 * "Virtualized sweep cost").
 */

const ROW_HEIGHT = 64;
/*
 * Half the bubble's height, so it's a capsule: a 17 pt line (about 20.3 pt
 * tall, `styles.label`) plus 8 pt padding above and below (`styles.bubble`).
 */
const BUBBLE_RADIUS = 18;
// Must match `lastRow` ("Row 9999") in VirtualizedCheck.swift.
const ROW_COUNT = 10000;
const ROWS = Array.from({length: ROW_COUNT}, (_, index) => index);
/*
 * Rows start hidden. The default `VirtualView` starts rendered, so the first
 * commit would build all 10,000 rows and then unmount almost all of them. The
 * hidden placeholder is `ROW_HEIGHT` tall, so the scroll range is correct from
 * the first frame.
 */
const HiddenRow = createHiddenVirtualView({minHeight: ROW_HEIGHT});

export default function VirtualizedScreen({onExit}: {onExit?: () => void}) {
  const list = useRef(null);
  const headerEdgeEffects = useHeaderEdgeEffects();
  return (
    <div style={styles.screen}>
      <NativeScroll
        edgeEffects={headerEdgeEffects}
        ref={list}
        style={styles.list}
        contentContainerStyle={styles.content}>
        {ROWS.map(index => (
          /*
           * `nativeID` labels `VirtualView`'s logging. VirtualizedCheck.swift
           * finds rows by their text (`Row ${index}`), which is not in the tree
           * while the row is hidden.
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
        Keeps the buttons above the home indicator: unlike `<native:scroll>`, a
        `<div>` doesn't reserve the safe area. VirtualizedCheck.swift taps the
        buttons by their labels.
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
   * `ROW_HEIGHT`, the same as the hidden placeholder, so a row doesn't change
   * height when it renders. `display: 'flex'` because a `<div>` is
   * `display: block`, which ignores `alignItems`.
   */
  row: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    height: ROW_HEIGHT,
    paddingHorizontal: 16,
  },
  rowTheirs: {justifyContent: 'flex-start'},
  rowMine: {justifyContent: 'flex-end'},
  bubble: {paddingVertical: 8, paddingHorizontal: 12},
  theirsSurface: {backgroundColor: uiColor('secondarySystemFill')},
  mineSurface: {backgroundColor: accentColor('systemBlue')},
  label: {marginBlock: 0, fontSize: 17},
  theirsLabel: {color: uiColor('label')},
  /* A literal: iOS has no semantic colour for text on `systemBlue`. */
  mineLabel: {color: '#ffffff'},
  /* On `NativeSafeArea`, not `controls`, so the border is above the safe-area
     padding. */
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
