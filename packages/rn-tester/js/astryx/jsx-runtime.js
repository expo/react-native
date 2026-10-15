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
import type {MarkerState} from './stylex-rn';

import {
  cssVersion,
  hasStylesheets,
  isVisuallyHidden,
  resolveCssForElement,
  rootVariables,
  subscribeCss,
  withoutOutrankedBoxEdges,
} from './css';
import {installStylesheet} from './css';
import {
  CONTAINER_BLOCK_SIZE,
  CONTAINER_INLINE_SIZE,
  VIEWPORT_BLOCK_SIZE,
  VIEWPORT_INLINE_SIZE,
  containerFromDeclarations,
  scopeSize,
} from './css/match';
import {registerElement} from './elementRegistry';
import Input from './elements/Input';
import TextArea from './elements/TextArea';
import TopLayerElement from './overlay/TopLayerElement';
import {
  EMPTY_MARKER_STATE,
  hasDescendantConditions,
  hasMarkers,
  parseTransformString,
  resolveInherited,
  resolveWhen,
} from './stylex-rn';
import {CurrentColorContext} from './svg/CurrentColor';
import {Svg, SvgCircle, SvgLine, SvgPath, SvgRect} from './svg/Svg';
import {useInteractionState} from './useInteractionState';
import {resolveRootRelativeSource} from '@react-native/expo-intrinsics-poc/src/rootRelativeSources';
import * as React from 'react';
import {Image, Platform, ScrollView, StyleSheet} from 'react-native';
import {
  Fragment as ReactFragment,
  jsx as reactJsx,
  jsxs as reactJsxs,
} from 'react/jsx-runtime';

// The custom properties in scope for a subtree. `null` is the root scope
// (only global design tokens apply).
const VarScopeContext: React.Context<?VarScope> = React.createContext(null);

/**
 * What every `stylex.when.*` condition in the subtree is answered from. StyleX
 * compiles these to a class on the marked element and a selector on the
 * descendant, which a browser answers out of the DOM; here the marked element
 * publishes the pseudo-classes it matches and the descendant reads them, in
 * the direction the custom-property scope already travels. `siblingBefore` /
 * `siblingAfter` need the markers on the elements either side of this one, so
 * a parent hands each child its own state.
 */
const MarkerStateContext: React.Context<MarkerState> =
  React.createContext<MarkerState>(EMPTY_MARKER_STATE);

/**
 * How a `when.descendant` question is answered. Every other relation travels
 * down, published by an ancestor before its subtree renders; this one travels
 * up, and a parent renders before its descendants exist. So marked elements
 * register with every asking ancestor in a layout effect, which runs after
 * commit and before paint, and an asker whose set changed re-renders in the
 * same cycle. The chain is a list because `:has()` is not limited to the
 * nearest ancestor. It converges because what is reported, structural position
 * and state pseudo-classes, never depends on the styles the answer produces.
 */
type DescendantRegistrar = (
  markerId: string,
  pseudos: ReadonlySet<string>,
) => () => void;

const DescendantRegistryContext: React.Context<
  ReadonlyArray<DescendantRegistrar>,
> = React.createContext<ReadonlyArray<DescendantRegistrar>>([]);

/**
 * For an element that asks about descendants: the collected answers, and the
 * chain to hand down so deeper marked elements report here too.
 */
function useDescendantMarkers(asks: boolean): {
  descendants: ReadonlyMap<string, ReadonlySet<string>>,
  chain: ReadonlyArray<DescendantRegistrar>,
} {
  const parentChain = React.useContext(DescendantRegistryContext);
  const [reported, setReported] = React.useState<
    ReadonlyMap<string, ReadonlySet<string>>,
  >(() => new Map());
  // Reference counts, so two descendants reporting the same pseudo do not
  // cancel each other when one unmounts
  const countsRef = React.useRef<Map<string, Map<string, number>>>(new Map());

  const register = React.useCallback<DescendantRegistrar>(
    (markerId, pseudos) => {
      const counts = countsRef.current;
      const forMarker = counts.get(markerId) ?? new Map<string, number>();
      counts.set(markerId, forMarker);
      for (const pseudo of pseudos) {
        forMarker.set(pseudo, (forMarker.get(pseudo) ?? 0) + 1);
      }
      setReported(snapshotCounts(counts));
      return () => {
        const current = countsRef.current.get(markerId);
        if (current == null) {
          return;
        }
        for (const pseudo of pseudos) {
          const next = (current.get(pseudo) ?? 0) - 1;
          if (next > 0) {
            current.set(pseudo, next);
          } else {
            current.delete(pseudo);
          }
        }
        if (current.size === 0) {
          countsRef.current.delete(markerId);
        }
        setReported(snapshotCounts(countsRef.current));
      };
    },
    [],
  );

  const chain = React.useMemo(
    () => (asks ? [...parentChain, register] : parentChain),
    [asks, parentChain, register],
  );

  return {descendants: asks ? reported : EMPTY_MARKER_STATE.descendants, chain};
}

/** A plain marker → pseudo-set view of the reference counts. */
function snapshotCounts(
  counts: Map<string, Map<string, number>>,
): ReadonlyMap<string, ReadonlySet<string>> {
  const out = new Map<string, ReadonlySet<string>>();
  for (const [markerId, pseudos] of counts) {
    out.set(markerId, new Set(pseudos.keys()));
  }
  return out;
}

/**
 * The structural pseudo-classes an element matches from its position among
 * siblings: the ones knowable without a layout pass or a DOM.
 */
function structuralPseudos(index: number, count: number): Set<string> {
  const pseudos = new Set<string>();
  if (index === 0) {
    pseudos.add(':first-child');
  }
  if (index === count - 1) {
    pseudos.add(':last-child');
  }
  if (count === 1) {
    pseudos.add(':only-child');
  }
  pseudos.add(`:nth-child(${index + 1})`);
  return pseudos;
}

/** A copy of `map` with `id`'s entry replaced — never a mutation of a parent's. */
function withMarker(
  map: ReadonlyMap<string, ReadonlySet<string>>,
  id: string,
  pseudos: ReadonlySet<string>,
): Map<string, ReadonlySet<string>> {
  const next = new Map(map);
  next.set(id, pseudos);
  return next;
}

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

