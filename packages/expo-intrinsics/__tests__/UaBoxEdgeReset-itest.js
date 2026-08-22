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
 * An author's box reset beats the user-agent sheet, whatever it is spelled.
 *
 * The two layers merge by KEY — the renderer hands the element
 * `[uaStyle, authorStyle]` — and that is the cascade only while both spell an
 * edge the same way. Where they differ, Yoga decides by EDGE SPECIFICITY, and
 * a more specific edge wins there regardless of which layer stated it or in
 * what order. So `<ol>`'s user-agent `paddingInlineStart: 40` survived an
 * author's `padding: 0`, which is the reset every ported design system
 * writes: Tailwind's preflight, shadcn's, and the vendored Astryx Stepper
 * whose vertical list sat 40pt further right than everything around it.
 *
 * On the web `padding: 0` cancels `padding-inline-start` outright — it is a
 * shorthand, it sets all four longhands, and it comes later.
 */

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

/** Where the list's content starts, which is what the gutter moves. */
function contentX(style: unknown): number {
  const probe = createRef<HostInstance | null>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View style={{width: 300}}>
        {/* $FlowFixMe[prop-missing] intrinsic <ol> tag */}
        <ol style={style}>
          <View ref={probe} style={{width: 10, height: 10}} />
        </ol>
      </View>,
    );
  });
  const node = probe.current;
  if (node == null) {
    throw new Error('not mounted');
  }
  return node.getBoundingClientRect().x;
}

describe("a list's user-agent marker gutter", () => {
  it('applies when the author says nothing about padding', () => {
    // The guard for the fix itself: masking must not cancel a sheet the
    // author never argued with.
    expect(contentX(undefined)).toBeGreaterThan(0);
  });

  it('is cancelled by `padding: 0`, the reset design systems write', () => {
    expect(contentX({padding: 0})).toBe(0);
  });

  it('is cancelled through an array of styles', () => {
    // React Native accepts nested arrays, and a component that merges a reset
    // with a caller's style produces exactly that.
    expect(contentX([{padding: 0}, null])).toBe(0);
  });

  it('is replaced, not merely removed, by a non-zero author padding', () => {
    expect(contentX({padding: 8})).toBe(8);
  });

  it('is still cancelled by the same spelling the sheet used', () => {
    expect(contentX({paddingInlineStart: 0})).toBe(0);
  });

  it('survives a claim on one physical edge only', () => {
    /*
     * `paddingLeft` claims `left`, and the sheet stated `paddingInlineStart` —
     * different edges until a direction resolves, which is after this runs.
     * A browser would cancel it here in a left-to-right list, so this is a
     * deliberate under-claim: it errs towards leaving the sheet alone rather
     * than towards dropping a declaration the author did not replace.
     * DOM-CSS-LIMITATION(physical-edge-does-not-claim-flow-relative)
     */
    expect(contentX({paddingLeft: 0})).toBeGreaterThan(0);
  });
});
