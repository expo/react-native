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
 * ## Why this is not a CSS question
 *
 * The web has no equivalent: a browser's `em` resolves against the computed
 * font size and there is nothing further to apply. On iOS and Android there is.
 * The platform reports a multiplier for the reader's chosen text size, and the
 * TEXT layer applies it when it draws — so an element's computed size and the
 * size it is actually drawn at are two different numbers.
 *
 * Which of the two an `em` multiplies depends on what is being resolved:
 *
 *  - a FONT SIZE must use the unscaled one, because the multiplier is applied
 *    to the result later. Scaling it here would apply the setting twice;
 *  - a MARGIN must use the scaled one, because layout is the last word on it.
 *    Nothing scales a margin afterwards.
 *
 * Get that backwards in either direction and the error is invisible at the
 * default text size, which is where it lived.
 *
 * ## The bug this holds
 *
 * A paragraph's `margin-block: 1em` froze while its text grew. Measured on an
 * iOS simulator between the standard text size and the largest accessibility
 * one, before the fix:
 *
 *   heading text    33.67 → 67      (2.0x)
 *   heading margin  18.67 → 37.33   (2.0x)   — followed
 *   paragraph text  20.33 → 72.67   (3.6x)
 *   paragraph margin 16.67 → 17     (1.0x)   — did not
 *
 * ## What Fantom can and cannot see
 *
 * Fantom's text measurer ignores the multiplier — a 20pt run measures 26pt at
 * every setting — so this file pins the LAYOUT arithmetic and nothing about
 * the text agreeing with it. That the two agree is a device fact, and the
 * measurements above are how it was established. Do not add a case here that
 * claims to check the text; it will pass for the wrong reason.
 *
 * A heading resolves through `TextRoleMetrics`, whose sizes are published
 * already scaled, so its margin followed. Everything else resolved against the
 * cascade's unscaled size and stood still. Two spellings of one rule disagreed
 * about the same setting, and only the one naming a platform text role was
 * right. At the largest accessibility size a paragraph was 72pt of text with a
 * 17pt gap — exactly the crowding `TextRoleMetrics.h` describes and exists to
 * prevent.
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

/*
 * Merge a caller's style over the helper's defaults, caller wins.
 *
 * Both sides arrive as `Style` — indexed — on purpose. Flow refuses to spread
 * an indexed object AFTER explicit keys, because the indexer could overwrite
 * them in a way it cannot track, so the defaults cannot be written inline at
 * the spread. Naming them as a parameter makes both operands indexed and the
 * spread legal, with the precedence still stated by the order.
 */
function withDefaults(defaults: Style, style: Style): Style {
  return {...defaults, ...style};
}

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
