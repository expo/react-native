/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 */

/* eslint no-bitwise: 0 */

/**
 * An HTML element whose CSS the renderer's style engine resolves: one host
 * node that names the element's inputs (its class, the attributes selectors
 * read, its StyleX and inline styles, its interaction states), and the
 * behaviour the engine cannot supply — interaction tracking, popovers and
 * dialogs in the top layer, a scroll container's platform scroll view, and
 * the element's record for the DOM methods.
 *
 * It reads no context but one, whether it is in the top layer, and provides
 * none: what an element inherits from its ancestors (custom properties,
 * `color`, font size, what selectors match) the engine reads from the tree it
 * commits.
 */

import type {ElementDescriptor} from '../css';
import type {ElementRecord} from '../elementRegistry';
import type {GeneratedContent} from '../stylex-rn';

import {
  markGeneratedContent,
  recordOf,
  registerElement,
  setRecordFallback,
} from '../elementRegistry';
import CheckableInput from '../elements/CheckableInput';
import Input from '../elements/Input';
import TextArea from '../elements/TextArea';
import TopLayerElement from '../overlay/TopLayerElement';
import {useInteractionState} from '../useInteractionState';
import {
  HINT_BOX,
  HINT_CLIP_BLOCK,
  HINT_FLEX_COLUMN,
  HINT_FLEX_ROW,
  HINT_PRESS_STATES,
  HINT_SCROLL,
  HINT_SCROLL_BLOCK,
  HINT_STATES,
  STATE_ACTIVE,
  STATE_FOCUS,
  STATE_FOCUS_VISIBLE,
  STATE_HOVER,
  STATE_POPOVER_OPEN,
  computedStyleForInstance,
  counters,
  declaresOverflow,
  encodeStyle,
  hintsFor,
  instrumenting,
  isPressReadThroughMarker,
  styleInputsOf,
} from './engine';
import * as React from 'react';
import {ScrollView} from 'react-native';
import Event from 'react-native/src/private/webapis/dom/events/Event';
import {jsx as reactJsx} from 'react/jsx-runtime';

/**
 * Whether an element is in the top layer, where a region that overflows in
 * the block axis scrolls (a menu, a dialog) rather than growing into a page.
 * Provided by the top layer's elements only.
 */
export const InTopLayerContext: React.Context<boolean> =
  React.createContext(false);

/**
 * Whether a block container above the element clips its block axis
 * (`overflow-y: hidden | clip`), past which a region that grew to its content
 * would be cut off, so a region that scrolls in that axis scrolls there as it
 * does in the top layer. Provided by the clipping containers, as the engine's
 * `clipsBlockBelow` follows them.
 */
const ClipsBlockContext: React.Context<boolean> = React.createContext(false);

// The custom property an element in the top layer declares for its subtree,
// which the engine reads to leave its regions scrolling
const IN_TOP_LAYER_ENTRY: [string, unknown] = ['--astryx-in-top-layer', '1'];

/**
 * The attributes that take part in selector matching, beyond `data-*` and
 * `aria-*`: the ones the sheets and the user agent's rules name.
 */
const MATCHABLE_ATTRIBUTES = [
  'id',
  'disabled',
  'type',
  'role',
  'dir',
  'lang',
  'hidden',
  'popover',
  'open',
  'href',
  'name',
  'checked',
  'selected',
  'multiple',
  'readOnly',
  'required',
  'tabIndex',
  'title',
  'htmlFor',
  'placeholder',
  // A table cell's and a column's, which size the table's columns
  'colSpan',
  'rowSpan',
  'span',
];

// `htmlFor` is `for` and `tabIndex` is `tabindex` to a selector, and the
// spans are lowercase
const ATTRIBUTE_NAMES: {[string]: string} = {
  htmlFor: 'for',
  tabIndex: 'tabindex',
  readOnly: 'readonly',
  colSpan: 'colspan',
  rowSpan: 'rowspan',
};

/**
 * The elements that scroll their content when their style says so: block
 * containers. Matches the engine's list.
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

const DEFAULT_BACKDROP = {backgroundColor: 'rgba(0, 0, 0, 0.1)'};

/**
 * Elements drawn by a component rather than a host of their own name, which
 * passes the engine's inputs to the host it renders: a text field for
 * `<input>` and `<textarea>`.
 */
