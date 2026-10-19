/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 */

/**
 * A region that scrolls in the block axis (`overflow-y: auto`) grows to its
 * content in the page, and the page's scroll view scrolls it
 * (DOM-CSS-LIMITATION(no-nested-vertical-scroll)). Below a box that clips its
 * block axis it scrolls as on the web, through a vertical scroll view: what
 * it grew by would be cut off there, out of the page's reach. Astryx's Dialog
 * clips its body that way, so a dialog drawn inline (Dialog Wizard, Settings
 * Dialog) scrolls its body between its header and its footer.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import {jsx, jsxs} from '../jsx-runtime';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

function elementRef(): {current: $FlowFixMe} {
  return React.createRef<$FlowFixMe>();
}

// A region of at most 100 points holding 300 points of content, in a box of
// 200 points with `outer` as its style
function renderRegion(outer: {[string]: unknown}): {
  root: $FlowFixMe,
  region: {current: $FlowFixMe},
} {
  const region = elementRef();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      jsx('div', {
        style: {...outer, height: 200},
        children: jsx('div', {
          children: jsx('div', {
            ref: region,
            style: {maxHeight: 100, overflowY: 'auto'},
            children: jsx('div', {style: {height: 300}}),
          }),
        }),
      }) as $FlowFixMe,
    );
  });
  return {root, region};
}

function scrollViewsIn(root: $FlowFixMe): number {
  return (
    JSON.stringify(root.getRenderedOutput({props: []}).toJSON()).split(
      '"ScrollView"',
    ).length - 1
  );
}

function heightOf(ref: {current: $FlowFixMe}): number {
  return ref.current.getBoundingClientRect().height;
}

describe('a region that scrolls in the block axis', () => {
  it('grows to its content in the page', () => {
    const {root, region} = renderRegion({});
    expect(heightOf(region)).toBe(300);
    expect(scrollViewsIn(root)).toBe(0);
  });

  it('scrolls below a box that clips its block axis', () => {
    const {root, region} = renderRegion({overflow: 'hidden'});
    expect(heightOf(region)).toBe(100);
    expect(region.current.scrollHeight).toBe(300);
    expect(scrollViewsIn(root)).toBe(1);
  });

  it('scrolls below a box that clips with `overflow-y: clip`', () => {
    const {root, region} = renderRegion({overflowY: 'clip'});
    expect(heightOf(region)).toBe(100);
    expect(scrollViewsIn(root)).toBe(1);
  });

  it('grows below a box that clips its inline axis only', () => {
    const {root, region} = renderRegion({overflowX: 'hidden'});
    expect(heightOf(region)).toBe(300);
    expect(scrollViewsIn(root)).toBe(0);
  });
});

describe("Astryx's Dialog, drawn inline", () => {
  it('scrolls its body between its header and its footer', () => {
    // Fantom's Hermes is built without `Intl`, which `utils/characters` reads
    // as it loads
    (globalThis as $FlowFixMe).Intl ??= {};
    // $FlowFixMe[cannot-resolve-module] the vendored sources are TypeScript
    const {Dialog, DialogHeader} = require('../vendor/Dialog');
    // $FlowFixMe[cannot-resolve-module] the vendored sources are TypeScript
    const {Layout, LayoutContent, LayoutFooter} = require('../vendor/Layout');
    const page = elementRef();
    const body = elementRef();
    const footer = elementRef();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        // As the Dialog Wizard template composes it: a Layout that fills the
        // dialog, its title in the header and its buttons in the footer
        jsx('div', {
          ref: page,
          children: jsx(Dialog, {
            isOpen: true,
            isInline: true,
            onOpenChange: () => {},
            width: 360,
            maxHeight: 300,
            children: jsx(Layout, {
              height: 'fill',
              header: jsx(DialogHeader, {
                title: 'Schedule a report',
                onOpenChange: () => {},
              }),
              content: jsx(LayoutContent, {
                ref: body,
                children: jsx('div', {style: {height: 600}}),
              }),
              footer: jsx(LayoutFooter, {
                ref: footer,
                children: jsxs('div', {
                  style: {height: 40},
                  children: ['Back', 'Continue'],
                }),
              }),
            }),
          }),
        }) as $FlowFixMe,
      );
    });
    // The inline dialog's box, which its `ref` does not reach
    const dialogBox = page.current.children[0].getBoundingClientRect();
    const bodyBox = body.current.getBoundingClientRect();
    const footerBox = footer.current.getBoundingClientRect();
    expect(dialogBox.height).toBe(300);
    // The footer starts where the body ends, inside the dialog, and the body
    // scrolls over the rest of its content
    expect(footerBox.top).toBeCloseTo(bodyBox.bottom, 3);
    expect(footerBox.bottom).toBeLessThanOrEqual(dialogBox.bottom);
    expect(body.current.scrollHeight).toBeGreaterThan(600);
    expect(body.current.clientHeight).toBe(Math.round(bodyBox.height));
    expect(scrollViewsIn(root)).toBe(1);
    const [scrollView] = body.current.childNodes;
    Fantom.scrollTo(scrollView, {x: 0, y: 200});
    expect(body.current.scrollTop).toBe(200);
  });
  it('is as tall as its content under a cap it does not reach', () => {
    // As the template draws it: centred in the page's height, which a
    // flexible body had stretched the dialog to
    (globalThis as $FlowFixMe).Intl ??= {};
    // $FlowFixMe[cannot-resolve-module] the vendored sources are TypeScript
    const {Dialog} = require('../vendor/Dialog');
    // $FlowFixMe[cannot-resolve-module] the vendored sources are TypeScript
    const {Layout, LayoutContent, LayoutFooter} = require('../vendor/Layout');
    const page = elementRef();
    const body = elementRef();
    const footer = elementRef();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        jsx('div', {
          ref: page,
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 800,
          },
          children: jsx(Dialog, {
            isOpen: true,
            isInline: true,
            onOpenChange: () => {},
            width: 360,
            maxHeight: 2000,
            children: jsx(Layout, {
              height: 'fill',
              content: jsx(LayoutContent, {
                ref: body,
                children: jsx('div', {style: {height: 100}}),
              }),
              footer: jsx(LayoutFooter, {
                ref: footer,
                children: jsx('div', {style: {height: 40}}),
              }),
            }),
          }),
        }) as $FlowFixMe,
      );
    });
    const dialogBox = page.current.children[0].getBoundingClientRect();
    const bodyBox = body.current.getBoundingClientRect();
    const footerBox = footer.current.getBoundingClientRect();
    expect(dialogBox.height).toBeLessThan(400);
    expect(footerBox.top).toBeCloseTo(bodyBox.bottom, 3);
    expect(footerBox.bottom).toBeCloseTo(dialogBox.bottom, 3);
    // Centred in the page's height
    expect(dialogBox.top).toBeCloseTo((800 - dialogBox.height) / 2, 3);
  });
});
