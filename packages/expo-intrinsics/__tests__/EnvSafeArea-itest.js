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
 * `env(safe-area-inset-*)` resolves during LAYOUT, from the surface.
 *
 * The claim worth testing is not that the number is right — a JavaScript API can
 * be right too — but that it is right in the first layout, without a render, and
 * that it FOLLOWS a change even through the walk that deliberately skips
 * subtrees whose configuration has not moved. All three are asserted here.
 *
 * Fantom is the instrument because it runs the real renderer: these numbers come
 * out of the same Yoga pass that runs on a device, not out of a mock. What it
 * cannot see is the platform — so the safe area is stated by the test rather
 * than measured from a window, which is exactly the seam
 * `LayoutContext.environmentValues` exists to provide.
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
        <View ref={probe} style={{height: env('safe-area-inset-bottom', 24)}} />,
      );
    });

    // 34, not 24. css-values-4 §5: the second argument is what the length
    // computes to when the variable is UNAVAILABLE, not a default that a
    // smaller published value loses to.
    //
    // Asserted against a surface that publishes 34 rather than one that
    // publishes nothing, because a surface with no insets resolves to zero —
    // and zero is also what a completely broken `env()` produces, so that
    // version of this test could not tell the two apart.
    expect(heightOf(probe)).toBe(34);
  });

  it('answers zero, not the fallback, on a surface that reports no inset', () => {
    const probe = createRef<HostInstance | null>();
    // Every device without a home indicator. The surface HAS answered — the
    // answer is zero — which is a different thing from never having been asked.
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View ref={probe} style={{height: env('safe-area-inset-bottom', 24)}} />,
      );
    });

    // A browser gives 0 here too. Reading it as "unpublished" and handing back
    // 24 would put a mysterious gap at the bottom of every screen on exactly the
    // devices least likely to be tested on.
    //
    // Not vacuous only because the test above proves the same expression
    // resolves to 34 when the surface publishes 34: together they show the value
    // is being read rather than dropped.
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

    // The child starts BELOW the padding, which is what "the safe area entered
    // layout" means. A value that arrived as anything other than a length would
    // leave this at 0.
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
              style={{height: env('safe-area-inset-top'), backgroundColor: color}}
            />
          </View>,
        );
      });
    };

    render('red');
    expect(heightOf(probe)).toBe(59);

    // A clone rebuilds its Yoga style from PROPS, and props carry only each
    // `env()`'s fallback — so a clone that did not re-resolve would collapse to
    // zero the moment anything unrelated about it changed. Changing a colour is
    // the smallest way to ask that question.
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

    // A rotation, in effect. Nothing about the ELEMENT changed, and the
    // configure walk skips a subtree whose configuration has not moved — so
    // this is the assertion that the per-node environment generation actually
    // works. Without it the height would stay at 59 forever.
    Fantom.runOnUIThread(() => {
      root.setSafeAreaInsets({top: 0, bottom: 21});
    });
    Fantom.runWorkLoop();

    expect(heightOf(probe)).toBe(0);
  });
});
