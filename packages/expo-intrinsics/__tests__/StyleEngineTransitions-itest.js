/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 * @fantom_flags useSharedAnimatedBackend:true
 */

/**
 * A change the style engine commits itself, not React, runs the element's
 * transition as a change React commits does (css-transitions-1 §3): a
 * script's write to the element's inline style, and an interaction state the
 * element enters. The transitions engine diffed React's commits alone, so a
 * bottom sheet dragged through `element.style` and released jumped shut
 * instead of sliding from the finger.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

type CSSEngine = {
  addStyleSheet: (text: string) => number,
  setScriptStyles: (writes: Array<[unknown, Array<[string, unknown]>]>) => void,
};

function engine(): CSSEngine {
  // $FlowExpectedError[prop-missing] installed by the renderer
  const binding: ?CSSEngine = globalThis.__cssEngine;
  if (binding == null) {
    throw new Error('The renderer installed no __cssEngine binding.');
  }
  return binding;
}

// What the transitions engine last wrote to the view, or null before a frame
function animatedOpacityOf(ref: {current: HostInstance | null}): ?unknown {
  try {
    return Fantom.unstable_getDirectManipulationProps(nullthrows(ref.current))
      .opacity;
  } catch (e) {
    return null;
  }
}

test("a script's write to an element's style runs its transition", () => {
  engine().addStyleSheet(
    '.fades { width: 10px; height: 10px; opacity: 1; transition: opacity 1000ms linear; }',
  );
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    // $FlowExpectedError[prop-missing]
    root.render(<div ref={ref} cssEngine={true} cssClass="fades" />);
  });
  const node = (ref.current as $FlowFixMe)?.__internalInstanceHandle?.stateNode
    ?.node;
  Fantom.runTask(() => {
    engine().setScriptStyles([[node, [['opacity', '0']]]]);
  });
  Fantom.unstable_produceFramesForDuration(500);
  expect(animatedOpacityOf(ref)).toBeCloseTo(0.5, 1);
  Fantom.unstable_produceFramesForDuration(600);
  expect(animatedOpacityOf(ref)).toBe(0);
});

test('a press runs the transition its :active style declares', () => {
  engine().addStyleSheet(
    '.dims { width: 10px; height: 10px; opacity: 1; transition: opacity 1000ms linear; } .dims:active { opacity: 0.2; }',
  );
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div ref={ref} cssEngine={true} cssClass="dims" cssStateful={true} />,
    );
  });
  Fantom.dispatchNativeEvent(ref, 'pointerDown');
  Fantom.unstable_produceFramesForDuration(500);
  expect(animatedOpacityOf(ref)).toBeCloseTo(0.6, 1);
});
