/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:true
 * @fantom_flags enableYogaDisplayBlock:true
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import {uaStyleFor} from '../src/uaStyles';
import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

/*
 * A `<button>` centres its content on both axes, which is why a radio's dot
 * and a checkbox's tick sit in the middle of their box on the web without the
 * markup saying anything about alignment. The block axis is `align-content`
 * from the UA sheet (css-align-3 §5.3); the inline axis is `text-align`.
 *
 * The numbers are Safari's, measured on the same markup at a 402pt viewport:
 * a 16x16 bordered radio puts its 10pt indicator at (3, 3).
 */
function offsetInParent(
  child: {current: HostInstance | null},
  parent: {current: HostInstance | null},
): {left: number, top: number} {
  const c = nullthrows(child.current).getBoundingClientRect();
  const p = nullthrows(parent.current).getBoundingClientRect();
  return {left: c.left - p.left, top: c.top - p.top};
}

test('a block-container button centres its content', () => {
  const root = Fantom.createRoot();
  const button = createRef<HostInstance>();
  const indicator = createRef<HostInstance>();

  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] intrinsic
      <div
        style={{
          width: 300,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
        }}>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <button
          ref={button}
          // `padding: 0` because this models a CONTROL, and a control owns its
          // own geometry. `<button>`'s user-agent inset (BUTTON_INSET) is for
          // a button with a label in it; an indicator that states its own 16pt
          // box would be inset inside itself by it.
          style={{width: 16, height: 16, borderWidth: 1, padding: 0}}>
          {/* The radio's indicator: an unsized box, so it fills the content
              width as any block box does and centres the dot on the inline
              axis itself. The block axis is the button's to give. */}
          {/* $FlowFixMe[prop-missing] intrinsic */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            {/* $FlowFixMe[prop-missing] intrinsic */}
            <div ref={indicator} style={{width: 10, height: 10}} />
          </div>
        </button>
      </div>,
    );
  });

  expect(offsetInParent(indicator, button)).toEqual({left: 3, top: 3});
});

test('an author flex button keeps its own alignment', () => {
  const root = Fantom.createRoot();
  const track = createRef<HostInstance>();
  const thumb = createRef<HostInstance>();

  // A switch: the thumb's whole job is to sit at one end of the track, so the
  // UA centring must not reach it.
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] intrinsic
      <button
        ref={track}
        style={{
          display: 'inline-flex',
          width: 44,
          height: 24,
          borderWidth: 2,
          alignItems: 'center',
          // See the note above: a switch track sizes itself, so the user-agent
          // button inset must not apply to it.
          padding: 0,
        }}>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <div ref={thumb} style={{width: 20, height: 20}} />
      </button>,
    );
  });

  const offset = offsetInParent(thumb, track);
  expect(offset.left).toBe(2);
  expect(offset.top).toBe(2);
});

/*
 * The expected numbers are READ FROM THE SHEET rather than written here again.
 *
 * `<button>`'s inset and minimum are each platform's own — measured from UIKit
 * and from the Android framework — so they differ by platform, and Fantom runs
 * the Android branch. Restating either set here would make this file assert the
 * platform it happens to run on, which is how it would come to be edited to
 * match whatever it printed.
 *
 * What this file is for is the PLUMBING: that the sheet reaches the box at all,
 * that the content centres inside it, and that an author's declaration
 * withdraws the user-agent one. The numbers themselves are pinned against the
 * platform measurements in `buttonMetrics-test.js`.
 */
const UA = uaStyleFor('button');
const UA_INSET_INLINE = Number(UA.paddingInline);
const UA_MIN_HEIGHT = Number(UA.minHeight);

function measureButton(style: {[string]: number}): {
  offset: {left: number, top: number},
  height: number,
} {
  const root = Fantom.createRoot();
  const button = createRef<HostInstance>();
  const inner = createRef<HostInstance>();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] intrinsic
      <button ref={button} style={style}>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <div ref={inner} style={{width: 10, height: 10}} />
      </button>,
    );
  });
  return {
    offset: offsetInParent(inner, button),
    height: nullthrows(button.current).getBoundingClientRect().height,
  };
}

test('a button insets its content, and an author padding replaces that inset', () => {
  /*
   * The second half is the one that needs guarding. A user-agent declaration is
   * a lower cascade origin than an author's, but React Native has no origins:
   * `paddingInline` is applied unconditionally by `applyAliasedProps`, so it
   * would beat `style={{padding: 0}}` and the cascade would run backwards. The
   * element withdraws its padding when the author states any — see
   * `authorStates`. Without it this test reads 14, not 4.
   */
  expect(measureButton({borderWidth: 0}).offset.left).toBe(UA_INSET_INLINE);
  expect(measureButton({borderWidth: 0, padding: 4}).offset.left).toBe(4);
});

test('a button is at least a touch target tall, and centres its content in it', () => {
  /*
   * 44 is the HIG's minimum touch target, and a `<button>`'s box IS its touch
   * target here, so the two are one number. It is deliberately NOT UIKit's own
   * button height: UIKit applies no minimum at all — a one-character gray
   * button fits 34.33 tall — because 44 is a claim about the finger, not about
   * the button.
   *
   * A 10pt child cannot reach that on its own, so the assertion is that the
   * floor applies and the content ends up centred inside it rather than sitting
   * at the padding edge.
   */
  const {offset, height} = measureButton({borderWidth: 0});
  expect(height).toBe(UA_MIN_HEIGHT);
  expect(offset.top).toBe((height - 10) / 2);
});

test('an author height withdraws the user-agent minimum', () => {
  /*
   * CSS is unambiguous that `min-height` beats `height`, so a 44pt floor would
   * turn an author's 16pt button into a 44pt one and be *right* to do it. That
   * is the same cascade inversion the padding withdrawal exists for, and it is
   * not hypothetical: a radio indicator and a switch track are both built out
   * of `<button>` and both state their own height. A control that states its
   * geometry owns it.
   */
  expect(measureButton({borderWidth: 0, height: 16}).height).toBe(16);
  // A cap is not a floor: what matters is that the 48pt minimum is gone, so the
  // button falls back to fitting its 10pt child inside its padding.
  expect(measureButton({borderWidth: 0, maxHeight: 20}).height).toBeLessThan(
    UA_MIN_HEIGHT,
  );
});
