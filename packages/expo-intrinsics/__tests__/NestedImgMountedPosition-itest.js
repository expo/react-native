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

/**
 * The MOUNTED position of a nested atomic inline — not its shadow-tree
 * rect.
 *
 * getBoundingClientRect and the Safari-pinned corpus compose STAMPED shadow
 * metrics, and both read perfect numbers while `<a><img/> text</a>` drew its
 * image at the line's start, under the word before it, on both platforms:
 * the attachment pass places a nested attachment PARENT-RELATIVE, and the
 * mounting layer composes ancestors from their MOUNTED metrics — which the
 * inline text elements returned as fully empty, origin included. This test
 * reads the rendered (mounted) output and composes frames the way the
 * platform view hierarchy does, so a dropped origin fails here even though
 * every shadow-tree instrument stays green.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';

import '@react-native/expo-intrinsics-poc';

function frameOf(props: {[string]: string}): {x: number, y: number} | null {
  const raw = props['layoutMetrics-frame'];
  if (raw == null) {
    return null;
  }
  const m = /x:([-\d.]+),y:([-\d.]+)/.exec(raw);
  return m != null ? {x: Number(m[1]), y: Number(m[2])} : null;
}

// Depth-first search for the img node, composing mounted origins on the way
// down — exactly what the native view hierarchy does.
function composedImgX(node: $FlowFixMe, offset: number): number | null {
  if (node == null || typeof node !== 'object') {
    return null;
  }
  const props = node.props ?? {};
  const own = frameOf(props);
  const here = offset + (own?.x ?? 0);
  if (props['source-uri'] != null) {
    return here;
  }
  const children = props.children;
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    const found = composedImgX(child, here);
    if (found != null) {
      return found;
    }
  }
  return null;
}

test('a nested anchor img MOUNTS after the text before it', () => {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] intrinsic
      <div style={{width: 360}}>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <div>
          Visit{' '}
          {/* $FlowFixMe[prop-missing] intrinsic */}
          <a href="https://reactnative.dev">
            {/* $FlowFixMe[prop-missing] intrinsic */}
            <img src="https://x/l.png" style={{width: 20, height: 20}} />{' '}
            reactnative.dev
          </a>
        </div>
      </div>,
    );
  });
  const output = root
    .getRenderedOutput({includeLayoutMetrics: true})
    .toJSX() as $FlowFixMe;
  const x = composedImgX(output, 0);
  expect(x).not.toBeNull();
  // After "Visit " (~33px at 16px type) — never at the line's start.
  expect(x).toBeGreaterThan(25);
});
