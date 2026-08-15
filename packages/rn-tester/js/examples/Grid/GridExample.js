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
  BASE_FONT_SIZE,
  DEMO_THEME,
  DemoContent,
  ThemingNote,
  usePublishRects,
} from '../TextChildren/TextChildrenShared';
import * as React from 'react';
import {useRef} from 'react';
import {Text, View} from 'react-native';

/*
 * CSS Grid, ported from the layouts in WebKit's Field Guide to Grid Lanes
 * (https://gridlanes.webkit.org/). Those demos are built on
 * `repeat(auto-fill, minmax(...))` rather than literal track lists, which is
 * the idiom that makes a gallery responsive without a media query per
 * breakpoint — so that is what these screens exercise.
 *
 * Every layout here is pinned against real Safari by the conformance corpus in
 * grid-lanes-conformance/, and the same cases run headlessly in
 * Libraries/Components/View/__tests__/Grid-itest.js.
 */

// A palette that reads in both appearances: these are the demo's subject, so
// they are deliberately fixed rather than semantic.
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

function Cell({
  index,
  height,
  label,
}: {
  index: number,
  height?: number,
  label?: string,
}): React.Node {
  return (
    <View
      style={{
        backgroundColor: SWATCHES[index % SWATCHES.length],
        borderRadius: 6,
        height: height ?? 48,
        justifyContent: 'center',
        paddingHorizontal: 8,
      }}>
      <Text style={{fontSize: 12, color: '#1a1a1a', fontWeight: '600'}}>
        {label ?? String(index + 1)}
      </Text>
    </View>
  );
}

/*
 * The numeric check that runs on device, read back by
 * scripts/grid-cdp-verify.js through the same published-rects channel the
 * cascade and white-space demos use.
 *
 * These assertions are about RELATIONS rather than absolute pixels, so they
 * hold at any container width: three equal fr tracks must be equal and evenly
 * spaced; an auto-fill container must produce tracks at least as wide as its
 * minmax floor; a spanning item must be as wide as the tracks it covers plus
 * the gap between them.
 */
function GridVerifyCase(): React.Node {
  const frA = useRef<React.ElementRef<typeof View> | null>(null);
  const frB = useRef<React.ElementRef<typeof View> | null>(null);
  const frC = useRef<React.ElementRef<typeof View> | null>(null);
  const spanContainer = useRef<React.ElementRef<typeof View> | null>(null);
  const spanItem = useRef<React.ElementRef<typeof View> | null>(null);
  const spanFirst = useRef<React.ElementRef<typeof View> | null>(null);
  const autoFillContainer = useRef<React.ElementRef<typeof View> | null>(null);
  const autoFillFirst = useRef<React.ElementRef<typeof View> | null>(null);

  usePublishRects({
    gridFrA: frA,
    gridFrB: frB,
    gridFrC: frC,
    gridSpanContainer: spanContainer,
    gridSpanItem: spanItem,
    gridSpanFirst: spanFirst,
    gridAutoFillContainer: autoFillContainer,
    gridAutoFillFirst: autoFillFirst,
  });

  return (
    <View>
      {/* Three equal fr tracks with a 10pt gap. */}
      <View
        // $FlowExpectedError[incompatible-type] grid style keys
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 10,
          marginBottom: 10,
        }}>
        <View ref={frA} style={{height: 24, backgroundColor: SWATCHES[0]}} />
        <View ref={frB} style={{height: 24, backgroundColor: SWATCHES[1]}} />
        <View ref={frC} style={{height: 24, backgroundColor: SWATCHES[2]}} />
      </View>

      {/* An item spanning two of three tracks. */}
      <View
        ref={spanContainer}
        // $FlowExpectedError[incompatible-type] grid style keys
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 10,
          marginBottom: 10,
        }}>
        <View
          ref={spanFirst}
          style={{height: 24, backgroundColor: SWATCHES[3]}}
        />
        <View
          ref={spanItem}
          // $FlowExpectedError[incompatible-type] grid style keys
          style={{
            height: 24,
            backgroundColor: SWATCHES[4],
            gridColumnEnd: 'span 2',
          }}
        />
      </View>

      {/* auto-fill: the track count follows the container width. */}
      <View
        ref={autoFillContainer}
        // $FlowExpectedError[incompatible-type] grid style keys
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
          gap: 10,
        }}>
        <View
          ref={autoFillFirst}
          style={{height: 24, backgroundColor: SWATCHES[5]}}
        />
        <View style={{height: 24, backgroundColor: SWATCHES[6]}} />
        <View style={{height: 24, backgroundColor: SWATCHES[7]}} />
      </View>
    </View>
  );
}

