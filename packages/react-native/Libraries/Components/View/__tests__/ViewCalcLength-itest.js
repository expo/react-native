/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

/**
 * `calc()`, `min()`, `max()` and `clamp()` with percentages (css-values-4
 * §10) as lengths: layout resolves them against the size the property's
 * percentages are of, as it resolves a percentage.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';

function rectOf(ref: {current: HostInstance | null}): {
  x: number,
  y: number,
  width: number,
  height: number,
} {
  const rect = ref.current?.getBoundingClientRect();
  if (rect == null) {
    throw new Error('The view did not render.');
  }
  return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
}

// A style whose lengths may be math functions, which `DimensionValue` does not
// name
type LengthStyle = {readonly [string]: number | string};

function layout(
  containerStyle: LengthStyle,
  childStyle: LengthStyle,
): {x: number, y: number, width: number, height: number} {
  const child = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[incompatible-type] lengths as math functions
      <View style={containerStyle}>
        {/* $FlowExpectedError[incompatible-type] lengths as math functions */}
        <View ref={child} style={childStyle} />
      </View>,
    );
  });
  const rect = rectOf(child);
  Fantom.runTask(() => root.destroy());
  return rect;
}

const BOX: LengthStyle = {width: 300, height: 200, alignItems: 'flex-start'};