const MAPPED_COMPONENTS: {[string]: React.ComponentType<$FlowFixMe>} = {
  input: Input,
  textarea: TextArea,
};

// The component an element is drawn by, by its tag and, for an `<input>`, its
// type: a checkbox or a radio is a box with its own activation behavior, not
// a text field
function mappedComponentFor(
  tag: string,
  type: unknown,
): ?React.ComponentType<$FlowFixMe> {
  if (tag === 'input' && (type === 'checkbox' || type === 'radio')) {
    return CheckableInput;
  }
  return MAPPED_COMPONENTS[tag];
}

const SCROLL_VIEW_STYLE = {flexGrow: 1, flexShrink: 1};
const HORIZONTAL_CONTENT_CONTAINER = {minWidth: '100%'};
const VERTICAL_CONTENT_CONTAINER = {minHeight: '100%'};

type Attributes = {[string]: unknown};

function buildAttributes(props: {readonly [string]: unknown}): {
  attributes: Attributes,
  key: string,
} {
  const attributes: Attributes = {};
  let key = '';
  for (const name of Object.keys(props)) {
    if (name.startsWith('data-') || name.startsWith('aria-')) {
      const value = props[name];
      if (value != null && value !== false) {
        attributes[name] = value;
        key += `${name}=${String(value)}&`;
      }
    }
  }
  for (const name of MATCHABLE_ATTRIBUTES) {
    const value = props[name];
    if (value != null && value !== false) {
      const attribute = ATTRIBUTE_NAMES[name] ?? name;
      attributes[attribute] = value;
      key += `${attribute}=${String(value)}&`;
    }
  }
  return {attributes, key};
}

// What an inline style may do, as `hints()` would say it of a sheet rule
function inlineHints(inline: ?{readonly [string]: unknown}): number {
  if (inline == null) {
    return 0;
  }
  let hints = 0;
  for (const key of Object.keys(inline)) {
    const value = String(inline[key]);
    if (key === 'display') {
      if (value !== 'inline' && value !== 'none' && value !== 'contents') {
        hints |= HINT_BOX;
      }
      if (value === 'flex' || value === 'inline-flex') {
        hints |= HINT_FLEX_ROW;
      }
    } else if (
      key === 'flexDirection' ||
      key === 'flexFlow' ||
      key === 'flexWrap'
    ) {
      // `wrap` and `wrap-reverse`, not `nowrap`
      if (
        value.includes('column') ||
        (value.includes('wrap') && !value.includes('nowrap'))
      ) {
        hints |= HINT_FLEX_COLUMN;
      }
    } else if (key === 'position') {
      if (value === 'absolute' || value === 'fixed') {
        hints |= HINT_BOX;
      }
    } else if (key === 'float' || key.startsWith('grid')) {
      hints |= HINT_BOX;
    } else if (key === 'overflowX') {
      if (value === 'auto' || value === 'scroll') {
        hints |= HINT_SCROLL;
      }
    } else if (key === 'overflow' || key === 'overflowY') {
      if (value === 'auto' || value === 'scroll') {
        hints |= HINT_SCROLL_BLOCK;
      }
      // The shorthand's block axis is its second value, or its only one
      const block = value.trim().split(/\s+/).pop();
      if (block === 'hidden' || block === 'clip') {
        hints |= HINT_CLIP_BLOCK;
      }
    }
  }
  return hints;
}

const classLists: Map<string, Array<string>> = new Map();

function classListOf(className: unknown): Array<string> {
  if (typeof className !== 'string' || className === '') {
    return [];
  }
  let list = classLists.get(className);
  if (list == null) {
    list = className.split(/\s+/).filter(name => name !== '');
    if (classLists.size > 4096) {
      classLists.clear();
    }
    classLists.set(className, list);
  }
  return list;
}

const encodedInline: WeakMap<
  interface {},
  Array<[string, unknown]>,
> = new WeakMap();

function encodeInline(inline: {
  readonly [string]: unknown,
}): Array<[string, unknown]> {
  let encoded = encodedInline.get(inline);
  if (encoded == null) {
    encoded = encodeStyle(inline);
    encodedInline.set(inline, encoded);
  }
  return encoded;
}

