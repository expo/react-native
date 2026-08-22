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
 * `<img>`'s HTML attributes, `<picture>`'s selection, `<q>`'s quotation marks
 * and the heading role.
 *
 * These assert the *mounted tree* rather than the component's return value,
 * because the thing worth protecting is that the translation survives the
 * reconciler — `<img>` is a component that renders a differently-named host
 * element, and a mistake there shows up as a prop that never arrives.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

function mount(element: React.MixedElement): Fantom.Root {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(element);
  });
  return root;
}

function rectOf(ref: {current: HostInstance | null}) {
  const rect = ref.current?.getBoundingClientRect();
  if (rect == null) {
    throw new Error('element did not render');
  }
  return rect;
}

describe('<img> attributes', () => {
  test('src renders an image and keeps the element inline', () => {
    const before = createRef<HostInstance>();
    const image = createRef<HostInstance>();
    const root = mount(
      // $FlowFixMe[prop-missing] elements from the catalog
      <div style={{width: 400}}>
        <span ref={before}>before</span>
        <img
          ref={image}
          src="https://e.com/a.png"
          style={{width: 24, height: 24}}
        />
      </div>,
    );
    // The translation must not cost the element its box: `src` reaching the
    // host is only useful if the host is still the inline replaced element.
    expect(rectOf(image).width).toBe(24);
    expect(rectOf(image).x).toBeGreaterThanOrEqual(
      rectOf(before).x + rectOf(before).width,
    );
    expect(root.getRenderedOutput().toJSX()).toBeTruthy();
  });

  test('the width and height attributes size the box', () => {
    const image = createRef<HostInstance>();
    mount(
      // $FlowFixMe[prop-missing] elements from the catalog
      <div style={{width: 400}}>
        <img ref={image} src="https://e.com/a.png" width={64} height={48} />
      </div>,
    );
    expect(rectOf(image).width).toBe(64);
    expect(rectOf(image).height).toBe(48);
  });

  test('an author style beats the width and height attributes', () => {
    // HTML calls these presentational hints: they act as if they came from the
    // user-agent sheet, so any author declaration wins.
    const image = createRef<HostInstance>();
    mount(
      // $FlowFixMe[prop-missing] elements from the catalog
      <div style={{width: 400}}>
        <img
          ref={image}
          src="https://e.com/a.png"
          width={64}
          height={48}
          style={{width: 100, height: 20}}
        />
      </div>,
    );
    expect(rectOf(image).width).toBe(100);
    expect(rectOf(image).height).toBe(20);
  });

  test('the RN-shaped source prop still works', () => {
    const image = createRef<HostInstance>();
    mount(
      // $FlowFixMe[prop-missing] elements from the catalog
      <div style={{width: 400}}>
        <img
          ref={image}
          source={{uri: 'https://e.com/a.png'}}
          style={{width: 30, height: 30}}
        />
      </div>,
    );
    expect(rectOf(image).width).toBe(30);
  });

  /*
   * `object-fit` is asserted in `imgObjectFit-test.js` rather than here.
   * Fantom's `rn-img` view config does not carry `contentFit` or `resizeMode`,
   * so they are absent from the mounted tree whatever the component passes —
   * an assertion here would be reporting the harness, not the product.
   */
});

describe('<picture>', () => {
  test('renders the <img> inside it', () => {
    const image = createRef<HostInstance>();
    mount(
      // $FlowFixMe[prop-missing] elements from the catalog
      <div style={{width: 400}}>
        <picture>
          <source srcSet="a.webp" type="image/webp" />
          <img ref={image} src="a.png" style={{width: 40, height: 40}} />
        </picture>
      </div>,
    );
    expect(rectOf(image).width).toBe(40);
  });

  test('a <source> mounts nothing of its own', () => {
    // The whole reason <source> needs no view config: it is read, not rendered.
    // Two sources and an image must produce exactly one box.
    const outer = createRef<HostInstance>();
    const image = createRef<HostInstance>();
    mount(
      // $FlowFixMe[prop-missing] elements from the catalog
      <div ref={outer} style={{width: 400}}>
        <picture>
          <source srcSet="a.avif" type="image/avif" />
          <source srcSet="a.webp" type="image/webp" />
          {/* Top-aligned so the line is exactly the image's height. A
              baseline-aligned box sits ON the baseline and the strut's descent
              hangs below it, making the line taller — correct per CSS (Safari
              agrees), but it would put a font metric in the assertion below,
              which is about whether a <source> occupies space. */}
          <img
            ref={image}
            src="a.png"
            style={{width: 40, height: 40, verticalAlign: 'top'}}
          />
        </picture>
      </div>,
    );
    // If a <source> mounted, it would occupy the line and push the image along.
    expect(rectOf(image).x).toBe(0);
    expect(rectOf(outer).height).toBe(40);
  });

  test('a <picture> with no <img> renders nothing', () => {
    const outer = createRef<HostInstance>();
    mount(
      // $FlowFixMe[prop-missing] elements from the catalog
      <div ref={outer} style={{width: 400}}>
        <picture>
          <source srcSet="a.webp" type="image/webp" />
        </picture>
      </div>,
    );
    expect(rectOf(outer).height).toBe(0);
  });
});

describe('<q>', () => {
  test('generates quotation marks around its content', () => {
    const root = mount(
      // $FlowFixMe[prop-missing] elements from the catalog
      <div style={{width: 400}}>
        <q>quoted</q>
      </div>,
    );
    const text = JSON.stringify(root.getRenderedOutput().toJSX());
    expect(text).toContain('“');
    expect(text).toContain('”');
  });

  test('a nested <q> takes the second pair', () => {
    // CSS's `quotes` alternates by depth; `open-quote` means "the pair at this
    // level", which is what makes nested quotations readable.
    const root = mount(
      // $FlowFixMe[prop-missing] elements from the catalog
      <div style={{width: 400}}>
        <q>
          outer <q>inner</q>
        </q>
      </div>,
    );
    const text = JSON.stringify(root.getRenderedOutput().toJSX());
    expect(text).toContain('‘');
    expect(text).toContain('’');
  });
});

describe('headings', () => {
  test('<h1>-<h6> still lay out as blocks', () => {
    // The role is added by a component that renders a differently-named host,
    // so the box has to be checked as well as the role.
    for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
      const child = createRef<HostInstance>();
      const Tag: $FlowFixMe = tag;
      mount(
        <Tag style={{width: 200}}>
          {/* $FlowFixMe[prop-missing] elements from the catalog */}
          <div ref={child} style={{height: 10}} />
        </Tag>,
      );
      expect(rectOf(child).width).toBe(200);
    }
  });
});
