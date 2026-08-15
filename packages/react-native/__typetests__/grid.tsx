/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

/**
 * CSS Grid style properties type-check as CSS.
 *
 * The layout is verified elsewhere — this asserts only that the syntax an
 * author would write is accepted by the types, which is the part a passing
 * layout test cannot tell you. Every value below is one that appears in the
 * RNTester demos or in WebKit's grid demos.
 */

import * as React from 'react';
import {StyleSheet, View} from 'react-native';

export function GridTypes() {
  return (
    <View style={styles.gallery}>
      <View style={styles.header} />
      <View style={styles.lead} />
      <View style={styles.pinned} />
    </View>
  );
}

const styles = StyleSheet.create({
  gallery: {
    display: 'grid',
    // The idiom every WebKit demo uses.
    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
    gap: 16,
  },
  fixedTracks: {
    display: 'grid',
    gridTemplateColumns: '100px 1fr 2fr',
    gridTemplateRows: 'repeat(3, minmax(60px, auto))',
    rowGap: 8,
    columnGap: 12,
  },
  intrinsicTracks: {
    display: 'grid',
    gridTemplateColumns: 'max-content fit-content(200px) 1fr',
  },
  implicitTracks: {
    display: 'grid',
    gridAutoRows: '80px',
    gridAutoColumns: 'minmax(40px, auto)',
  },
  flows: {
    display: 'grid',
    gridAutoFlow: 'row dense',
  },
  columnFlow: {
    display: 'grid',
    gridAutoFlow: 'column',
  },
  inlineLevel: {
    display: 'inline-grid',
  },
  // A full-bleed header, as in WebKit's Recipes demo.
  header: {
    gridColumnStart: 1,
    gridColumnEnd: -1,
  },
  // A spanning lead story, as in the Newspaper demo.
  lead: {
    gridColumnEnd: 'span 3',
    gridRowEnd: 'span 2',
  },
  pinned: {
    gridColumnStart: 2,
    gridRowStart: 3,
    justifySelf: 'center',
    alignSelf: 'end',
  },
  // Named areas, as in a page shell.
  shell: {
    display: 'grid',
    gridTemplateAreas: '"header header" "sidebar main"',
    gridTemplateColumns: '200px 1fr',
    gridTemplateRows: 'auto 1fr',
  },
  shellHeader: {
    gridArea: 'header',
  },
  // css-grid-3 grid lanes.
  waterfall: {
    display: 'grid-lanes',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: 12,
    flowTolerance: 'normal',
  },
  brick: {
    display: 'grid-lanes',
    gridTemplateRows: 'repeat(3, minmax(60px, 1fr))',
    flowTolerance: 16,
  },
  strictOrder: {
    display: 'grid-lanes',
    gridTemplateColumns: '1fr 1fr 1fr',
    flowTolerance: 'infinite',
  },
  proportionalTolerance: {
    display: 'grid-lanes',
    gridTemplateColumns: '1fr 1fr',
    flowTolerance: '10%',
  },
  alignment: {
    display: 'grid',
    justifyItems: 'center',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    alignContent: 'start',
  },
});