// Whether two descriptors of one element say the same thing to a selector
function sameDescriptor(a: ElementDescriptor, b: ElementDescriptor): boolean {
  return (
    sameMatchedElement(a, b) &&
    sameContainer(a.container, b.container) &&
    sameBoxSize(a.containerSize, b.containerSize)
  );
}

function sameContainer(
  a: ?{readonly names: ReadonlyArray<string>, ...},
  b: ?{readonly names: ReadonlyArray<string>, ...},
): boolean {
  return (
    a === b ||
    (a != null && b != null && a.names.join(' ') === b.names.join(' '))
  );
}

// Whether two descriptors of one element match the same rules: the same
// element, state and ancestors, its own container aside (a container query
// asks about an ancestor)
function sameMatchedElement(
  a: ElementDescriptor,
  b: ElementDescriptor,
): boolean {
  return (
    a.tag === b.tag &&
    a.parent === b.parent &&
    a.isRoot === b.isRoot &&
    a.classes.length === b.classes.length &&
    a.classes.every((name, i) => name === b.classes[i]) &&
    sameEntries(a.attributes, b.attributes) &&
    sameEntries(a.states, b.states)
  );
}

// HTML's `dialog::backdrop`, under an author's (html.css)
const DEFAULT_BACKDROP = {backgroundColor: 'rgba(0, 0, 0, 0.1)'};

// Calls an element's click handler as a click whose target is the element
// itself, which is what a press on a dialog's backdrop is on the web
function clickOnTheElementItself(handler: unknown, instance: unknown): void {
  if (typeof handler !== 'function' || instance == null) {
    return;
  }
  const click: (event: {...}) => unknown = handler as $FlowFixMe;
  let defaultPrevented = false;
  let propagationStopped = false;
  click({
    type: 'click',
    target: instance,
    currentTarget: instance,
    nativeEvent: {},
    get defaultPrevented(): boolean {
      return defaultPrevented;
    },
    preventDefault(): void {
      defaultPrevented = true;
    },
    stopPropagation(): void {
      propagationStopped = true;
    },
    isDefaultPrevented: (): boolean => defaultPrevented,
    isPropagationStopped: (): boolean => propagationStopped,
    persist(): void {},
  });
}

// The native top layer, on the platforms that have it.
// DOM-CSS-LIMITATION(popover-is-not-in-the-top-layer): on Android a shown
// popover still sits where its author styles put it.
const TOP_LAYER_IS_NATIVE: boolean = Platform.OS === 'ios';

function isPlainObject(value: unknown): boolean {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function sameBoxSize(a: ?BoxSize, b: ?BoxSize): boolean {
  return (
    a === b ||
    (a != null && b != null && a.width === b.width && a.height === b.height)
  );
}

// Whether two objects have the same keys with identical values
function sameEntries(
  a: ?{readonly [string]: unknown},
  b: ?{readonly [string]: unknown},
): boolean {
  if (a === b) {
    return true;
  }
  if (a == null || b == null) {
    return false;
  }
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) {
    return false;
  }
  for (const key of keys) {
    if (!Object.is(a[key], b[key]) || !(key in b)) {
      return false;
    }
  }
  return true;
}

type IntrinsicProps = {
  __astryxTag: string,
  className?: string,
  style?: {[string]: unknown},
  __stylexStyle?: {[string]: unknown},
  __stylexVars?: {[string]: unknown},
  /*
   * The `when.*` blocks this element deferred, declared because the descendant
   * scan and `resolveWhen` need an object, not the indexer's `unknown`.
   */
  __stylexWhen?: {[string]: unknown},
  children?: React.Node,
  [string]: unknown,
};

/*
 * What an element derives from objects that elements share — a matched
 * resolution's style, a `props()` answer, an inherited scope — kept by their
 * identity: the cells of a table derive the same style and scope from the same
 * objects, and deriving them again for each was a large part of rendering one.
 * The caches are dropped with the stylesheets' version, which everything else
 * the derivations read (the colour scheme, the window's size) bumps.
 */
type SharedDerivations = {
  version: number,
  sheetUnderAuthor: WeakMap<Object, WeakMap<Object, {[string]: unknown}>>,
  sheetVarsUnderStylex: WeakMap<Object, WeakMap<Object, {[string]: unknown}>>,
  inherited: WeakMap<
    Object,
    WeakMap<Object, WeakMap<Object, ReturnType<typeof resolveInherited>>>,
  >,
};

let sharedDerivations: SharedDerivations = newSharedDerivations(-1);
// The keys that stand for an absent style, scope or set of declarations
const NO_STYLE = {};
const NO_SCOPE = {};
const NO_VARS = {};

function newSharedDerivations(version: number): SharedDerivations {
  return {
    version,
    sheetUnderAuthor: new WeakMap(),
    sheetVarsUnderStylex: new WeakMap(),
    inherited: new WeakMap(),
  };
}

function currentDerivations(): SharedDerivations {
  const version = cssVersion();
  if (sharedDerivations.version !== version) {
    sharedDerivations = newSharedDerivations(version);
  }
  return sharedDerivations;
}

function derivedFrom<R>(
  cache: WeakMap<Object, WeakMap<Object, R>>,
  first: Object,
  second: Object,
  derive: () => R,
): R {
  let byFirst = cache.get(first);
  if (byFirst == null) {
    byFirst = new WeakMap();
    cache.set(first, byFirst);
  }
  let derived = byFirst.get(second);
  if (derived == null) {
    derived = derive();
    byFirst.set(second, derived);
  }
  return derived;
}

// A matched rule's style under the author's, which gives up the box edges the
// author's claims; see `withoutOutrankedBoxEdges`
function sheetUnderAuthor(
  sheetStyle: {[string]: unknown},
  authorStyle: {[string]: unknown},
): {[string]: unknown} {
  return derivedFrom(
    currentDerivations().sheetUnderAuthor,
    sheetStyle,
    authorStyle,
    () => ({
      ...withoutOutrankedBoxEdges(sheetStyle, authorStyle),
      ...authorStyle,
    }),
  );
}

// Stylesheet-matched custom properties under StyleX-declared ones
function sheetVarsUnderStylex(
  sheetVars: {[string]: unknown},
  stylexVars: {[string]: unknown},
): {[string]: unknown} {
  return derivedFrom(
    currentDerivations().sheetVarsUnderStylex,
    sheetVars,
    stylexVars,
    () => ({...sheetVars, ...stylexVars}),
  );
}

