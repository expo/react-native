/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import {
  GALLERY_COLUMNS,
  galleryFoldTracks,
  galleryTilePlacement,
} from '../../../../astryx-demo/src/galleryLayout';
import {jsx} from '../jsx-runtime';
// TypeScript vendor sources are compiled by Metro, rather than checked by Flow.
// $FlowExpectedError[cannot-resolve-module]
import {Grid} from '../vendor/Grid';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

it('reflows a mounted gallery between cover, unfolded, and hinge-pane widths', () => {
  const root = Fantom.createRoot();
  const tiles: Array<{current: $FlowFixMe}> = Array.from({length: 8}, () =>
    React.createRef(),
  );
  for (const [width, expectedColumns] of [
    [382, 2],
    [585, 4],
    [669, 4],
    [842, 4],
    [421, 2],
    [1376, 4],
  ]) {
    Fantom.runTask(() =>
      root.render(
        <Grid columns={GALLERY_COLUMNS} width={width - 32} gap={3}>
          {tiles.map((ref, index) =>
            jsx(
              'div',
              {
                ref,
                style: {height: 120, minWidth: 0},
                children: `Template ${index}`,
              },
              index,
            ),
          )}
        </Grid>,
      ),
    );
    const rects = tiles.map(ref => ref.current.getBoundingClientRect());
    expect(rects.filter(rect => rect.y === rects[0].y)).toHaveLength(
      expectedColumns,
    );
    expect(rects.every(rect => rect.x >= 0 && rect.right <= width - 32)).toBe(
      true,
    );
  }
});

it('keeps four shared rows with two tiles on each side of the hinge', () => {
  const root = Fantom.createRoot();
  const tiles: Array<{current: $FlowFixMe}> = Array.from({length: 12}, () =>
    React.createRef(),
  );
  for (const [x, width, hingeX, hingeWidth] of [
    [0, 951, 465, 22],
    [0, 867, 465, 22],
    [84, 867, 465, 22],
    [0, 585, 325, 16],
    [0, 951, 455, 42],
  ]) {
    const tracks = galleryFoldTracks(
      {x, width},
      {x: hingeX, width: hingeWidth},
    );
    Fantom.runTask(() =>
      root.render(
        <>
          {jsx('div', {
            style: {paddingLeft: x + 16, width: x + width},
            children: (
              <Grid
                columns={GALLERY_COLUMNS}
                width={width - 32}
                gap={3}
                style={{gridTemplateColumns: tracks}}>
                {tiles.map((ref, index) =>
                  jsx(
                    'div',
                    {
                      ref,
                      style: {
                        height: 100 + (index % 4) * 15,
                        minWidth: 0,
                        ...galleryTilePlacement(index),
                      },
                      children: `Template ${index}`,
                    },
                    index,
                  ),
                )}
              </Grid>
            ),
          })}
        </>,
      ),
    );
    const rects = tiles.map(ref => ref.current.getBoundingClientRect());
    for (let row = 0; row < 3; row++) {
      const cells = rects.slice(row * 4, row * 4 + 4);
      expect(cells.every(rect => rect.y === cells[0].y)).toBe(true);
      expect(cells[1].right).toBeLessThanOrEqual(hingeX - 16);
      expect(cells[2].left).toBeGreaterThanOrEqual(hingeX + hingeWidth + 16);
      expect(cells[0].left).toBeGreaterThanOrEqual(x + 16);
      expect(cells[3].right).toBeLessThanOrEqual(x + width - 16);
    }
  }
});