/**
 * The props of an element that needs no behaviour of the runtime's, as the
 * host node it is rendered as directly — no component, no hooks: its inputs
 * for the style engine beside the author's props. Null when the element
 * needs `EngineElement`: a popover or a dialog, a scroll container, a
 * behaviour-mapped element. An element whose styles read its interaction
 * state, or a StyleX marker's, is a host node too: the engine keeps its
 * states from its pointer and focus events (`cssStateful`).
 */
export function hostPropsFor(
  tag: string,
  props: {readonly [string]: unknown},
): ?{[string]: unknown} {
  const start = instrumenting() ? performance.now() : 0;
  if (MAPPED_COMPONENTS[tag] != null || tag === 'dialog') {
    if (start !== 0) {
      counters.componentMapped++;
    }
    return null;
  }
  // An empty element something holds a ref to is where a portal can land
  // (react-dom-shim's `createPortal` takes the element), and only a component
  // can draw what lands in it. A layer's `<template>` sentinel is held the
  // same way on every trigger and never receives anything.
  if (props.ref != null && props.children == null && tag !== 'template') {
    return null;
  }
  // One pass over the props: the host's, the attributes selectors read, and
  // the style inputs, with nothing allocated an element without them needs
  const host: {[string]: unknown} = {};
  let attributes: ?Attributes = null;
  let attributesKey = '';
  let style: unknown;
  let styleId: unknown;
  let className = '';
  let marker: ?string = null;
  for (const key in props) {
    const value = props[key];
    if (key === 'style') {
      style = value;
      continue;
    }
    if (key === '__cssStyle') {
      styleId = value;
      continue;
    }
    if (key === '__cssBackdrop') {
      continue;
    }
    if ((key === '__cssBefore' || key === '__cssAfter') && value != null) {
      // A `::before` or `::after` box is a child the component draws
      return null;
    }
    if (key === '__cssMarker') {
      // A marker is a class a `when.*` condition's selector names, and the
      // element reports its states for it
      if (typeof value === 'string') {
        marker = value;
      }
      continue;
    }
    if (key === 'popover' && value != null && value !== false) {
      // A popover is shown and hidden: the component's
      if (start !== 0) {
        counters.componentPopover++;
      }
      return null;
    }
    if (key === 'className' && typeof value === 'string') {
      className = value;
    }
    host[key] = value;
    if (value == null || value === false) {
      continue;
    }
    const attribute = MATCHABLE[key];
    if (
      attribute != null ||
      key.startsWith('data-') ||
      key.startsWith('aria-')
    ) {
      const name = attribute ?? key;
      const target: Attributes = attributes ?? {};
      target[name] = value;
      attributes = target;
      attributesKey += `${name}=${String(value)}&`;
    }
  }
  const classes =
    marker != null ? `${className} __stylex-marker-${marker}` : className;
  const {styleId: resolvedStyle, inline} = styleInputsOf(styleId, style);
  const hints =
    hintsFor(tag, classes, attributes, attributesKey, resolvedStyle) |
    inlineHints(inline);
  // A block that may scroll is the component's, which builds the platform's
  // scroll view around it, and so is one that may clip, which tells the
  // regions below it to scroll; asked of what the style states, not of the
  // value, so a style that changes its `overflow` as it measures does not
  // move the element between a host node and the component, remounting its
  // children
  if (
    SCROLL_CONTAINER_TAGS.has(tag) &&
    ((hints & (HINT_SCROLL | HINT_SCROLL_BLOCK | HINT_CLIP_BLOCK)) !== 0 ||
      declaresOverflow(resolvedStyle, inline))
  ) {
    if (start !== 0) {
      counters.componentScroll++;
    }
    return null;
  }
  // The engine keeps the states of an element whose styles read them, from
  // the events these handlers make its view report
  if ((hints & HINT_STATES) !== 0 || marker != null) {
    host.cssStateful = true;
    for (const key in STATE_EVENT_HANDLERS) {
      if (host[key] == null) {
        host[key] = STATE_EVENT_HANDLERS[key];
      }
    }
    if (start !== 0) {
      counters.statefulHosts++;
    }
  }
  if (tag === 'button' && authorAnswersPress(hints, marker)) {
    host.authorStatesPressFeedback = true;
  }
  host.cssEngine = true;
  host.cssClass = classes;
  host.cssAttributes = attributes ?? NO_ATTRIBUTES;
  host.cssStyle = resolvedStyle;
  host.cssInline = inline != null ? encodeInline(inline) : null;
  host.cssBox = (hints & HINT_BOX) !== 0;
  if (start !== 0) {
    counters.hostElements++;
    counters.hostElementMs += performance.now() - start;
  }
  return host;
}

