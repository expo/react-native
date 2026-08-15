/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

'use strict';

import type {RNTesterModule} from '../../types/RNTesterTypes';

import {
  DEMO_THEME,
  DemoContent,
  ThemingNote,
  usePublishRects,
} from '../TextChildren/TextChildrenShared';
import * as React from 'react';
import {useRef} from 'react';
import {Text, View} from 'react-native';

/*
 * Grid lanes (css-grid-3), ported from WebKit's Field Guide
 * (https://gridlanes.webkit.org/).
 *
 * Lanes is CSS Grid with one axis flowed instead of gridded: tracks are
 * defined in the GRID AXIS exactly as in Grid, and in the STACKING AXIS each
 * track keeps a running position, with every item packing into whichever track
 * is currently least filled. That is the waterfall layout people have been
 * writing by hand — measuring columns in JavaScript and appending to the
 * shortest — expressed as three CSS declarations.
 *
 * Every layout here is pinned against real Safari by the corpus in
 * grid-lanes-conformance/, and the same cases run headlessly in
 * Libraries/Components/View/__tests__/Grid-itest.js.
 */

const SWATCHES = [
  '#6ea8fe',
  '#f0a15c',
  '#8fd3a8',
  '#d3a8f0',
  '#f0d76e',
  '#a8c8f0',
  '#f08fa8',
  '#8fd3d3',
];

// Heights chosen so the packing is visible: a uniform set would look the same
// under any placement rule, which would make the demo prove nothing.
const PHOTO_HEIGHTS = [72, 40, 96, 56, 64, 32, 88, 48, 60, 36, 80, 52];

function Tile({
  index,
  height,
  label,
}: {
  index: number,
  height: number,
  label?: string,
}): React.Node {
  return (
    <View
      style={{
        height,
        backgroundColor: SWATCHES[index % SWATCHES.length],
        borderRadius: 6,
        // Centred, like the tiles in the grid demo next door. The label sits
        // inside the tile and says nothing about where the GRID put the tile,
        // so the two screens disagreeing on it read as a placement difference
        // that is not there. The shortest tile is 20 and the label's line box
        // is 13, so centring fits without the block padding this used to need.
        justifyContent: 'center',
        paddingHorizontal: 6,
      }}>
      <Text style={{fontSize: 11, fontWeight: '600', color: '#1a1a1a'}}>
        {label ?? String(index + 1)}
      </Text>
    </View>
  );
}

/*
 * The on-device numeric check, read back by
 * scripts/grid-lanes-cdp-verify.js.
 *
 * The assertions are RELATIONS, so they hold at any screen width: an item
 * placed into a lane must sit exactly where the items above it in that lane
 * end, and the shortest-lane rule must actually be what decides.
 */
function LanesVerifyCase(): React.Node {
  const a = useRef<React.ElementRef<typeof View> | null>(null);
  const b = useRef<React.ElementRef<typeof View> | null>(null);
  const c = useRef<React.ElementRef<typeof View> | null>(null);
  const d = useRef<React.ElementRef<typeof View> | null>(null);
  const strictA = useRef<React.ElementRef<typeof View> | null>(null);
  const strictD = useRef<React.ElementRef<typeof View> | null>(null);

  usePublishRects({
    laneA: a,
    laneB: b,
    laneC: c,
    laneD: d,
    laneStrictA: strictA,
    laneStrictD: strictD,
  });

  return (
    <View>
      {/*
        Three lanes, tolerance 0 so the shortest lane always wins. Heights
        60/30/40 mean lane 2 (30 tall) is shortest when the fourth item is
        placed, so it must land there — under the tallest-first misreading it
        would land in lane 1.
      */}
      <View
        // $FlowExpectedError[incompatible-type] grid-lanes style keys
        style={{
          display: 'grid-lanes',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 10,
          flowTolerance: 0,
          marginBottom: 12,
        }}>
        <View ref={a} style={{height: 60, backgroundColor: SWATCHES[0]}} />
        <View ref={b} style={{height: 30, backgroundColor: SWATCHES[1]}} />
        <View ref={c} style={{height: 40, backgroundColor: SWATCHES[2]}} />
        <View ref={d} style={{height: 20, backgroundColor: SWATCHES[3]}} />
      </View>

      {/* The same items under `infinite`: strictly in order, ignoring height. */}
      <View
        // $FlowExpectedError[incompatible-type] grid-lanes style keys
        style={{
          display: 'grid-lanes',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 10,
          flowTolerance: 'infinite',
        }}>
        <View ref={strictA} style={{height: 60, backgroundColor: SWATCHES[0]}} />
        <View style={{height: 30, backgroundColor: SWATCHES[1]}} />
        <View style={{height: 40, backgroundColor: SWATCHES[2]}} />
        <View ref={strictD} style={{height: 20, backgroundColor: SWATCHES[3]}} />
      </View>
    </View>
  );
}