describe('a math function with a percentage is a length', () => {
  test('substitutes both safe-area sides before resolving a percentage width', () => {
    const root = Fantom.createRoot({
      viewportWidth: 466,
      viewportHeight: 678,
      safeAreaInsets: {left: 73, right: 11},
    });
    const child = createRef<HostInstance>();
    function render(width: string) {
      Fantom.runTask(() => {
        root.render(
          // $FlowExpectedError[incompatible-type] lengths as math functions
          <View ref={child} style={{width, height: 100}} />,
        );
      });
    }
    const width =
      'calc(100% - env(safe-area-inset-left) - env(safe-area-inset-right) - 20px)';
    render(width);
    expect(rectOf(child).width).toBe(362);
    Fantom.runTask(() => root.setSafeAreaInsets({left: 0, right: 0}));
    expect(rectOf(child).width).toBe(446);
    // An unrelated props clone must retain the expression's dependency.
    render(width);
    Fantom.runTask(() => root.setSafeAreaInsets({left: 10, right: 20}));
    expect(rectOf(child).width).toBe(416);
    // Replacing the expression removes its environment dependency.
    render('50%');
    Fantom.runTask(() => root.setSafeAreaInsets({left: 73, right: 11}));
    expect(rectOf(child).width).toBe(233);
    Fantom.runTask(() => root.destroy());
  });

  test('substitutes environment values inside nested min and max functions', () => {
    const root = Fantom.createRoot({safeAreaInsets: {left: 62, right: 62}});
    const child = createRef<HostInstance>();
    Fantom.runTask(() => {
      root.render(
        <View style={{width: 874}}>
          <View
            ref={child}
            // $FlowExpectedError[incompatible-type] lengths as math functions
            style={{
              width:
                'min(800px, calc(100% - 2 * max(env(safe-area-inset-left), env(safe-area-inset-right))))',
              height: 10,
            }}
          />
        </View>,
      );
    });
    expect(rectOf(child).width).toBe(750);
    Fantom.runTask(() => root.destroy());
  });
  test('max() caps a width by the larger of its arguments', () => {
    expect(
      layout(BOX, {width: 1000, height: 10, maxWidth: 'max(80%, 280px)'}).width,
    ).toBe(280);
    expect(
      layout(
        {...BOX, width: 400},
        {width: 1000, height: 10, maxWidth: 'max(80%, 280px)'},
      ).width,
    ).toBe(320);
  });

  test('min() is the smaller of its arguments', () => {
    expect(layout(BOX, {width: 'min(100%, 400px)', height: 10}).width).toBe(
      300,
    );
    expect(
      layout({...BOX, width: 500}, {width: 'min(100%, 400px)', height: 10})
        .width,
    ).toBe(400);
  });

  test('calc() adds and subtracts lengths and percentages', () => {
    expect(layout(BOX, {width: 'calc(100% - 20px)', height: 10}).width).toBe(
      280,
    );
    // A height's percentages are of the container's height
    expect(layout(BOX, {width: 10, height: 'calc(50% + 5px)'}).height).toBe(
      105,
    );
    // An inset's are of the container's width or height
    expect(
      layout(BOX, {
        position: 'absolute',
        left: 'calc(50% - 10px)',
        width: 20,
        height: 10,
      }).x,
    ).toBe(140);
  });

  test('calc() multiplies and divides by numbers', () => {
    expect(
      layout(BOX, {width: 'calc((100% - 2 * 10px) / 2)', height: 10}).width,
    ).toBe(140);
  });

  test('clamp() keeps the preferred value between its bounds', () => {
    expect(
      layout(BOX, {width: 'clamp(100px, 50%, 120px)', height: 10}).width,
    ).toBe(120);
    expect(
      layout(BOX, {width: 'clamp(100px, 20%, 120px)', height: 10}).width,
    ).toBe(100);
  });

  test('nested functions resolve from the inside out', () => {
    // Astryx's centred column: half of what the content width leaves over
    expect(
      layout(BOX, {
        marginLeft: 'max(0px, calc((100% - 200px) / 2))',
        width: 200,
        height: 10,
      }).x,
    ).toBe(50);
  });

  test('padding takes its percentages of the container width', () => {
    const inner = createRef<HostInstance>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        // $FlowExpectedError[incompatible-type] lengths as math functions
        <View style={BOX}>
          {/* $FlowExpectedError[incompatible-type] lengths as math functions */}
          <View style={{paddingLeft: 'calc(10% + 2px)', flexDirection: 'row'}}>
            <View ref={inner} style={{width: 10, height: 10}} />
          </View>
        </View>,
      );
    });
    expect(rectOf(inner).x).toBe(32);
  });

  test('without a percentage it is the length it computes to', () => {
    expect(layout(BOX, {width: 'calc(10px + 5px)', height: 10}).width).toBe(15);
  });

  test('a new container size resolves it again', () => {
    const child = createRef<HostInstance>();
    const root = Fantom.createRoot();
    const render = (width: number) =>
      Fantom.runTask(() => {
        root.render(
          // $FlowExpectedError[incompatible-type] lengths as math functions
          <View style={{...BOX, width}}>
            <View
              ref={child}
              style={{width: 1000, height: 10, maxWidth: 'max(80%, 280px)'}}
            />
          </View>,
        );
      });
    render(300);
    expect(rectOf(child).width).toBe(280);
    render(400);
    expect(rectOf(child).width).toBe(320);
  });

  test('sizes a grid track and counts the tracks auto-fill repeats', () => {
    // Astryx's grid that caps its column count at three: each track at least
    // a third of the row less its gaps, so no more than three fit
    const items = [createRef<HostInstance>(), createRef<HostInstance>()];
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View
          style={{
            width: 306,
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fill, minmax(min(100%, max(96px, calc((100% - 2 * 8px) / 3))), 1fr))',
            columnGap: 8,
          }}>
          <View ref={items[0]} style={{height: 20}} />
          <View ref={items[1]} style={{height: 20}} />
        </View>,
      );
    });
    // Three tracks of (306 - 2 * 8) / 3 in a row of 306, the third row-mate
    // starting a gap after the second
    expect(rectOf(items[0]).width).toBeCloseTo(290 / 3, 3);
    expect(rectOf(items[1]).x).toBeCloseTo(290 / 3 + 8, 3);
    expect(rectOf(items[1]).y).toBe(0);
    Fantom.runTask(() => root.destroy());
  });
});
