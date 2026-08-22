/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * @flow strict-local
 * @format
 * @oncall react_native
 */

/**
 * `<a>`'s user-agent style, and the thing that makes it different from every
 * other element in the catalog: it depends on the element's own props.
 *
 * A browser's sheet styles `a:link`, not `a`. An anchor with no `href` — a jump
 * target, a placeholder, a disabled item in a nav — is ordinary text, and
 * painting it link-blue would be a visible bug rather than a nicety. So the
 * catalog supplies a *function* as the UA style, and these tests pin both
 * halves of that behaviour, because a static style would pass any test that
 * only ever rendered an anchor with an href.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

function renderAnchor(element: React.Node): string {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    // Wrapped in a block container on purpose: an inline element has no
    // formatting context of its own, so an anchor rendered at the root has
    // nowhere to flow and produces no mountable output at all.
    // $FlowFixMe[prop-missing] intrinsic
    root.render(<div>{element}</div>);
  });
  return (
    JSON.stringify(
      root
        .getRenderedOutput({
          props: ['color', 'foregroundColor', 'textDecorationLine'],
        })
        .toJSX(),
    ) ?? ''
  );
}

/*
 * THE COLOUR IS NOT ASSERTED HERE, and that is deliberate rather than an
 * omission.
 *
 * The link colour used to be `#0000EE` — Chrome and Safari's `-webkit-link`,
 * written into this sheet as a literal — and this test pinned `0, 0, 238`. It
 * is now `LinkText` from `systemColors.js`, which resolves to
 * `UIColor.linkColor` on iOS and `?attr/colorPrimary` on Android: adaptive
 * tokens, so dark mode and Material You arrive without the stylesheet knowing
 * they exist. A literal cannot do that, which was the point of the change.
 *
 * A `PlatformColor` resolves to NOTHING on this host — there is no UIKit and no
 * Android theme behind it — so there is no colour in the rendered output to
 * assert, and a test that demanded one would be demanding the literal back.
 * The colour is pinned where it can be: `EXPLinkTextAttributesTests` checks it
 * against `UIColor.linkColor` and against the requirement that it MOVES between
 * light and dark.
 *
 * What is still assertable here is the part that is structural: which anchors
 * get the link treatment at all, and that an author outranks it.
 */
test('<a href> takes the user-agent link style', () => {
  const output = renderAnchor(
    // $FlowFixMe[prop-missing] intrinsic
    <a href="https://example.com">docs</a>,
  );
  // Underlined, because this host reports itself as Android and Android
  // underlines links — iOS does not, and says so in `linkTextAttributes`.
  expect(output).toContain('underline');
});

test('<a> without href is left unstyled, as in a browser', () => {
  // $FlowFixMe[prop-missing] intrinsic
  const output = renderAnchor(<a>docs</a>);
  expect(output).not.toContain('underline');
});

test('an author style still beats the user-agent link style', () => {
  const output = renderAnchor(
    // $FlowFixMe[prop-missing] intrinsic
    <a href="https://example.com" style={{color: 'rgb(255, 0, 0)'}}>
      docs
    </a>,
  );
  // The UA origin sits *beneath* the author's, so the author's colour wins
  // while the underline it did not mention survives.
  expect(output).toContain('underline');
  expect(output.toLowerCase()).toContain('255, 0, 0');
});

test('<a> still reports its own tag', () => {
  const anchor = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] intrinsic
      <a ref={anchor} href="https://example.com">
        docs
      </a>,
    );
  });
  // $FlowFixMe[incompatible-use] nodeName is on the host instance
  expect(anchor.current?.nodeName).toBe('RN:a');
});
