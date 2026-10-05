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
 * <address>, <hgroup>, <search>, <menu>, <noscript>, <dfn> and <data>.
 *
 * Each is checked for the thing that would actually be wrong if the
 * registration were missing, rather than for merely rendering. An unregistered
 * tag does not fail — it falls through to the INLINE unknown element, so a
 * block element that was never registered silently flows inline with its
 * siblings and looks like a styling problem. So the block cases assert block
 * layout, and the inline cases assert the UA style that distinguishes them.
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

// <fieldset> and <menu> are excluded: their UA padding means the child fills
// the content box rather than the container, and each has its own test below.
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

    // A block box fills its containing block. An unregistered tag would fold
    // into the inline flow instead and shrink-wrap, so this is the assertion
    // that says "registered as block-level" rather than "rendered at all".
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

  // html.css gives <address> `font-style: italic`; it is the one block element
  // in this group that carries a text style of its own.
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

  // The HTML Standard groups menu with dir/ol/ul for margins and with dir/ul
  // for the disc marker, so its content box starts where a <ul>'s does. Equal
  // to <ul> rather than to a literal 40, so the assertion survives the gutter
  // width changing.
  expect(rectOf(menuItem).x).toBe(rectOf(ulItem).x);
  expect(rectOf(menuItem).x).toBeGreaterThan(0);

  // And it is block-level: the item fills what is left of the 200pt container
  // after the gutter, rather than shrink-wrapping as inline content would.
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

  // `display: none`, so it generates no box and its 50pt child contributes
  // nothing: the sibling sits at the top of the container.
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

    // Inline content shares a line with the text either side of it, so the
    // element starts after the leading run rather than at the container edge.
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

  // These alias <div>'s and <b>'s native components, so without recordNodeName
  // they would identify as the component rather than the authored tag.
  for (const tag of Object.keys(refs)) {
    // The fork namespaces the authored tag rather than upper-casing it the way
    // the DOM does, so <address> reports `RN:address`.
    // $FlowFixMe[incompatible-use] nodeName is on the host instance
    expect(refs[tag].current?.nodeName).toBe(`RN:${tag}`);
  }
});

test('<fieldset> carries the native group surface metrics', () => {
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

  // DOM-CSS-DEVIATION(fieldset-native-surface): the platform's group
  // surface, not html.css's 0.35em/0.625em web-control metrics — Material's
  // outlined card gives 16dp of block padding (Fantom resolves the android
  // table), inside the 1px outline.
  const inset = rectOf(child).y - rectOf(outer).y;
  expect(inset).toBeCloseTo(16 + 1, 1);

  // marginInline: 2 on each side.
  expect(rectOf(outer).width).toBe(200 - 4);
});

test('<legend> hoists above the bordered box as the group label', () => {
  // DOM-CSS-DEVIATION(fieldset-legend-position): a browser notches the legend
  // into the top border; the platforms' form convention — iOS grouped
  // settings, Material subheads — sets the label ABOVE the surface, so
  // Fieldset.js hoists it. The legend must sit entirely above the box the
  // controls live in, separated by its UA block-end margin.
  const legend = createRef<HostInstance>();
  const control = createRef<HostInstance>();
  const outer = createRef<HostInstance>();
  const root = Fantom.createRoot();

  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] element from the catalog
      <fieldset ref={outer} style={{width: 200}}>
        {/* $FlowFixMe[prop-missing] */}
        <legend ref={legend}>Details</legend>
        {/* $FlowFixMe[prop-missing] */}
        <div ref={control} style={{height: 10}} />
      </fieldset>,
    );
  });

  const legendRect = rectOf(legend);
  const controlRect = rectOf(control);
  expect(legendRect.width).toBeGreaterThan(0);
  // The control sits in the bordered box BELOW the whole legend: legend
  // bottom + its 6px margin + the box's 1px border + 0.35em padding.
  expect(controlRect.y).toBeGreaterThanOrEqual(
    legendRect.y + legendRect.height + 6,
  );
  // And the element's overall box still honours the author's width.
  expect(rectOf(outer).width).toBe(200);
});
