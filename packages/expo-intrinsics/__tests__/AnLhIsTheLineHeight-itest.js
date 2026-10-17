/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

type CSSEngine = {addStyleSheet: (text: string) => number};

function engine(): CSSEngine {
  // $FlowExpectedError[prop-missing] installed by the renderer
  const binding: ?CSSEngine = globalThis.__cssEngine;
  if (binding == null) {
    throw new Error('The renderer installed no __cssEngine binding.');
  }
  return binding;
}

// `lh` is the element's computed line height (css-values-4 §6.1.1). A number
// inherits as itself and multiplies each element's own font size; a length
// inherits as it computed (css-inline-3 §2.4). Astryx sizes a mention chip's
// box `height: 1lh` to center it on its line of text.
function heightIn(sheet: string): number {
  engine().addStyleSheet(sheet);
  const box = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing] intrinsic tag with engine inputs
      <div cssEngine={true} cssClass="line">
        {/* $FlowExpectedError[prop-missing] */}
        <div ref={box} cssEngine={true} cssClass="box" />
      </div>,
    );
  });
  return box.current?.getBoundingClientRect().height ?? -1;
}

test('a length line height', () => {
  expect(
    heightIn('.line { line-height: 24px } .box { height: 1lh; width: 10px }'),
  ).toBe(24);
});

test('a number multiplies the font size of the element that reads it', () => {
  expect(
    heightIn(
      '.line { font-size: 10px; line-height: 1.5 } ' +
        '.box { font-size: 20px; height: 1lh; width: 10px }',
    ),
  ).toBe(30);
});

test('a percentage inherits as the length it computed to', () => {
  expect(
    heightIn(
      '.line { font-size: 10px; line-height: 150% } ' +
        '.box { font-size: 20px; height: 2lh; width: 10px }',
    ),
  ).toBe(30);
});
