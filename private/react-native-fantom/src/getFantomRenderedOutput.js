/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import type {RootTag} from 'react-native';

import * as React from 'react';
import NativeFantom from 'react-native/src/private/testing/fantom/specs/NativeFantom';

export type RenderOutputConfig = {
  ...FantomRenderedOutputConfig,
  includeRoot?: boolean,
  includeLayoutMetrics?: boolean,
};

type FantomJsonObject = {
  type: string,
  props: {[key: string]: string},
  children: ReadonlyArray<FantomJsonObject | string>,
};

type FantomJson = FantomJsonObject | ReadonlyArray<FantomJsonObject>;

type FantomRenderedOutputConfig = {
  // RegExp patterns to match prop names
  props?: ReadonlyArray<string>,
};

/** Whether the renderer produced any view at all. */
function isEmptyTree(json: FantomJson): boolean {
  return Array.isArray(json) ? json.length === 0 : json == null;
}

/** Every prop name present anywhere in the tree. */
function allPropNames(json: FantomJson): Array<string> {
  const found = new Set<string>();
  const visit = (node: FantomJsonObject | string) => {
    if (typeof node === 'string') {
      return;
    }
    for (const name of Object.keys(node.props)) {
      found.add(name);
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  if (Array.isArray(json)) {
    json.forEach(visit);
  } else {
    visit(json);
  }
  return Array.from(found).sort();
}

class FantomRenderedOutput {
  #json: FantomJson;
  #unfiltered: FantomJson;
  #config: FantomRenderedOutputConfig;

  constructor(json: FantomJson, config: FantomRenderedOutputConfig) {
    this.#json = this.#filterJson(json, config);
    this.#unfiltered = json;
    this.#config = config;
  }

  /**
   * Why a prop you expected is not in the output.
   *
   * A `props` filter that comes back empty has three possible causes and the
   * empty result is IDENTICAL in all three:
   *
   *  1. the value equals its default — `debugStringConvertibleItem` drops those,
   *     so a prop at its initial value is absent by design;
   *  2. the C++ `Props` class does not emit it from `getDebugProps()` at all, so
   *     it is invisible here however well the prop works;
   *  3. no view was rendered — it was FLATTENED away, and there is nothing to
   *     have props at all.
   *
   * This is a method rather than a warning because every one of the three is
   * something a correct test deliberately asserts. `FlatList`'s `inverted` is
   * checked by there being no such prop (1); `<View pointerEvents="box-none">`
   * is checked by the tree being empty (3). Warning on the first two produced 97
   * warnings on a green run and narrowing it to the third still produced 26 —
   * all of them correct tests being told off. What distinguishes a mistake from
   * an intent is the ASSERTION, and the query cannot see it.
   *
   * So nothing is emitted unless it is asked for. When a read comes back empty
   * and you do not know which of the three you are looking at, print this.
   */
  explain(): string {
    const patterns = this.#config.props;
    const present = allPropNames(this.#unfiltered);
    const lines = [];

    if (patterns == null || patterns.length === 0) {
      lines.push('No `props` filter was given, so nothing was filtered out.');
    } else {
      for (const pattern of patterns) {
        const matched = present.filter(name => new RegExp(pattern).test(name));
        lines.push(
          matched.length > 0
            ? `  /${pattern}/ matched: ${matched.join(', ')}`
            : `  /${pattern}/ matched NOTHING`,
        );
      }
    }

    if (isEmptyTree(this.#unfiltered)) {
      lines.push(
        '',
        'NOTHING WAS RENDERED. The tree is empty, so every prop reads as',
        'absent whether it works or not. The usual cause is view flattening: a',
        'view with only layout style and nothing to paint never reaches the',
        'mounting layer. Give it a backgroundColor, or assert on a child that',
        'does paint.',
      );
    } else {
      lines.push('', `Present anywhere in the tree: ${present.join(', ')}`);
    }

    lines.push(
      '',
      'A prop is only visible here if the C++ Props class emits it from',
      'getDebugProps() AND its value differs from the default. If the name is',
      'not in the list above and the tree is not empty, add it to',
      'getDebugProps() in the relevant Props.cpp — until then it cannot be',
      'observed from a test however well it works.',
    );

    return lines.join('\n');
  }

  toJSON(): FantomJson {
    return Array.isArray(this.#json) ? [...this.#json] : {...this.#json};
  }

  toJSONObject(): FantomJsonObject {
    if (Array.isArray(this.#json)) {
      throw new Error('Cannot convert array to JSON object');
    }

    return {...this.#json};
  }

  toJSX(): React.Node {
    return convertRawJsonToJSX(this.#json);
  }

  #filterJson(
    json: FantomJson,
    config: FantomRenderedOutputConfig,
  ): FantomJson {
    if (Array.isArray(json)) {
      return json.map(child => this.#filterJsonObject(child, config));
    } else {
      return this.#filterJsonObject(json, config);
    }
  }

  #filterJsonObject(
    json: FantomJsonObject,
    config: FantomRenderedOutputConfig,
  ): FantomJsonObject {
    const root: FantomJsonObject = {
      type: json.type,
      props: this.#filterProps(json.props, config),
      children: [],
    };

    if (Array.isArray(json.children)) {
      root.children = json.children.map(child =>
        typeof child === 'object'
          ? this.#filterJsonObject(child, config)
          : child,
      );
    } else {
      root.children = json.children;
    }

    return root;
  }

  #filterProps(
    props: FantomJsonObject['props'],
    config: FantomRenderedOutputConfig,
  ): FantomJsonObject['props'] {
    const patterns = config.props;
    if (patterns == null) {
      return {...props};
    }

    return Object.keys(props)
      .filter(key => patterns.some(pattern => new RegExp(pattern).test(key)))
      .reduce(
        (acc, name) => {
          acc[name] = props[name];
          return acc;
        },
        {} as FantomJsonObject['props'],
      );
  }
}

export type {FantomRenderedOutput};

export default function getFantomRenderedOutput(
  surfaceId: RootTag,
  config: RenderOutputConfig,
): FantomRenderedOutput {
  const {
    includeRoot = false,
    includeLayoutMetrics = false,
    ...fantomConfig
  } = config;
  return new FantomRenderedOutput(
    JSON.parse(
      NativeFantom.getRenderedOutput(surfaceId, {
        includeRoot,
        includeLayoutMetrics,
      }),
    ),
    fantomConfig,
  );
}

function convertRawJsonToJSX(
  actualJSON: FantomJsonObject | ReadonlyArray<FantomJsonObject>,
): React.Node {
  let actualJSX;
  /* $FlowFixMe[invalid-compare] Error discovered during Constant Condition
   * roll out. See https://fburl.com/workplace/5whu3i34. */
  if (actualJSON === null || typeof actualJSON === 'string') {
    actualJSX = actualJSON;
  } else if (Array.isArray(actualJSON)) {
    if (actualJSON.length === 0) {
      actualJSX = null;
    } else if (actualJSON.length === 1) {
      actualJSX = jsonChildToJSXChild(actualJSON[0]);
    } else {
      const actualJSXChildren = jsonChildrenToJSXChildren(actualJSON);
      if (actualJSXChildren === null || typeof actualJSXChildren === 'string') {
        actualJSX = actualJSXChildren;
      } else {
        actualJSX = <>{actualJSXChildren}</>;
      }
    }
  } else {
    actualJSX = jsonChildToJSXChild(actualJSON);
  }

  return actualJSX;
}

function createJSXElementForTestComparison(
  type: string,
  props: unknown,
  key?: ?string,
): React.Node {
  const Tag = type;
  return <Tag key={key} {...props} />;
}

function rnTypeToTestType(type: string): string {
  return `rn-${type.substring(0, 1).toLowerCase() + type.substring(1)}`;
}

function jsonChildToJSXChild(
  jsonChild: FantomJsonObject | string,
  index?: ?number,
): React.Node {
  if (typeof jsonChild === 'string') {
    return jsonChild;
  } else {
    const jsxChildren = jsonChildrenToJSXChildren(jsonChild.children);
    const type = rnTypeToTestType(jsonChild.type);
    return createJSXElementForTestComparison(
      type,
      jsxChildren == null
        ? jsonChild.props
        : {...jsonChild.props, children: jsxChildren},
      index != null ? String(index) : undefined,
    );
  }
}

function jsonChildrenToJSXChildren(jsonChildren: FantomJsonObject['children']) {
  if (jsonChildren.length === 1) {
    return jsonChildToJSXChild(jsonChildren[0]);
  } else if (jsonChildren.length > 1) {
    const jsxChildren = [];
    let allJSXChildrenAreStrings = true;
    let jsxChildrenString = '';
    for (let i = 0; i < jsonChildren.length; i++) {
      const jsxChild = jsonChildToJSXChild(jsonChildren[i], i);
      jsxChildren.push(jsxChild);
      if (allJSXChildrenAreStrings) {
        if (typeof jsxChild === 'string') {
          jsxChildrenString += jsxChild;
        } else if (jsxChild !== null) {
          allJSXChildrenAreStrings = false;
        }
      }
    }
    return allJSXChildrenAreStrings ? jsxChildrenString : jsxChildren;
  }

  return null;
}