/*
 * A grid container with padding around a single fixed-height row.
 *
 * The correct height is padding + row + padding = 20 + 20 + 20 = 60. This is
 * the MRE for a bug in the vendored track sizing (see
 * yoga/algorithm/grid/README-VENDORED.md): the container's own track total is
 * a CONTENT-box size, but it was being floored at the node's padding+border,
 * which is only correct for a border-box size — so the container measured 80.
 *
 * It renders its own measured height so a screenshot carries the number.
 */
function ContainerPaddingMRE(): React.Node {
  const [measured, setMeasured] = React.useState<number | null>(null);
  return (
    <View>
      <View
        onLayout={e => setMeasured(e.nativeEvent.layout.height)}
        // $FlowExpectedError[incompatible-type] grid style keys
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
          padding: 20,
          borderWidth: 1,
          borderColor: DEMO_THEME.fg,
          alignSelf: 'flex-start',
          width: 300,
        }}>
        <View style={{height: 20, backgroundColor: SWATCHES[0]}} />
        <View style={{height: 20, backgroundColor: SWATCHES[1]}} />
      </View>
      <Text
        style={{
          fontSize: 13,
          marginTop: 8,
          color: DEMO_THEME.fg,
          fontWeight: '600',
        }}>
        measured height: {measured == null ? '…' : measured.toFixed(1)}pt
        {'  '}
        <Text style={{color: DEMO_THEME.muted, fontWeight: '400'}}>
          (Safari: 62.0pt — 20 padding + 20 row + 20 padding + 2 border)
        </Text>
      </Text>
    </View>
  );
}

