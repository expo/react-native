/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags useSharedAnimatedBackend:true
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {View} from 'react-native';

/*
 * Registering the engine's frame callback resumes the choreographer, and a
 * paused display link does not deliver until the next vsync, so a transition
 * that registers it as it starts loses its first frame. The engine therefore
 * registers on the commit that brings in a `transition-*` declaration, with
 * nothing yet moving. Fantom drives frames by hand, so these tests pin that
 * ordering rather than frame timing.
 */
function trace(): Array<string> {
  // $FlowFixMe[prop-missing] installed by the renderer
  const drain = globalThis.__cssTransitionsTrace;
  // Each line is "<timestamp> <message>", so match on the message end
  return typeof drain === 'function' ? drain() : [];
}

test('the engine starts on the commit that brings in transitionable content', () => {
  trace(); // drain anything a previous test left behind

  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View
        style={{
          width: 100,
          height: 100,
          opacity: 1,
          transitionProperty: 'opacity',
          transitionDuration: '500ms',
        }}
      />,
    );
  });

  const lines = trace();
  expect(lines.filter(line => line.endsWith('backend-start'))).toHaveLength(1);
  // Nothing has changed, so nothing may be transitioning yet
  expect(lines.filter(line => line.includes(' start '))).toEqual([]);
});

test('a view with no transitions does not start the engine', () => {
  trace();

  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(<View style={{width: 100, height: 100, opacity: 1}} />);
  });

  expect(trace().filter(line => line.endsWith('backend-start'))).toEqual([]);
});
