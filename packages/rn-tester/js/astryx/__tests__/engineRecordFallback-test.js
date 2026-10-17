/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

'use strict';

import '../dom-compat';
import '../native-css/EngineElement';

import {recordOf} from '../elementRegistry';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

// A host node the style engine styles directly, as the renderer presents it to
// the DOM methods: its name under the `RN:` prefix `getTagName` adds, its
// committed props on the instance handle
function hostNode(
  componentName: string,
  props: $FlowFixMe,
  children: Array<$FlowFixMe> = [],
): $FlowFixMe {
  const currentProps: $FlowFixMe = {cssEngine: true, ...props};
  const node: $FlowFixMe = {
    nodeType: 1,
    nodeName: `RN:${componentName}`,
    childNodes: children,
    parentElement: null,
    __internalInstanceHandle: {stateNode: {canonical: {currentProps}}},
  };
  for (const child of children) {
    child.parentElement = node;
  }
  return node;
}

describe('the record of an engine-styled host node', () => {
  const prototype: $FlowFixMe = ReactNativeElement.prototype;
  const button = hostNode('button', {
    cssAttributes: {type: 'button', 'aria-label': 'Filter Description'},
  });
  const wrapper = hostNode('div', {}, [button]);

  it('names the tag without the renderer prefix', () => {
    expect(recordOf(button)?.descriptor.tag).toBe('button');
    expect(recordOf(wrapper)?.descriptor.tag).toBe('div');
  });

  it('is found by a type selector once setAttribute has written to it', () => {
    // A node with an override is matched here, not by the native engine
    recordOf(button)?.overrides.set('aria-expanded', {
      value: 'false',
      reactValue: null,
    });
    expect(prototype.matches.call(button, 'button')).toBe(true);
    expect(prototype.matches.call(button, '[aria-label]')).toBe(true);
    expect(prototype.matches.call(button, 'div button')).toBe(true);
    expect(prototype.matches.call(button, 'span button')).toBe(false);
    expect(
      prototype.querySelector.call(wrapper, 'button, [role="button"]'),
    ).toBe(button);
  });
});
