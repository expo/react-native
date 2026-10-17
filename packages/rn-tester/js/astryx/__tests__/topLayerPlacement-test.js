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

import {placeInTopLayer} from '../overlay/topLayerPlacement';

const viewport = {width: 402, height: 800};
// A sort button at the right of a toolbar, as in Library
const anchor = {x: 300, y: 224, width: 76, height: 36};
const menu = {width: 80, height: 130};

describe('placing an element in the top layer', () => {
  it('puts a menu under its trigger, end edges aligned, past the clearance', () => {
    // Astryx's DropdownMenu, placement "below", alignment "end"
    expect(
      placeInTopLayer({
        style: {
          positionAnchor: '--layer',
          positionArea: 'self-block-end span-self-inline-start',
          positionTryFallbacks:
            'flip-block, flip-inline, flip-block flip-inline',
          marginTop: 4,
          marginBottom: 8,
        },
        size: menu,
        anchor,
        viewport,
      }),
    ).toEqual({x: 300 + 76 - 80, y: 224 + 36 + 4});
  });

  it('flips above its trigger when there is no room below', () => {
    const low = {...anchor, y: 700};
    expect(
      placeInTopLayer({
        style: {
          positionArea: 'self-block-end span-self-inline-start',
          positionTryFallbacks:
            'flip-block, flip-inline, flip-block flip-inline',
          marginTop: 4,
          marginBottom: 8,
        },
        size: menu,
        anchor: low,
        viewport,
      }),
    ).toEqual({x: 300 + 76 - 80, y: 700 - 130 - 4});
  });

  it('keeps a layer that fits nowhere inside the viewport', () => {
    const wide = {width: 500, height: 100};
    const at = placeInTopLayer({
      style: {
        positionArea: 'self-block-end span-self-inline-end',
        positionTryFallbacks: 'flip-block, --astryx-slide-below-start-same',
        marginBottom: 8,
        // The viewport gutter on both inline edges, as Astryx's slide keeps
        marginLeft: 8,
        marginRight: 8,
      },
      size: wide,
      anchor,
      viewport,
    });
    expect(at.x).toBe(8);
    expect(at.y).toBe(224 + 36);
  });

  it('keeps each side its own gutter, and flips the margins with the area', () => {
    // A block gutter far larger than the inline one: the menu still sits
    // flush with its trigger's end edge, 8 from the viewport's right
    const at = placeInTopLayer({
      style: {
        positionArea: 'self-block-end span-self-inline-start',
        positionTryFallbacks: 'flip-block',
        marginTop: 4,
        marginBottom: 62,
        marginLeft: 8,
      },
      size: menu,
      anchor: {...anchor, y: 600},
      viewport,
    });
    // Below would leave less than the 62 gutter under it: flipped above, the
    // gutter moves to the top and the clearance to the bottom
    expect(at).toEqual({x: 300 + 76 - 80, y: 600 - 130 - 4});
  });

  it('places an element with no anchor at its own insets', () => {
    expect(
      placeInTopLayer({
        style: {right: 16, bottom: 24},
        size: {width: 200, height: 50},
        anchor: null,
        viewport,
      }),
    ).toEqual({x: 402 - 16 - 200, y: 800 - 24 - 50});
  });

  it('centres a modal dialog in the viewport by its inset: 0 and margin: auto', () => {
    expect(
      placeInTopLayer({
        style: {margin: 'auto'},
        size: {width: 300, height: 200},
        anchor: null,
        viewport: {width: 400, height: 800},
        defaultInset: 0,
      }),
    ).toEqual({x: 50, y: 300});
  });
});
