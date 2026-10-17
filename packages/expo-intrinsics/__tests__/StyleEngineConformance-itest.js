/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 */

/**
 * The renderer's style engine against Safari, over the conformance corpus in
 * `style-engine-conformance/`: each case's sheet and tree rendered with the
 * engine styling every element, read the way the oracle read Safari, and
 * held to Safari's answers (`expected.json`, written by `oracle.js` only once
 * Safari agreed with each case's reading of the spec).
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';

// $FlowExpectedError[untyped-import] the corpus is plain Node
const {CASES, PRELUDE} = require('./style-engine-conformance/cases');
// $FlowExpectedError[untyped-import]
const {compareRead} = require('./style-engine-conformance/compare');
// $FlowExpectedError[untyped-import]
const EXPECTED = require('./style-engine-conformance/expected.json');

import '@react-native/expo-intrinsics-poc';

type Engine = {
  addStyleSheet: (text: string) => number,
  removeStyleSheet: (id: number) => void,
  computedStyle: (node: unknown) => ?{[string]: unknown},
  customProperty: (node: unknown, name: string) => ?string,
  matches: (node: unknown, selectors: string) => boolean,
};

function engine(): Engine {
  // $FlowExpectedError[prop-missing] installed by the renderer
  const binding: ?Engine = globalThis.__cssEngine;
  if (binding == null) {
    throw new Error('The renderer installed no __cssEngine binding.');
  }
  return binding;
}

function nodeOf(instance: ?HostInstance): unknown {
  return (instance as $FlowFixMe)?.__internalInstanceHandle?.stateNode?.node;
}

// `height: 8px; width: 9px` as the engine's inline entries
function inlineEntries(text: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const declaration of text.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon > 0) {
      const name = declaration
        .slice(0, colon)
        .trim()
        .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      entries.push([name, declaration.slice(colon + 1).trim()]);
    }
  }
  return entries;
}

function render(
  node: [string, {[string]: string}, Array<$FlowFixMe>],
  refs: Map<string, {current: HostInstance | null}>,
  isRoot: boolean,
  key: number = 0,
): React.MixedElement {
  const [tag, attributes, children] = node;
  const cssAttributes: {[string]: string} = {};
  let className = '';
  let inline = null;
  for (const name of Object.keys(attributes)) {
    if (name === 'class') {
      className = attributes[name];
    } else if (name === 'style') {
      inline = inlineEntries(attributes[name]);
    } else {
      cssAttributes[name] = attributes[name];
    }
  }
  if (isRoot) {
    cssAttributes.id = 'root';
  }
  const ref = React.createRef<HostInstance>();
  refs.set(cssAttributes.id ?? '', ref);
  // A host component the element registry declares, named by the case
  const Element: $FlowFixMe = tag;
  return (
    <Element
      key={key}
      ref={ref}
      cssEngine={true}
      cssClass={className}
      cssAttributes={cssAttributes}
      cssInline={inline}>
      {children.map((child, index) => render(child, refs, false, index))}
    </Element>
  );
}

// React Native's packed 0xAARRGGBB as the oracle's [r, g, b, a]
function rgba(packed: unknown): Array<number> {
  if (typeof packed !== 'number') {
    return [0, 0, 0, 0];
  }
  /* eslint-disable no-bitwise */
  const value = packed >>> 0;
  return [
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
    ((value >>> 24) & 0xff) / 255,
  ];
  /* eslint-enable no-bitwise */
}

for (const testCase of CASES) {
  test(`${testCase.name} (${testCase.spec})`, () => {
    const sheet = engine().addStyleSheet(PRELUDE + testCase.css);
    const refs: Map<string, {current: HostInstance | null}> = new Map();
    const root = Fantom.createRoot();
    try {
      Fantom.runTask(() => {
        root.render(render(testCase.tree, refs, true));
      });
      const origin = refs.get('root')?.current?.getBoundingClientRect();
      const expected = EXPECTED[testCase.name];
      const problems: Array<string> = [];
      testCase.reads.forEach((read: $FlowFixMe, index: number) => {
        const instance = refs.get(read.id)?.current;
        const node = nodeOf(instance);
        let answer: $FlowFixMe;
        if (instance == null || node == null || origin == null) {
          answer = {error: `no element #${read.id}`};
        } else if (read.rect != null) {
          const r = instance.getBoundingClientRect();
          answer = {rect: [r.x - origin.x, r.y - origin.y, r.width, r.height]};
        } else if (read.background != null) {
          answer = {
            background: rgba(engine().computedStyle(node)?.backgroundColor),
          };
        } else if (read.matches != null) {
          answer = {matches: engine().matches(node, read.matches)};
        } else if (read.custom != null) {
          answer = {custom: engine().customProperty(node, read.custom) ?? ''};
        }
        const problem = compareRead(read, expected[index], answer);
        if (problem != null) {
          problems.push(`read ${index} (#${read.id}): ${problem}`);
        }
      });
      expect(problems).toEqual([]);
    } finally {
      Fantom.runTask(() => root.destroy());
      engine().removeStyleSheet(sheet);
    }
  });
}
