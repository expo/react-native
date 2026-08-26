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
 * `em` and `rem` in a block MARGIN, against css-values-4 §5.1.1.
 *
 * A margin's `em` and a font-size's `em` are different questions one step
 * apart, and the difference is the base:
 *
 *   font-size: 2em    → 2 × the size the element INHERITED
 *   margin-block: 1em → 1 × the size the element COMPUTED for itself
 *
 * So on an element that resizes itself — `<pre>`, every heading — the two
 * multiply different numbers, and an implementation that used one base for
 * both looks correct on every element that does not. `HeadingMargins-itest`
 * covers that pairing where a platform text role decides the size; this file
 * covers it where the cascade does, and covers `rem`, which nothing in the
 * user-agent sheet uses and which would otherwise go untested.
 *
 * Margins are measured on the PARENT: an element's own rect is its border box
 * and never includes them. The parent carries a border, because a border is
 * what stops a margin collapsing through its edge (CSS 2.1 §8.3.1) — without
 * one the margin escapes upward and the child measures flush.
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

/**
 * The resolved block-start margin of a `<View>` carrying `style`, in points.
 */
function marginOf(style: Style, outer?: Style): number {
  const parentRef = createRef<unknown>();
  const childRef = createRef<unknown>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[incompatible-type] new style keys
      <View collapsable={false} style={withDefaults({}, outer ?? {})}>
        <View
          collapsable={false}
          ref={parentRef}
          style={{borderWidth: BORDER, borderColor: '#000'}}>
          {/* $FlowFixMe[incompatible-type] */}
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

describe('a block margin in em', () => {
  it('multiplies the element’s own computed font size', () => {
    // Stated on the element, so its own size is the base and the parent's is
    // not involved at all.
    expect(marginOf({uaMarginBlockEm: 1, fontSize: 30})).toBeCloseTo(30, 0);
    expect(marginOf({uaMarginBlockEm: 0.5, fontSize: 30})).toBeCloseTo(15, 0);
    expect(marginOf({uaMarginBlockEm: 2, fontSize: 7})).toBeCloseTo(14, 0);
  });

  it('follows a size the element inherited', () => {
    // The element states no size of its own, so its computed size is the one
    // above it — and the margin has to move with it.
    expect(marginOf({uaMarginBlockEm: 1}, {fontSize: 24})).toBeCloseTo(24, 0);
    expect(marginOf({uaMarginBlockEm: 1}, {fontSize: 48})).toBeCloseTo(48, 0);
  });

  it('resolves against a size that is itself an em', () => {
    /*
     * The compounding case, which is the whole reason the base has to be the
     * element's COMPUTED size rather than anything the stylesheet could have
     * multiplied out: 40 → `0.5em` → 20 → `1em` margin → 20.
     *
     * Using the inherited size for the margin, as the sheet did, would give 40
     * here — twice the answer, on the element `<pre>` actually is.
     */
    expect(
      marginOf({uaMarginBlockEm: 1, fontSizeEm: 0.5}, {fontSize: 40}),
    ).toBeCloseTo(20, 0);
  });

  it('is not the root’s size', () => {
    /*
     * `em` and `rem` agree exactly when the element's size IS the root's, so
     * the only way to tell them apart is to make it something else. A `rem`
     * here would hold still across both rows.
     */
    const small = marginOf({uaMarginBlockEm: 1}, {fontSize: 12});
    const large = marginOf({uaMarginBlockEm: 1}, {fontSize: 48});
    expect(large).toBeCloseTo(4 * small, 0);
  });
});

describe('a block margin in rem', () => {
  it('ignores the element’s own size and the inherited one', () => {
    // One number for the whole document, whatever it is nested inside and
    // whatever the element states for itself.
    const bare = marginOf({uaMarginBlockRem: 1});
    expect(marginOf({uaMarginBlockRem: 1}, {fontSize: 48})).toBeCloseTo(
      bare,
      0,
    );
    expect(marginOf({uaMarginBlockRem: 1, fontSize: 48})).toBeCloseTo(bare, 0);
  });

  it('scales by its factor', () => {
    // Asserted as a ratio, so the platform's own root size stays out of it:
    // 17 on iOS, 16 on Android, and this must pass on both.
    const one = marginOf({uaMarginBlockRem: 1});
    expect(one).toBeGreaterThan(0);
    expect(marginOf({uaMarginBlockRem: 2})).toBeCloseTo(2 * one, 0);
    expect(marginOf({uaMarginBlockRem: 0.5})).toBeCloseTo(0.5 * one, 0);
  });

  it('differs from em wherever the element is not at the root’s size', () => {
    // The pair that would be indistinguishable anywhere else.
    const outer = {fontSize: 48};
    expect(marginOf({uaMarginBlockEm: 1}, outer)).not.toBeCloseTo(
      marginOf({uaMarginBlockRem: 1}, outer),
      0,
    );
  });
});

describe('the cascade’s origins', () => {
  it('an author’s margin beats either unit', () => {
    /*
     * Both of these are user-agent channels; an author writes `marginBlock`.
     * The renderer checks for an author's block margin before writing anything
     * of its own, which is what lets a user-agent default lose here — the
     * precedence a UA sheet has on the web, and the one that merging both into
     * a single `style` cannot express.
     */
    expect(
      marginOf({uaMarginBlockEm: 1, fontSize: 30, marginBlock: 3}),
    ).toBeCloseTo(3, 0);
    expect(marginOf({uaMarginBlockRem: 1, marginTop: 7})).toBeCloseTo(7, 0);
    // Zero is a stated value, not an absent one.
    expect(
      marginOf({uaMarginBlockEm: 1, fontSize: 30, marginBlock: 0}),
    ).toBeCloseTo(0, 0);
  });

  it('an element with neither factor is untouched', () => {
    expect(marginOf({fontSize: 30})).toBeCloseTo(0, 0);
  });
});