// `resolveInherited`, once for each style, scope and set of declarations
function sharedResolveInherited(
  style: ?{[string]: unknown},
  declaredVars: ?{[string]: unknown},
  inheritedScope: ?VarScope,
): ReturnType<typeof resolveInherited> {
  const byStyle = currentDerivations().inherited;
  const styleKey: Object = style ?? NO_STYLE;
  let byScope = byStyle.get(styleKey);
  if (byScope == null) {
    byScope = new WeakMap();
    byStyle.set(styleKey, byScope);
  }
  return derivedFrom(
    byScope,
    inheritedScope ?? NO_SCOPE,
    declaredVars ?? NO_VARS,
    () => resolveInherited(style, declaredVars, inheritedScope),
  );
}

// The class list of each `className` string, split once: a page renders the
// same few hundred strings on every render, and splitting them was a tenth of
// an element's render. The lists are shared, so nothing may change one.
const classLists: Map<string, Array<string>> = new Map();
const NO_CLASSES: Array<string> = [];
const CLASS_LISTS_BOUND = 4096;

function classListOf(className: unknown): Array<string> {
  if (typeof className !== 'string' || className === '') {
    return NO_CLASSES;
  }
  let classes = classLists.get(className);
  if (classes == null) {
    if (classLists.size >= CLASS_LISTS_BOUND) {
      classLists.clear();
    }
    classes = className.split(/\s+/).filter(Boolean);
    classLists.set(className, classes);
  }
  return classes;
}

/**
 * A style array flattened so a `when.*` block layers over all of it.
 * `mergedStyle` may be a single object or a reset plus the resolved entry.
 */
function flattenStyleForWhen(style: unknown): {[string]: unknown} | null {
  if (style == null) {
    return null;
  }
  if (Array.isArray(style)) {
    let flat: {[string]: unknown} = {};
    for (const entry of style) {
      const inner = flattenStyleForWhen(entry);
      if (inner != null) {
        // Spread rather than `Object.assign`, whose result Flow cannot track
        flat = {...flat, ...inner};
      }
    }
    return flat;
  }
  if (typeof style === 'object') {
    // $FlowFixMe[incompatible-return] a style object
    return {...style};
  }
  return null;
}

/**
 * Hands each child element its position among its siblings, which only the
 * parent knows and a marked element needs before it can publish
 * `:first-child`. A clone per child, so gated on any marker existing at all.
 */
// The stamped children of each `children` value seen, so an element that
// re-renders with the same children (its own state changed: a container
// measured itself, a stylesheet changed) hands React the same child elements
// and the subtree is not re-rendered; cloned elements have new identities,
// and every element inside a page re-rendered whenever its host did
const stampedChildren: WeakMap<Object, unknown> = new WeakMap();

function markedChildren(children: unknown): unknown {
  if (!hasMarkers() || children == null) {
    return children;
  }
  const cacheable = typeof children === 'object';
  if (cacheable) {
    const cached = stampedChildren.get(children as $FlowFixMe);
    if (cached !== undefined) {
      return cached;
    }
  }
  const result = stampChildren(children);
  if (cacheable) {
    stampedChildren.set(children as $FlowFixMe, result);
  }
  return result;
}

