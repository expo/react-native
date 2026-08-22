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
 * `<figcaption>` sits below the figure's content, inside the figure's box.
 *
 * Pinned because the three-way comparison once showed the caption INSIDE the
 * blue content box on web and beside it on the devices, which read as a
 * product bug and was neither: the extractor wrote `<div/>` into the browser
 * page, HTML has no self-closing non-void tags, and the parser swallowed the
 * caption as a child of the box. The DEVICES were right the whole time. This
 * asserts the device behaviour directly, so if it ever really changes the
 * failure names the product rather than a harness.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

test('the caption is a sibling below the content, not a child inside it', () => {
  const root = Fantom.createRoot();
  const figure = createRef<HostInstance>();
  const content = createRef<HostInstance>();
  const caption = createRef<HostInstance>();

  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] intrinsic
      <div style={{width: 360}}>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <figure ref={figure}>
          {/* The demo's shape: a sized box standing in for the image. */}
          {/* $FlowFixMe[prop-missing] intrinsic */}
          <div ref={content} style={{height: 60, width: 120}} />
          {/* $FlowFixMe[prop-missing] intrinsic */}
          <figcaption ref={caption}>The caption</figcaption>
        </figure>
      </div>,
    );
  });

  const figureRect = nullthrows(figure.current).getBoundingClientRect();
  const contentRect = nullthrows(content.current).getBoundingClientRect();
  const captionRect = nullthrows(caption.current).getBoundingClientRect();

  // Below the content — the whole point.
  expect(captionRect.top).toBeGreaterThanOrEqual(contentRect.bottom);
  // Inside the figure's own box (Safari, probed: the caption IS inside the
  // figure), which also implies the figure grew to contain it.
  expect(captionRect.bottom).toBeLessThanOrEqual(figureRect.bottom);
  expect(figureRect.height).toBeGreaterThanOrEqual(
    contentRect.height + captionRect.height,
  );
});
