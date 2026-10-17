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

/**
 * JSX runtime for the Astryx layer: the seam where an HTML or SVG element in
 * the vendored sources becomes what the renderer draws.
 *
 * The renderer's style engine (ReactCommon/react/renderer/cssengine) styles
 * the elements while a tree is committed, so an element is one host node that
 * names its inputs (native-css/EngineElement.js), or a component where it
 * needs one: an SVG drawing, a field, a scroll container, the top layer.
 * Vendored Astryx sources render intrinsics (`<div>`, `<p>`) directly, so the
 * only way to route them without editing the sources is to intercept JSX
 * creation, the same build-level seam StyleX itself uses on the web. Babel
 * points the astryx directory at this runtime (see
 * packages/rn-tester/.babelrc.js); Metro resolves the module id (see
 * metro.config.js).
 *
 * Composite components pass straight through untouched.
 */

import {installStylesheet} from './css';
import EngineElement, {hostPropsFor} from './native-css/EngineElement';
import {EngineSvg, SvgCircle, SvgLine, SvgPath, SvgRect} from './svg/Svg';
import * as React from 'react';
import {
  Fragment as ReactFragment,
  jsx as reactJsx,
  jsxs as reactJsxs,
} from 'react/jsx-runtime';

/**
 * `<style>{css}</style>`: a stylesheet where a page puts one — the templates
 * carry a container query or an override this way — installed in the style
 * engine, as a `<style>` appended to the stub document's head is, and drawn
 * as nothing. Installed once per distinct text, since a sheet, like the
 * web's, is document-wide and outlives the element: a re-render, or a second
 * page carrying the same text, adds nothing. Installed as the page renders,
 * so the commit that mounts the page is styled under it; installing it after
 * would restyle the whole page once more.
 */
const installedStyleTexts: Set<string> = new Set();

function StyleElement({children}: {children?: unknown}): React.Node {
  const css = React.Children.toArray<$FlowFixMe>(children as $FlowFixMe)
    .filter(child => typeof child === 'string' || typeof child === 'number')
    .join('');
  if (css !== '' && !installedStyleTexts.has(css)) {
    installedStyleTexts.add(css);
    installStylesheet(css);
  }
  return null;
}

/**
 * The SVG elements, which draw as components: the shapes inside an `<svg>`
 * styled like any element
 */
const SVG_COMPONENTS: {[string]: React.ComponentType<any>} = {
  svg: EngineSvg,
  path: SvgPath,
  circle: SvgCircle,
  rect: SvgRect,
  line: SvgLine,
};

function wrap(type: unknown, props: unknown): [unknown, unknown] {
  if (typeof type !== 'string') {
    return [type, props];
  }
  // A capitalized name is a native component (`AstryxVectorShape`, what a
  // codegen'd component is to React), not an HTML or SVG element: it takes
  // React Native's props as they are, and no stylesheet selects it
  const first = type.charCodeAt(0);
  if (first >= 65 && first <= 90) {
    return [type, props];
  }
  if (type === 'style') {
    return [StyleElement, props];
  }
  const svgComponent = SVG_COMPONENTS[type];
  if (svgComponent != null) {
    // $FlowFixMe[incompatible-type] intrinsic props
    return [svgComponent, {...props, __astryxTag: type}];
  }
  // The element as its host node, where it needs nothing else
  const hostProps = hostPropsFor(type, props as $FlowFixMe);
  if (hostProps != null) {
    return [type, hostProps];
  }
  // $FlowFixMe[incompatible-type] intrinsic props
  return [EngineElement, {...props, __astryxTag: type}];
}

export function jsx(type: unknown, props: unknown, key?: unknown): React.Node {
  const [t, p] = wrap(type, props);
  // $FlowFixMe[incompatible-call] passthrough to the React runtime
  return reactJsx(t, p, key);
}

export function jsxs(type: unknown, props: unknown, key?: unknown): React.Node {
  const [t, p] = wrap(type, props);
  // $FlowFixMe[incompatible-call] passthrough to the React runtime
  return reactJsxs(t, p, key);
}

// The dev runtime carries extra debug args; the wrapping is identical.
export function jsxDEV(
  type: unknown,
  props: unknown,
  key?: unknown,
  isStaticChildren?: unknown,
  source?: unknown,
  self?: unknown,
): React.Node {
  const [t, p] = wrap(type, props);
  // $FlowFixMe[incompatible-call] passthrough to the React runtime
  return reactJsx(t, p, key, isStaticChildren, source, self);
}

export const Fragment: typeof ReactFragment = ReactFragment;
