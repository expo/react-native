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

import type {ElementDescriptor} from './css';
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
import Dialog from './elements/Dialog';
import Input from './elements/Input';
import TextArea from './elements/TextArea';
import {
  EMPTY_MARKER_STATE,
  hasDescendantConditions,
  hasMarkers,
  markerOfProps,
  parseTransformString,
  resolveInherited,
  resolveWhen,
} from './stylex-rn';
import type {MarkerState} from './stylex-rn';
import {CurrentColorContext} from './svg/CurrentColor';
import {Svg, SvgCircle, SvgLine, SvgPath, SvgRect} from './svg/Svg';
import {useInteractionState} from './useInteractionState';
import * as React from 'react';
import {
  Fragment as ReactFragment,
  jsx as reactJsx,
  jsxs as reactJsxs,
} from 'react/jsx-runtime';

// The custom properties in scope for a subtree. `null` is the root scope
// (only global design tokens apply).
const VarScopeContext: React.Context<?VarScope> = React.createContext(null);

/*
 * What every `stylex.when.*` condition in the subtree is answered from.
 *
 * StyleX compiles these to a class on the marked element and a selector on the
 * descendant, so the BROWSER answers "is my marked ancestor a `:first-child`?"
 * out of the DOM. There is no DOM and no compiler here, so the marked element
 * publishes the pseudo-classes it matches and the descendant reads them — the
 * same direction the custom-property scope above already travels, for the same
 * reason.
 *
 * `siblingBefore` / `siblingAfter` need a different fact — the markers on the
 * elements either side of THIS one — so a parent hands each child its own
 * state rather than the subtree sharing one.
 */
const MarkerStateContext: React.Context<MarkerState> =
  React.createContext<MarkerState>(EMPTY_MARKER_STATE);

/*
 * How a `when.descendant` question is answered.
 *
 * Every other relation travels DOWN: an ancestor knows what it matches before
 * its subtree renders, so it publishes and descendants read. This one travels
 * UP, and that asymmetry is the whole difficulty — a parent renders before its
 * descendants exist, so on its first pass the honest answer is "nothing has
 * reported yet".
 *
 * So marked elements REGISTER with every asking ancestor, in a layout effect,
 * and an asker whose set changed re-renders. Layout effects run after commit
 * and before paint, and a state update from one is flushed in the same cycle,
 * so the settled answer is the first one the screen shows rather than a
 * corrected second frame.
 *
 * The chain is a list rather than a single callback because `:has()` is not
 * limited to the nearest ancestor: a marked element satisfies the condition for
 * EVERY asker above it, so it reports to all of them.
 *
 * Convergence is not an accident. What gets reported — an element's structural
 * position and its own state pseudo-classes — never depends on the styles the
 * answer produces, so an asker restyling cannot change what was reported and
 * restart the cycle.
 */
type DescendantRegistrar = (
  markerId: string,
  pseudos: ReadonlySet<string>,
) => () => void;

const DescendantRegistryContext: React.Context<ReadonlyArray<DescendantRegistrar>> =
  React.createContext<ReadonlyArray<DescendantRegistrar>>([]);

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
  // cancel each other when only one unmounts.
  const countsRef = React.useRef<Map<string, Map<string, number>>>(new Map());

  const register = React.useCallback<DescendantRegistrar>((markerId, pseudos) => {
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
  }, []);

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

/*
 * The structural pseudo-classes an element matches from its position among
 * siblings. These are the ones a marker can be asked about, and the only ones
 * knowable without a layout pass or a DOM.
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
// attributes — not live interaction state; ancestor-state selectors
// (`.group:hover .x`) are a documented gap until states broadcast.
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
  /*
   * The `when.*` blocks this element deferred: condition key to the style it
   * applies. Declared rather than left to the indexer below, because both the
   * descendant scan and `resolveWhen` need it to be an object, and an
   * `unknown` from the indexer is not one.
   */
  __stylexWhen?: {[string]: unknown},
  children?: React.Node,
  [string]: unknown,
};

