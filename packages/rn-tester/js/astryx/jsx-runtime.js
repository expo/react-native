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
import {resolveInherited} from './stylex-rn';
import {Svg, SvgCircle, SvgLine, SvgPath, SvgRect} from './svg/Svg';
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
  __stylexStyle?: {[string]: unknown},
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
    style: styleProp,
    __stylexStyle,
    __stylexVars,
    __startingStyle,
    children,
    ...rest
  } = props;
  // A naked `style` attribute written after a stylex spread clobbers the
  // spread's `style` — on the web they are separate channels (className +
  // inline style), so vendored sources write exactly that. props() plants the
  // resolved styles under `__stylexStyle` too; when the two diverge, the
  // inline override layers on top, per-property, as it would on the web.
  const style =
    __stylexStyle != null &&
    styleProp != null &&
    styleProp !== __stylexStyle &&
    typeof styleProp === 'object' &&
    !Array.isArray(styleProp)
      ? {...__stylexStyle, ...styleProp}
      : (styleProp ?? __stylexStyle);

  // `@starting-style` (css-transitions-2 §3), the way the web runs it: the
  // element's first commit renders the starting values, the effect below
  // drops them, and the renderer's native CSS transitions — declared in this
  // same style — animate to the real values off the JS thread. Two commits,
  // no animation code. The hook order is stable: the hooks run
  // unconditionally and only their values depend on the block's presence.
  const [entered, setEntered] = React.useState(false);
  React.useEffect(() => {
    if (__startingStyle != null) {
      setEntered(true);
    }
    // Mount-only by design: `@starting-style` is about first appearance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const entryStyle =
    __startingStyle != null && !entered
      ? (__startingStyle as $FlowFixMe)
      : null;

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
  // The SAME host type on every commit, including the entry ones: the old
  // Animated entry path swapped in an animated tag while animating, and with
  // the two-commit `@starting-style` that swap would REMOUNT the element
  // between the starting commit and the final one — a fresh native view has
  // no previous value, so the native transition would never run.
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
