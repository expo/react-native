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
 * JSX runtime for the Astryx layer, giving CSS custom properties real
 * **inheritance** across elements (M3).
 *
 * Why a JSX runtime: on web, a custom property set on an ancestor is visible
 * to every descendant. `stylex.props()` runs inside a component and cannot
 * see the tree, so the inheritance has to happen at the *element*. Vendored
 * Astryx sources render intrinsics (`<div>`, `<p>`) directly, so the only way
 * to wrap them without editing the sources is to intercept JSX creation —
 * the same build-level seam StyleX itself uses on web. Babel points the
 * astryx directory at this runtime (see packages/rn-tester/.babelrc.js); Metro
 * resolves the module id (see metro.config.js).
 *
 * Composite components pass straight through untouched; only lowercase
 * intrinsics are wrapped, and only they pay for the extra component.
 */

import type {VarScope} from './stylex-rn';

import Dialog from './elements/Dialog';
import Input from './elements/Input';
import {resolveInherited} from './stylex-rn';
import * as React from 'react';
import {
  Fragment as ReactFragment,
  jsx as reactJsx,
  jsxs as reactJsxs,
} from 'react/jsx-runtime';

// The custom properties in scope for a subtree. `null` is the root scope
// (only global design tokens apply).
const VarScopeContext: React.Context<?VarScope> = React.createContext(null);

type IntrinsicProps = {
  __astryxTag: string,
  style?: {[string]: unknown},
  __stylexVars?: {[string]: unknown},
  children?: React.Node,
  [string]: unknown,
};

/**
 * Renders one intrinsic element: finishes any style values that were waiting
 * on an inherited custom property, then publishes its own declarations to the
 * subtree.
 */
function IntrinsicElement({__astryxTag, ...props}: IntrinsicProps): React.Node {
  const inheritedScope = React.useContext(VarScopeContext);
  const {style, __stylexVars, children, ...rest} = props;

  const {style: resolvedStyle, scope} = resolveInherited(
    style,
    __stylexVars,
    inheritedScope,
  );

  const mapped = ELEMENT_COMPONENTS[__astryxTag];
  const hostProps =
    resolvedStyle != null
      ? {...rest, style: resolvedStyle, children}
      : {...rest, children};
  if (mapped != null) {
    // Behavior-mapped element (e.g. <input> → TextInput). Children are not
    // meaningful for these; drop them rather than passing them through.
    const {children: _ignored, ...componentProps} = hostProps;
    const mappedElement = reactJsx(mapped, componentProps);
    return scope === inheritedScope ? (
      mappedElement
    ) : (
      <VarScopeContext.Provider value={scope}>
        {mappedElement}
      </VarScopeContext.Provider>
    );
  }
  // Build the host element through React's runtime directly — going back
  // through this module's `jsx` would re-enter the wrapper forever.
  const element = Array.isArray(children)
    ? reactJsxs(__astryxTag, hostProps)
    : reactJsx(__astryxTag, hostProps);

  // Only elements that declare custom properties open a new scope; everything
  // else reuses the ancestor's provider, so the common case adds no provider.
  if (scope === inheritedScope) {
    return element;
  }
  return (
    <VarScopeContext.Provider value={scope}>{element}</VarScopeContext.Provider>
  );
}

/**
 * Elements that need *behavioral* translation rather than a view-config
 * alias: the web's prop vocabulary mapped onto an RN component. Pure
 * containers (<div>, <p>, <button>) stay intrinsics and go through
 * IntrinsicElement below.
 */
const ELEMENT_COMPONENTS: {[string]: React.ComponentType<any>} = {
  input: Input,
  dialog: Dialog,
};

function wrap(type: unknown, props: unknown): [unknown, unknown] {
  if (typeof type !== 'string') {
    return [type, props];
  }
  const component = ELEMENT_COMPONENTS[type];
  if (component != null) {
    // Still routed through IntrinsicElement so it participates in custom
    // property inheritance (it may read inherited padding tokens); the
    // wrapper renders `component` instead of a host tag.
    // $FlowFixMe[incompatible-type] intrinsic props
    return [IntrinsicElement, {...props, __astryxTag: type}];
  }
  // $FlowFixMe[incompatible-type] intrinsic props
  return [IntrinsicElement, {...props, __astryxTag: type}];
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

export {VarScopeContext};
