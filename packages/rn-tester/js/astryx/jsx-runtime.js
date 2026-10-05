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
 * JSX runtime for the Astryx layer, giving CSS custom properties inheritance
 * across elements.
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

import type {BoxSize, ElementDescriptor} from './css';
import type {VarScope} from './stylex-rn';

import {
  cssVersion,
  hasStylesheets,
  isVisuallyHidden,
  resolveCssForElement,
  rootVariables,
  subscribeCss,
  withoutOutrankedBoxEdges,
} from './css';
import {
  CONTAINER_BLOCK_SIZE,
  CONTAINER_INLINE_SIZE,
  VIEWPORT_BLOCK_SIZE,
  VIEWPORT_INLINE_SIZE,
  containerFromDeclarations,
  scopeSize,
} from './css/match';
import Dialog from './elements/Dialog';
import Input from './elements/Input';
import TextArea from './elements/TextArea';
import {parseTransformString, resolveInherited} from './stylex-rn';
import {CurrentColorContext} from './svg/CurrentColor';
import {Svg, SvgCircle, SvgLine, SvgPath, SvgRect} from './svg/Svg';
import {useInteractionState} from './useInteractionState';
import * as React from 'react';
import {StyleSheet} from 'react-native';
import {
  Fragment as ReactFragment,
  jsx as reactJsx,
  jsxs as reactJsxs,
} from 'react/jsx-runtime';

// The custom properties in scope for a subtree. `null` is the root scope
// (only global design tokens apply).
const VarScopeContext: React.Context<?VarScope> = React.createContext(null);

// The ancestor chain for stylesheet selector matching (`.card .title`,
// `.dark` theming). Ancestor descriptors carry structure — tag, classes,
// attributes — not live interaction state, so ancestor-state selectors
// (`.group:hover .x`) do not match.
// DOM-CSS-LIMITATION(ancestor-state-selectors)
const ElementDescriptorContext: React.Context<ElementDescriptor | null> =
  React.createContext(null);

// Attributes that participate in selector matching, beyond data-*.
const MATCHABLE_ATTRIBUTES = ['id', 'disabled', 'type', 'role', 'dir'];

function buildAttributes(props: {[string]: unknown}): {[string]: unknown} {
  const attributes: {[string]: unknown} = {};
  for (const key of Object.keys(props)) {
    if (key.startsWith('data-') || key.startsWith('aria-')) {
      attributes[key] = props[key];
    }
  }
  for (const key of MATCHABLE_ATTRIBUTES) {
    if (props[key] != null) {
      attributes[key] = props[key];
    }
  }
  return attributes;
}

