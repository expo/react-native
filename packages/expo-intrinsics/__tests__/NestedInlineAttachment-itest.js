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
 * An atomic inline nested inside an inline element is placed on the line.
 *
 * An inline box does not establish a formatting context of its own: its
 * children participate in the *same* inline formatting context as the box
 * (CSS2 §9.4.2). So `<a><img></a>` puts the image on the paragraph's line, and
 * so does `<span><b><img></b></span>` — the depth is irrelevant, which is the
 * property these tests pin.
 *
 * They are written against *position* rather than existence, because the way
 * this failed was not a missing node. The `<img>` mounted, was measured, and
 * was given an attachment frame by the text layout — it was simply never moved
 * to it, so it sat at the origin under the first line and was invisible. A test
 * that only asked "did it render" passed throughout.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

const SRC = {uri: 'https://reactnative.dev/img/tiny_logo.png'};

function rectOf(ref: {current: HostInstance | null}) {
  const rect = ref.current?.getBoundingClientRect();
  if (rect == null) {
    throw new Error('element did not render');
  }
  return rect;
}

function mount(element: React.MixedElement) {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(element);
  });
}

/**
 * The image sits after the run before it and before the run after it, on one
 * shared line. This is the whole claim, and it is what a bare `<img>` in a
 * `<div>` has always satisfied.
 */
function expectPlacedInline(
  before: {current: HostInstance | null},
  image: {current: HostInstance | null},
  after: {current: HostInstance | null},
) {
  const b = rectOf(before);
  const i = rectOf(image);
  const a = rectOf(after);

  // Unplaced meant "left at the origin": x = 0 despite text preceding it.
  expect(i.x).toBeGreaterThanOrEqual(b.x + b.width);
  expect(a.x).toBeGreaterThanOrEqual(i.x + i.width);

  // Vertically overlapping is what "one line" means; a 24pt image and a 16pt
  // run share a baseline at different offsets, so the boxes overlap rather
  // than align.
  const lineTop = Math.max(b.y, i.y, a.y);
  const lineBottom = Math.min(b.y + b.height, i.y + i.height, a.y + a.height);
  expect(lineBottom).toBeGreaterThan(lineTop);
}

test('an <img> inside a <span> is placed on the line', () => {
  const before = createRef<HostInstance>();
  const image = createRef<HostInstance>();
  const after = createRef<HostInstance>();
  mount(
    // $FlowFixMe[prop-missing] elements from the catalog
    <div style={{width: 400, fontSize: 16}}>
      <span>
        <span ref={before}>before</span>
        <img ref={image} source={SRC} style={{width: 24, height: 24}} />
        <span ref={after}>after</span>
      </span>
    </div>,
  );
  expectPlacedInline(before, image, after);
});

test('an <img> inside an <a> is placed on the line', () => {
  // The case that made this visible: an image in a link simply disappeared.
  const before = createRef<HostInstance>();
  const image = createRef<HostInstance>();
  const after = createRef<HostInstance>();
  mount(
    // $FlowFixMe[prop-missing] elements from the catalog
    <div style={{width: 400, fontSize: 16}}>
      <a href="https://example.com">
        <span ref={before}>before</span>
        <img ref={image} source={SRC} style={{width: 24, height: 24}} />
        <span ref={after}>after</span>
      </a>
    </div>,
  );
  expectPlacedInline(before, image, after);
});

test('nesting depth does not matter', () => {
  // An inline box never establishes a formatting context, so three of them
  // are the same as one.
  const before = createRef<HostInstance>();
  const image = createRef<HostInstance>();
  const after = createRef<HostInstance>();
  mount(
    // $FlowFixMe[prop-missing] elements from the catalog
    <div style={{width: 400, fontSize: 16}}>
      <span>
        <b>
          <em>
            <span ref={before}>before</span>
            <img ref={image} source={SRC} style={{width: 24, height: 24}} />
            <span ref={after}>after</span>
          </em>
        </b>
      </span>
    </div>,
  );
  expectPlacedInline(before, image, after);
});

