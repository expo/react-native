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
 * `env(safe-area-inset-*)` resolves during layout, from the surface: right in
 * the first layout without a render, and following a change even through the
 * walk that skips subtrees whose configuration has not moved. Fantom runs the
 * real renderer but cannot see the platform, so the safe area is stated by the
 * test through `LayoutContext.environmentValues`.
 */

import type {HostInstance} from 'react-native';

import env from '../src/env';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

function heightOf(ref: {current: HostInstance | null}): number {
  const node = ref.current;
  if (node == null) {
    throw new Error('the probe was not mounted');
  }
  return node.getBoundingClientRect().height;
}

describe('env(safe-area-inset-*)', () => {
  it('resolves to the surface’s safe area', () => {
    const probe = createRef<HostInstance | null>();
    const root = Fantom.createRoot({
      safeAreaInsets: {top: 59, bottom: 34},
    });

    Fantom.runTask(() => {
      root.render(
        <View ref={probe} style={{height: env('safe-area-inset-top')}} />,
      );
    });

    expect(heightOf(probe)).toBe(59);
  });

  it('ignores the fallback once the surface has published a value', () => {
    const probe = createRef<HostInstance | null>();
    const root = Fantom.createRoot({safeAreaInsets: {bottom: 34}});

    Fantom.runTask(() => {
      root.render(
        <View
          ref={probe}
          style={{height: env('safe-area-inset-bottom', 24)}}
        />,
      );
    });

    // 34, not 24: css-values-4 §5 makes the second argument what the length
    // computes to when the variable is unavailable, not a minimum. A surface
    // publishing 34 rather than nothing, since zero is also what a broken
    // `env()` produces.
    expect(heightOf(probe)).toBe(34);
  });

  it('answers zero, not the fallback, on a surface that reports no inset', () => {
    const probe = createRef<HostInstance | null>();
    // A device without a home indicator: the surface has answered zero, which
    // is not "unpublished"
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          ref={probe}
          style={{height: env('safe-area-inset-bottom', 24)}}
        />,
      );
    });

    // A browser gives 0 here too. Meaningful only with the test above, which
    // shows the same expression reads 34.
    expect(heightOf(probe)).toBe(0);
  });

  it('is a length, so it composes with the rest of the layout', () => {
    const child = createRef<HostInstance | null>();
    const root = Fantom.createRoot({safeAreaInsets: {top: 59}});

    Fantom.runTask(() => {
      root.render(
        <View style={{paddingTop: env('safe-area-inset-top')}}>
          <View ref={child} style={{height: 10}} />
        </View>,
      );
    });

    // The child starts below the padding, which is what "the safe area entered
    // layout" means
    expect(child.current?.getBoundingClientRect().y).toBe(59);
  });

  it('re-resolves for a node that is cloned for an unrelated reason', () => {
    const probe = createRef<HostInstance | null>();
    const root = Fantom.createRoot({safeAreaInsets: {top: 59}});

    const render = (color: string) => {
      Fantom.runTask(() => {
        root.render(
          <View style={{padding: 0}}>
            <View
              ref={probe}
              style={{
                height: env('safe-area-inset-top'),
                backgroundColor: color,
              }}
            />
          </View>,
        );
      });
    };

    render('red');
    expect(heightOf(probe)).toBe(59);

    // A clone rebuilds its Yoga style from props, which carry only each
    // `env()`'s fallback, so a clone that did not re-resolve would collapse
    // the moment anything unrelated changed
    render('blue');
    expect(heightOf(probe)).toBe(59);
  });

  it('follows a change to the surface’s safe area', () => {
    const probe = createRef<HostInstance | null>();
    const root = Fantom.createRoot({safeAreaInsets: {top: 59}});

    Fantom.runTask(() => {
      root.render(
        <View ref={probe} style={{height: env('safe-area-inset-top')}} />,
      );
    });
    expect(heightOf(probe)).toBe(59);

    // A rotation, in effect: nothing about the element changed, and the
    // configure walk skips a subtree whose configuration has not moved, so
    // this asserts the per-node environment generation
    Fantom.runOnUIThread(() => {
      root.setSafeAreaInsets({top: 0, bottom: 21});
    });
    Fantom.runWorkLoop();

    expect(heightOf(probe)).toBe(0);
  });
});

describe('env() inside calc()', () => {
  function renderedHeight(height: string): number {
    const probe = createRef<HostInstance | null>();
    const root = Fantom.createRoot({safeAreaInsets: {top: 59, bottom: 34}});
    Fantom.runTask(() => {
      // $FlowExpectedError[incompatible-type] a calc() string length
      root.render(<View ref={probe} style={{height}} />);
    });
    return heightOf(probe);
  }

  it('adds a pixel length to the inset', () => {
    expect(renderedHeight('calc(env(safe-area-inset-top) + 8px)')).toBe(67);
  });

  it('accepts the length on either side', () => {
    expect(renderedHeight('calc(8px + env(safe-area-inset-bottom))')).toBe(42);
  });

  it('subtracts a pixel length from the inset', () => {
    expect(renderedHeight('calc(env(safe-area-inset-bottom) - 4px)')).toBe(30);
  });

  it('computes to nothing for any other expression', () => {
    expect(renderedHeight('calc(env(safe-area-inset-bottom) * 2)')).toBe(0);
  });
});
