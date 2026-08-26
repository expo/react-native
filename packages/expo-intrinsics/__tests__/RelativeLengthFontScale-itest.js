/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 * @flow strict-local
 * @format
 */

/**
 * A length in `em` follows the user's text-size setting, because the text it is
 * proportional to does.
 *
 * The web has no equivalent: a browser's `em` resolves against the computed
 * font size and nothing further applies. On iOS and Android the platform
 * reports a multiplier for the reader's chosen text size, and the text layer
 * applies it when it draws, so an element's computed size and the size it is
 * drawn at are two different numbers. Which one an `em` multiplies depends on
 * what is being resolved: a font size must use the unscaled one, because the
 * multiplier is applied to the result later; a margin must use the scaled one,
 * because layout is the last word on it. Either error is invisible at the
 * default text size.
 *
 * Fantom's text measurer ignores the multiplier (a 20pt run measures 26pt at
 * every setting), so this file pins the layout arithmetic and nothing about the
 * text agreeing with it; that agreement is a device fact. Do not add a case
 * here that claims to check the text; it will pass for the wrong reason.
 *
 * A heading resolves through `TextRoleMetrics`, whose sizes are published
 * already scaled; everything else resolves against the cascade's size and
 * must apply the multiplier itself, or at the largest accessibility size a
 * paragraph is 72pt of text with a 17pt gap.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';

const BORDER = 1;

/*
 * A style, as these helpers pass one around.
 *
 * An indexer rather than a named set of keys, because the whole point is to
 * vary which property states the size — and read-only, because nothing here
 * mutates one and Flow will not let an indexed object be passed by value
 * otherwise.
 */
type Style = {readonly [string]: unknown};

/** The resolved block-start margin of a `<View>` carrying `style`. */
function marginAtScale(style: Style, fontSizeMultiplier: number): number {
  const parentRef = createRef<unknown>();
  const childRef = createRef<unknown>();
  const root = Fantom.createRoot({fontSizeMultiplier});
  Fantom.runTask(() => {
    root.render(
      <View collapsable={false}>
        <View
          collapsable={false}
          ref={parentRef}
          style={{borderWidth: BORDER, borderColor: '#000'}}>
          {/* $FlowFixMe[incompatible-type] new style keys */}
          <View collapsable={false} ref={childRef} style={style}>
            {'x'}
          </View>
        </View>
      </View>,
    );
  });
  // $FlowFixMe[incompatible-use]
  const parent = parentRef.current.getBoundingClientRect();
  // $FlowFixMe[incompatible-use]
  const child = childRef.current.getBoundingClientRect();
  root.destroy();
  return child.y - parent.y - BORDER;
}

describe('an em length under the reader’s text-size setting', () => {
  it('scales with the setting', () => {
    // 1em of a 20pt element, at a setting that doubles text: 40.
    expect(marginAtScale({uaMarginBlockEm: 1, fontSize: 20}, 2)).toBeCloseTo(
      40,
      0,
    );
    expect(marginAtScale({uaMarginBlockEm: 1, fontSize: 20}, 3)).toBeCloseTo(
      60,
      0,
    );
  });

  it('is unchanged at the default setting', () => {
    // The control: a multiplier of 1 must leave the authored answer alone, or
    // the fix would be a behaviour change for every reader who never touched
    // the setting.
    expect(marginAtScale({uaMarginBlockEm: 1, fontSize: 20}, 1)).toBeCloseTo(
      20,
      0,
    );
  });

  it('scales a rem length too', () => {
    // `rem` names the root's size, and the root's text scales like any other.
    const atOne = marginAtScale({uaMarginBlockRem: 1}, 1);
    expect(marginAtScale({uaMarginBlockRem: 1}, 2)).toBeCloseTo(2 * atOne, 0);
  });

  it('leaves a margin stated in points alone', () => {
    // The boundary. A length the author gave in points is not proportional to
    // any text, so the setting must not touch it — which is also what stops
    // this from being "scale everything".
    expect(marginAtScale({marginBlock: 20, fontSize: 20}, 3)).toBeCloseTo(
      20,
      0,
    );
  });

  it('is the only lever there is on this path', () => {
    /*
     * `allowFontScaling` and `maxFontSizeMultiplier` are what an element uses
     * to opt out of the setting or cap how far it follows — and both are
     * `<Text>` properties that never reach the element cascade. So on this
     * path the device's multiplier is the whole story, and stating either here
     * changes nothing.
     *
     * Asserted rather than left unsaid, because the obvious reading of the
     * function above is that it honours them. It does not, because it cannot;
     * if they are ever cascaded this test is what will fail and say so.
     */
    const plain = marginAtScale({uaMarginBlockEm: 1, fontSize: 20}, 3);
    expect(
      marginAtScale(
        {uaMarginBlockEm: 1, fontSize: 20, allowFontScaling: false},
        3,
      ),
    ).toBeCloseTo(plain, 0);
    expect(
      marginAtScale(
        {uaMarginBlockEm: 1, fontSize: 20, maxFontSizeMultiplier: 1.5},
        3,
      ),
    ).toBeCloseTo(plain, 0);
  });
});