/**
 * A style array flattened enough for `when.*` blocks to layer over it.
 *
 * `mergedStyle` may be a single object or an array (a reset plus the resolved
 * entry). A matching conditional block has to win over all of it, so the array
 * is folded once here rather than the block being appended and hoping the
 * renderer's own precedence agrees.
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
        // Spread rather than `Object.assign`, whose result Flow cannot track.
        // These arrays are a reset plus a handful of resolved namespaces, so
        // rebuilding costs nothing worth naming.
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
 * Hands each child element its position among its siblings.
 *
 * A marked element has to know whether it is a `:first-child` before it can
 * publish that, and only its PARENT knows. React gives a component no view of
 * its own position, so the parent stamps each child as it renders it — which
 * is a clone per child, and therefore gated on any marker existing at all.
 * Nothing in React Native uses markers; an app that never calls
 * `defineMarker()` walks no children and clones nothing.
 */
function markedChildren(children: unknown): unknown {
  if (!hasMarkers() || children == null) {
    return children;
  }
  const list = React.Children.toArray(children);
  if (list.length === 0) {
    return children;
  }
  let changed = false;
  const stamped = list.map((child, index) => {
    if (!React.isValidElement(child)) {
      return child;
    }
    changed = true;
    // $FlowFixMe[incompatible-type] stamping our own props onto our own element
    return React.cloneElement(child, {
      __astryxIndex: index,
      __astryxCount: list.length,
    });
  });
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
  // Any change to the stylesheet environment — installation, appearance,
  // window size — re-renders every intrinsic so matches recompute.
  React.useSyncExternalStore(subscribeCss, cssVersion);
  const markerState = React.useContext(MarkerStateContext);
  const {
    style: styleProp,
    __stylexStyle,
    __stylexVars,
    __startingStyle,
    __stylexMarker,
    __stylexWhen,
    __astryxIndex,
    __astryxCount,
    className,
    children,
    ...rest
  } = props;

  /*
   * A marked element publishes what it matches, so its subtree can be asked
   * about it. Its own structural position came from its parent (`markedChildren`
   * stamps it), because nothing else can know it.
   *
   * Sibling state is published too, and is per-child rather than per-subtree:
   * `siblingBefore` asks about the element before THIS one, so the answer
   * differs for every child of the same parent. This element contributes its
   * own marker to what its FOLLOWING siblings see, which is the direction the
   * tree can actually carry.
   */
  /*
   * Descendant conditions, if this element asks any. The chain is handed down
   * regardless, so a marked element deeper in the tree reports to every asker
   * above it rather than only the nearest.
   */
  const asksAboutDescendants =
    hasDescendantConditions() &&
    __stylexWhen != null &&
    Object.keys(__stylexWhen).some(key => key.startsWith(':where-descendant('));
  const {descendants, chain: descendantChain} =
    useDescendantMarkers(asksAboutDescendants);

  /*
   * A marked element reports itself upward, in a layout effect so the answer
   * is settled before paint rather than one frame after it.
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

  // What THIS element resolves against: what it can see from above, plus what
  // its own descendants have reported.
  const effectiveMarkerState = React.useMemo<MarkerState>(
    () => (asksAboutDescendants ? {...markerState, descendants} : markerState),
    [asksAboutDescendants, markerState, descendants],
  );

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
  };

  const css = hasStylesheets()
    ? resolveCssForElement(descriptor, {
        hovered: interaction.hovered === true,
        pressed: interaction.pressed === true,
        focused: interaction.focused === true,
        focusVisible: interaction.focused === true,
        disabled: rest.disabled === true,
      })
    : {style: null, vars: null, dependsOnStates: false};
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
  // has claimed first — see `withoutOutrankedBoxEdges`, and the preflight
  // `button { padding: 0 }` that was beating every `paddingBlock` under it.
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
  const mergedVars =
    css.vars != null
      ? __stylexVars != null
        ? {...css.vars, ...__stylexVars}
        : css.vars
      : __stylexVars;

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
  const entryMerged =
    entryStyle != null ? [resolvedStyle, entryStyle] : resolvedStyle;
  // Astryx's reset, applied to Astryx's own elements only — see ASTRYX_RESET.
  // Underneath everything, so it is a floor the sources can still override,
  // which is what a reset is.
  const reset = ASTRYX_RESET[__astryxTag];
  const mergedStyle =
    reset == null
      ? entryMerged
      : entryMerged != null
        ? [reset, entryMerged]
        : reset;
  // Interaction handlers attach only when a candidate rule gates on state,
  // composing WITH any handlers the author passed rather than replacing
  // them.
  const stateProps = css.dependsOnStates
    ? composeInteractionHandlers(rest, interactionHandlers)
    : rest;
  /*
   * The `when.*` blocks this element deferred, settled now that the marker
   * state is known, layered over everything else so a matching condition wins
   * the same way the generated rule would.
   */
  const whenResolved = resolveWhen(
    flattenStyleForWhen(mergedStyle),
    __stylexWhen,
    effectiveMarkerState,
    scope,
  );
  const styleWithWhen =
    __stylexWhen != null && whenResolved != null ? whenResolved : mergedStyle;

  const hostProps =
    styleWithWhen != null
      ? {...stateProps, style: styleWithWhen, children: markedChildren(children)}
      : {...stateProps, children: markedChildren(children)};
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
  // The SAME host type on every commit, including the entry ones: the old
  // Animated entry path swapped in an animated tag while animating, and with
  // the two-commit `@starting-style` that swap would REMOUNT the element
  // between the starting commit and the final one — a fresh native view has
  // no previous value, so the native transition would never run.
  // The visually-hidden clip pattern renders nothing at all here (see
  // isVisuallyHidden): its text cannot be both invisible and announced on
  // this platform, and showing it is the worse of the two failures.
  if (isVisuallyHidden(css.style)) {
    return null;
  }

  let element = Array.isArray(children)
    ? reactJsxs(__astryxTag, hostProps)
    : reactJsx(__astryxTag, hostProps);

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

  let withMarkerState =
    publishedMarkers === markerState ? (
      element
    ) : (
      <MarkerStateContext.Provider value={publishedMarkers}>
        {element}
      </MarkerStateContext.Provider>
    );
  if (descendantChain !== parentChain) {
    withMarkerState = (
      <DescendantRegistryContext.Provider value={descendantChain}>
        {withMarkerState}
      </DescendantRegistryContext.Provider>
    );
  }

  // Only elements that declare custom properties open a new scope; everything
  // else reuses the ancestor's provider, so the common case adds no provider.
  if (scope === baseScope) {
    return withMarkerState;
  }
  return (
    <VarScopeContext.Provider value={scope}>
      {withMarkerState}
    </VarScopeContext.Provider>
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
 * Astryx's CSS reset, scoped to Astryx's own elements.
 *
 * Astryx on the web ships a reset and styles from scratch on top of it: its
 * Card computes an exact 16px inset and expects nothing else to contribute, so
 * the user-agent `<p>` margins — correct per the web — would make it measure
 * 32. The vendored slice here does not include that reset, so it lives here.
 *
 * It used to be `overrideUAStyle('p', {marginBlock: 0})` at module scope in
 * `dom.js`, and that was a bug with a long tail. `overrideUAStyle` mutates the
 * SHARED user-agent style object, so importing this demo silently zeroed
 * paragraph margins for **every** screen in the app — and because RNTester
 * loads example modules lazily, whether `<p>` had margins depended on which
 * screens had been visited. It presented as a native, tag-specific, sometimes
 * platform-specific renderer bug: `<p>` lost its margin while `<dl>`,
 * `<blockquote>` and `<h1>`–`<h6>` kept theirs, with a byte-identical entry,
 * and `marginInline` on `<p>` worked while `marginBlock` did not.
 *
 * The reset belongs to the consumer, exactly as it does in a browser — but a
 * consumer's reset must not reach outside the consumer.
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
