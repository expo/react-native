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
import TextArea from './elements/TextArea';
import {useEntryTransition} from './startingStyle';
import {resolveInherited} from './stylex-rn';
import {Svg, SvgCircle, SvgLine, SvgPath, SvgRect} from './svg/Svg';
import * as React from 'react';
import {Animated} from 'react-native';
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
  const {
    style,
    __stylexVars,
    __startingStyle,
    __entryTransition,
    children,
    ...rest
  } = props;

  // `@starting-style`: animate from the starting values on mount. The hook is
  // called unconditionally — it returns null when there is nothing to animate
  // — because React requires a stable hook order.
  const entryStyle = useEntryTransition(
    __startingStyle as $FlowFixMe,
    __entryTransition as $FlowFixMe,
  );

  const {style: resolvedStyle, scope} = resolveInherited(
    style,
    __stylexVars,
    inheritedScope,
  );

  const mapped = ELEMENT_COMPONENTS[__astryxTag];
  const mergedStyle =
    entryStyle != null ? [resolvedStyle, entryStyle] : resolvedStyle;
  const hostProps =
    mergedStyle != null
      ? {...rest, style: mergedStyle, children}
      : {...rest, children};
  if (mapped != null) {
    // Behavior-mapped element (e.g. <input> → TextInput). For most of these
    // children are noise — a TextInput renders any it is given as text — so
    // they are dropped. For the ones whose children ARE their content they
    // must be kept, which `<svg>` made unavoidable: its children are the
    // shapes. `<dialog>` was in the same position and had the same bug, it
    // simply never showed because the demo imports the component directly
    // rather than writing the element.
    // $FlowFixMe[incompatible-type] props flow through untyped by design here
    let componentProps: $FlowFixMe = hostProps;
    if (!ELEMENT_COMPONENTS_KEEPING_CHILDREN.has(__astryxTag)) {
      const {children: _ignored, ...withoutChildren} = hostProps;
      componentProps = withoutChildren;
    }
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
  //
  // An element mid-entry-animation renders through an animated version of the
  // SAME tag rather than inside an `Animated.View`: a wrapper would add a box
  // to the tree, and for the absolutely-positioned overlays that use
  // `@starting-style` it would change their containing block.
  const hostType = entryStyle != null ? animatedTag(__astryxTag) : __astryxTag;
  const element = Array.isArray(children)
    ? reactJsxs(hostType, hostProps)
    : reactJsx(hostType, hostProps);

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
  textarea: TextArea,
  dialog: Dialog,
  // The SVG subset. These are lowercase intrinsics like any other element —
  // authors write <svg><path d="…"/></svg>, not <Svg><Path/></Svg> — but they
  // need behavioural translation because their geometry is parsed in JS and
  // handed to a drawing view. See svg/Svg.js for what the subset covers.
  svg: Svg,
  path: SvgPath,
  circle: SvgCircle,
  rect: SvgRect,
  line: SvgLine,
};

/**
 * Behaviour-mapped elements whose children are their content.
 */
const ELEMENT_COMPONENTS_KEEPING_CHILDREN: Set<string> = new Set([
  'svg',
  'dialog',
]);

/**
 * The animated counterpart of a host tag, made once per tag.
 *
 * `Animated.createAnimatedComponent` accepts a host tag directly, so this
 * needs no wrapper element — the same `<div>` simply becomes able to read an
 * `Animated.Value` from its style.
 */
const animatedTags: {[string]: React.ComponentType<any>} = {};
function animatedTag(tag: string): React.ComponentType<any> {
  let animated = animatedTags[tag];
  if (animated == null) {
    // A host tag IS a valid component to React; Flow's signature only admits
    // ComponentType. Verified at runtime before relying on it.
    animated = Animated.createAnimatedComponent(tag as $FlowFixMe);
    animatedTags[tag] = animated;
  }
  return animated;
}

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