export default {
  title: 'Grid Lanes',
  category: 'Layout',
  description:
    'CSS Grid Lanes: display, gridTemplateColumns, gridTemplateRows, ' +
    'flowTolerance, gridAutoFlow, gridColumnStart/End, gridRowStart/End, ' +
    'gap, rowGap, columnGap, justifyItems, alignItems, justifySelf, ' +
    'alignSelf, justifyContent, alignContent.',
  examples: [
    {
      title: 'Waterfall — the whole point',
      name: 'waterfall',
      description:
        'Items of differing height packing into whichever lane is shortest. ' +
        'This is the layout people hand-roll by measuring columns in JS; here ' +
        'it is three declarations.',
      render: (): React.Node => (
        <DemoContent
          code={
            "<View style={{\n" +
            "  display: 'grid-lanes',\n" +
            "  gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',\n" +
            '  gap: 10,\n' +
            '}}>'
          }>
          <View
            // $FlowExpectedError[incompatible-type] grid-lanes style keys
            style={{
              display: 'grid-lanes',
              gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
              gap: 10,
            }}>
            {PHOTO_HEIGHTS.map((h, i) => (
              <Tile key={i} index={i} height={h} />
            ))}
          </View>
        </DemoContent>
      ),
    },
    {
      title: 'Grid vs grid-lanes — the same items',
      name: 'compare',
      description:
        'Identical children and tracks. Grid puts every row at the height of ' +
        'its tallest item, leaving gaps under the short ones; lanes packs each ' +
        'column independently.',
      render: (): React.Node => (
        <DemoContent
          code={"display: 'grid'   // vs   display: 'grid-lanes'"}>
          {['grid', 'grid-lanes'].map(display => (
            <View key={display}>
              <Text
                style={{
                  color: DEMO_THEME.muted,
                  fontSize: 12,
                  marginBottom: 4,
                  marginTop: display === 'grid' ? 0 : 12,
                }}>
                display: '{display}'
              </Text>
              <View
                // $FlowExpectedError[incompatible-type] grid style keys
                style={{
                  display,
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: 8,
                }}>
                {[64, 32, 48, 28, 56, 36].map((h, i) => (
                  <Tile key={i} index={i} height={h} />
                ))}
              </View>
            </View>
          ))}
        </DemoContent>
      ),
    },
    {
      title: 'Photo gallery — aspect-ratio items',
      name: 'photos',
      description:
        'The shape every real gallery has: items with no height at all, only ' +
        'an aspect ratio. The lane gives each one its width and the ratio ' +
        'gives the height, so the packing follows from the images themselves.',
      render: (): React.Node => (
        <DemoContent
          code={
            "gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))'\n" +
            '// each item:  aspectRatio: 1.5   (no height)'
          }>
          <View
            // $FlowExpectedError[incompatible-type] grid-lanes style keys
            style={{
              display: 'grid-lanes',
              gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
              gap: 8,
            }}>
            {[1.5, 0.75, 1, 1.33, 0.66, 1.5, 1, 0.8].map((ratio, i) => (
              <View
                key={i}
                style={{
                  aspectRatio: ratio,
                  backgroundColor: SWATCHES[i % SWATCHES.length],
                  borderRadius: 6,
                  justifyContent: 'center',
                  padding: 6,
                }}>
                <Text
                  style={{fontSize: 11, fontWeight: '600', color: '#1a1a1a'}}>
                  {ratio}
                </Text>
              </View>
            ))}
          </View>
        </DemoContent>
      ),
    },
    {
      title: 'flow-tolerance — filling in order',
      name: 'tolerance',
      description:
        'The same items at three thresholds. At 0 the shortest lane always ' +
        'wins, which can look scattered; `normal` (1em) treats near-equal ' +
        'lanes as tied so they fill in order; `infinite` ignores height ' +
        'entirely and fills strictly in order.',
      render: (): React.Node => (
        <DemoContent
          code={"flowTolerance: 0   |   'normal' (1em)   |   'infinite'"}>
          {[0, 'normal', 'infinite'].map(tolerance => (
            <View key={String(tolerance)}>
              <Text
                style={{
                  color: DEMO_THEME.muted,
                  fontSize: 12,
                  marginBottom: 4,
                  marginTop: tolerance === 0 ? 0 : 12,
                }}>
                flowTolerance:{' '}
                {typeof tolerance === 'number' ? tolerance : `'${tolerance}'`}
              </Text>
              <View
                // $FlowExpectedError[incompatible-type] grid-lanes style keys
                style={{
                  display: 'grid-lanes',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: 8,
                  flowTolerance: tolerance,
                }}>
                {[60, 40, 20, 30, 30, 30].map((h, i) => (
                  <Tile key={i} index={i} height={h} />
                ))}
              </View>
            </View>
          ))}
        </DemoContent>
      ),
    },
    {
      title: 'Brick — lanes that run sideways',
      name: 'brick',
      description:
        'Giving `gridTemplateRows` instead of columns makes the BLOCK axis ' +
        'the grid axis, so lanes are rows and the layout grows horizontally ' +
        '(css-grid-3 §2.3). This is WebKit’s Timeline demo.',
      render: (): React.Node => (
        <DemoContent
          code={
            "<View style={{\n" +
            "  display: 'grid-lanes',\n" +
            "  gridTemplateRows: '1fr 1fr 1fr',\n" +
            '  height: 200,\n' +
            '  gap: 8,\n' +
            '}}>'
          }>
          <View
            // $FlowExpectedError[incompatible-type] grid-lanes style keys
            style={{
              display: 'grid-lanes',
              gridTemplateRows: '1fr 1fr 1fr',
              height: 200,
              gap: 8,
            }}>
            {[80, 50, 110, 64, 96, 44].map((w, i) => (
              <View
                key={i}
                style={{
                  width: w,
                  backgroundColor: SWATCHES[i % SWATCHES.length],
                  borderRadius: 6,
                  justifyContent: 'center',
                  paddingHorizontal: 6,
                }}>
                <Text style={{fontSize: 11, fontWeight: '600', color: '#1a1a1a'}}>
                  {w}pt
                </Text>
              </View>
            ))}
          </View>
        </DemoContent>
      ),
    },
    {
      title: 'Spanning items',
      name: 'spanning',
      description:
        'An item can span lanes, and the lanes it covers are levelled to its ' +
        'lowest point before it is placed — so a spanning item acts as a ' +
        'partial barrier the later items flow around.',
      render: (): React.Node => (
        <DemoContent code={"gridColumnEnd: 'span 2'"}>
          <View
            // $FlowExpectedError[incompatible-type] grid-lanes style keys
            style={{
              display: 'grid-lanes',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 8,
            }}>
            <Tile index={0} height={48} />
            <Tile index={1} height={32} />
            <Tile index={2} height={64} />
            <View
              // $FlowExpectedError[incompatible-type] grid-lanes style keys
              style={{
                gridColumnEnd: 'span 2',
                height: 40,
                backgroundColor: SWATCHES[3],
                borderRadius: 6,
                justifyContent: 'center',
                paddingHorizontal: 8,
              }}>
              <Text style={{fontSize: 11, fontWeight: '600', color: '#1a1a1a'}}>
                span 2
              </Text>
            </View>
            {[36, 52, 28].map((h, i) => (
              <Tile key={i} index={i + 4} height={h} />
            ))}
          </View>
        </DemoContent>
      ),
    },
    {
      title: 'Lane geometry (verified on device)',
      name: 'verify',
      render: (): React.Node => (
        <View>
          <ThemingNote>
            Swatch colors are fixed on purpose — they are the subject of the
            demo, not chrome, and must read identically in light and dark.
          </ThemingNote>
          <LanesVerifyCase />
        </View>
      ),
    },
  ],
} as RNTesterModule;
