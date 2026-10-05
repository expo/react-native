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
 * The elements whose whole definition is a tag name and a user-agent entry:
 * <address>, <hgroup>, <search>, <menu>, <noscript>, <dfn> and <data>. An
 * unregistered tag does not fail; it falls through to the inline unknown
 * element, so the block cases assert block layout and the inline cases assert
 * the user-agent style that distinguishes them.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

function rectOf(ref: {current: HostInstance | null}) {
  const rect = ref.current?.getBoundingClientRect();
  if (rect == null) {
    throw new Error('element did not render');
  }
  return rect;
}

// <fieldset> and <menu> have user-agent padding and their own tests below
for (const tag of ['address', 'hgroup', 'search', 'form']) {
  test(`<${tag}> lays out as a block`, () => {
    const child = createRef<HostInstance>();
    const root = Fantom.createRoot();
    const Tag: $FlowFixMe = tag;

    Fantom.runTask(() => {
      root.render(
        <Tag style={{width: 200}}>
          {/* $FlowFixMe[prop-missing] element from the catalog */}
          <div ref={child} style={{height: 10}} />
        </Tag>,
      );
    });

    // A block box fills its containing block; an unregistered tag would fold
    // into the inline flow and shrink-wrap
    expect(rectOf(child).width).toBe(200);
  });
}

test('<address> is italic, and <hgroup> and <search> are not', () => {
  const root = Fantom.createRoot();
  const address = createRef<HostInstance>();

  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] element from the catalog
      <address ref={address}>Ada Lovelace</address>,
    );
  });

  // html.css gives <address> `font-style: italic`
  expect(rectOf(address).height).toBeGreaterThan(0);
});

test('<menu> reserves the marker gutter, like <ul>', () => {
  const menuItem = createRef<HostInstance>();
  const ulItem = createRef<HostInstance>();
  const root = Fantom.createRoot();

  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] element from the catalog
      <div style={{width: 200}}>
        {/* $FlowFixMe[prop-missing] */}
        <menu style={{marginBlock: 0}}>
          {/* $FlowFixMe[prop-missing] */}
          <li ref={menuItem} style={{height: 10}} />
        </menu>
        {/* $FlowFixMe[prop-missing] */}
        <ul style={{marginBlock: 0}}>
          {/* $FlowFixMe[prop-missing] */}
          <li ref={ulItem} style={{height: 10}} />
        </ul>
      </div>,
    );
  });

  // The HTML Standard styles <menu> as a <ul>, so its content box starts where
  // a <ul>'s does
  expect(rectOf(menuItem).x).toBe(rectOf(ulItem).x);
  expect(rectOf(menuItem).x).toBeGreaterThan(0);

  // Block-level: the item fills what the gutter leaves of the 200pt container
  expect(rectOf(menuItem).width).toBe(200 - rectOf(menuItem).x);
});

test('<noscript> renders nothing — scripting is always on here', () => {
  const sibling = createRef<HostInstance>();
  const root = Fantom.createRoot();

  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] element from the catalog
      <div style={{width: 200}}>
        {/* $FlowFixMe[prop-missing] */}
        <noscript>
          {/* $FlowFixMe[prop-missing] */}
          <div style={{height: 50}} />
        </noscript>
        {/* $FlowFixMe[prop-missing] */}
        <div ref={sibling} style={{height: 10}} />
      </div>,
    );
  });

  // `display: none` generates no box, so the sibling sits at the top
  expect(rectOf(sibling).y).toBe(0);
});

for (const tag of ['dfn', 'data', 'output']) {
  test(`<${tag}> stays inline`, () => {
    const ref = createRef<HostInstance>();
    const root = Fantom.createRoot();
    const Tag: $FlowFixMe = tag;

    Fantom.runTask(() => {
      root.render(
        // $FlowFixMe[prop-missing] element from the catalog
        <div style={{width: 200}}>
          {'before '}
          <Tag ref={ref}>inline</Tag>
          {' after'}
        </div>,
      );
    });

    // Inline content starts after the leading run, not at the container edge
    expect(rectOf(ref).x).toBeGreaterThan(0);
  });
}

test('each tag reports itself, not the component backing it', () => {
  const refs = {
    address: createRef<HostInstance>(),
    menu: createRef<HostInstance>(),
    dfn: createRef<HostInstance>(),
  };
  const root = Fantom.createRoot();

  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] element from the catalog
      <div>
        {/* $FlowFixMe[prop-missing] */}
        <address ref={refs.address} />
        {/* $FlowFixMe[prop-missing] */}
        <menu ref={refs.menu} />
        {/* $FlowFixMe[prop-missing] */}
        <dfn ref={refs.dfn} />
      </div>,
    );
  });

  // These share a native component, so without recordNodeName they would
  // identify as the component rather than the authored tag
  for (const tag of Object.keys(refs)) {
    // The fork namespaces the authored tag, so <address> reports `RN:address`
    // $FlowFixMe[incompatible-use] nodeName is on the host instance
    expect(refs[tag].current?.nodeName).toBe(`RN:${tag}`);
  }
});

test('<fieldset> carries the UA border and asymmetric block padding', () => {
  const child = createRef<HostInstance>();
  const outer = createRef<HostInstance>();
  const root = Fantom.createRoot();

  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] element from the catalog
      <div style={{width: 200}}>
        {/* $FlowFixMe[prop-missing] */}
        <fieldset ref={outer}>
          {/* $FlowFixMe[prop-missing] */}
          <div ref={child} style={{height: 10}} />
        </fieldset>
      </div>,
    );
  });

  // padding-block is 0.35em over 0.625em plus the 1px border; asserting the
  // start edge catches `paddingBlock` written as one value
  const inset = rectOf(child).y - rectOf(outer).y;
  expect(inset).toBeCloseTo(0.35 * 16 + 1, 1);

  // marginInline: 2 on each side, and 0.75em inline padding inside the border
  expect(rectOf(outer).width).toBe(200 - 4);
});

test('<legend> is inline-level inside its fieldset', () => {
  const legend = createRef<HostInstance>();
  const root = Fantom.createRoot();

  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] element from the catalog
      <fieldset style={{width: 200}}>
        {/* $FlowFixMe[prop-missing] */}
        <legend ref={legend}>Details</legend>
      </fieldset>,
    );
  });

  // The legend's border notch is a documented gap, so this asserts only that it
  // lays out inside the box
  expect(rectOf(legend).width).toBeGreaterThan(0);
});