function stampChildren(children: unknown): unknown {
  const list = React.Children.toArray(children);
  if (list.length === 0) {
    return children;
  }
  // A fragment is not a sibling: its children are, in its place, as the DOM
  // sees them. Counting through fragments keeps `:first-child` and
  // `:nth-child` honest for a component that wraps its rows in one, and keeps
  // the stamps off `React.Fragment`, which rejects any prop but `key`.
  const flattened = [];
  const flatten = (child: $FlowFixMe) => {
    if (React.isValidElement(child) && child.type === ReactFragment) {
      React.Children.toArray<$FlowFixMe>(child.props.children).forEach(flatten);
    } else {
      flattened.push(child);
    }
  };
  list.forEach(flatten);
  const count = flattened.length;
  let position = 0;
  let changed = false;
  const stamp = (child: $FlowFixMe): $FlowFixMe => {
    if (!React.isValidElement(child)) {
      return child;
    }
    if (child.type === ReactFragment) {
      const inner = React.Children.toArray<$FlowFixMe>(
        child.props.children,
      ).map(stamp);
      // $FlowFixMe[incompatible-type] a fragment takes new children only
      return React.cloneElement(child, undefined, ...inner);
    }
    changed = true;
    // $FlowFixMe[incompatible-type] stamping our own props onto our own element
    return React.cloneElement(child, {
      __astryxIndex: position++,
      __astryxCount: count,
    });
  };
  const stamped = list.map(stamp);
  return changed ? stamped : children;
}

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
  const markerState = React.useContext(MarkerStateContext);
  const inheritedCurrentColor = React.useContext(CurrentColorContext);
  const {
    style: styleProp,
    __stylexStyle,
    __stylexVars,
    __stylexContainer,
    __startingStyle,
    __stylexMarker,
    __stylexWhen,
    __stylexAnswersPress,
    __stylexBackdrop,
    __astryxIndex,
    __astryxCount,
    className,
    children,
    ...rest
  } = props;

  /*
   * A marked element publishes what it matches, so its subtree can be asked about
   * it; its structural position came from its parent (`markedChildren`). Sibling
   * state is per child, since `siblingBefore` asks about the element before this
   * one, and this element contributes its marker to what its following siblings
   * see.
   */
  /*
   * Descendant conditions, if this element asks any; the chain is handed down
   * regardless so a deeper marked element reports to every asker above it.
   */
  const asksAboutDescendants =
    hasDescendantConditions() &&
    __stylexWhen != null &&
    Object.keys(__stylexWhen).some(key => key.startsWith(':where-descendant('));
  const {descendants, chain: descendantChain} =
    useDescendantMarkers(asksAboutDescendants);

  /*
   * A marked element reports itself upward in a layout effect, so the answer is
   * settled before paint.
   */
  const ownPseudos = React.useMemo(
    () =>
      typeof __stylexMarker === 'string'
        ? structuralPseudos(
            typeof __astryxIndex === 'number' ? __astryxIndex : 0,
            typeof __astryxCount === 'number' ? __astryxCount : 1,
          )
        : null,
    [__stylexMarker, __astryxIndex, __astryxCount],
  );
  const parentChain = React.useContext(DescendantRegistryContext);
  React.useLayoutEffect(() => {
    if (typeof __stylexMarker !== 'string' || ownPseudos == null) {
      return;
    }
    if (parentChain.length === 0) {
      return;
    }
    const undo = parentChain.map(register =>
      register(__stylexMarker, ownPseudos),
    );
    return () => {
      for (const un of undo) {
        un();
      }
    };
  }, [__stylexMarker, ownPseudos, parentChain]);

  const publishedMarkers = React.useMemo<MarkerState>(() => {
    if (typeof __stylexMarker !== 'string') {
      return markerState;
    }
    const index = typeof __astryxIndex === 'number' ? __astryxIndex : 0;
    const count = typeof __astryxCount === 'number' ? __astryxCount : 1;
    return {
      ancestors: withMarker(
        markerState.ancestors,
        __stylexMarker,
        structuralPseudos(index, count),
      ),
      before: markerState.before,
      after: markerState.after,
      descendants: markerState.descendants,
    };
  }, [markerState, __stylexMarker, __astryxIndex, __astryxCount]);

  // What this element resolves against: what it sees from above plus what its
  // descendants reported
  const effectiveMarkerState = React.useMemo<MarkerState>(
    () => (asksAboutDescendants ? {...markerState, descendants} : markerState),
    [asksAboutDescendants, markerState, descendants],
  );

  // Interaction tracking for stylesheet pseudo-classes. The hook always
  // runs (hook-order stability); its handlers attach only when some
  // candidate rule actually gates on state.
  const {state: interaction, handlers: interactionHandlers} =
    useInteractionState({disabled: rest.disabled === true});
  // Whether a popover is shown (HTML §6.12), which `showPopover()` and
  // `hidePopover()` set through the element's record (dom-compat.js)
  const [popoverOpen, setPopoverOpen] = React.useState(false);
  // Removing the attribute closes the popover, so restoring it starts closed
  const isPopover = rest.popover != null && rest.popover !== false;
  // Whether a dialog is shown, and how (HTML §4.11.4): `showModal()` puts it in
  // the top layer over a backdrop, `show()` where it is; the dialog methods set
  // it through the element's record (dom-compat.js)
  const isDialog = __astryxTag === 'dialog';
  const [dialogMode, setDialogMode] =
    React.useState<?('modal' | 'non-modal')>(null);
  React.useLayoutEffect(() => {
    if (!isPopover && popoverOpen) {
      setPopoverOpen(false);
    }
  }, [isPopover, popoverOpen]);

  const recordHolder = React.useRef<$FlowFixMe>(null);
  const instanceRef = React.useRef<$FlowFixMe>(null);
  const authorRef = rest.ref;
  const authorRefRef = React.useRef<$FlowFixMe>(authorRef);
  authorRefRef.current = authorRef;
  const registeringRef = React.useCallback((instance: $FlowFixMe) => {
    instanceRef.current = instance;
    if (instance != null && typeof instance === 'object') {
      registerElement(instance, recordHolder as $FlowFixMe);
    }
    const author = authorRefRef.current;
    if (typeof author === 'function') {
      author(instance);
    } else if (author != null && typeof author === 'object') {
      author.current = instance;
    }
  }, []);

  const freshDescriptor: ElementDescriptor = {
    tag: typeof __astryxTag === 'string' ? __astryxTag.toLowerCase() : null,
    classes: classListOf(className),
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
      popoverOpen,
    },
    parent: parentDescriptor,
    container: null,
  };

  // The media queries see the host surface's viewport where one has declared
  // it (an app's screen, a split view's column), else the window
  const viewport = scopeSize(
    inheritedScope,
    VIEWPORT_INLINE_SIZE,
    VIEWPORT_BLOCK_SIZE,
  );
  // The previous render's match while nothing it was matched on has changed:
  // the element itself, its ancestors (whose descriptors are kept while they
  // are unchanged), the viewport and the stylesheets
  const cssMatchRef = React.useRef<?{
    descriptor: ElementDescriptor,
    viewport: ?BoxSize,
    version: number,
    css: $FlowFixMe,
  }>(null);
  const previousMatch = cssMatchRef.current;
  const css = hasStylesheets()
    ? previousMatch != null &&
      previousMatch.version === cssVersion() &&
      sameBoxSize(previousMatch.viewport, viewport) &&
      sameMatchedElement(previousMatch.descriptor, freshDescriptor)
      ? previousMatch.css
      : resolveCssForElement(
          freshDescriptor,
          {
            hovered: interaction.hovered === true,
            pressed: interaction.pressed === true,
            focused: interaction.focused === true,
            focusVisible: interaction.focused === true,
            disabled: rest.disabled === true,
            popoverOpen,
          },
          viewport,
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
  freshDescriptor.container =
    css.container ??
    (__stylexContainer as $FlowFixMe) ??
    containerFromInlineStyle(styleProp);
  freshDescriptor.containerSize =
    freshDescriptor.container != null ? containerSize : null;
  // The previous render's descriptor while nothing in it has changed: it is
  // the context every descendant reads, so a new object with the same content
  // would re-render the whole subtree whenever this element re-rendered
  if (hasStylesheets()) {
    cssMatchRef.current = {
      descriptor: freshDescriptor,
      viewport,
      version: cssVersion(),
      css,
    };
  }
  const descriptorRef = React.useRef<?ElementDescriptor>(null);
  const previousDescriptor = descriptorRef.current;
  const descriptor: ElementDescriptor =
    previousDescriptor != null &&
    sameDescriptor(previousDescriptor, freshDescriptor)
      ? previousDescriptor
      : freshDescriptor;
  descriptorRef.current = descriptor;

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
      style = sheetUnderAuthor(css.style, authorStyle);
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
        ? sheetVarsUnderStylex(css.vars, __stylexVars)
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

  // An element drawn in the top layer marks its subtree's scope, so the
  // regions in it scroll in the block axis; see scrollContainerStyles
  const opensTopLayer = (isPopover || isDialog) && TOP_LAYER_IS_NATIVE;
  if (opensTopLayer) {
    mergedVars = withTopLayerMark(mergedVars);
  }
  const inTopLayer = opensTopLayer || inheritedScope?.get(IN_TOP_LAYER) != null;

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

  // The previous render's scope while what it is made of is unchanged: the
  // inherited scope, and this element's own declarations. It is the context
  // every descendant reads, and resolving the declarations again would make a
  // new map, and re-render the subtree, on any re-render of this element. The
  // style resolved against it is kept too, while the style is the same.
  const inheritedRef = React.useRef<?{
    inherited: ?VarScope,
    declared: ?{[string]: unknown},
    scope: ?VarScope,
    styleIn: unknown,
    styleOut: ?{[string]: unknown},
  }>(null);
  const previousInherited = inheritedRef.current;
  const reusesScope =
    previousInherited != null &&
    previousInherited.inherited === baseScope &&
    sameEntries(previousInherited.declared, mergedVars);
  let resolvedStyle: ?{[string]: unknown};
  let scope: ?VarScope;
  if (
    reusesScope &&
    previousInherited != null &&
    (previousInherited.styleIn === style ||
      (isPlainObject(previousInherited.styleIn) &&
        isPlainObject(style) &&
        sameEntries(previousInherited.styleIn as $FlowFixMe, style)))
  ) {
    resolvedStyle = previousInherited.styleOut;
    scope = previousInherited.scope;
  } else {
    const resolved =
      reusesScope && previousInherited != null
        ? sharedResolveInherited(style, null, previousInherited.scope)
        : sharedResolveInherited(style, mergedVars, baseScope);
    resolvedStyle = resolved.style;
    scope = resolved.scope;
    inheritedRef.current = {
      inherited: baseScope,
      declared: mergedVars,
      scope,
      styleIn: style,
      styleOut: resolvedStyle,
    };
  }

  const mapped = ELEMENT_COMPONENTS[__astryxTag];
  const entryMerged =
    entryStyle != null ? [resolvedStyle, entryStyle] : resolvedStyle;
  // Astryx's reset, applied to Astryx's own elements only — see ASTRYX_RESET.
  // Underneath everything, so it is a floor the sources can still override,
  // which is what a reset is.
  const reset = ASTRYX_RESET[__astryxTag];
  const withReset =
    reset == null
      ? entryMerged
      : entryMerged != null
        ? [reset, entryMerged]
        : reset;
  // The user agent's rules for the attributes that hide an element, under
  // every other style, so an author's `display` still wins as on the web
  const hidden = hiddenByUserAgent(
    rest,
    popoverOpen,
    isDialog && dialogMode == null,
  );
  const mergedStyle =
    hidden == null
      ? withReset
      : withReset != null
        ? [hidden, withReset]
        : hidden;
  // Interaction handlers attach only when a candidate rule gates on state,
  // composing WITH any handlers the author passed rather than replacing
  // them.
  const stateProps = css.dependsOnStates
    ? composeInteractionHandlers(rest, interactionHandlers)
    : rest;
  /*
   * A button whose own styles answer a press tells the platform to stay out of
   * it, since two responses on different clocks show as a button that goes dark
   * and then changes colour; a button that answers nothing needs the platform's.
   */
  const pressProps =
    __astryxTag === 'button' &&
    (css.dependsOnStates || __stylexAnswersPress === true)
      ? {...stateProps, authorStatesPressFeedback: true}
      : stateProps;
  /*
   * The deferred `when.*` blocks, settled now that the marker state is known and
   * layered over everything else so a matching condition wins as the generated
   * rule would.
   */
  const whenResolved =
    __stylexWhen != null
      ? resolveWhen(
          flattenStyleForWhen(mergedStyle),
          __stylexWhen,
          effectiveMarkerState,
          scope,
        )
      : null;
  const styleWithWhen =
    __stylexWhen != null && whenResolved != null ? whenResolved : mergedStyle;
  // A block whose block axis overflows grows instead of scrolling, except in
  // the top layer; see growingOverflowStyle
  const styleGrown = inTopLayer
    ? styleWithWhen
    : (growingOverflowStyle(__astryxTag, styleWithWhen) ?? styleWithWhen);

  const hostProps =
    styleWithWhen != null
      ? {
          ...pressProps,
          style: styleGrown,
          children: markedChildren(children),
        }
      : {...pressProps, children: markedChildren(children)};
  // What dom-compat.js answers `getAttribute`, `matches` and
  // `getComputedStyle` from: the latest descriptor, props and style, kept by
  // host instance. The holder is updated every render and registered once,
  // through a stable ref callback composed with the author's own.
  recordHolder.current = {
    descriptor,
    props: rest,
    style: styleGrown,
    overrides: recordHolder.current?.overrides ?? new Map(),
    popoverOpen,
    setPopoverOpen,
    dialogMode,
    setDialogMode,
    returnValue: recordHolder.current?.returnValue ?? '',
  };
  hostProps.ref = registeringRef;
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
    // The providers are unconditional, as below
    return (
      <VarScopeContext.Provider value={scope}>
        <ElementDescriptorContext.Provider value={descriptor}>
          {reactJsx(mapped, componentProps)}
        </ElementDescriptorContext.Provider>
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
  const scrollSplit = scrollContainerStyles(
    __astryxTag,
    styleGrown,
    inTopLayer,
  );
  if (displayIsContents(styleWithWhen)) {
    // `display: contents` (css-display-3 §2.5): the element generates no box
    // and its children take its place in the parent — as flex items of a
    // flex parent, as text in a line. Rendering the children in its place is
    // exactly that; a host view that Yoga lays out as `contents` would still
    // fold text-level children into a run of its own, and a button's label and
    // icon, wrapped in such a span, would sit in one line with no gap between
    // them. The contexts above still publish the element's descriptor, its
    // custom properties and its colour to the children.
    element = <ReactFragment>{markedChildren(children)}</ReactFragment>;
  } else if (scrollSplit != null) {
    // A scroll container (`overflow-x: auto | scroll` on a block, or in the
    // top layer `overflow-y`): the element is the content of a scroll view,
    // which takes the box's own sizing, placement and paint; the element keeps
    // its padding, its children's layout, its identity (ref, record, events).
    // See DOM-CSS-LIMITATION(no-nested-vertical-scroll).
    const contentProps = {...hostProps, style: scrollSplit.content};
    const content = Array.isArray(children)
      ? reactJsxs(__astryxTag, contentProps)
      : reactJsx(__astryxTag, contentProps);
    // The platform's own horizontal scroll view, which needs none of the
    // keyboard and safe-area work `native:scroll` does for the block axis.
    // The content container is at least the viewport wide. It does not
    // rubber-band when its content fits, so a drag that begins on a strip
    // with nothing to scroll reaches the page.
    element = reactJsx(ScrollView, {
      horizontal: scrollSplit.horizontal,
      style: scrollSplit.viewport,
      contentContainerStyle: scrollSplit.horizontal
        ? horizontalScrollContentContainerStyle
        : verticalScrollContentContainerStyle,
      showsHorizontalScrollIndicator: false,
      alwaysBounceHorizontal: false,
      alwaysBounceVertical: false,
      children: content,
    });
  } else {
    const backgroundImage = backgroundImageLayer(hostProps.style);
    if (backgroundImage != null) {
      // A `background-image: url()` is drawn by an image filling the box
      // behind the element's children; see backgroundImageLayer
      const laid = Array.isArray(hostProps.children)
        ? hostProps.children
        : [hostProps.children];
      element = reactJsxs(__astryxTag, {
        ...hostProps,
        style: backgroundImage.style,
        children: [backgroundImage.layer, ...laid],
      });
    } else {
      element = Array.isArray(children)
        ? reactJsxs(__astryxTag, hostProps)
        : reactJsx(__astryxTag, hostProps);
    }
  }
  if ((isPopover || isDialog) && TOP_LAYER_IS_NATIVE) {
    // A shown popover and a modal dialog are drawn in the top layer (HTML
    // §6.12, §4.11.4), from a handle that stays here whether or not they are
    // shown, so showing one does not remount it. A modal dialog is centred in
    // the viewport over its `::backdrop`, and a press on the backdrop is a
    // click on the dialog itself, as on the web, which is how a dialog tells
    // it from a click on its content.
    const authoredClick = rest.onClick;
    element = (
      <TopLayerElement
        open={isDialog ? dialogMode === 'modal' : popoverOpen}
        lightDismiss={!isDialog && rest.popover !== 'manual'}
        backdrop={
          isDialog
            ? __stylexBackdrop != null
              ? // The backdrop inherits from the dialog (css-position-4
                // §5.2), so its `var()`s resolve in the dialog's scope
                sharedResolveInherited(
                  __stylexBackdrop as $FlowFixMe,
                  null,
                  scope,
                ).style
              : DEFAULT_BACKDROP
            : null
        }
        onBackdropPress={
          isDialog
            ? () => clickOnTheElementItself(authoredClick, instanceRef.current)
            : null
        }
        centered={isDialog}
        viewport={viewport}
        instanceRef={instanceRef}>
        {element}
      </TopLayerElement>
    );
  }

  // `color` is what SVG's currentColor means, and icon sets are built on
  // it: the value is set on an ANCESTOR (a checked checkbox says
  // `text-primary-foreground` on the control, never on its checkmark), so
  // publish it for any descendant that has to paint with it.
  const resolvedColor: $FlowFixMe =
    resolvedStyle != null && typeof resolvedStyle === 'object'
      ? (resolvedStyle as $FlowFixMe).color
      : null;
  const currentColor =
    typeof resolvedColor === 'string' &&
    resolvedColor.toLowerCase() !== 'currentcolor'
      ? resolvedColor
      : inheritedCurrentColor;

  // Every provider is rendered whether or not this element changes what it
  // provides, handing down the inherited value when it does not: a provider
  // that appeared or went away with a condition (a colour resolved, a custom
  // property declared, a stylesheet installed) changed the type of what this
  // element returned, and React remounted the whole subtree under it, every
  // picture and text field included. A provider whose value is unchanged
  // re-renders nothing.
  //
  // Descendants match ancestor compounds (`.card .title`) against the
  // descriptor chain, read their marker state and report to the descendant
  // registry through the others; only elements that declare custom properties
  // open a new scope, and the rest pass their ancestor's on.
  return (
    <VarScopeContext.Provider value={scope}>
      <DescendantRegistryContext.Provider value={descendantChain}>
        <MarkerStateContext.Provider value={publishedMarkers}>
          <ElementDescriptorContext.Provider value={descriptor}>
            <CurrentColorContext.Provider value={currentColor}>
              {element}
            </CurrentColorContext.Provider>
          </ElementDescriptorContext.Provider>
        </MarkerStateContext.Provider>
      </DescendantRegistryContext.Provider>
    </VarScopeContext.Provider>
  );
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

/**
 * A `background-image: url(…)` as a layer the renderer can draw.
 *
 * The renderer's `backgroundImage` takes gradients only. An image is drawn by
 * an `<Image>` filling the element's box under its children, clipped to the
 * same corners, sized by `background-size` (`cover`, `contain`, or the
 * image's own size centred). DOM-CSS-LIMITATION(background-image-url-layer):
 * `background-position` other than centred, `background-repeat`, and a url()
 * layered with a gradient or a second image are not drawn — the first url()
 * is the layer, and the gradients are dropped with it. The scroll-container
 * path does not take the layer. A root-relative url names a bundled asset,
 * as an `<img>`'s does (see expo-intrinsics' rootRelativeSources).
 */
function backgroundImageLayer(
  style: unknown,
): ?{layer: React.Node, style: {[string]: unknown}} {
  const flat: $FlowFixMe = StyleSheet.flatten(style as $FlowFixMe);
  const value = flat?.backgroundImage;
  if (typeof value !== 'string' || !value.includes('url(')) {
    return null;
  }
  const match = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/.exec(value);
  if (match == null) {
    return null;
  }
  const uri = (match[1] ?? match[2] ?? match[3] ?? '').trim();
  if (uri === '') {
    return null;
  }
  // The URI alone: a resolved asset's own width and height would size the
  // image, over its four edges, so a 1200pt photo drew from the box's corner
  // and widened the page into a sideways scroll
  const source = {uri: resolveRootRelativeSource(uri)?.uri ?? uri};
  const size =
    typeof flat.backgroundSize === 'string' ? flat.backgroundSize : '';
  const resizeMode =
    size === 'cover' ? 'cover' : size === 'contain' ? 'contain' : 'center';
  const corners: {[string]: unknown} = {};
  for (const key of Object.keys(flat)) {
    if (key.startsWith('border') && key.endsWith('Radius')) {
      corners[key] = flat[key];
    }
  }
  const {
    backgroundImage: _image,
    backgroundSize: _size,
    backgroundPosition: _position,
    backgroundRepeat: _repeat,
    ...rest
  } = flat;
  const layer = (
    <Image
      key="__astryx_background_image"
      source={source}
      resizeMode={resizeMode}
      style={[StyleSheet.absoluteFill, corners as $FlowFixMe]}
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden={true}
      importantForAccessibility="no-hide-descendants"
    />
  );
  return {layer, style: rest};
}

/**
 * The elements that scroll their content when their style says so: block
 * containers. Text-level elements and the behaviour-mapped ones do not.
 */
const SCROLL_CONTAINER_TAGS: Set<string> = new Set([
  'div',
  'section',
  'main',
  'article',
  'aside',
  'nav',
  'header',
  'footer',
  'form',
  'fieldset',
  'figure',
  'ul',
  'ol',
  'menu',
]);

/**
 * The style properties that stay on the scroll viewport: how the box is
 * sized and placed among its siblings, and what it paints. Everything else
 * — padding, the children's layout, the inherited text properties — belongs
 * to the content, which is the element itself.
 */
const SCROLL_VIEWPORT_PROPS: Set<string> = new Set([
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'flex',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'alignSelf',
  'justifySelf',
  'order',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'inset',
  'insetInline',
  'insetBlock',
  'insetInlineStart',
  'insetInlineEnd',
  'insetBlockStart',
  'insetBlockEnd',
  'zIndex',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'marginInline',
  'marginBlock',
  'marginInlineStart',
  'marginInlineEnd',
  'marginBlockStart',
  'marginBlockEnd',
  'marginHorizontal',
  'marginVertical',
  'marginStart',
  'marginEnd',
  'gridColumn',
  'gridColumnStart',
  'gridColumnEnd',
  'gridRow',
  'gridRowStart',
  'gridRowEnd',
  'gridArea',
  'aspectRatio',
  'boxSizing',
  'backgroundColor',
  'backgroundImage',
  'opacity',
  'transform',
  'transformOrigin',
  'boxShadow',
  'filter',
  'borderRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
  'borderStartStartRadius',
  'borderStartEndRadius',
  'borderEndStartRadius',
  'borderEndEndRadius',
  'borderWidth',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderStartWidth',
  'borderEndWidth',
  'borderInlineStartWidth',
  'borderInlineEndWidth',
  'borderBlockStartWidth',
  'borderBlockEndWidth',
  'borderColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderStartColor',
  'borderEndColor',
  'borderInlineStartColor',
  'borderInlineEndColor',
  'borderBlockStartColor',
  'borderBlockEndColor',
  'borderStyle',
  'outlineWidth',
  'outlineColor',
  'outlineStyle',
  'outlineOffset',
  'display',
]);

const horizontalScrollContentContainerStyle = {minWidth: '100%'};
const verticalScrollContentContainerStyle = {minHeight: '100%'};

// The custom property an element in the top layer declares for its subtree,
// whose regions scroll in the block axis there
const IN_TOP_LAYER = '--astryx-in-top-layer';
const TOP_LAYER_MARK: {[string]: unknown} = {[IN_TOP_LAYER]: '1'};
const markedVars: WeakMap<{[string]: unknown}, {[string]: unknown}> =
  new WeakMap();

// The declarations with the top layer's mark, the same object for the same
// declarations
function withTopLayerMark(vars: ?{[string]: unknown}): {[string]: unknown} {
  if (vars == null) {
    return TOP_LAYER_MARK;
  }
  let marked = markedVars.get(vars);
  if (marked == null) {
    marked = {...vars, ...TOP_LAYER_MARK};
    markedVars.set(vars, marked);
  }
  return marked;
}

/**
 * When a block's style makes it a scroll container, its style split between
 * the native scroll view that will scroll it and the element that becomes
 * that view's content. Null when it does not scroll.
 *
 * DOM-CSS-LIMITATION(no-nested-vertical-scroll): in the page only the inline
 * axis scrolls here, and only for an explicit `overflow-x: auto | scroll`,
 * through the platform's horizontal scroll view; the block axis, and the
 * `overflow` shorthand, grow instead (growingOverflowStyle). In the top layer,
 * where a dialog or a menu has no page to grow into, the block axis scrolls
 * too, through a vertical scroll view. The element's `scroll` events and
 * `scrollTop` do not reach the scroll view.
 */
function scrollContainerStyles(
  tag: string,
  style: unknown,
  scrollsVertically: boolean,
): ?{
  viewport: {[string]: unknown},
  content: {[string]: unknown},
  horizontal: boolean,
} {
  if (!SCROLL_CONTAINER_TAGS.has(tag) || style == null) {
    return null;
  }
  const flat: ?{[string]: unknown} = StyleSheet.flatten(style as $FlowFixMe);
  if (flat == null) {
    return null;
  }
  // Only an explicit `overflow-x` scrolls sideways. The `overflow` shorthand
  // names a region that scrolls in the block axis on the web (a fixed-height
  // card, a layout's content pane) and grows here (growingOverflowStyle); as a
  // horizontal scroll view its text would be measured without a width and
  // never wrap.
  const overflowX = flat.overflowX;
  const horizontal = overflowX === 'scroll' || overflowX === 'auto';
  const overflowY = flat.overflowY ?? flat.overflow;
  if (
    !horizontal &&
    !(scrollsVertically && (overflowY === 'scroll' || overflowY === 'auto'))
  ) {
    return null;
  }
  const viewport: {[string]: unknown} = {};
  const content: {[string]: unknown} = {};
  for (const key of Object.keys(flat)) {
    if (key === 'overflow' || key === 'overflowX' || key === 'overflowY') {
      continue;
    }
    if (SCROLL_VIEWPORT_PROPS.has(key)) {
      viewport[key] = flat[key];
    } else {
      content[key] = flat[key];
    }
  }
  // The element lays its children out as before; the viewport is a plain box
  // whatever `display` the element had
  delete viewport.display;
  // A CSS box in a flex container: sized by its own width or height unless
  // the author gives it flex properties. The `native:scroll` element's own
  // defaults fill what is left of the container instead (flex-basis 0), which
  // is right for a scroll view placed by hand and wrong for a 240px column
  // that scrolls.
  if (viewport.flex == null) {
    viewport.flexGrow ??= 0;
    viewport.flexShrink ??= 1;
    viewport.flexBasis ??= 'auto';
  }
  if (flat.display != null) {
    content.display = flat.display;
  }
  // Fills the content container, which is at least the viewport (see the
  // render site); the element's own flex properties went to the viewport
  content.flexGrow = 1;
  // One axis scrolls: the inline one where the element names it, and in the
  // page a block that also overflows in the block axis grows downward
  // (growingOverflowStyle)
  return {viewport, content, horizontal};
}

/**
 * A block whose block axis overflows (`overflow-y: auto | scroll`) grows to
 * its content instead of scrolling inside the page.
 *
 * DOM-CSS-LIMITATION(no-nested-vertical-scroll): on a phone a page scrolls
 * as one; a region that scrolls on its own captures the drag meant for the
 * page, hides content below its edge, and fights the keyboard and the safe
 * area the page reserves. Layouts written for a desktop viewport — a
 * `Layout` of height "fill" whose `LayoutContent` scrolls, a `Card` pinned to
 * its grid cell — keep their markup; their scrolling region takes its content
 * height, the box's `height` becoming its minimum, its `max-height` and the
 * `flex-shrink`/`min-height: 0` that let a flex item give way to its siblings
 * set aside, and the page scroll reaches whatever overflows the ancestors
 * (the scroll view's content size is the scrollable overflow area). The
 * inline axis is the exception: a wide table or a strip of columns still
 * scrolls sideways, through the platform's horizontal scroll view.
 */
function growingOverflowStyle(
  tag: string,
  style: unknown,
): ?{[string]: unknown} {
  if (!SCROLL_CONTAINER_TAGS.has(tag) || style == null) {
    return null;
  }
  const flat: ?{[string]: unknown} = StyleSheet.flatten(style as $FlowFixMe);
  if (flat == null) {
    return null;
  }
  const overflowY = flat.overflowY ?? flat.overflow;
  if (overflowY !== 'scroll' && overflowY !== 'auto') {
    return null;
  }
  const grown: {[string]: unknown} = {...flat};
  delete grown.overflow;
  delete grown.overflowY;
  if (flat.overflowX !== 'scroll' && flat.overflowX !== 'auto') {
    // An explicit `overflow-x` stays for the horizontal scroll container
    // (scrollContainerStyles); the shorthand's inline axis clips with the box
    delete grown.overflowX;
  }
  if (grown.height != null && grown.height !== 'auto') {
    if (grown.minHeight == null || grown.minHeight === 0) {
      grown.minHeight = grown.height;
    }
    delete grown.height;
  }
  delete grown.maxHeight;
  if (grown.minHeight === 0) {
    delete grown.minHeight;
  }
  if (
    grown.flex != null ||
    grown.flexShrink != null ||
    grown.flexBasis != null
  ) {
    // A flex item that was allowed to shrink to its share of the column keeps
    // its content height instead; whatever it grows into stays
    grown.flexShrink = 0;
    if (grown.flexBasis === 0 || grown.flexBasis === '0%') {
      grown.flexBasis = 'auto';
    }
    if (typeof grown.flex === 'number' && grown.flex > 0) {
      grown.flexGrow = grown.flex;
      grown.flexBasis = 'auto';
      delete grown.flex;
    }
  }
  return grown;
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

const HIDDEN_BY_USER_AGENT: {readonly display: 'none'} = {display: 'none'};

/**
 * HTML's rendering rules for hidden elements (§15.3.1), as the user agent's
 * sheet writes them: `[hidden]:not([hidden=until-found i])` and
 * `[popover]:not(:popover-open)` are `display: none`.
 */
function hiddenByUserAgent(
  props: {readonly [string]: unknown},
  popoverOpen: boolean,
  dialogClosed: boolean,
): ?{readonly display: 'none'} {
  // `dialog:not([open]) { display: none }`: a dialog shows once it is opened,
  // by its methods or its `open` attribute
  if (dialogClosed && (props.open == null || props.open === false)) {
    return HIDDEN_BY_USER_AGENT;
  }
  const hidden = props.hidden;
  if (
    hidden != null &&
    hidden !== false &&
    String(hidden).toLowerCase() !== 'until-found'
  ) {
    return HIDDEN_BY_USER_AGENT;
  }
  const popover = props.popover;
  if (popover != null && popover !== false && !popoverOpen) {
    return HIDDEN_BY_USER_AGENT;
  }
  return null;
}

/**
 * Astryx's CSS reset, scoped to Astryx's own elements: its Card computes an
 * exact 16px inset and the user-agent `<p>` margins would make it 32. Scoped
 * rather than `overrideUAStyle`, which mutates the shared sheet for every
 * screen in the app.
 */
const ASTRYX_RESET: {[string]: {[string]: unknown}} = {
  p: {marginBlock: 0},
};

/**
 * Elements that need *behavioral* translation rather than a view-config
 * alias: the web's prop vocabulary mapped onto an RN component. Pure
 * containers (<div>, <p>, <button>) stay intrinsics and go through
 * IntrinsicElement below.
 */
const ELEMENT_COMPONENTS: {[string]: React.ComponentType<any>} = {
  input: Input,
  textarea: TextArea,
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
const ELEMENT_COMPONENTS_KEEPING_CHILDREN: Set<string> = new Set(['svg']);

/**
 * `<style>{css}</style>`: a stylesheet where a page puts one — the templates
 * carry a container query or an override this way — installed in the CSS
 * engine, as a `<style>` appended to the stub document's head is, and drawn
 * as nothing. Installed once per distinct text, since a sheet, like the
 * web's, is document-wide and outlives the element: a re-render, or a second
 * page carrying the same text, adds nothing.
 */
const installedStyleTexts: Set<string> = new Set();

function StyleElement({children}: {children?: unknown}): React.Node {
  const css = React.Children.toArray<$FlowFixMe>(children as $FlowFixMe)
    .filter(child => typeof child === 'string' || typeof child === 'number')
    .join('');
  // A layout effect, not an insertion effect: installing a sheet notifies
  // the elements subscribed to the engine, and React forbids updates from an
  // insertion effect
  React.useLayoutEffect(() => {
    if (css !== '' && !installedStyleTexts.has(css)) {
      installedStyleTexts.add(css);
      installStylesheet(css);
    }
  }, [css]);
  return null;
}

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

export {ElementDescriptorContext, VarScopeContext};