// Handlers for the events the style engine keeps an element's states from:
// their presence makes the element's view report them, and they do nothing
function reportToTheStyleEngine(): void {}
const STATE_EVENT_HANDLERS: {readonly [string]: () => void} = Object.freeze({
  onPointerEnter: reportToTheStyleEngine,
  onPointerLeave: reportToTheStyleEngine,
  onPointerDown: reportToTheStyleEngine,
  onPointerUp: reportToTheStyleEngine,
  onPointerCancel: reportToTheStyleEngine,
  onFocus: reportToTheStyleEngine,
  onBlur: reportToTheStyleEngine,
});

/*
 * Whether a button's author answers its press, which keeps the platform's
 * press feedback out of it: with both, the two land on different clocks. Its
 * styles read its `:hover` (a touch is a hover on the way to a press) or its
 * `:active`, or a `when.*` condition reads them through its marker.
 */
function authorAnswersPress(hints: number, marker: unknown): boolean {
  return (
    (hints & HINT_PRESS_STATES) !== 0 ||
    (typeof marker === 'string' && isPressReadThroughMarker(marker))
  );
}

// The attributes selectors read beyond `data-*` and `aria-*`, by prop name,
// under the name a selector gives them
const MATCHABLE: {readonly [string]: string} = (() => {
  const names: {[string]: string} = {};
  for (const name of MATCHABLE_ATTRIBUTES) {
    names[name] = ATTRIBUTE_NAMES[name] ?? name;
  }
  return names;
})();

const NO_ATTRIBUTES: Attributes = Object.freeze({});

/*
 * The record of an element rendered as a bare host node, for the DOM methods:
 * its props as last committed, which carry its attributes and its inputs.
 */
const hostRecords: WeakMap<
  interface {},
  {props: unknown, record: ElementRecord},
> = new WeakMap();

setRecordFallback((instance: Object): ElementRecord | null => {
  const canonical = instance?.__internalInstanceHandle?.stateNode?.canonical;
  const props = canonical?.currentProps;
  if (props == null || props.cssEngine !== true) {
    return null;
  }
  const cached = hostRecords.get(instance);
  if (cached != null && cached.props === props) {
    return cached.record;
  }
  // The host reports its name under the renderer's `RN:` prefix (`getTagName`
  // in DOM.cpp); a selector names the tag without it, so `button` has to
  // match an `RN:button`
  const nodeName =
    typeof instance.nodeName === 'string' ? instance.nodeName : '';
  const tag = (
    nodeName.startsWith('RN:') ? nodeName.slice('RN:'.length) : nodeName
  ).toLowerCase();
  const record: $FlowFixMe = {
    descriptor: {
      tag,
      classes: classListOf(props.className),
      attributes: props.cssAttributes ?? {},
      states: {
        hovered: false,
        pressed: false,
        focused: false,
        focusVisible: false,
        disabled: props.disabled === true,
        popoverOpen: false,
      },
      // The ancestor chain, read when a selector asks: the JS matcher takes
      // over for this node once `setAttribute` has written to it, and a
      // descendant selector (`th button`) needs the parents then
      get parent(): ?ElementDescriptor {
        const parent = instance.parentElement;
        return parent == null ? null : (recordOf(parent)?.descriptor ?? null);
      },
    },
    props,
    overrides: cached?.record.overrides ?? new Map(),
    popoverOpen: false,
    setPopoverOpen: () => {},
    dialogMode: null,
    setDialogMode: () => {},
    returnValue: '',
    engine: true,
  };
  Object.defineProperty(record, 'style', {
    get: () => computedStyleForInstance(instance),
    enumerable: true,
  });
  hostRecords.set(instance, {props, record});
  return record;
});

type Props = {
  __astryxTag: string,
  // The host to render, where it is not the tag: `<svg>` is drawn by a box
  // whose children are its shapes
  __hostTag?: string,
  // The boxes `::before` and `::after` generate, from `props()`
  __cssBefore?: GeneratedContent,
  __cssAfter?: GeneratedContent,
  [string]: unknown,
};

