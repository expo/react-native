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
 * The boundary's own contract: what it puts on screen when a tree fails, and
 * that it can be given a working tree afterwards. Fantom's root swallows a
 * render throw with or without a boundary, so "a render error does not end
 * the process" cannot be tested here; the wiring into `AppContainer` is
 * pinned in `SurfaceErrorBoundary-test.js` and survival on a device.
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
  // React reports the error before any boundary sees it; captured rather than
  // silenced so the report can be asserted on
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
    // The boundary sits on the render path of every app, so the ordinary case
    // has to be exactly as it was
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
    // The sibling that rendered fine goes too: the tree it belonged to failed
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
    // Containment must not become concealment: the error is still reported
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
    // Left latched, the boundary would turn one bad render into a permanently
    // blank app
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
    // Clearing on every update would re-render the same failing tree and spin,
    // so re-rendering the same children must leave it latched
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