export default {
  title: 'Grid',
  category: 'Layout',
  description:
    'CSS Grid (css-grid-2) in the layout engine: track lists written as CSS, ' +
    'repeat() with auto-fill and auto-fit, spanning, explicit line placement, ' +
    'and box alignment. Layouts ported from WebKit’s Field Guide.',
  examples: [
    {
      title: 'Three equal columns',
      name: 'basic',
      description: 'The simplest grid: `1fr 1fr 1fr` with a gap.',
      render: (): React.Node => (
        <DemoContent
          code={
            "<View style={{\n" +
            "  display: 'grid',\n" +
            "  gridTemplateColumns: '1fr 1fr 1fr',\n" +
            '  gap: 10,\n' +
            '}}>'
          }>
          <View
            // $FlowExpectedError[incompatible-type] grid style keys
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 10,
            }}>
            {[0, 1, 2].map(i => (
              <Cell key={i} index={i} />
            ))}
          </View>
        </DemoContent>
      ),
    },
    {
      title: 'Responsive gallery — repeat(auto-fill, minmax())',
      name: 'autofill',
      description:
        'The idiom every WebKit demo uses. The track COUNT follows the ' +
        'container width; no breakpoint is declared anywhere. Rotate the ' +
        'device to see the column count change.',
      render: (): React.Node => (
        <DemoContent
          code={
            "gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))'"
          }>
          <View
            // $FlowExpectedError[incompatible-type] grid style keys
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
              gap: 10,
            }}>
            {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
              <Cell key={i} index={i} />
            ))}
          </View>
        </DemoContent>
      ),
    },
    {
      title: 'auto-fill vs auto-fit',
      name: 'autofit',
      description:
        'Same tracks, three items. auto-fill KEEPS the empty tracks, so the ' +
        'items stay narrow; auto-fit COLLAPSES them, so the items share the ' +
        'whole width. This is the only case where the two differ.',
      render: (): React.Node => (
        <DemoContent
          code={
            "// auto-fill: empty tracks remain\n" +
            "gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))'\n" +
            '\n' +
            '// auto-fit: empty tracks collapse\n' +
            "gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))'"
          }>
          <Text style={{color: DEMO_THEME.muted, fontSize: 12, marginBottom: 4}}>
            auto-fill
          </Text>
          <View
            // $FlowExpectedError[incompatible-type] grid style keys
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
              gap: 8,
              marginBottom: 12,
            }}>
            {[0, 1, 2].map(i => (
              <Cell key={i} index={i} height={32} />
            ))}
          </View>
          <Text style={{color: DEMO_THEME.muted, fontSize: 12, marginBottom: 4}}>
            auto-fit
          </Text>
          <View
            // $FlowExpectedError[incompatible-type] grid style keys
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))',
              gap: 8,
            }}>
            {[0, 1, 2].map(i => (
              <Cell key={i} index={i} height={32} />
            ))}
          </View>
        </DemoContent>
      ),
    },
    {
      title: 'Newspaper — spanning items',
      name: 'newspaper',
      description:
        'WebKit’s Newspaper demo: a lead article spanning three tracks, a ' +
        'secondary spanning two, the rest flowing around them.',
      render: (): React.Node => (
        <DemoContent
          code={
            "gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))'\n" +
            "// lead:      gridColumnEnd: 'span 3'\n" +
            "// secondary: gridColumnEnd: 'span 2'"
          }>
          <View
            // $FlowExpectedError[incompatible-type] grid style keys
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))',
              gap: 8,
            }}>
            <View
              // $FlowExpectedError[incompatible-type] grid style keys
              style={{
                gridColumnEnd: 'span 3',
                backgroundColor: SWATCHES[0],
                borderRadius: 6,
                height: 64,
                justifyContent: 'center',
                paddingHorizontal: 8,
              }}>
              <Text style={{fontSize: 13, fontWeight: '700', color: '#1a1a1a'}}>
                Lead story
              </Text>
              <Text style={{fontSize: 11, color: '#1a1a1a'}}>span 3</Text>
            </View>
            <View
              // $FlowExpectedError[incompatible-type] grid style keys
              style={{
                gridColumnEnd: 'span 2',
                backgroundColor: SWATCHES[1],
                borderRadius: 6,
                height: 64,
                justifyContent: 'center',
                paddingHorizontal: 8,
              }}>
              <Text style={{fontSize: 12, fontWeight: '600', color: '#1a1a1a'}}>
                Secondary
              </Text>
              <Text style={{fontSize: 11, color: '#1a1a1a'}}>span 2</Text>
            </View>
            {[2, 3, 4, 5].map(i => (
              <Cell key={i} index={i} height={64} label={`Story ${i - 1}`} />
            ))}
          </View>
        </DemoContent>
      ),
    },
    {
      title: 'Recipes — a full-bleed header',
      name: 'recipes',
      description:
        'WebKit’s Recipes demo pins its header across every track with ' +
        '`grid-column: 1 / -1`. Line -1 counts from the end, so the header ' +
        'spans the grid however many tracks it has.',
      render: (): React.Node => (
        <DemoContent
          code={
            "gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))'\n" +
            '// header: gridColumnStart: 1, gridColumnEnd: -1'
          }>
          <View
            // $FlowExpectedError[incompatible-type] grid style keys
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
              gap: 8,
            }}>
            <View
              // $FlowExpectedError[incompatible-type] grid style keys
              style={{
                gridColumnStart: 1,
                gridColumnEnd: -1,
                backgroundColor: DEMO_THEME.border,
                borderRadius: 6,
                paddingVertical: 8,
                paddingHorizontal: 10,
              }}>
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: '700',
                  color: DEMO_THEME.fg,
                }}>
                Weeknight dinners — 1 / -1
              </Text>
            </View>
            {[0, 1, 2, 3, 4].map(i => (
              <Cell key={i} index={i} height={56} label={`Recipe ${i + 1}`} />
            ))}
          </View>
        </DemoContent>
      ),
    },
    {
      title: 'Pinboard — mixed heights',
      name: 'pinboard',
      description:
        'Items of differing height in a uniform grid. Rows are as tall as ' +
        'their tallest item, which is what distinguishes a grid from the ' +
        'grid-lanes waterfall, where each column packs independently.',
      render: (): React.Node => (
        <DemoContent
          code={"gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))'"}>
          <View
            // $FlowExpectedError[incompatible-type] grid style keys
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
              gap: 8,
            }}>
            {[40, 72, 56, 88, 48, 64].map((h, i) => (
              <Cell key={i} index={i} height={h} label={`${h}pt`} />
            ))}
          </View>
        </DemoContent>
      ),
    },
    {
      title: 'Mega menu — fixed sides around an auto-fill run',
      name: 'megamenu',
      description:
        'A fixed rail on each side with the middle filled responsively: ' +
        '`60px repeat(auto-fill, minmax(70px, 1fr)) 60px`. The repetitions ' +
        'get what is left after the fixed tracks and every gap.',
      render: (): React.Node => (
        <DemoContent
          code={
            "gridTemplateColumns:\n" +
            "  '60px repeat(auto-fill, minmax(70px, 1fr)) 60px'"
          }>
          <View
            // $FlowExpectedError[incompatible-type] grid style keys
            style={{
              display: 'grid',
              gridTemplateColumns:
                '60px repeat(auto-fill, minmax(70px, 1fr)) 60px',
              gap: 8,
            }}>
            {[0, 1, 2, 3, 4, 5].map(i => (
              <Cell key={i} index={i} height={40} />
            ))}
          </View>
        </DemoContent>
      ),
    },
    {
      title: 'Explicit rows and mixed track types',
      name: 'explicit',
      description:
        'Rows can be sized too, and a track list can mix fixed, fractional ' +
        'and minmax() sizes.',
      render: (): React.Node => (
        <DemoContent
          code={
            "gridTemplateColumns: '80px 1fr minmax(60px, 2fr)'\n" +
            "gridTemplateRows: '40px 64px'"
          }>
          <View
            // $FlowExpectedError[incompatible-type] grid style keys
            style={{
              display: 'grid',
              gridTemplateColumns: '80px 1fr minmax(60px, 2fr)',
              gridTemplateRows: '40px 64px',
              gap: 8,
            }}>
            {[0, 1, 2, 3, 4, 5].map(i => (
              <Cell key={i} index={i} label={`${i + 1}`} />
            ))}
          </View>
        </DemoContent>
      ),
    },
    {
      title: 'Box alignment inside tracks',
      name: 'alignment',
      description:
        'justify-items and align-items place an item within its track. ' +
        '`stretch` is the default and fills it.',
      render: (): React.Node => (
        <DemoContent
          code={"justifyItems: 'center', alignItems: 'center'"}>
          <View
            // $FlowExpectedError[incompatible-type] grid style keys
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gridTemplateRows: '64px',
              gap: 8,
              justifyItems: 'center',
              alignItems: 'center',
            }}>
            {[0, 1, 2].map(i => (
              <View
                key={i}
                style={{
                  width: 40,
                  height: 24,
                  borderRadius: 4,
                  backgroundColor: SWATCHES[i],
                }}
              />
            ))}
          </View>
        </DemoContent>
      ),
    },
    {
      title: 'Container padding (regression guard)',
      name: 'padding-mre',
      description:
        'A padded grid container around a single 20pt row. The height must ' +
        'be padding + row + padding + borders. This guards a fixed bug where ' +
        'the container was floored at its own padding+border and measured too ' +
        'tall.',
      render: (): React.Node => (
        <DemoContent
          code={
            "<View style={{\n" +
            "  display: 'grid',\n" +
            "  gridTemplateColumns: '1fr 1fr',\n" +
            '  gap: 10,\n' +
            '  padding: 20,\n' +
            '  borderWidth: 1,\n' +
            '}}>'
          }>
          <ContainerPaddingMRE />
        </DemoContent>
      ),
    },
    {
      // Read by packages/rn-tester/scripts/grid-cdp-verify.js on a real
      // device or simulator: the same relations the Fantom suite asserts,
      // re-checked through the actual platform layout pass.
      title: 'Track geometry (verified on device)',
      name: 'verify',
      render: (): React.Node => (
        <View>
          <ThemingNote>
            Swatch colors are fixed on purpose — they are the subject of the
            demo, not chrome, and must read identically in light and dark.
          </ThemingNote>
          <GridVerifyCase />
        </View>
      ),
    },
  ],
} as RNTesterModule;
