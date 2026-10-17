/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 */

/**
 * A flex item's display is blockified (css-display-3 §2.7). Astryx's
 * ChatTokenizedText is a `display: inline` span in a column flexbox (the chat
 * bubble), holding an `inline-flex` chip and the words after it; as a block
 * its chip sits on the first line of the words. Box-backed and left inline,
 * it laid the chip and the words out as a row of flex items, the chip in a
 * column of its own. The span here is box-backed as Astryx's is, by a branch
 * that may give it a box, while its display stays `inline`.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import {jsx} from '../jsx-runtime';
import * as stylex from '../stylex-rn';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

const styles = stylex.create({
  bubble: {display: 'flex', flexDirection: 'column', width: 200},
  text: {display: {default: 'inline', ':hover': 'inline-block'}},
  chip: {display: 'inline-flex', width: 60, height: 20},
});

function laidOut(
  tag: string,
  textStyle: unknown,
): {
  chip: $FlowFixMe,
  text: $FlowFixMe,
} {
  const text = React.createRef<$FlowFixMe>();
  const chip = React.createRef<$FlowFixMe>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[incompatible-type] the runtime's jsx() returns a node
      jsx('div', {
        ...stylex.props(styles.bubble),
        children: jsx(tag, {
          ref: text,
          ...stylex.props(textStyle),
          children: [
            jsx('span', {ref: chip, ...stylex.props(styles.chip)}, 'chip'),
            ' Can you review these auth files? The JWT refresh logic seems broken',
          ],
        }),
      }),
    );
  });
  return {
    chip: chip.current?.getBoundingClientRect(),
    text: text.current?.getBoundingClientRect(),
  };
}

test('an inline element that is a flex item puts its chip on the line', () => {
  const asBlock = laidOut('div', null);
  const asItem = laidOut('span', styles.text);
  // The same lines as a block holding the chip and the words: the chip on
  // the first line and the words wrapping after and under it, not a column
  // or a row of two flex items
  expect(asItem.text.height).toBe(asBlock.text.height);
  expect(asItem.chip).toEqual(asBlock.chip);
});