export default function EngineElement({
  __astryxTag: tag,
  __hostTag: hostTag = tag,
  ...props
}: Props): React.Node {
  const start = instrumenting() ? performance.now() : 0;
  const {
    style,
    __cssStyle,
    __cssBackdrop,
    __cssMarker,
    __cssBefore,
    __cssAfter,
    className,
    children,
    ...rest
  } = props;

  const {styleId, inline} = styleInputsOf(__cssStyle, style);
  const {attributes, key: attributesKey} = buildAttributes(rest);
  // A StyleX marker is a class, which `when.*` conditions name
  const authoredClasses = typeof className === 'string' ? className : '';
  const classes =
    typeof __cssMarker === 'string'
      ? `${authoredClasses} __stylex-marker-${__cssMarker}`
      : authoredClasses;
  const hints =
    hintsFor(tag, classes, attributes, attributesKey, styleId) |
    inlineHints(inline);

  const inTopLayerAbove = React.useContext(InTopLayerContext);
  const clippedAbove = React.useContext(ClipsBlockContext);

  // Interaction tracking, for the rules and StyleX conditions that read it.
  // The hook always runs (hook order); its handlers attach only when needed
  // A marked element reports its states for the `when.*` conditions below it
  const tracksStates =
    (hints & HINT_STATES) !== 0 || typeof __cssMarker === 'string';
  const {state: interaction, handlers: interactionHandlers} =
    useInteractionState({disabled: rest.disabled === true});

  // Whether a popover is shown (HTML §6.12), and how a dialog is shown (HTML
  // §4.11.4); the DOM methods set them through the element's record
  const [popoverOpen, setPopoverOpen] = React.useState(false);
  const isPopover = rest.popover != null && rest.popover !== false;
  const isDialog = tag === 'dialog';
  const [dialogMode, setDialogMode] =
    React.useState<?('modal' | 'non-modal')>(null);
  React.useLayoutEffect(() => {
    if (!isPopover && popoverOpen) {
      setPopoverOpen(false);
    }
  }, [isPopover, popoverOpen]);

  // What other components portal into this element (react-dom-shim's
  // `createPortal`), drawn after its own children as a portal's are
  const [portals, setPortals] =
    React.useState<?ReadonlyMap<string, React.Node>>(null);

  const recordHolder = React.useRef<?ElementRecord>(null);
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

  let states = 0;
  if (tracksStates) {
    if (interaction.hovered === true) {
      states |= STATE_HOVER;
    }
    if (interaction.pressed === true) {
      states |= STATE_ACTIVE;
    }
    if (interaction.focused === true) {
      states |= STATE_FOCUS | STATE_FOCUS_VISIBLE;
    }
  }
  if (popoverOpen) {
    states |= STATE_POPOVER_OPEN;
  }

  // A shown dialog has its `open` attribute, which the user agent's
  // `dialog:not([open])` reads
  const matchedAttributes =
    isDialog && dialogMode != null && attributes.open == null
      ? {...attributes, open: true}
      : attributes;

  const opensTopLayer = isPopover || isDialog;
  let inlineEntries = inline != null ? encodeInline(inline) : null;
  if (opensTopLayer) {
    inlineEntries =
      inlineEntries != null
        ? [...inlineEntries, IN_TOP_LAYER_ENTRY]
        : [IN_TOP_LAYER_ENTRY];
  }

  const {ref: _ref, ...withoutRef} = rest;
  const hostProps: {[string]: unknown} = {
    ...withoutRef,
    ref: registeringRef,
    cssEngine: true,
    cssClass: classes,
    cssAttributes: matchedAttributes,
    cssStyle: styleId,
    cssInline: inlineEntries,
    cssStates: states,
    cssBox: (hints & HINT_BOX) !== 0,
  };
  if (tracksStates) {
    for (const name of Object.keys(interactionHandlers)) {
      const own = interactionHandlers[name];
      const authored = rest[name];
      hostProps[name] =
        typeof authored === 'function'
          ? (event: $FlowFixMe) => {
              (authored as $FlowFixMe)(event);
              own();
            }
          : own;
    }
  }
  if (tag === 'button' && authorAnswersPress(hints, __cssMarker)) {
    hostProps.authorStatesPressFeedback = true;
  }

  // The platform scroll view of a scroll container, which dom-compat.js answers
  // the element's scroll offsets and sizes from
  const scrollViewRef = React.useRef<?Object>(null);
  // The element's `scroll` event (cssom-view-1 §13.1), which does not bubble:
  // `useScrollOverflow` and a sticky header listen for it
  const dispatchScroll = React.useCallback(() => {
    instanceRef.current?.dispatchEvent?.(new Event('scroll'));
  }, []);

  // What dom-compat.js answers the DOM methods from
  const descriptor = {
    tag,
    classes: classListOf(className),
    attributes: matchedAttributes,
    states: {
      hovered: interaction.hovered === true,
      pressed: interaction.pressed === true,
      focused: interaction.focused === true,
      focusVisible: interaction.focused === true,
      disabled: rest.disabled === true,
      popoverOpen,
    },
    parent: null,
  };
  const record: $FlowFixMe = {
    descriptor,
    props: rest,
    overrides: recordHolder.current?.overrides ?? new Map(),
    popoverOpen,
    setPopoverOpen,
    dialogMode,
    setDialogMode,
    returnValue: recordHolder.current?.returnValue ?? '',
    engine: true,
    setPortals,
  };
  // The style the engine resolved, read when asked
  Object.defineProperty(record, 'style', {
    get: () => computedStyleForInstance(instanceRef.current),
    enumerable: true,
  });
  Object.defineProperty(record, 'scrollView', {
    get: () => scrollViewRef.current,
    enumerable: true,
  });
  recordHolder.current = record;

  const inTopLayer = inTopLayerAbove || opensTopLayer;
  // The scroll view an element needs, kept once it has needed one: a scroll
  // area that sets its own `overflow` as it measures (Astryx's does) would
  // otherwise move its children in and out of the scroll view, remounting
  // them, and their refs would measure again
  const scrollRef = React.useRef<0 | 1 | 2>(0);
  if (scrollRef.current === 0 && SCROLL_CONTAINER_TAGS.has(tag)) {
    // The `overflow` shorthand scrolls sideways on a flex row that does not
    // wrap: its items sit side by side with their own widths, and the
    // block-axis growth that stands in for a vertical scroll container
    // (DOM-CSS-LIMITATION(no-nested-vertical-scroll)) has nothing to grow
    const shorthandOnRow =
      (hints & HINT_SCROLL_BLOCK) !== 0 &&
      (hints & HINT_FLEX_ROW) !== 0 &&
      (hints & HINT_FLEX_COLUMN) === 0;
    // A region of the top layer, or below a container that clips its block
    // axis, has no page to grow into, and scrolls in the block axis even when
    // it scrolls sideways as well (a bottom sheet's body is `overflow: auto`
    // in both): the block axis is where its content flows, and the horizontal
    // scroll view lays the content out at max-content and stretches it to the
    // region's height, which leaves it nothing to scroll
    if (
      (inTopLayer || clippedAbove) &&
      (hints & HINT_SCROLL_BLOCK) !== 0 &&
      !shorthandOnRow
    ) {
      scrollRef.current = 2;
    } else if ((hints & HINT_SCROLL) !== 0 || shorthandOnRow) {
      scrollRef.current = 1;
    }
  }
  const scrollsSideways = scrollRef.current === 1;
  const scrollsInBlockAxis = scrollRef.current === 2;

  if (hostTag !== tag) {
    hostProps.cssTag = tag;
  }

  const beforeBox =
    __cssBefore != null
      ? generatedBox(__cssBefore, '::before', states, rest)
      : null;
  const afterBox =
    __cssAfter != null
      ? generatedBox(__cssAfter, '::after', states, rest)
      : null;
  let content =
    (portals == null || portals.size === 0) &&
    beforeBox == null &&
    afterBox == null
      ? children
      : [
          beforeBox,
          children,
          ...Array.from(portals ?? [], ([id, node]) =>
            reactJsx(React.Fragment, {children: node}, id),
          ),
          afterBox,
        ];
  // A container that may clip its block axis tells the regions below it to
  // scroll, kept once it has, so its children are not remounted if its style
  // stops clipping
  const clipsBelowRef = React.useRef(false);
  if (
    !clippedAbove &&
    SCROLL_CONTAINER_TAGS.has(tag) &&
    (hints & HINT_CLIP_BLOCK) !== 0
  ) {
    clipsBelowRef.current = true;
  }
  if (clipsBelowRef.current) {
    content = reactJsx(ClipsBlockContext.Provider, {
      value: true,
      children: content,
    });
  }

  let element: React.Node;
  const Mapped = mappedComponentFor(tag, rest.type);
  if (Mapped != null) {
    // A field has no children of its own; a textarea's are its initial value
    hostProps.cssTag = tag;
    delete hostProps.cssBox;
    element = reactJsx(
      Mapped,
      tag === 'textarea' ? {...hostProps, children} : hostProps,
    );
  } else if (scrollsSideways || scrollsInBlockAxis) {
    // A scroll container: the element's box holds the platform's scroll view,
    // and the element just inside it lays out the children; the engine splits
    // the element's styles between the two.
    // DOM-CSS-LIMITATION(no-nested-vertical-scroll)
    hostProps.cssScroll = scrollsSideways ? 1 : 2;
    hostProps.children = reactJsx(ScrollView, {
      ref: scrollViewRef,
      onScroll: dispatchScroll,
      horizontal: scrollsSideways,
      style: SCROLL_VIEW_STYLE,
      contentContainerStyle: scrollsSideways
        ? HORIZONTAL_CONTENT_CONTAINER
        : VERTICAL_CONTENT_CONTAINER,
      // A region below a clip scrolls inside the screen's scroll view, which
      // on Android takes a vertical drag from a scroll view inside it that
      // does not ask for nested scrolling
      nestedScrollEnabled: scrollsInBlockAxis,
      showsHorizontalScrollIndicator: false,
      alwaysBounceHorizontal: false,
      alwaysBounceVertical: false,
      children: reactJsx('div', {
        cssEngine: true,
        cssScroll: 3,
        children: content,
      }),
    });
    element = reactJsx(hostTag, hostProps);
  } else {
    hostProps.children = content;
    element = reactJsx(hostTag, hostProps);
  }

  if (opensTopLayer) {
    // A shown popover and a modal dialog are drawn in the top layer, from a
    // handle that stays here whether or not they are shown
    const authoredClick = rest.onClick;
    element = (
      <TopLayerElement
        open={isDialog ? dialogMode === 'modal' : popoverOpen}
        lightDismiss={!isDialog && rest.popover !== 'manual'}
        backdrop={isDialog ? DEFAULT_BACKDROP : null}
        backdropStyleId={
          isDialog && typeof __cssBackdrop === 'number' ? __cssBackdrop : null
        }
        onBackdropPress={
          isDialog
            ? () => clickOnTheElementItself(authoredClick, instanceRef.current)
            : null
        }
        centered={isDialog}
        instanceRef={instanceRef}>
        {element}
      </TopLayerElement>
    );
    if (!inTopLayerAbove) {
      element = (
        <InTopLayerContext.Provider value={true}>
          {element}
        </InTopLayerContext.Provider>
      );
    }
  }
  if (start !== 0) {
    counters.elements++;
    counters.elementMs += performance.now() - start;
  }
  return element;
}

// A press on a dialog's backdrop is a click on the dialog itself, as on the
// web, which is how a dialog tells it from a click on its content
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

/*
 * A `::before` or `::after` box (css-pseudo-4 §2): the first or last child of
 * the element it is generated for, styled under its own id with the element's
 * states (its `:hover` is the element's), and named `::before` or `::after`
 * so that no tag selector matches it. It is not an element: the style engine
 * leaves it out of its siblings' positions (`cssPseudo`) and the DOM leaves it
 * out of its parent's children (`markGeneratedContent`).
 */
function generatedBox(
  box: GeneratedContent,
  name: '::before' | '::after',
  states: number,
  attributes: {readonly [string]: unknown},
): React.Node {
  const text = box.attr != null ? String(attributes[box.attr] ?? '') : box.text;
  return reactJsx(
    'span',
    {
      ref: markGeneratedContent,
      cssEngine: true,
      cssTag: name,
      cssStyle: box.id,
      cssStates: states,
      cssPseudo: name === '::before' ? 1 : 2,
      cssBox: (hintsFor(name, '', null, '', box.id) & HINT_BOX) !== 0,
      children: text === '' ? null : text,
    },
    name,
  );
}
