/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 */

'use strict';

import '../dom-compat';

import {registerElement} from '../elementRegistry';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

/**
 * Astryx's chat counts its messages with `getElementsByClassName`, which the
 * elements did not have: AI Chat threw "undefined is not a function". Class
 * and tag names are literal (DOM §4.2.6), not selectors.
 */
function element(
  tag: string,
  classes: Array<string>,
  children: Array<Object> = [],
) {
  const node = {nodeType: 1, childNodes: children};
  registerElement(node, {
    current: {
      descriptor: {tag, classes, attributes: {}, states: {}, parent: null},
      props: {},
      style: null,
      overrides: new Map(),
    } as $FlowFixMe,
  });
  return node;
}

describe('getElementsByClassName and getElementsByTagName', () => {
  const prototype: $FlowFixMe = ReactNativeElement.prototype;
  const dotted = element('div', ['a.b']);
  const both = element('div', ['a', 'b']);
  const item = element('li', ['a']);
  const root = element('section', [], [dotted, both, item]);

  it('take class names literally, every one of them', () => {
    expect(prototype.getElementsByClassName.call(root, 'a.b')).toEqual([
      dotted,
    ]);
    expect(prototype.getElementsByClassName.call(root, ' b  a ')).toEqual([
      both,
    ]);
    expect(prototype.getElementsByClassName.call(root, 'a')).toEqual([
      both,
      item,
    ]);
    expect(prototype.getElementsByClassName.call(root, '  ')).toEqual([]);
  });

  it('take a tag name, not a selector list', () => {
    expect(prototype.getElementsByTagName.call(root, 'LI')).toEqual([item]);
    expect(prototype.getElementsByTagName.call(root, 'div,li')).toEqual([]);
    expect(prototype.getElementsByTagName.call(root, '*')).toHaveLength(3);
  });
});