test('a form control inside a <label> is placed on the line', () => {
  // The other half of the same bug: `<label><input> Subscribe</label>` is one
  // of the two ways HTML associates a label with its control, and the control
  // was being drawn adrift of the label's own text.
  const control = createRef<HostInstance>();
  const after = createRef<HostInstance>();
  mount(
    // $FlowFixMe[prop-missing] elements from the catalog
    <div style={{width: 400, fontSize: 16}}>
      <label>
        <input type="checkbox" ref={control} />
        <span ref={after}> Subscribe</span>
      </label>
    </div>,
  );
  const c = rectOf(control);
  const a = rectOf(after);
  expect(c.width).toBeGreaterThan(0);
  // The text follows the control on the same line rather than dropping below.
  expect(a.x).toBeGreaterThanOrEqual(c.x + c.width);
  expect(Math.min(c.y + c.height, a.y + a.height)).toBeGreaterThan(
    Math.max(c.y, a.y),
  );
});

test('a nested <img> still wraps with the run', () => {
  // Placement has to follow wrapping, not just the first line — the attachment
  // frame comes from the text layout, so a nested image must land on whichever
  // line it wrapped onto.
  const image = createRef<HostInstance>();
  const paragraph = createRef<HostInstance>();
  mount(
    // $FlowFixMe[prop-missing] elements from the catalog
    <div ref={paragraph} style={{width: 120, fontSize: 16}}>
      <a href="https://example.com">
        {'a long enough run of words to force wrapping before the image '}
        <img ref={image} source={SRC} style={{width: 24, height: 24}} />
      </a>
    </div>,
  );
  const i = rectOf(image);
  const p = rectOf(paragraph);
  // On a later line, and inside the paragraph rather than overflowing it.
  expect(i.y).toBeGreaterThan(0);
  expect(i.y + i.height).toBeLessThanOrEqual(p.y + p.height);
});

test('a bare <img> in a block container still works', () => {
  // The case that always worked, kept so a change to the recursion cannot fix
  // the nested one by breaking the direct one.
  const before = createRef<HostInstance>();
  const image = createRef<HostInstance>();
  const after = createRef<HostInstance>();
  mount(
    // $FlowFixMe[prop-missing] elements from the catalog
    <div style={{width: 400, fontSize: 16}}>
      <span ref={before}>before</span>
      <img ref={image} source={SRC} style={{width: 24, height: 24}} />
      <span ref={after}>after</span>
    </div>,
  );
  expectPlacedInline(before, image, after);
});

test('an inline-block box nested inside an inline element is placed', () => {
  // The other kind of atomic inline. `<img>` qualifies through the
  // `InlineReplaced` trait; a `display: inline-block` box qualifies through
  // `isAtomicInline` instead, so it exercises a different arm of the same
  // predicate and could regress independently.
  const before = createRef<HostInstance>();
  const box = createRef<HostInstance>();
  const after = createRef<HostInstance>();
  mount(
    // $FlowFixMe[prop-missing] elements from the catalog
    <div style={{width: 400, fontSize: 16}}>
      <span>
        <span ref={before}>before</span>
        {/* $FlowFixMe[prop-missing] elements from the catalog */}
        <div
          ref={box}
          style={{display: 'inline-block', width: 24, height: 24}}
        />
        <span ref={after}>after</span>
      </span>
    </div>,
  );
  expectPlacedInline(before, box, after);
});

test('an inline element between a block container and its atomic inline', () => {
  // A span-like `display: inline` Yoga box wrapping an inline text element
  // wrapping an image: both kinds of inline box on one path down, which is the
  // case that needs the recursion to handle them uniformly rather than by kind.
  const before = createRef<HostInstance>();
  const image = createRef<HostInstance>();
  const after = createRef<HostInstance>();
  mount(
    // $FlowFixMe[prop-missing] elements from the catalog
    <div style={{width: 400, fontSize: 16}}>
      {/* $FlowFixMe[prop-missing] elements from the catalog */}
      <div style={{display: 'inline'}}>
        <span>
          <span ref={before}>before</span>
          <img ref={image} source={SRC} style={{width: 24, height: 24}} />
          <span ref={after}>after</span>
        </span>
      </div>
    </div>,
  );
  expectPlacedInline(before, image, after);
});
