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
 * StyleX's `when.*` conditions, which style an element by the state of
 * another: a marked ancestor (`when.ancestor`) or an earlier marked sibling
 * (`when.siblingBefore`). A marker reaches the style engine as a class its
 * element carries, and the engine answers a condition as the selector StyleX
 * generates for it on the web (`.marker:hover *`, `.marker:hover ~ *`). The
 * styles are StyleX's own shape, a condition inside a property's value. The
 * engine answers no other relation (`when.descendant`, `when.siblingAfter`,
 * `when.anySibling` need `:has()`), and its `whenSelector` returns none.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import {jsx} from '../jsx-runtime';
import * as stylex from '../stylex-rn';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

const BLUE = 'rgba(0, 0, 255, 1)';
const RED = 'rgba(255, 0, 0, 1)';

const marker = stylex.defineMarker();

/** A box that is red where `condition` holds and blue elsewhere. */
function tintedWhen(condition: string): {[string]: unknown} {
  return {
    width: 10,
    height: 10,
    backgroundColor: Object.fromEntries([
      ['default', 'rgb(0, 0, 255)'],
      [condition, 'rgb(255, 0, 0)'],
    ]),
  };
}

function render(element: unknown): $FlowFixMe {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(element as $FlowFixMe);
  });
  return root;
}

/** The background of every box drawn with one, in tree order. */
function backgrounds(root: $FlowFixMe): Array<string> {
  const found: Array<string> = [];
  const walk = (node: $FlowFixMe) => {
    if (node == null || typeof node === 'string') {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node.props.backgroundColor != null) {
      found.push(node.props.backgroundColor);
    }
    walk(node.children);
  };
  walk(root.getRenderedOutput({props: ['backgroundColor']}).toJSON());
  return found;
}

/** A list whose items carry the marker, each holding a conditional box. */
function list(count: number, condition: string): unknown {
  const items = [];
  for (let i = 0; i < count; i++) {
    items.push(
      jsx(
        'div',
        {
          ...stylex.props(marker),
          children: jsx('div', {...stylex.props(tintedWhen(condition))}),
        },
        String(i),
      ),
    );
  }
  return jsx('div', {children: items});
}

describe('when.ancestor', () => {
  it('applies under the first child and nowhere else', () => {
    const root = render(list(3, stylex.when.ancestor(':first-child', marker)));
    expect(backgrounds(root)).toEqual([RED, BLUE, BLUE]);
  });

  it('picks the other end with :last-child', () => {
    const root = render(list(3, stylex.when.ancestor(':last-child', marker)));
    expect(backgrounds(root)).toEqual([BLUE, BLUE, RED]);
  });

  it('takes a lone item as first, last and only at once', () => {
    for (const pseudo of [':first-child', ':last-child', ':only-child']) {
      const root = render(list(1, stylex.when.ancestor(pseudo, marker)));
      expect(backgrounds(root)).toEqual([RED]);
    }
  });

  it('is answered by no ancestor that carries another marker', () => {
    const other = stylex.defineMarker();
    const root = render(list(3, stylex.when.ancestor(':first-child', other)));
    expect(backgrounds(root)).toEqual([BLUE, BLUE, BLUE]);
  });

  it('follows the pointer over the marked ancestor', () => {
    const card = React.createRef<$FlowFixMe>();
    const root = render(
      jsx('div', {
        ref: card,
        ...stylex.props(marker),
        children: jsx('div', {
          ...stylex.props(tintedWhen(stylex.when.ancestor(':hover', marker))),
        }),
      }),
    );
    expect(backgrounds(root)).toEqual([BLUE]);
    Fantom.dispatchNativeEvent(card, 'pointerEnter');
    expect(backgrounds(root)).toEqual([RED]);
    Fantom.dispatchNativeEvent(card, 'pointerLeave');
    expect(backgrounds(root)).toEqual([BLUE]);
  });

  it('holds while a press inside the marked ancestor lasts', () => {
    // A press on the box is `:active` on its marked ancestor too
    const card = React.createRef<$FlowFixMe>();
    const box = React.createRef<$FlowFixMe>();
    const root = render(
      jsx('div', {
        ref: card,
        ...stylex.props(marker),
        children: jsx('div', {
          ref: box,
          ...stylex.props(tintedWhen(stylex.when.ancestor(':active', marker))),
        }),
      }),
    );
    expect(backgrounds(root)).toEqual([BLUE]);
    Fantom.dispatchNativeEvent(box, 'pointerDown');
    expect(backgrounds(root)).toEqual([RED]);
    Fantom.dispatchNativeEvent(box, 'pointerUp');
    expect(backgrounds(root)).toEqual([BLUE]);
  });

  it('resolves a var() in its value where the element is', () => {
    const style = {
      width: 10,
      height: 10,
      backgroundColor: Object.fromEntries([
        ['default', 'rgb(0, 0, 255)'],
        [stylex.when.ancestor(':only-child', marker), 'var(--tint)'],
      ]),
    };
    const root = render(
      jsx('div', {
        ...stylex.props({'--tint': 'rgb(0, 128, 0)'}),
        children: jsx('div', {
          ...stylex.props(marker),
          children: jsx('div', {...stylex.props(style)}),
        }),
      }),
    );
    expect(backgrounds(root)).toEqual(['rgba(0, 128, 0, 1)']);
  });
});

describe('when.siblingBefore', () => {
  it('follows the pointer over an earlier marked sibling', () => {
    const style = stylex.props(
      tintedWhen(stylex.when.siblingBefore(':hover', marker)),
    );
    const marked = React.createRef<$FlowFixMe>();
    const root = render(
      jsx('div', {
        children: [
          jsx('div', {...style}, 'before'),
          jsx(
            'div',
            {ref: marked, ...stylex.props(marker), style: {height: 10}},
            'marked',
          ),
          jsx('div', {...style}, 'after'),
          // Inside a later sibling, which is not a sibling itself
          jsx('div', {children: jsx('div', {...style})}, 'inside'),
        ],
      }),
    );
    expect(backgrounds(root)).toEqual([BLUE, BLUE, BLUE]);
    Fantom.dispatchNativeEvent(marked, 'pointerEnter');
    expect(backgrounds(root)).toEqual([BLUE, RED, BLUE]);
    Fantom.dispatchNativeEvent(marked, 'pointerLeave');
    expect(backgrounds(root)).toEqual([BLUE, BLUE, BLUE]);
  });

  it('reads where the marked sibling sits among its own siblings', () => {
    const style = stylex.props(
      tintedWhen(stylex.when.siblingBefore(':first-child', marker)),
    );
    const first = render(
      jsx('div', {
        children: [
          jsx('div', {...stylex.props(marker)}, 'marked'),
          jsx('div', {...style}, 'after'),
        ],
      }),
    );
    expect(backgrounds(first)).toEqual([RED]);
    const second = render(
      jsx('div', {
        children: [
          jsx('div', {style: {height: 10}}, 'first'),
          jsx('div', {...stylex.props(marker)}, 'marked'),
          jsx('div', {...style}, 'after'),
        ],
      }),
    );
    expect(backgrounds(second)).toEqual([BLUE]);
  });
});
