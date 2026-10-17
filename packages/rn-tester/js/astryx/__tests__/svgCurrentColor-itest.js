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
 * An icon paints with `currentColor`, the colour the engine resolved for its
 * `<svg>`, whether a JSX expression built it or a component that calls
 * `React.createElement` (the vendored sources and the icon packages, which
 * Metro hands `react-with-runtime.js`).
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import {registerFrameworkComponent} from '../../../../expo-intrinsics/src/ElementRegistry';
import {jsx} from '../jsx-runtime';
import {EngineSvg, SvgPath} from '../svg/Svg';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {processColor} from 'react-native';
import {getInternalInstanceHandleFromPublicInstance} from 'react-native/react-private-interface';

const ReactWithRuntime = require('../react-with-runtime');

// React's own `createElement`, which an icon library's prebuilt components
// call outside the Astryx runtime; typed loosely, as Flow's library does not
// declare it callable
const reactCreateElement: $FlowFixMe = React.createElement;

// The paint each shape under the `<svg>` was drawn with, in tree order, read
// off the props its host was given
function shapePaint(
  svg: {current: $FlowFixMe},
  paint: 'fillColor' | 'strokeColor',
): Array<unknown> {
  const fills: Array<unknown> = [];
  const walk = (fiber: $FlowFixMe) => {
    for (let node = fiber; node != null; node = node.sibling) {
      if (node.type === 'AstryxVectorShape') {
        fills.push(node.memoizedProps[paint]);
      }
      walk(node.child);
    }
  };
  const handle: $FlowFixMe = getInternalInstanceHandleFromPublicInstance(
    svg.current,
  );
  walk(currentFiber(handle)?.child);
  return fills;
}

// The fiber of the committed tree for the host `fiber` stands for, of the
// two React keeps: found from the root's current fiber down, since an old
// fiber's own links can lead back into the current tree
function currentFiber(fiber: $FlowFixMe): $FlowFixMe {
  let root = fiber;
  while (root.return != null) {
    root = root.return;
  }
  const find = (node: $FlowFixMe): $FlowFixMe => {
    for (let child = node; child != null; child = child.sibling) {
      if (child.stateNode === fiber.stateNode) {
        return child;
      }
      const found = find(child.child);
      if (found != null) {
        return found;
      }
    }
    return null;
  };
  return find(root.stateNode.current);
}

function renderInRed(icon: unknown): void {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      jsx('div', {
        style: {color: 'rgb(255, 0, 0)'},
        children: icon,
      }) as $FlowFixMe,
    );
  });
  // The `<svg>` reads its colour after layout and draws again
  Fantom.runWorkLoop();
}

const RED = processColor('rgba(255, 0, 0, 1)');

describe('an icon', () => {
  it('built as JSX paints with the colour its element resolved', () => {
    const svg = React.createRef<$FlowFixMe>();
    renderInRed(
      jsx('svg', {
        ref: svg,
        viewBox: '0 0 24 24',
        width: 24,
        height: 24,
        children: jsx('path', {d: 'M0 0 L24 24 L0 24 Z', fill: 'currentColor'}),
      }),
    );
    expect(shapePaint(svg, 'fillColor')).toEqual([RED]);
  });

  it('built with React.createElement paints with it too', () => {
    const svg = React.createRef<$FlowFixMe>();
    renderInRed(
      ReactWithRuntime.createElement(
        'svg',
        {ref: svg, viewBox: '0 0 24 24', width: 24, height: 24},
        ReactWithRuntime.createElement('path', {
          d: 'M0 0 L24 24 L0 24 Z',
          fill: 'currentColor',
        }),
      ),
    );
    expect(shapePaint(svg, 'fillColor')).toEqual([RED]);
  });

  it('stroked from its <svg>, as Heroicons builds one, paints the stroke', () => {
    // `stroke` on the root, inherited by a path that states none
    const svg = React.createRef<$FlowFixMe>();
    renderInRed(
      ReactWithRuntime.createElement(
        'svg',
        {
          ref: svg,
          xmlns: 'http://www.w3.org/2000/svg',
          fill: 'none',
          viewBox: '0 0 24 24',
          strokeWidth: 1.5,
          stroke: 'currentColor',
          'aria-hidden': 'true',
        },
        null,
        ReactWithRuntime.createElement('path', {
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          d: 'M4.5 12.75l6 6 9-13.5',
        }),
      ),
    );
    expect(shapePaint(svg, 'strokeColor')).toEqual([RED]);
    expect(shapePaint(svg, 'fillColor')).toEqual([0]);
  });

  it('built with React’s own createElement paints with it under the bare tag', () => {
    // As the apps register the engine's <svg> for a tag built outside the
    // runtime
    registerFrameworkComponent('svg', EngineSvg);
    registerFrameworkComponent('path', SvgPath);
    const svg = React.createRef<$FlowFixMe>();
    renderInRed(
      reactCreateElement(
        'svg',
        {ref: svg, viewBox: '0 0 24 24', width: 24, height: 24},
        reactCreateElement('path', {
          d: 'M0 0 L24 24 L0 24 Z',
          fill: 'currentColor',
        }),
      ),
    );
    expect(shapePaint(svg, 'fillColor')).toEqual([RED]);
  });
});
