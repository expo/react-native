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
 * `<label>` gives its control an accessible name.
 *
 * Worth testing rather than eyeballing, because this is the one feature on the
 * screen that is *invisible*: a labelled and an unlabelled checkbox are pixel
 * for pixel identical, and the difference only appears to someone using a screen
 * reader. A screenshot can never catch a regression here.
 *
 * The assertions read the mounted props, since the accessible name is a prop on
 * the control rather than anything with a position.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import {textOf} from '../src/Label';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

import '@react-native/expo-intrinsics-poc';

/**
 * The accessible name of each *control* in the tree.
 *
 * Reading the control's own props rather than searching the whole output
 * matters: a label's text is also rendered as visible text, so a naive
 * substring match on the tree passes whether or not the association worked —
 * it would have reported all of these as passing while the controls went
 * unnamed.
 */
function controlLabels(
  element: React.MixedElement,
): Array<[string, string | null]> {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(element);
  });
  const output = JSON.parse(
    JSON.stringify(root.getRenderedOutput({props: ['accessibilityLabel']})),
  );
  const found: Array<[string, string | null]> = [];
  const walk = (node: $FlowFixMe) => {
    if (node == null || typeof node !== 'object') {
      return;
    }
    const type = node.type;
    // The boxes are not controls, and a <label> renders as ordinary text.
    if (
      typeof type === 'string' &&
      type.startsWith('element-') &&
      type !== 'element-box'
    ) {
      found.push([type, node.props?.accessibilityLabel ?? null]);
    }
    for (const child of node.children ?? []) {
      walk(child);
    }
  };
  walk(output);
  return found;
}

/** Just the names, for the common case of one control. */
function namesOf(element: React.MixedElement): Array<string | null> {
  return controlLabels(element).map(([, label]) => label);
}

describe('<label htmlFor>', () => {
  test('names the control with the matching id', () => {
    expect(
      namesOf(
        // $FlowFixMe[prop-missing] elements from the catalog
        <div>
          <label htmlFor="terms">Accept the terms</label>
          <input id="terms" type="checkbox" />
        </div>,
      ),
    ).toEqual(['Accept the terms']);
  });

  test('a control with no matching label is left unnamed', () => {
    // Guards against the registry leaking a name onto the wrong control, which
    // would be worse than no name at all.
    expect(
      namesOf(
        // $FlowFixMe[prop-missing] elements from the catalog
        <div>
          <label htmlFor="other">Accept the terms</label>
          <input id="unrelated" type="checkbox" />
        </div>,
      ),
    ).toEqual([null]);
  });
});

describe('<label> wrapping its control', () => {
  test('names the control it contains', () => {
    expect(
      namesOf(
        // $FlowFixMe[prop-missing] elements from the catalog
        <div>
          <label>
            <input type="checkbox" />
            Subscribe to the newsletter
          </label>
        </div>,
      ),
    ).toEqual(['Subscribe to the newsletter']);
  });

  test('names a select and a textarea too', () => {
    expect(
      namesOf(
        // $FlowFixMe[prop-missing] elements from the catalog
        <div>
          <label>
            Choose a plan
            <select>
              <option value="free">Free</option>
            </select>
          </label>
          <label>
            Your notes
            <textarea />
          </label>
        </div>,
      ),
    ).toEqual(['Choose a plan', 'Your notes']);
  });

  test('does not reach a control outside it', () => {
    expect(
      namesOf(
        // $FlowFixMe[prop-missing] elements from the catalog
        <div>
          <label>Just some text</label>
          <input type="checkbox" />
        </div>,
      ),
    ).toEqual([null]);
  });
});

describe('precedence', () => {
  test("the control's own accessibilityLabel wins", () => {
    expect(
      namesOf(
        // $FlowFixMe[prop-missing] elements from the catalog
        <div>
          <label htmlFor="a">From the label</label>
          <input id="a" type="checkbox" accessibilityLabel="From the control" />
        </div>,
      ),
    ).toEqual(['From the control']);
  });

  test('an explicit for/id association beats a wrapping one', () => {
    // The more specific statement wins, which is HTML's rule.
    expect(
      namesOf(
        // $FlowFixMe[prop-missing] elements from the catalog
        <div>
          <label htmlFor="b">Explicit</label>
          <label>
            Wrapping
            <input id="b" type="checkbox" />
          </label>
        </div>,
      ),
    ).toEqual(['Explicit']);
  });
});

describe('textOf', () => {
  test('reads nested elements', () => {
    expect(
      textOf(
        <>
          {'Accept '}
          {/* $FlowFixMe[prop-missing] elements from the catalog */}
          <strong>now</strong>
        </>,
      ),
    ).toBe('Accept now');
  });

  test('skips a nested control, which is what is being named', () => {
    expect(
      textOf(
        <>
          {/* $FlowFixMe[prop-missing] elements from the catalog */}
          <input type="checkbox" />
          {' Subscribe'}
        </>,
      ),
    ).toBe('Subscribe');
  });

  test('collapses whitespace the way an accessible name computation does', () => {
    expect(textOf('  Accept   the \n terms  ')).toBe('Accept the terms');
  });
});
