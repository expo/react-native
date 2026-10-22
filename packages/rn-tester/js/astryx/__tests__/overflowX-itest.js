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
 * A region that scrolls sideways (`overflow-x: auto`) lays its content out at
 * its own width and scrolls over what overflows that width, its scrollable
 * overflow area (css-overflow-3 §2.2): a paragraph wraps at the region's
 * width, and a block wider than the region is what scrolls. The region is a
 * horizontal scroll view whose content container is as wide as the region,
 * and whose mounted width reaches over the content's overflow, which both
 * platforms scroll over.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import {jsx} from '../jsx-runtime';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {ScrollView, View} from 'react-native';

// 10 points a character in Fantom's text measurer: 202 characters, on one
// line at its max-content width
const THREE_SENTENCES =
  'The kiln was fired at dawn and the glaze came out a soft white. ' +
  'Every mug in the batch kept its handle and none of them cracked. ' +
  'The studio packed them in recycled kraft paper and shipped them that day.';
const ONE_SENTENCE =
  'Each piece is thrown by hand, so no two of them are ever exactly alike.';

function elementRef(): {current: $FlowFixMe} {
  return React.createRef<$FlowFixMe>();
}

type Refs = {
  region: {current: $FlowFixMe},
  paragraph: {current: $FlowFixMe},
  block: {current: $FlowFixMe},
};

// A 300-wide page holding a sideways scroller: a paragraph, and a block of
// `blockWidth` when there is one
function Page({
  refs,
  text,
  blockWidth,
}: {
  refs: Refs,
  text: string,
  blockWidth: ?number,
}): React.Node {
  return jsx('div', {
    style: {width: 300},
    children: jsx('div', {
      ref: refs.region,
      style: {overflowX: 'auto'},
      children: [
        jsx('p', {ref: refs.paragraph, children: text}, 'p'),
        blockWidth != null
          ? jsx(
              'div',
              {ref: refs.block, style: {width: blockWidth, height: 10}},
              'block',
            )
          : null,
      ],
    }),
  }) as $FlowFixMe;
}

function renderPage(
  text: string,
  blockWidth: ?number,
): {root: $FlowFixMe, refs: Refs, rerender: (blockWidth: ?number) => void} {
  const root = Fantom.createRoot();
  const refs = {
    region: elementRef(),
    paragraph: elementRef(),
    block: elementRef(),
  };
  const rerender = (width: ?number) => {
    Fantom.runTask(() => {
      root.render(<Page refs={refs} text={text} blockWidth={width} />);
    });
  };
  rerender(blockWidth);
  return {root, refs, rerender};
}

// The mounted width of the first scroll view's content container: what the
// platform scrolls over
function mountedContentWidth(root: $FlowFixMe): ?number {
  const find = (node: $FlowFixMe): ?number => {
    if (node == null || typeof node !== 'object') {
      return null;
    }
    const children = Array.isArray(node.children) ? node.children : [];
    if (/ScrollView/i.test(String(node.type))) {
      const frame = children[0]?.props?.['layoutMetrics-frame'];
      const width = /width:([-\d.]+)/.exec(String(frame ?? ''));
      return width != null ? Number(width[1]) : null;
    }
    for (const child of children) {
      const found = find(child);
      if (found != null) {
        return found;
      }
    }
    return null;
  };
  return find(root.getRenderedOutput({includeLayoutMetrics: true}).toJSON());
}

function widthOf(ref: {current: $FlowFixMe}): number {
  return ref.current.getBoundingClientRect().width;
}

describe('a region that scrolls sideways', () => {
  it('wraps a paragraph at its own width, with nothing to scroll', () => {
    const {root, refs} = renderPage(THREE_SENTENCES, null);
    expect(widthOf(refs.paragraph)).toBe(300);
    expect(
      refs.paragraph.current.getBoundingClientRect().height,
    ).toBeGreaterThan(40);
    expect(refs.region.current.scrollWidth).toBe(300);
    expect(mountedContentWidth(root)).toBe(300);
  });

  it('scrolls over a block wider than it, the paragraph still wrapped', () => {
    const {root, refs} = renderPage(ONE_SENTENCE, 600);
    expect(widthOf(refs.paragraph)).toBe(300);
    expect(widthOf(refs.block)).toBe(600);
    expect(refs.region.current.scrollWidth).toBe(600);
    expect(mountedContentWidth(root)).toBe(600);
  });

  it('follows the overflow as it grows and shrinks', () => {
    const {root, rerender} = renderPage(ONE_SENTENCE, 600);
    rerender(800);
    expect(mountedContentWidth(root)).toBe(800);
    rerender(400);
    expect(mountedContentWidth(root)).toBe(400);
    rerender(null);
    expect(mountedContentWidth(root)).toBe(300);
  });
});

describe("React Native's own horizontal ScrollView", () => {
  it('still lays its content out at its max-content width', () => {
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <ScrollView horizontal={true} style={{width: 300}}>
          <View style={{width: 500, height: 10}} />
        </ScrollView>,
      );
    });
    expect(mountedContentWidth(root)).toBe(500);
  });
});
