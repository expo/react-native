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
 * The behaviour of the boundary itself: what it puts on screen when a tree
 * fails, and that it can be given a working tree afterwards.
 *
 * **What this file cannot test, and where that is tested instead.** The
 * guarantee that matters is "a render error does not end the process", and
 * Fantom cannot show it either way: its root swallows a render throw with or
 * without a boundary present — checked directly, by rendering a throwing
 * component bare and watching nothing propagate. An earlier version of this
 * file asserted that guarantee here and passed just as happily with the
 * boundary deleted from `AppContainer`, which is worse than having no test.
 *
 * So the split is: the component's contract is pinned here, the wiring into
 * `AppContainer` is pinned in `SurfaceErrorBoundary-test.js`, and that a real
 * app survives is checked on a device, against the screen that used to take it
 * down.
 */

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';
import SurfaceErrorBoundary from 'react-native/Libraries/ReactNative/SurfaceErrorBoundary';

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

function Throws(): React.Node {
  throw new Error('deliberate failure from a component');
}

describe('SurfaceErrorBoundary', () => {
  // React reports the error itself before any boundary sees it. Captured rather
  // than silenced, so the deliberate failures below do not look like test
  // failures and the report can still be asserted on.
  let reported: Array<unknown> = [];
  const realError = console.error;
  beforeEach(() => {
    reported = [];
    // $FlowFixMe[cannot-write] deliberately swapped for the duration of a test
    console.error = (...args: Array<unknown>) => {
      reported.push(args[0]);
    };
  });
  afterEach(() => {
    // $FlowFixMe[cannot-write] restored immediately after
    console.error = realError;
  });

  test('children that render are left completely alone', () => {
    // The boundary sits on the render path of every app, so the ordinary case —
    // which is every case — has to be exactly as it was.
    const ok = createRef<HostInstance>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <SurfaceErrorBoundary>
          <View ref={ok} style={{width: 10, height: 10}} />
        </SurfaceErrorBoundary>,
      );
    });
    expect(ok.current?.getBoundingClientRect().width).toBe(10);
  });

  test('nothing of a failed tree stays mounted', () => {
    // Not a half-built surface whose state cannot be trusted: the sibling that
    // rendered fine before the throw goes too, because the tree it belonged to
    // is the thing that failed.
    const sibling = createRef<HostInstance>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <SurfaceErrorBoundary>
          <View ref={sibling} style={{width: 10, height: 10}} />
          <Throws />
        </SurfaceErrorBoundary>,
      );
    });
    expect(sibling.current).toBe(null);
  });

  test('the error is still reported', () => {
    // Containment must not become concealment. A caught error is not a handled
    // one; the only thing that changes is that the process survives to show it.
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <SurfaceErrorBoundary>
          <Throws />
        </SurfaceErrorBoundary>,
      );
    });
    expect(reported.length).toBeGreaterThan(0);
  });

  test('recovers when it is given a working tree', () => {
    // A boundary latches by design, and left latched it would turn one bad
    // render into a permanently blank app — not a crash, but no better than
    // one. This assertion caught exactly that: the first version never cleared
    // `failed`, and this test was red until it did.
    const recovered = createRef<HostInstance>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <SurfaceErrorBoundary>
          <Throws />
        </SurfaceErrorBoundary>,
      );
    });
    Fantom.runTask(() => {
      root.render(
        <SurfaceErrorBoundary>
          <View ref={recovered} style={{width: 10, height: 10}} />
        </SurfaceErrorBoundary>,
      );
    });
    expect(recovered.current?.getBoundingClientRect().width).toBe(10);
  });

  test('does not clear itself while the children are unchanged', () => {
    // The other half of recovery, and the reason it is conditional. Clearing on
    // every update would re-render the same failing tree at once and spin:
    // throw, catch, clear, throw. Re-rendering the *same* children must leave
    // it latched.
    const child = <Throws />;
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(<SurfaceErrorBoundary>{child}</SurfaceErrorBoundary>);
    });
    const afterFirst = reported.length;
    Fantom.runTask(() => {
      root.render(<SurfaceErrorBoundary>{child}</SurfaceErrorBoundary>);
    });
    expect(reported.length).toBe(afterFirst);
  });
});