type IntrinsicProps = {
  __astryxTag: string,
  className?: string,
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
  const parentDescriptor = React.useContext(ElementDescriptorContext);
  // A query container's laid-out size, for its descendants' container
  // queries and container units (null until the first layout, and for every
  // element that is not a container)
  const [containerSize, setContainerSize] = React.useState<?BoxSize>(null);
  // Any change to the stylesheet environment — installation, appearance,
  // window size — re-renders every intrinsic so matches recompute.
  React.useSyncExternalStore(subscribeCss, cssVersion);
  const {
    style: styleProp,
    __stylexStyle,
    __stylexVars,
    __stylexContainer,
    __startingStyle,
    className,
    children,
    ...rest
  } = props;

  // Interaction tracking for stylesheet pseudo-classes. The hook always
  // runs (hook-order stability); its handlers attach only when some
  // candidate rule actually gates on state.
  const {state: interaction, handlers: interactionHandlers} =
    useInteractionState({disabled: rest.disabled === true});

  const descriptor: ElementDescriptor = {
    tag: typeof __astryxTag === 'string' ? __astryxTag.toLowerCase() : null,
    classes:
      typeof className === 'string' && className !== ''
        ? className.split(/\s+/).filter(Boolean)
        : [],
    attributes: buildAttributes(rest),
    // Live, not empty: this descriptor is what DESCENDANTS match their
    // ancestor compounds against, so `.group:hover .x` can only work if the
    // group's hover state is actually in it.
    states: {
      hovered: interaction.hovered === true,
      pressed: interaction.pressed === true,
      focused: interaction.focused === true,
      focusVisible: interaction.focused === true,
      disabled: rest.disabled === true,
    },
    parent: parentDescriptor,
    container: null,
  };

  const css = hasStylesheets()
    ? resolveCssForElement(
        descriptor,
        {
          hovered: interaction.hovered === true,
          pressed: interaction.pressed === true,
          focused: interaction.focused === true,
          focusVisible: interaction.focused === true,
          disabled: rest.disabled === true,
        },
        // The media queries see the host surface's viewport where one has
        // declared it (an app's screen, a split view's column), else the window
        scopeSize(inheritedScope, VIEWPORT_INLINE_SIZE, VIEWPORT_BLOCK_SIZE),
      )
    : {
        style: null,
        strongStyle: null,
        vars: null,
        dependsOnStates: false,
        container: null,
      };
  // A query container, for its descendants' container queries: declared by a
  // matched rule, the element's StyleX styles, or an inline style
  descriptor.container =
    css.container ??
    (__stylexContainer as $FlowFixMe) ??
    containerFromInlineStyle(styleProp);
  descriptor.containerSize =
    descriptor.container != null ? containerSize : null;

  // A naked `style` attribute written after a stylex spread clobbers the
  // spread's `style` — on the web they are separate channels (className +
  // inline style), so vendored sources write exactly that. props() plants the
  // resolved styles under `__stylexStyle` too; when the two diverge, the
  // inline override layers on top, per-property, as it would on the web.
  const authorStyle =
    __stylexStyle != null &&
    styleProp != null &&
    styleProp !== __stylexStyle &&
    typeof styleProp === 'object' &&
    !Array.isArray(styleProp)
      ? {...__stylexStyle, ...styleProp}
      : (styleProp ?? __stylexStyle);
  // Stylesheet declarations sit UNDER stylex/inline styles: an inline style
  // beats a matched rule, per the cascade.
  //
  // Merging by key IS that cascade, but only while both layers spell an edge
  // the same way. Where they do not, the sheet gives up the edges the author
  // has claimed first; see `withoutOutrankedBoxEdges`.
  let style = authorStyle;
  if (css.style != null) {
    if (
      authorStyle != null &&
      typeof authorStyle === 'object' &&
      !Array.isArray(authorStyle)
    ) {
      style = {
        ...withoutOutrankedBoxEdges(css.style, authorStyle),
        ...authorStyle,
      };
    } else if (authorStyle == null) {
      style = css.style;
    }
  }
  // DOM-CSS-DEVIATION(stylex-is-a-layer): a StyleX style is taken for what it
  // is on the web, a rule in the `astryx-base` cascade layer. A sheet rule in
  // a layer above it, or unlayered — the theme's `@layer astryx-theme`
  // `.astryx-heading[data-level="1"]` — beats it there and does here; a rule
  // in that layer or below sits under it, as above. An inline `style` beats
  // them all. A sheet that orders no such layer leaves every rule under
  // StyleX, as before.
  if (css.strongStyle != null && style == null) {
    style = css.strongStyle;
  } else if (
    css.strongStyle != null &&
    style != null &&
    typeof style === 'object'
  ) {
    const inlineOverride = inlineStyleOverride(styleProp, __stylexStyle);
    const outranked = withoutOutrankedBoxEdges(
      (Array.isArray(style) ? StyleSheet.flatten(style) : style) ?? {},
      css.strongStyle,
    );
    style =
      inlineOverride != null
        ? {
            ...withoutOutrankedBoxEdges(outranked, inlineOverride),
            ...css.strongStyle,
            ...inlineOverride,
          }
        : {...outranked, ...css.strongStyle};
  }

  // A CSS transform STRING in an inline style (style={{transform:
  // 'translateX(-70%)'}}, which is how web components position things such
  // as shadcn's Progress fill) is a web-ism RN's style pipeline does not
  // parse. Normalize it to the array form here, where percentages survive
  // as strings for the native side to resolve against layout. Stylesheet
  // transforms already went through this in the value pipeline.
  if (
    style != null &&
    typeof style === 'object' &&
    !Array.isArray(style) &&
    typeof style.transform === 'string'
  ) {
    const parsedTransform = parseTransformString(style.transform);
    if (parsedTransform != null) {
      style = {...style, transform: parsedTransform};
    }
  }

  // Custom properties: stylesheet-matched vars underlie stylex-declared ones.
  let mergedVars =
    css.vars != null
      ? __stylexVars != null
        ? {...css.vars, ...__stylexVars}
        : css.vars
      : __stylexVars;
  // Custom properties written in an inline style (`style={{'--x': …}}`),
  // which the host would not know what to do with, are the element's
  // declarations like any other
  const inlineVars = inlineCustomProperties(style);
  if (inlineVars != null) {
    mergedVars = {...(mergedVars ?? {}), ...inlineVars.vars};
    style = inlineVars.style;
  }
  // A laid-out container tells its descendants its size, for their
  // container units (see css/match.js, CONTAINER_INLINE_SIZE). A container
  // opens a scope of its own from its first render, size or no size, so the
  // provider it needs once laid out does not remount its subtree.
  if (descriptor.container != null) {
    mergedVars =
      containerSize != null
        ? {
            ...(mergedVars ?? {}),
            [CONTAINER_INLINE_SIZE]: `${containerSize.width}px`,
            [CONTAINER_BLOCK_SIZE]: `${containerSize.height}px`,
          }
        : (mergedVars ?? {});
  }

  // With no ancestor scope, stylesheet :root variables (scheme-aware) form
  // the base the inheritance pass resolves against.
  const baseScope = React.useMemo(() => {
    if (inheritedScope != null || !hasStylesheets()) {
      return inheritedScope;
    }
    const rootVars = rootVariables();
    if (rootVars == null) {
      return inheritedScope;
    }
    const scope = new Map<string, unknown>();
    for (const key of Object.keys(rootVars)) {
      scope.set(key, rootVars[key]);
    }
    return scope;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inheritedScope, cssVersion()]);

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
    mergedVars,
    baseScope,
  );

  const mapped = ELEMENT_COMPONENTS[__astryxTag];
  const mergedStyle =
    entryStyle != null ? [resolvedStyle, entryStyle] : resolvedStyle;
  // Interaction handlers attach only when a candidate rule gates on state,
  // composing WITH any handlers the author passed rather than replacing
  // them.
  const stateProps = css.dependsOnStates
    ? composeInteractionHandlers(rest, interactionHandlers)
    : rest;
  const hostProps =
    mergedStyle != null
      ? {...stateProps, style: mergedStyle, children}
      : {...stateProps, children};
  if (descriptor.container != null) {
    // A query container measures itself; the size reaches its descendants
    // on the next render, through the descriptor and the scope
    const authored = rest.onLayout;
    hostProps.onLayout = (event: $FlowFixMe) => {
      if (typeof authored === 'function') {
        (authored as $FlowFixMe)(event);
      }
      const {width, height} = event.nativeEvent.layout;
      setContainerSize(previous =>
        previous != null &&
        previous.width === width &&
        previous.height === height
          ? previous
          : {width, height},
      );
    };
  }
  if (mapped != null) {
    // Behavior-mapped element (e.g. <input> → TextInput). For most of these
    // children are noise (a TextInput renders any it is given as text), so
    // they are dropped; the ones whose children are their content, such as
    // `<svg>` and its shapes, keep them.
    // $FlowFixMe[incompatible-type] props flow through untyped by design here
    let componentProps: $FlowFixMe = hostProps;
    if (!ELEMENT_COMPONENTS_KEEPING_CHILDREN.has(__astryxTag)) {
      const {children: _ignored, ...withoutChildren} = hostProps;
      componentProps = withoutChildren;
    }
    let mappedElement = reactJsx(mapped, componentProps);
    if (hasStylesheets()) {
      mappedElement = (
        <ElementDescriptorContext.Provider value={descriptor}>
          {mappedElement}
        </ElementDescriptorContext.Provider>
      );
    }
    return scope === baseScope ? (
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
  // The same host type on every commit, including the entry ones: a type
  // change would remount the element between the `@starting-style` commit
  // and the final one, and a fresh native view has no previous value for
  // the native transition to run from.
  // The visually-hidden clip pattern renders nothing at all here (see
  // isVisuallyHidden): its text cannot be both invisible and announced on
  // this platform, and showing it is the worse of the two failures.
  if (isVisuallyHidden(css.style)) {
    return null;
  }

  let element;
  if (displayIsContents(mergedStyle)) {
    // `display: contents` (css-display-3 §2.5): the element generates no box
    // and its children take its place in the parent — as flex items of a
    // flex parent, as text in a line. Rendering the children in its place is
    // exactly that; a host view that Yoga lays out as `contents` would still
    // fold text-level children into a run of its own, and a button's label and
    // icon, wrapped in such a span, would sit in one line with no gap between
    // them. The contexts above still publish the element's descriptor, its
    // custom properties and its colour to the children.
    element = <ReactFragment>{children}</ReactFragment>;
  } else {
    element = Array.isArray(children)
      ? reactJsxs(__astryxTag, hostProps)
      : reactJsx(__astryxTag, hostProps);
  }

  // `color` is what SVG's currentColor means, and icon sets are built on
  // it: the value is set on an ANCESTOR (a checked checkbox says
  // `text-primary-foreground` on the control, never on its checkmark), so
  // publish it for any descendant that has to paint with it.
  const resolvedColor: $FlowFixMe =
    resolvedStyle != null && typeof resolvedStyle === 'object'
      ? (resolvedStyle as $FlowFixMe).color
      : null;
  if (
    typeof resolvedColor === 'string' &&
    resolvedColor.toLowerCase() !== 'currentcolor'
  ) {
    element = (
      <CurrentColorContext.Provider value={resolvedColor}>
        {element}
      </CurrentColorContext.Provider>
    );
  }

  // With stylesheets installed, descendants match ancestor compounds
  // (`.card .title`) against this chain. No sheets, no provider.
  if (hasStylesheets()) {
    element = (
      <ElementDescriptorContext.Provider value={descriptor}>
        {element}
      </ElementDescriptorContext.Provider>
    );
  }

  // Only elements that declare custom properties open a new scope; everything
  // else reuses the ancestor's provider, so the common case adds no provider.
  if (scope === baseScope) {
    return element;
  }
  return (
    <VarScopeContext.Provider value={scope}>{element}</VarScopeContext.Provider>
  );
}

/**
 * Merges the runtime's interaction handlers with author-passed ones: both
 * run, author's first.
 */
function composeInteractionHandlers(
  rest: {[string]: unknown},
  handlers: {[string]: (e: $FlowFixMe) => void},
): {[string]: unknown} {
  const out: {[string]: unknown} = {...rest};
  for (const name of Object.keys(handlers)) {
    const authored = rest[name];
    const own = handlers[name];
    out[name] =
      typeof authored === 'function'
        ? (event: $FlowFixMe) => {
            (authored as $FlowFixMe)(event);
            own(event);
          }
        : own;
  }
  return out;
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

function containerFromInlineStyle(style: unknown): ?{names: Array<string>} {
  if (style == null || typeof style !== 'object') {
    return null;
  }
  const flat: ?{[string]: unknown} = Array.isArray(style)
    ? StyleSheet.flatten(style as $FlowFixMe)
    : (style as $FlowFixMe);
  if (flat == null) {
    return null;
  }
  return containerFromDeclarations(
    flat.containerType,
    flat.containerName,
    flat.container,
  );
}

/**
 * The `--custom-property` keys of a style and the style without them, or
 * null when it has none.
 */
function inlineCustomProperties(
  style: unknown,
): ?{vars: {[string]: unknown}, style: {[string]: unknown}} {
  if (style == null || typeof style !== 'object') {
    return null;
  }
  const flat: ?{[string]: unknown} = Array.isArray(style)
    ? StyleSheet.flatten(style as $FlowFixMe)
    : (style as $FlowFixMe);
  if (flat == null) {
    return null;
  }
  let vars: ?{[string]: unknown} = null;
  for (const key of Object.keys(flat)) {
    if (key.startsWith('--')) {
      const bucket: {[string]: unknown} = vars ?? {};
      bucket[key] = flat[key];
      vars = bucket;
    }
  }
  if (vars == null) {
    return null;
  }
  const rest: {[string]: unknown} = {};
  for (const key of Object.keys(flat)) {
    if (!key.startsWith('--')) {
      rest[key] = flat[key];
    }
  }
  return {vars, style: rest};
}

function displayIsContents(style: unknown): boolean {
  if (style == null || typeof style !== 'object') {
    return false;
  }
  const flat: ?{[string]: unknown} = Array.isArray(style)
    ? StyleSheet.flatten(style as $FlowFixMe)
    : (style as $FlowFixMe);
  return flat?.display === 'contents';
}

/**
 * The part of an element's `style` that is an inline style rather than its
 * StyleX spread: the keys a naked `style` attribute set beyond (or differently
 * from) `__stylexStyle`. With no StyleX spread, the whole style is inline.
 */
function inlineStyleOverride(
  styleProp: unknown,
  stylexStyle: ?{[string]: unknown},
): ?{[string]: unknown} {
  if (styleProp == null || typeof styleProp !== 'object') {
    return null;
  }
  const flat: ?{[string]: unknown} = Array.isArray(styleProp)
    ? StyleSheet.flatten(styleProp as $FlowFixMe)
    : (styleProp as $FlowFixMe);
  if (flat == null) {
    return null;
  }
  if (stylexStyle == null || flat === stylexStyle) {
    return stylexStyle == null ? flat : null;
  }
  let override: ?{[string]: unknown} = null;
  for (const key of Object.keys(flat)) {
    if (flat[key] !== stylexStyle[key] && flat[key] !== undefined) {
      const bucket: {[string]: unknown} = override ?? {};
      bucket[key] = flat[key];
      override = bucket;
    }
  }
  return override;
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
