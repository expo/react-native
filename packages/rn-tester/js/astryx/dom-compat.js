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

import type {ElementDescriptor} from './css';
import type {ElementRecord} from './elementRegistry';

import {
  nativeScrollDocuments,
  nativeScrollGeometry,
} from '../../../expo-intrinsics/src/NativeScroll';
import {currentContext} from './css';
import {selectorMatches} from './css/match';
import {compileSelector} from './css/parse';
import {forwardShimEventsTo} from './document-shim';
import {
  isGeneratedContent,
  observeRegistrations,
  recordOf,
} from './elementRegistry';
import {checkednessOf} from './elements/checkedness';
import {
  customProperty as engineCustomProperty,
  matches as engineMatches,
  nodeOf,
  resolveUrls,
  scriptStyle as engineScriptStyle,
  setScriptAttributes as setEngineScriptAttributes,
  setScriptStyles as setEngineScriptStyles,
} from './native-css/engine';
import {setAnchorNames} from './overlay/anchorNames';
import {isTopLayerHandle} from './overlay/topLayerHandles';
import scrollAlignment from './scrollAlignment';
import {Platform, StyleSheet} from 'react-native';
import {getFabricUIManager} from 'react-native/Libraries/ReactNative/FabricUIManager';
import LegacySyntheticEvent from 'react-native/src/private/renderer/events/LegacySyntheticEvent';
import Event from 'react-native/src/private/webapis/dom/events/Event';
import EventTarget from 'react-native/src/private/webapis/dom/events/EventTarget';
import {EVENT_TARGET_GET_THE_PARENT_KEY} from 'react-native/src/private/webapis/dom/events/internals/EventTargetInternals';
import {getNativeElementReference} from 'react-native/src/private/webapis/dom/nodes/internals/NodeInternals';
import ReactNativeDocument from 'react-native/src/private/webapis/dom/nodes/ReactNativeDocument';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

import './imperativeEvents';

/**
 * The DOM methods the vendored Astryx sources call on their element refs,
 * added to React Native's element instances.
 *
 * `ReactNativeElement` already gives an element `getBoundingClientRect`,
 * `focus`, `contains`, `parentElement`, `childNodes`, `tagName`,
 * `textContent` and the client/scroll metrics; `imperativeEvents.js` gives it
 * back `addEventListener`. What is added here reads from the JSX runtime's
 * record of the element (`elementRegistry.js`):
 *
 * - attributes (`getAttribute`, `setAttribute`, `hasAttribute`,
 *   `removeAttribute`, `dataset`) from the authored props, with `setAttribute`
 *   writes kept over them until React writes the attribute anew, and sent to
 *   the style engine, whose selectors match them;
 * - selectors (`matches`, `closest`, `querySelector`, `querySelectorAll`)
 *   through the stylesheet engine's own selector matcher, over the element's
 *   descriptor and the native node tree;
 * - `window.getComputedStyle` from the style the element resolved to;
 * - `element.style` writes as the element's inline style, which the engine
 *   styles over React's `style`.
 *
 * DOM-CSS-LIMITATION(dom-methods-are-a-subset): `animate` does nothing here,
 * `scrollTo` and `scrollBy` move only a scroll
 * container the runtime lays out in a platform scroll view, and an attribute
 * written with `setAttribute` is read and matched but reaches no native prop
 * (a script's `aria-label` is not what the accessibility tree reads), nor
 * does a written `class` or `style` restyle the element.
 */

// $FlowFixMe[unclear-type] prototypes are patched by name
const elementPrototype: {[string]: any} = ReactNativeElement.prototype as any;
// $FlowFixMe[unclear-type]
const documentPrototype: {[string]: any} = ReactNativeDocument.prototype as any;

function define(
  target: {[string]: unknown},
  name: string,
  value: unknown,
): void {
  if (!(name in target)) {
    Object.defineProperty(target, name, {
      value,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
}

function defineGetter(
  target: {[string]: unknown},
  name: string,
  get: () => unknown,
): void {
  if (!(name in target)) {
    Object.defineProperty(target, name, {get, configurable: true});
  }
}

// ---- attributes ----------------------------------------------------------

// Props that read as attributes of the same name on the web
const ATTRIBUTE_PROPS = new Set([
  'id',
  'role',
  'title',
  'type',
  'name',
  'value',
  'href',
  'src',
  'alt',
  'placeholder',
  'disabled',
  'checked',
  'selected',
  'hidden',
  'tabIndex',
  'lang',
  'dir',
  'popover',
  'inert',
]);

function attributeFromProps(record: ElementRecord, name: string): ?string {
  const written = scriptAttribute(record, name.toLowerCase());
  return written !== undefined ? written : reactAttribute(record, name);
}

/*
 * What script wrote to the attribute and still stands, or undefined: a write
 * stands over React's value until React writes the attribute anew (a value
 * other than the one it had when script wrote it), as React DOM sets an
 * attribute only when its prop changes. The style engine keeps the same rule
 * (`setScriptAttributes`), so `getAttribute` and selectors agree.
 */
function scriptAttribute(record: ElementRecord, name: string): ?string | void {
  const written = record.overrides.get(name);
  if (written === undefined) {
    return undefined;
  }
  if (reactAttribute(record, name) !== written.reactValue) {
    record.overrides.delete(name);
    return undefined;
  }
  return written.value;
}

// The attribute's value as React gives it, from the authored props
function reactAttribute(record: ElementRecord, name: string): ?string {
  const lower = name.toLowerCase();
  const props = record.props;
  let value: unknown;
  if (lower === 'class') {
    value = props.className;
  } else if (lower === 'tabindex') {
    value = props.tabIndex;
  } else if (lower.startsWith('data-') || lower.startsWith('aria-')) {
    value = props[lower];
  } else if (ATTRIBUTE_PROPS.has(name)) {
    value = props[name];
  } else {
    value = props[lower];
  }
  if (value == null || value === false) {
    return null;
  }
  if (value === true) {
    return '';
  }
  return typeof value === 'string' ? value : String(value);
}

define(
  elementPrototype,
  'getAttribute',
  function (this: Object, name: string): ?string {
    const record = recordOf(this);
    return record == null ? null : attributeFromProps(record, name);
  },
);
define(
  elementPrototype,
  'hasAttribute',
  function (this: Object, name: string): boolean {
    const record = recordOf(this);
    return record != null && attributeFromProps(record, name) != null;
  },
);
define(
  elementPrototype,
  'setAttribute',
  function (this: Object, name: string, value: unknown): void {
    writeAttribute(this, name, String(value));
  },
);
define(
  elementPrototype,
  'removeAttribute',
  function (this: Object, name: string): void {
    writeAttribute(this, name, null);
  },
);

/*
 * Writes an attribute over React's, where `getAttribute` reads it and, by the
 * end of the task, the style engine's selectors match it (DOM §4.9, an
 * element's attribute list): Astryx's touch press controller paints a press
 * by writing `data-astryx-press` onto the pressed control.
 */
function writeAttribute(
  element: Object,
  name: string,
  value: string | null,
): void {
  const record = recordOf(element);
  if (record == null) {
    return;
  }
  // HTML lowercases an attribute's name on an HTML element (DOM §4.9)
  const lower = name.toLowerCase();
  const reactValue = reactAttribute(record, lower) ?? null;
  // A write of React's own value leaves nothing over it
  if (value === reactValue) {
    record.overrides.delete(lower);
  } else {
    record.overrides.set(lower, {value, reactValue});
  }
  sendScriptAttributes(element);
}
define(
  elementPrototype,
  'toggleAttribute',
  function (this: Object, name: string, force?: boolean): boolean {
    const has = this.hasAttribute(name);
    const next = force ?? !has;
    if (next) {
      this.setAttribute(name, '');
    } else {
      this.removeAttribute(name);
    }
    return next;
  },
);
defineGetter(elementPrototype, 'dataset', function (this: Object): {
  [string]: string,
} {
  const record = recordOf(this);
  const out: {[string]: string} = {};
  if (record == null) {
    return out;
  }
  const keys = new Set([
    ...Object.keys(record.props),
    ...Array.from(record.overrides.keys()),
  ]);
  for (const key of keys) {
    if (key.startsWith('data-')) {
      const value = attributeFromProps(record, key);
      if (value != null) {
        out[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] =
          value;
      }
    }
  }
  return out;
});
defineGetter(elementPrototype, 'className', function (this: Object): string {
  const record = recordOf(this);
  return record == null ? '' : (attributeFromProps(record, 'class') ?? '');
});

// ---- selectors -----------------------------------------------------------

// A descriptor for a node the runtime did not record (a host view that is not
// one of the catalog's elements): its tag, nothing else
function descriptorOf(node: Object): ElementDescriptor | null {
  const record = recordOf(node);
  if (record != null) {
    // Attributes written with setAttribute take part in matching
    if (record.overrides.size === 0) {
      return record.descriptor;
    }
    const attributes = {...record.descriptor.attributes};
    for (const name of Array.from(record.overrides.keys())) {
      const value = scriptAttribute(record, name);
      if (value === null) {
        delete attributes[name];
      } else if (value !== undefined) {
        attributes[name] = value === '' ? true : value;
      }
    }
    return {...record.descriptor, attributes};
  }
  const tag =
    typeof node.nodeName === 'string' ? node.nodeName.toLowerCase() : null;
  if (tag == null) {
    return null;
  }
  const parent = node.parentElement;
  return {
    tag,
    classes: [],
    attributes: {},
    states: {
      hovered: false,
      pressed: false,
      focused: false,
      focusVisible: false,
      disabled: false,
    },
    parent: parent == null ? null : descriptorOf(parent),
  };
}

const compiled: Map<string, $FlowFixMe> = new Map();
function selectorsOf(selectors: string): Array<$FlowFixMe> {
  // A selector list (`a, b`) matches when any member does
  return selectors
    .split(',')
    .map(s => s.trim())
    .filter(s => s !== '')
    .map(s => {
      let sel = compiled.get(s);
      if (sel == null) {
        sel = compileSelector(s);
        compiled.set(s, sel);
      }
      return sel;
    });
}

function nodeMatches(node: Object, selectors: string): boolean {
  // An element the renderer's style engine styles is matched there, against
  // the tree it last committed, unless the DOM methods have changed it since
  const record = recordOf(node);
  if (
    record != null &&
    record.engine === true &&
    record.overrides.size === 0 &&
    record.uncommitted !== true
  ) {
    return engineMatches(nodeOf(node), selectors);
  }
  const descriptor = descriptorOf(node);
  if (descriptor == null) {
    return false;
  }
  const ctx = currentContext();
  return selectorsOf(selectors).some(sel =>
    selectorMatches(sel, descriptor, ctx),
  );
}

function* elementsUnder(node: Object): Iterable<Object> {
  const children = node.childNodes;
  if (children == null) {
    return;
  }
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child != null && child.nodeType === 1) {
      yield child;
      yield* elementsUnder(child);
    }
  }
}

define(
  elementPrototype,
  'matches',
  function (this: Object, selectors: string): boolean {
    return nodeMatches(this, selectors);
  },
);
function closestFrom(start: Object, selectors: string): ?Object {
  for (let node = start; node != null; node = node.parentElement) {
    if (nodeMatches(node, selectors)) {
      return node;
    }
  }
  return null;
}
define(
  elementPrototype,
  'closest',
  function (this: Object, selectors: string): ?Object {
    return closestFrom(this, selectors);
  },
);
define(
  elementPrototype,
  'querySelector',
  function (this: Object, selectors: string): ?Object {
    for (const node of elementsUnder(this)) {
      if (nodeMatches(node, selectors)) {
        return node;
      }
    }
    return null;
  },
);
define(
  elementPrototype,
  'querySelectorAll',
  function (this: Object, selectors: string): Array<Object> {
    const found = [];
    for (const node of elementsUnder(this)) {
      if (nodeMatches(node, selectors)) {
        found.push(node);
      }
    }
    return found;
  },
);
// `getElementsByClassName` and `getElementsByTagName` (DOM §4.2.6): class
// names and a tag name taken literally, not as selectors. A browser's
// collection is live; this one is the elements at the time of the call, which
// is how the sources read it
function classTokens(names: string): Array<string> {
  return String(names).trim().split(/\s+/).filter(Boolean);
}
function elementsWhere(
  root: Object,
  test: (descriptor: ElementDescriptor) => boolean,
): Array<Object> {
  const start = root.documentElement ?? root;
  const found = [];
  if (start !== root) {
    const descriptor = descriptorOf(start);
    if (descriptor != null && test(descriptor)) {
      found.push(start);
    }
  }
  for (const node of elementsUnder(start)) {
    const descriptor = descriptorOf(node);
    if (descriptor != null && test(descriptor)) {
      found.push(node);
    }
  }
  return found;
}
for (const prototype of [elementPrototype, documentPrototype]) {
  define(
    prototype,
    'getElementsByClassName',
    function (this: Object, names: string): Array<Object> {
      const wanted = classTokens(names);
      return wanted.length === 0
        ? []
        : elementsWhere(this, descriptor =>
            wanted.every(name => descriptor.classes.includes(name)),
          );
    },
  );
  define(
    prototype,
    'getElementsByTagName',
    function (this: Object, name: string): Array<Object> {
      const tag = String(name).toLowerCase();
      return elementsWhere(
        this,
        descriptor => tag === '*' || descriptor.tag === tag,
      );
    },
  );
}
define(
  documentPrototype,
  'querySelector',
  function (this: Object, selectors: string): ?Object {
    const root = this.documentElement;
    return root == null ? null : root.querySelector(selectors);
  },
);
define(
  documentPrototype,
  'querySelectorAll',
  function (this: Object, selectors: string): Array<Object> {
    const root = this.documentElement;
    return root == null ? [] : root.querySelectorAll(selectors);
  },
);
// Composed with React Native's own lookup rather than defined beside it: the
// document already has a `getElementById`, so `define` would leave this out,
// and the stub document's elements would never be found
const nativeGetElementById: ?(id: string) => ?Object =
  documentPrototype.getElementById;
const globalShim = shimDocument();
const shimGetElementById = globalShim?.getElementById.bind(globalShim);
Object.defineProperty(documentPrototype, 'getElementById', {
  value: function (this: Object, id: string): ?Object {
    // The rendered elements whose id reached the native tree
    const found = nativeGetElementById?.call(this, id);
    if (found != null) {
      return found;
    }
    // The stub document's own elements: the `<style>` sheets the sources
    // append to `head`, which they look up by id before appending again (each
    // Layer's `ensureSlideRules`)
    const shimElement = shimGetElementById?.(id);
    if (shimElement != null) {
      return shimElement;
    }
    // The rendered elements whose id the native tree does not carry
    const root = this.documentElement;
    if (root != null) {
      for (const node of elementsUnder(root)) {
        const record = recordOf(node);
        if (record != null && attributeFromProps(record, 'id') === id) {
          return node;
        }
      }
    }
    return null;
  },
  writable: true,
  configurable: true,
  enumerable: false,
});

// Elements the sources create imperatively (`doc.createElement('style')` in
// the Layer's slide rules, with `doc` an element's `ownerDocument`, which is
// this document) are the stub document's: nothing imperative can be mounted
// in the native tree, and a `<style>` appended to `head` reaches the CSS
// engine from there
for (const method of ['createElement', 'createElementNS', 'createTextNode']) {
  define(
    documentPrototype,
    method,
    function (this: Object, ...args: Array<$FlowFixMe>): unknown {
      const shim = shimDocument();
      return shim == null ? null : shim[method](...args);
    },
  );
}

// The global facade owns injected sheets and unattached nodes. Rendered
// lookups use Fabric's real documents, discovered from mounted viewports.
// Ref cleanup removes a viewport when its native tree leaves.
if (globalShim != null) {
  globalShim.getElementById = (id: string): ?Object => {
    const own = shimGetElementById?.(id);
    if (own != null) {
      return own;
    }
    for (const document of nativeScrollDocuments()) {
      const found = document.getElementById(id);
      if (found != null) {
        return found;
      }
    }
    return null;
  };
  const shimQuerySelector = globalShim.querySelector.bind(globalShim);
  const shimQuerySelectorAll = globalShim.querySelectorAll.bind(globalShim);
  globalShim.querySelector = (selector: string): ?Object => {
    const own = shimQuerySelector(selector);
    if (own != null) {
      return own;
    }
    for (const document of nativeScrollDocuments()) {
      const found = document.querySelector(selector);
      if (found != null) {
        return found;
      }
    }
    return null;
  };
  globalShim.querySelectorAll = (selector: string): Array<Object> => [
    ...shimQuerySelectorAll(selector),
    ...nativeScrollDocuments().flatMap(document =>
      document.querySelectorAll(selector),
    ),
  ];
}

function shimDocument(): ?Object {
  const shim = (globalThis as $FlowFixMe).document;
  return shim != null && shim.constructor?.name === 'ShimDocument'
    ? shim
    : null;
}
defineGetter(documentPrototype, 'defaultView', () => globalThis);
defineGetter(documentPrototype, 'body', function (this: Object): ?Object {
  return this.documentElement;
});
defineGetter(documentPrototype, 'head', function (this: Object): ?Object {
  // Styles appended here go to the CSS engine through document-shim's head;
  // a real document has no head to speak of
  return shimDocument()?.head ?? null;
});

// ---- document events -------------------------------------------------------

/*
 * The page's events are dispatched in the renderer's documents, and an event
 * goes on from a document to its window (DOM §2.9, a document's "get the
 * parent"). The global `document` the sources listen on is the stub, and
 * `window` is React Native's global; neither is in the renderer's tree, so an
 * event target above every renderer document stands for each, and is handed
 * its listeners. A press reaches them from the first frame, whatever element
 * it lands on, in a browser's order: `window`, then `document`, in the
 * capture phase. Handing the listeners to each document as an element of it
 * first registered left out a page whose elements were all bare host views:
 * Astryx's press controller never heard a press there.
 */
const pageWindow: EventTarget = new EventTarget();
const pageDocument: EventTarget = new EventTarget();
(pageDocument as $FlowFixMe)[EVENT_TARGET_GET_THE_PARENT_KEY] = () =>
  pageWindow;
(documentPrototype as $FlowFixMe)[EVENT_TARGET_GET_THE_PARENT_KEY] =
  function (): EventTarget {
    return pageDocument;
  };
// The stub's listeners take events as the DOM's do
forwardShimEventsTo(pageDocument as $FlowFixMe, pageWindow as $FlowFixMe);

// ---- the top layer's handles ----------------------------------------------

// A shown popover is drawn from a handle the renderer puts where the popover was
// written (overlay/TopLayerElement.js). The handle is not the document's: the
// popover is its parent's child, as a shown popover is in the DOM, so a source
// that checks where its layer is mounted (Astryx's `isCurrentContextPopover`,
// which compares the popover's `parentElement` with its marker's) finds it
// there. Each getter is replaced on the prototype that defines it.
function replaceGetter(
  name: string,
  wrap: (original: (node: Object) => unknown) => (node: Object) => unknown,
): void {
  let owner: ?Object = elementPrototype;
  while (
    owner != null &&
    Object.getOwnPropertyDescriptor(owner, name) == null
  ) {
    owner = Object.getPrototypeOf(owner);
  }
  const descriptor =
    owner == null ? null : Object.getOwnPropertyDescriptor(owner, name);
  const original = descriptor?.get;
  if (owner == null || original == null) {
    return;
  }
  const read = (node: Object) => original.call(node);
  const replaced = wrap(read);
  Object.defineProperty(owner, name, {
    ...descriptor,
    get: function (this: Object): unknown {
      return replaced(this);
    },
  });
}

for (const name of ['parentNode', 'parentElement']) {
  replaceGetter(name, read => node => {
    let parent = read(node);
    while (isTopLayerHandle(parent) && parent != null) {
      parent = read(parent as $FlowFixMe);
    }
    return parent;
  });
}

for (const name of ['childNodes', 'children']) {
  replaceGetter(name, read => node => {
    const nodes = read(node) as $FlowFixMe;
    if (
      nodes == null ||
      !Array.from(nodes).some(
        child => isTopLayerHandle(child) || isGeneratedContent(child),
      )
    ) {
      return nodes;
    }
    const flattened: Array<unknown> = [];
    const add = (child: $FlowFixMe) => {
      if (isTopLayerHandle(child)) {
        Array.from(read(child) as $FlowFixMe).forEach(add);
      } else if (!isGeneratedContent(child)) {
        // Skip a `::before` or `::after` box, which is drawn as a child but is
        // not one. DOM-CSS-LIMITATION(generated-content-in-text-content):
        // `textContent` still counts its text.
        flattened.push(child);
      }
    };
    Array.from(nodes).forEach(add);
    return flattened;
  });
}

// ---- element.style -------------------------------------------------------

const inlineStyles: WeakMap<Object, Object> = new WeakMap();

/**
 * `element.style`, a CSSStyleDeclaration of sorts: reads answer from what
 * script wrote, then from the style the element resolved to (so
 * `el.style.anchorName` is `''` rather than a property of `undefined`), and
 * writes (`el.style.top = '4px'`, `setProperty`, `removeProperty`,
 * `cssText`) are the element's inline style as the engine styles it, over
 * React's `style` until React writes the property anew. They reach the
 * engine together at the end of the task, which restyles the elements without
 * React rendering; a read of computed style first sends what is pending.
 */
defineGetter(elementPrototype, 'style', function (this: Object): Object {
  let style = inlineStyles.get(this);
  if (style == null) {
    style = inlineStyleFor(this);
    inlineStyles.set(this, style);
  }
  return style;
});

function inlineStyleFor(instance: Object): Object {
  // What script wrote, by property; the engine's list, once sent, drops what
  // React has written since
  const writes: Map<string, string> = new Map();
  let written = false;
  const standing = (): Map<string, string> => {
    const node =
      written && !pendingScriptStyles.has(instance) ? nodeOf(instance) : null;
    if (node != null) {
      const anchorName = writes.get('anchorName');
      writes.clear();
      for (const [key, value] of engineScriptStyle(node)) {
        writes.set(key, String(value));
      }
      if (anchorName != null) {
        writes.set('anchorName', anchorName);
      }
    }
    return writes;
  };
  const read = (name: string): string => {
    const scripted = standing().get(name);
    if (scripted != null) {
      return scripted;
    }
    const record = recordOf(instance);
    const flat =
      record == null
        ? null
        : (StyleSheet.flatten(record.style as $FlowFixMe) as $FlowFixMe);
    const value = flat == null ? undefined : flat[name];
    return value == null
      ? ''
      : typeof value === 'number'
        ? `${value}px`
        : String(value);
  };
  const methods: {[string]: $FlowFixMe} = {
    getPropertyValue: (name: string): string => read(camel(name)),
    setProperty: (name: string, value: ?string): void => {
      const key = camel(name);
      standing();
      written = true;
      if (value == null || value === '') {
        writes.delete(key);
      } else {
        writes.set(key, String(value));
      }
      // An anchor name is the one inline write the engine does not style:
      // the element a top-layer popover is placed against
      if (key === 'anchorName') {
        setAnchorNames(instance, writes.get(key) ?? '');
      } else {
        sendScriptStyle(instance, writes);
      }
    },
    removeProperty: (name: string): string => {
      const key = camel(name);
      const had = standing().get(key) ?? '';
      methods.setProperty(key, null);
      return had;
    },
    item: (index: number): string => Array.from(standing().keys())[index] ?? '',
  };
  return new Proxy(methods, {
    get(target, name) {
      if (typeof name !== 'string') {
        return undefined;
      }
      if (name in target) {
        return target[name];
      }
      if (name === 'length') {
        return standing().size;
      }
      if (name === 'cssText') {
        return Array.from(standing())
          .map(([key, value]) => `${kebab(key)}: ${value};`)
          .join(' ');
      }
      return read(name);
    },
    set(target, name, value) {
      if (typeof name !== 'string') {
        return false;
      }
      if (name === 'cssText') {
        if (writes.has('anchorName')) {
          setAnchorNames(instance, '');
        }
        writes.clear();
        sendScriptStyle(instance, writes);
        for (const declaration of String(value ?? '').split(';')) {
          const colon = declaration.indexOf(':');
          if (colon > 0) {
            methods.setProperty(
              declaration.slice(0, colon).trim(),
              declaration.slice(colon + 1).trim(),
            );
          }
        }
        return true;
      }
      methods.setProperty(name, value == null ? '' : String(value));
      return true;
    },
    has(target, name) {
      return (
        typeof name === 'string' && (name in target || standing().has(name))
      );
    },
  });
}

// The elements whose inline style script changed this task, and what it is
const pendingScriptStyles: Map<Object, Map<string, string>> = new Map();

function sendScriptStyle(instance: Object, writes: Map<string, string>): void {
  if (pendingScriptStyles.size === 0) {
    queueMicrotask(flushScriptStyles);
  }
  pendingScriptStyles.set(instance, writes);
}

/*
 * Sends the engine what script wrote to inline styles since the last time, in
 * one call, which restyles each surface once
 */
function flushScriptStyles(): void {
  if (pendingScriptStyles.size === 0) {
    return;
  }
  const sent: Array<[unknown, Array<[string, unknown]>]> = [];
  for (const [instance, writes] of pendingScriptStyles) {
    const node = nodeOf(instance);
    if (node == null) {
      continue;
    }
    const declarations: Array<[string, unknown]> = [];
    for (const [key, value] of writes) {
      if (key !== 'anchorName') {
        declarations.push([key, resolveUrls(value)]);
      }
    }
    sent.push([node, declarations]);
  }
  pendingScriptStyles.clear();
  if (sent.length > 0) {
    setEngineScriptStyles(sent);
  }
}

// The elements whose attributes script changed this task
const pendingScriptAttributes: Set<Object> = new Set();

function sendScriptAttributes(instance: Object): void {
  if (pendingScriptAttributes.size === 0) {
    queueMicrotask(flushScriptAttributes);
  }
  pendingScriptAttributes.add(instance);
}

/*
 * Sends the engine every attribute script wrote that stands on each element
 * changed since the last time, in one call, which restyles each surface once.
 * `class` and `style` are left out: an element's classes and its inline style
 * reach the engine as their own inputs, not as attributes.
 */
function flushScriptAttributes(): void {
  if (pendingScriptAttributes.size === 0) {
    return;
  }
  const sent: Array<[unknown, Array<[string, string | null]>]> = [];
  for (const instance of pendingScriptAttributes) {
    const record = recordOf(instance);
    const node = nodeOf(instance);
    if (record == null || node == null) {
      continue;
    }
    const attributes: Array<[string, string | null]> = [];
    for (const name of Array.from(record.overrides.keys())) {
      const value = scriptAttribute(record, name);
      if (value !== undefined && name !== 'class' && name !== 'style') {
        attributes.push([name, value]);
      }
    }
    sent.push([node, attributes]);
  }
  pendingScriptAttributes.clear();
  if (sent.length > 0) {
    setEngineScriptAttributes(sent);
  }
}

const CAMEL_UPPER = /[A-Z]/g;
function kebab(name: string): string {
  return name.replace(CAMEL_UPPER, c => `-${c.toLowerCase()}`);
}

// ---- the rest ------------------------------------------------------------

const noop = () => {};

/*
 * A scroll container the runtime lays out in a platform scroll view
 * (`EngineElement`'s `cssScroll`) scrolls that view, not its own box, so its
 * scroll offsets and its scrolling area's size are the view's (cssom-view-1
 * §7), and `scrollTo`, `scrollBy` and a write to `scrollTop` or `scrollLeft`
 * move it. A bottom sheet hands a pull to the sheet only when its body reads
 * `scrollTop` 0; read off the box, which never scrolls, it always did, so a
 * pull on scrolled content dragged the sheet as well as the content. Any other
 * element answers as React Native's element does.
 */
function scrollViewOf(element: Object, horizontal: boolean = false): ?Object {
  const record = recordOf(element);
  return (
    (horizontal ? record?.horizontalScrollView : null) ??
    record?.scrollView ??
    null
  );
}

const readOnlyElementPrototype = Object.getPrototypeOf(elementPrototype);
for (const name of ['scrollTop', 'scrollLeft', 'scrollHeight', 'scrollWidth']) {
  const own = Object.getOwnPropertyDescriptor(readOnlyElementPrototype, name);
  const get = own?.get;
  if (get == null) {
    continue;
  }
  const axis = name === 'scrollTop' ? 'y' : name === 'scrollLeft' ? 'x' : null;
  Object.defineProperty(elementPrototype, name, {
    configurable: true,
    get: function (this: Object): unknown {
      return get.call(
        scrollViewOf(this, name === 'scrollLeft' || name === 'scrollWidth') ??
          this,
      );
    },
    set: function (this: Object, value: unknown): void {
      if (axis != null && typeof value === 'number') {
        scrollViewTo(
          this,
          axis === 'x' ? value : null,
          axis === 'y' ? value : null,
          false,
        );
      }
    },
  });
}

// Moves the element's scroll view to `left` and `top`, keeping the offset
// along an axis given as null
function scrollViewTo(
  element: Object,
  left: ?number,
  top: ?number,
  animated: boolean,
): void {
  const view = scrollViewOf(element);
  if (view == null) {
    return;
  }
  const horizontal = scrollViewOf(element, true);
  if (horizontal != null && horizontal !== view && left != null) {
    horizontal.scrollTo({x: left, y: horizontal.scrollTop, animated});
  }
  view.scrollTo({
    x: horizontal === view ? (left ?? view.scrollLeft) : view.scrollLeft,
    y: top ?? view.scrollTop,
    animated,
  });
}

// `scrollTo(x, y)` or `scrollTo({left, top, behavior})` (cssom-view-1 §7)
function scrollOptions(args: ReadonlyArray<unknown>): {
  left: ?number,
  top: ?number,
  animated: boolean,
} {
  const [first, second] = args;
  if (typeof first === 'object' && first != null) {
    const options: {left?: unknown, top?: unknown, behavior?: unknown} =
      first as $FlowFixMe;
    return {
      left: typeof options.left === 'number' ? options.left : null,
      top: typeof options.top === 'number' ? options.top : null,
      animated: options.behavior === 'smooth',
    };
  }
  return {
    left: typeof first === 'number' ? first : null,
    top: typeof second === 'number' ? second : null,
    animated: false,
  };
}

define(
  elementPrototype,
  'scrollTo',
  function (this: Object, ...args: ReadonlyArray<unknown>): void {
    const {left, top, animated} = scrollOptions(args);
    scrollViewTo(this, left, top, animated);
  },
);
define(
  elementPrototype,
  'scrollBy',
  function (this: Object, ...args: ReadonlyArray<unknown>): void {
    const view = scrollViewOf(this);
    if (view == null) {
      return;
    }
    const {left, top, animated} = scrollOptions(args);
    scrollViewTo(
      this,
      left == null ? null : this.scrollLeft + left,
      top == null ? null : this.scrollTop + top,
      animated,
    );
  },
);

// CSSOM View §6.1: visit scroll boxes from the target outwards. Geometry
// comes from Fabric; the host performs the scroll and clamps its range.
define(
  elementPrototype,
  'scrollIntoView',
  function (this: Object, argument?: boolean | {[string]: unknown}): void {
    const options =
      typeof argument === 'object' && argument != null ? argument : {};
    const block = options.block ?? (argument === false ? 'end' : 'start');
    const inline = options.inline ?? 'nearest';
    for (const alignment of [block, inline]) {
      if (!['start', 'center', 'end', 'nearest'].includes(alignment)) {
        throw new TypeError('Invalid scrollIntoView alignment');
      }
    }
    const animated = options.behavior === 'smooth';
    let target = this.getBoundingClientRect();
    for (
      let ancestor = this.parentElement;
      ancestor != null;
      ancestor = ancestor.parentElement
    ) {
      const geometry = nativeScrollGeometry(ancestor);
      const view = geometry != null ? ancestor : scrollViewOf(ancestor);
      if (view == null) {
        continue;
      }
      const frame = view.getBoundingClientRect();
      const inset = geometry?.inset;
      const shift = geometry?.contentShift;
      const dx =
        ancestor.scrollWidth > view.clientWidth
          ? scrollAlignment(
              target.left - (shift?.x ?? 0),
              target.right - (shift?.x ?? 0),
              frame.left + (inset?.left ?? 0),
              frame.right - (inset?.right ?? 0),
              inline,
            )
          : 0;
      const dy =
        view.scrollHeight > view.clientHeight
          ? scrollAlignment(
              target.top - (shift?.y ?? 0),
              target.bottom - (shift?.y ?? 0),
              frame.top + (inset?.top ?? 0),
              frame.bottom - (inset?.bottom ?? 0),
              block,
            )
          : 0;
      const currentLeft = ancestor.scrollLeft + (shift?.x ?? 0);
      const currentTop = ancestor.scrollTop + (shift?.y ?? 0);
      const minLeft = -(inset?.left ?? 0);
      const minTop = -(inset?.top ?? 0);
      const maxLeft = Math.max(
        minLeft,
        ancestor.scrollWidth - view.clientWidth + (inset?.right ?? 0),
      );
      const maxTop = Math.max(
        minTop,
        ancestor.scrollHeight - view.clientHeight + (inset?.bottom ?? 0),
      );
      const left = Math.max(minLeft, Math.min(maxLeft, currentLeft + dx));
      const top = Math.max(minTop, Math.min(maxTop, currentTop + dy));
      const movedX = left - currentLeft;
      const movedY = top - currentTop;
      if (movedX !== 0 || movedY !== 0) {
        if (geometry != null) {
          const node = getNativeElementReference(view);
          if (node != null) {
            getFabricUIManager()?.dispatchCommand(node, 'scrollTo', [
              left,
              top,
              animated,
            ]);
          }
        } else {
          scrollViewTo(ancestor, left, top, animated);
        }
        // An outer box must see where the target will be after the inner
        // scroll, including when that scroll is animated.
        target = {
          left: target.left - movedX,
          right: target.right - movedX,
          top: target.top - movedY,
          bottom: target.bottom - movedY,
        };
      }
      if (options.container === 'nearest') {
        break;
      }
    }
  },
);

// The popover methods (HTML §6.12.2) show and hide the element: the runtime
// renders a popover `display: none` until it is shown, and `:popover-open`
// matches while it is. A change fires `toggle` after it, as a task, with the
// old and new states. A shown popover is drawn in the top layer, placed by
// anchor positioning (overlay/TopLayerElement.js).
// The dialog methods (HTML §4.11.4): `showModal()` shows the dialog in the top
// layer over its backdrop, `show()` where it is; `close()` closes it, keeps
// the return value it is given and fires `close` after it, as a task;
// `requestClose()` fires a cancelable `cancel` first. `open` reads whether it
// is shown. A dialog already shown the other way is an InvalidStateError.
function dialogRecordOf(element: Object, method: string): ElementRecord {
  const record = recordOf(element);
  if (record == null || record.descriptor.tag !== 'dialog') {
    throw new Error(
      `NotSupportedError: ${method}() is a method of <dialog>, and this element is not one.`,
    );
  }
  return record;
}

function showDialog(element: Object, mode: 'modal' | 'non-modal'): void {
  const record = dialogRecordOf(
    element,
    mode === 'modal' ? 'showModal' : 'show',
  );
  if (record.dialogMode === mode) {
    return;
  }
  if (record.dialogMode != null) {
    throw new Error(
      `InvalidStateError: the dialog is already open ${
        record.dialogMode === 'modal' ? 'as a modal' : 'in place'
      }. Close it before opening it the other way.`,
    );
  }
  setDialogMode(record, mode);
}

/*
 * A dialog's state as `show()`, `showModal()` and `close()` change it, which
 * matching reads from the record until the element renders it: a shown
 * dialog has its `open` attribute (HTML §4.11.4).
 */
function setDialogMode(
  record: ElementRecord,
  mode: ?('modal' | 'non-modal'),
): void {
  record.dialogMode = mode;
  const authored = record.props.open != null && record.props.open !== false;
  const {open, ...others} = record.descriptor.attributes;
  record.descriptor = {
    ...record.descriptor,
    attributes:
      mode != null || authored ? {...others, open: open ?? true} : others,
  };
  record.uncommitted = true;
  record.setDialogMode(mode);
}

define(elementPrototype, 'showModal', function (this: Object): void {
  showDialog(this, 'modal');
});
define(elementPrototype, 'show', function (this: Object): void {
  showDialog(this, 'non-modal');
});
define(
  elementPrototype,
  'close',
  function (this: Object, returnValue?: string): void {
    const record = dialogRecordOf(this, 'close');
    if (record.dialogMode == null) {
      return;
    }
    if (returnValue !== undefined) {
      record.returnValue = String(returnValue);
    }
    setDialogMode(record, null);
    setTimeout(() => {
      (this as $FlowFixMe).dispatchEvent?.(new Event('close'));
    }, 0);
  },
);
define(
  elementPrototype,
  'requestClose',
  function (this: Object, returnValue?: string): void {
    const record = dialogRecordOf(this, 'requestClose');
    if (record.dialogMode == null) {
      return;
    }
    const cancel: $FlowFixMe = new Event('cancel', {cancelable: true});
    (this as $FlowFixMe).dispatchEvent?.(cancel);
    if (!cancel.defaultPrevented) {
      (this as $FlowFixMe).close(returnValue);
    }
  },
);
if (!('open' in elementPrototype)) {
  Object.defineProperty(elementPrototype, 'open', {
    get: function (this: Object): boolean {
      const record = recordOf(this);
      if (record == null) {
        return false;
      }
      return (
        record.dialogMode != null || attributeFromProps(record, 'open') != null
      );
    },
    set: function (this: Object, value: unknown): void {
      if (value) {
        (this as $FlowFixMe).show();
      } else {
        (this as $FlowFixMe).close();
      }
    },
    configurable: true,
  });
}
if (!('returnValue' in elementPrototype)) {
  Object.defineProperty(elementPrototype, 'returnValue', {
    get: function (this: Object): string {
      return recordOf(this)?.returnValue ?? '';
    },
    set: function (this: Object, value: unknown): void {
      const record = recordOf(this);
      if (record != null) {
        record.returnValue = String(value);
      }
    },
    configurable: true,
  });
}

define(elementPrototype, 'showPopover', function (this: Object): void {
  setPopoverOpen(this, true);
});
define(elementPrototype, 'hidePopover', function (this: Object): void {
  setPopoverOpen(this, false);
});
define(
  elementPrototype,
  'togglePopover',
  function (this: Object, force?: unknown): boolean {
    const record = recordOf(this);
    // `force` alone, or as the options dictionary's member, where an
    // undefined member is an absent one (Web IDL)
    const forced =
      force != null && typeof force === 'object'
        ? (force as $FlowFixMe).force
        : force;
    const open =
      typeof forced === 'boolean' ? forced : !(record?.popoverOpen ?? false);
    setPopoverOpen(this, open);
    return open;
  },
);

function setPopoverOpen(element: Object, open: boolean): void {
  const record = recordOf(element);
  if (record == null) {
    return;
  }
  const popover = attributeFromProps(record, 'popover');
  if (popover == null) {
    throw new Error(
      'NotSupportedError: showPopover() and hidePopover() need a popover ' +
        'attribute on the element. Add popover="auto" or popover="manual".',
    );
  }
  if (record.popoverOpen === open) {
    return;
  }
  const oldState = open ? 'closed' : 'open';
  const newState = open ? 'open' : 'closed';
  // `beforetoggle` first, synchronously; showing can be cancelled there
  const before: $FlowFixMe = new Event('beforetoggle', {cancelable: open});
  before.oldState = oldState;
  before.newState = newState;
  element.dispatchEvent?.(before);
  if (open && before.defaultPrevented) {
    return;
  }
  record.popoverOpen = open;
  // What `matches(':popover-open')` reads now, before the element renders
  // its new state
  record.descriptor = {
    ...record.descriptor,
    states: {...record.descriptor.states, popoverOpen: open},
  };
  record.uncommitted = true;
  record.setPopoverOpen(open);
  queueToggle(element, oldState, newState);
}

// The pending `toggle` of each element: a change before it fires replaces
// it, keeping the state it started from (HTML §6.12.1, the popover toggle task
// tracker), so a show and a hide in one task fire one event
const pendingToggles: WeakMap<Object, {oldState: string, timer: TimeoutID}> =
  new WeakMap();

function queueToggle(element: Object, oldState: string, newState: string) {
  const pending = pendingToggles.get(element);
  const from = pending?.oldState ?? oldState;
  if (pending != null) {
    clearTimeout(pending.timer);
  }
  const timer = setTimeout(() => {
    pendingToggles.delete(element);
    const event: $FlowFixMe = new Event('toggle');
    event.oldState = from;
    event.newState = newState;
    element.dispatchEvent?.(event);
  }, 0);
  pendingToggles.set(element, {oldState: from, timer});
}
define(elementPrototype, 'animate', function (this: Object): {
  cancel(): void,
  finish(): void,
  finished: Promise<void>,
} {
  return {cancel: noop, finish: noop, finished: Promise.resolve()};
});
define(
  elementPrototype,
  'getClientRects',
  function (this: Object): Array<unknown> {
    return [this.getBoundingClientRect()];
  },
);
define(elementPrototype, 'checkVisibility', function (this: Object): boolean {
  return this.isConnected === true;
});

// An `<input>`'s `type`, from its authored props, `text` when none is given,
// as the DOM reflects it; Astryx's field containers read it to decide whether
// a press on the container focuses the field
defineGetter(elementPrototype, 'type', function (this: Object): ?string {
  const record = recordOf(this);
  if (record == null) {
    return undefined;
  }
  const authored = record.props.type;
  if (typeof authored === 'string') {
    return authored;
  }
  return record.descriptor.tag === 'input' ? 'text' : undefined;
});

// An `<input>`'s checkedness (HTML §4.10.5.4), which a checkbox or a radio
// keeps (CheckableInput), false for any other input and undefined for any
// other element
defineGetter(elementPrototype, 'checked', function (this: Object): ?boolean {
  const checked = checkednessOf(this);
  if (checked != null) {
    return checked;
  }
  return recordOf(this)?.descriptor.tag === 'input' ? false : undefined;
});

// `click()` from script runs the element's authored click handler, which is
// what activating it means here; the platform's own controls are pressed by
// their native views, which a script cannot reach. An element without a
// handler does nothing, where an undefined method aborted the app. A checkbox
// or a radio is clicked as on the web, by a click event that bubbles from it:
// its activation behavior is the handler of the click it receives, which a
// dispatched click reaches as a press does.
define(elementPrototype, 'click', function (this: Object): void {
  if (checkednessOf(this) != null) {
    this.dispatchEvent(
      new MouseEvent('click', {bubbles: true, cancelable: true}),
    );
    return;
  }
  // $FlowFixMe[unclear-type] an authored handler takes whatever event it is given
  const handler: any = recordOf(this)?.props.onClick;
  if (typeof handler !== 'function') {
    return;
  }
  const event: {
    type: string,
    target: Object,
    currentTarget: Object,
    defaultPrevented: boolean,
    preventDefault(): void,
    stopPropagation(): void,
  } = {
    type: 'click',
    target: this,
    currentTarget: this,
    defaultPrevented: false,
    preventDefault(): void {
      event.defaultPrevented = true;
    },
    stopPropagation(): void {},
  };
  handler(event);
});

// ---- event fields --------------------------------------------------------

/**
 * The fields of a web pointer, mouse and touch event that the vendored Astryx
 * sources read on the event itself (`event.clientX`, `event.pointerType`,
 * `event.touches.length`), which React Native's event carries only on its
 * `nativeEvent`. React DOM copies them onto its synthetic event the same way.
 * A touch in a list gets the web `Touch`'s `clientX` and `clientY`: its page
 * point, which is relative to the root view, the viewport here.
 *
 * DOM-CSS-LIMITATION(event-fields-on-every-event): the fields are getters on
 * the event class, so `'touches' in event` is true of every event, where on
 * the web only a touch event has them, and a field the native payload lacks
 * reads as undefined. A `Touch`'s `target` is the event's target, which is
 * the element every touch started on only when there is one touch.
 */
const NATIVE_EVENT_FIELDS = [
  'clientX',
  'clientY',
  'pageX',
  'pageY',
  'screenX',
  'screenY',
  'offsetX',
  'offsetY',
  'x',
  'y',
  'pointerId',
  'pointerType',
  'isPrimary',
  'pressure',
  'tangentialPressure',
  'tiltX',
  'tiltY',
  'twist',
  'width',
  'height',
  'button',
  'buttons',
  'detail',
  'altKey',
  'ctrlKey',
  'metaKey',
  'shiftKey',
  // A transition event's (css-transitions-1 §6.1)
  'propertyName',
  'elapsedTime',
  'pseudoElement',
];
const TOUCH_LISTS = ['touches', 'changedTouches', 'targetTouches'];

// $FlowFixMe[unclear-type] prototypes are patched by name
const eventPrototype: {[string]: any} = LegacySyntheticEvent.prototype as any;
for (const name of NATIVE_EVENT_FIELDS) {
  defineGetter(eventPrototype, name, function (this: Object): unknown {
    return this.nativeEvent[name];
  });
}

// Touch lists are converted once per event, so a list reads as the same object
// each time, as a `TouchList` does
const touchLists: WeakMap<Object, {[string]: ?ReadonlyArray<WebTouch>}> =
  new WeakMap();
for (const name of TOUCH_LISTS) {
  defineGetter(
    eventPrototype,
    name,
    function (this: Object): ?ReadonlyArray<WebTouch> {
      let lists = touchLists.get(this);
      if (lists == null) {
        lists = {} as {[string]: ?ReadonlyArray<WebTouch>};
        touchLists.set(this, lists);
      }
      if (!(name in lists)) {
        const list = this.nativeEvent[name];
        lists[name] = Array.isArray(list)
          ? list.map(touch => webTouch(touch, this.target))
          : undefined;
      }
      return lists[name];
    },
  );
}

type WebTouch = {
  identifier: unknown,
  target: unknown,
  clientX: unknown,
  clientY: unknown,
  pageX: unknown,
  pageY: unknown,
  screenX: unknown,
  screenY: unknown,
  force: unknown,
};

// What a touch's pointer is numbered from: iOS's pointer handler gives the
// mouse 0 and the pencil 1 and counts the fingers from 2
// (`RCTSurfacePointerHandler`), where its touch handler counts them from 0;
// Android numbers both by the `MotionEvent`'s pointer id
const TOUCH_POINTER_ID_OFFSET = Platform.OS === 'ios' ? 2 : 0;

/*
 * A `Touch`'s `identifier` is the `pointerId` of the finger's pointer events,
 * as WebKit makes it, so a source that tracks a finger through both can find
 * one from the other: a bottom sheet drags by the pointer and prevents the
 * scroll from the matching touch, and did not find it.
 */
function webTouch(touch: {[string]: unknown}, target: unknown): WebTouch {
  return {
    identifier:
      typeof touch.identifier === 'number'
        ? touch.identifier + TOUCH_POINTER_ID_OFFSET
        : touch.identifier,
    target,
    clientX: touch.pageX,
    clientY: touch.pageY,
    pageX: touch.pageX,
    pageY: touch.pageY,
    screenX: touch.screenX,
    screenY: touch.screenY,
    force: touch.force,
  };
}

// ---- a touch's default action --------------------------------------------

/*
 * Scrolling is a touch's default action, so preventing a cancelable
 * `touchstart` or `touchmove` keeps the platform's scroll views around the
 * touch from scrolling for the rest of it, as a browser does: the target
 * becomes the JavaScript responder that blocks the native one until the last
 * finger lifts. A bottom sheet prevents the `touchmove` that pulls its content
 * down from the top and drags the sheet instead; the content followed the
 * finger as well. The platform hears of it a frame or so after the touch
 * moved, where a browser waits for the listener, so a scroll under way when it
 * does stops where it is.
 */
let touchBlockedAt: ?ReturnType<typeof getNativeElementReference> = null;
// The pointers of the touches whose default was prevented
const blockedPointerIds: Set<unknown> = new Set();
const preventDefault = eventPrototype.preventDefault;
eventPrototype.preventDefault = function (this: Object): void {
  preventDefault.call(this);
  if (
    !this.defaultPrevented ||
    (this.type !== 'touchstart' && this.type !== 'touchmove')
  ) {
    return;
  }
  for (const touch of this.changedTouches ?? []) {
    blockedPointerIds.add(touch.identifier);
  }
  const node =
    touchBlockedAt == null ? getNativeElementReference(this.target) : null;
  if (node != null) {
    touchBlockedAt = node;
    getFabricUIManager()?.setIsJSResponder(node, true, true);
  }
};

/*
 * The `pointercancel` a scroll sends (`RCTSurfacePointerHandler`), and the
 * `lostpointercapture` after it, are not delivered for the pointer of a touch
 * whose default was prevented: a browser never takes over such a touch, so it
 * never cancels the pointer, and a scroll that had begun before the block
 * landed is stopped by it. The sheet's drag ended on the cancel. The touch's
 * own events carry the gesture on from there.
 */
function dropCancelOfBlockedPointer(event: Object): void {
  if (blockedPointerIds.has(event.pointerId)) {
    event.stopImmediatePropagation();
  }
}

// Lifts the block when the last finger does, and at a touch that begins a new
// gesture in case the end of the last never arrived
function releaseTouchBlock(event: Object): void {
  if (
    event.type === 'touchstart'
      ? event.touches?.length !== 1
      : event.touches?.length > 0
  ) {
    return;
  }
  blockedPointerIds.clear();
  const blockedAt = touchBlockedAt;
  if (blockedAt != null) {
    getFabricUIManager()?.setIsJSResponder(blockedAt, false, false);
    touchBlockedAt = null;
  }
}

const touchBlockReleasers: WeakSet<Object> = new WeakSet();
observeRegistrations(instance => {
  const rendererDocument = (instance as $FlowFixMe).ownerDocument;
  if (rendererDocument == null || touchBlockReleasers.has(rendererDocument)) {
    return;
  }
  touchBlockReleasers.add(rendererDocument);
  for (const type of ['touchstart', 'touchend', 'touchcancel']) {
    rendererDocument.addEventListener(type, releaseTouchBlock, true);
  }
  for (const type of ['pointercancel', 'lostpointercapture']) {
    rendererDocument.addEventListener(type, dropCancelOfBlockedPointer, true);
  }
});

// ---- getComputedStyle ----------------------------------------------------

const KEBAB = /-([a-z])/g;
// A property's name as a style object spells it; a custom property's is
// written as it is, case and all
function camel(name: string): string {
  return name.startsWith('--')
    ? name
    : name.replace(KEBAB, (_, c) => c.toUpperCase());
}

/**
 * The style an element resolved to, as CSSOM's resolved values (cssom-1
 * §9): strings, lengths in pixels, every padding, margin and border width
 * present on all four sides and their logical aliases, `0px` where nothing
 * set one, and `width`/`height` the box's used size. Code measuring space
 * subtracts these (`parseFloat(style.paddingLeft)`); an absent value made
 * that `NaN`, and every comparison with it false. `getPropertyValue` takes
 * the kebab-cased names.
 */
function computedStyleOf(instance: unknown): {[string]: unknown} {
  // Style is resolved with what script wrote, as a browser does on this read
  flushScriptStyles();
  flushScriptAttributes();
  const record = recordOf(instance);
  const flat: {[string]: unknown} =
    record == null
      ? {}
      : ((StyleSheet.flatten(record.style as $FlowFixMe) as $FlowFixMe) ?? {});
  const direction = flat.direction === 'rtl' ? 'rtl' : 'ltr';
  const style: {[string]: unknown} = {
    direction,
    writingMode: 'horizontal-tb',
    visibility: 'visible',
  };
  for (const key of Object.keys(flat)) {
    style[key] = resolvedValue(key, flat[key]);
  }
  for (const property of [
    'padding',
    'margin',
    'scrollPadding',
    'scrollMargin',
  ]) {
    boxEdges(style, flat, property, '', direction);
  }
  boxEdges(style, flat, 'border', 'Width', direction);
  const overflow =
    typeof flat.overflow === 'string' ? flat.overflow : 'visible';
  style.overflow = overflow;
  style.overflowX = flat.overflowX ?? overflow;
  style.overflowY = flat.overflowY ?? overflow;
  transitionValues(style);
  // The used size, from layout, over what the style stated
  const rect =
    instance != null &&
    typeof (instance as $FlowFixMe).getBoundingClientRect === 'function'
      ? (instance as $FlowFixMe).getBoundingClientRect()
      : null;
  if (rect != null) {
    // A minimum or maximum may have overruled a stated size
    style.width = `${rect.width}px`;
    style.height = `${rect.height}px`;
  }
  Object.defineProperty(style, 'getPropertyValue', {
    value: (name: string): string => {
      if (name.startsWith('--') && record?.engine === true) {
        return engineCustomProperty(nodeOf(instance), name) ?? '';
      }
      const v = style[name.startsWith('--') ? name : camel(name)];
      return v == null ? '' : String(v);
    },
    enumerable: false,
  });
  return style;
}

/*
 * The transition longhands, at their initial values where nothing set them
 * (css-transitions-1 §2), and `transition` serialized from them, an entry per
 * transitioned property: a computed style answers every property, and code
 * that reads how long a transition takes reads these
 */
function transitionValues(style: {[string]: unknown}): void {
  const longhand = (key: string, initial: string): Array<string> => {
    const value = style[key];
    const text = value == null || value === '' ? initial : String(value);
    style[key] = text;
    return splitTopLevelCommas(text);
  };
  const properties = longhand('transitionProperty', 'all');
  const durations = longhand('transitionDuration', '0s');
  const timings = longhand('transitionTimingFunction', 'ease');
  const delays = longhand('transitionDelay', '0s');
  style.transition = properties
    .map(
      (property, i) =>
        `${property} ${durations[i % durations.length]} ` +
        `${timings[i % timings.length]} ${delays[i % delays.length]}`,
    )
    .join(', ');
}

// A list's items, split at the commas outside parentheses
// (`cubic-bezier(0, 0, 1, 1), ease`)
function splitTopLevelCommas(text: string): Array<string> {
  const items: Array<string> = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
    } else if (c === ',' && depth === 0) {
      items.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  items.push(text.slice(start).trim());
  return items;
}

// Properties whose number values are unitless rather than pixels
const UNITLESS: Set<string> = new Set([
  'opacity',
  'zIndex',
  'flex',
  'flexGrow',
  'flexShrink',
  'fontWeight',
  'aspectRatio',
  'order',
]);

function resolvedValue(key: string, value: unknown): unknown {
  if (typeof value !== 'number' || key.startsWith('--')) {
    return value;
  }
  return UNITLESS.has(key) ? String(value) : `${value}px`;
}

const SIDES = ['Top', 'Right', 'Bottom', 'Left'];

/**
 * One box edge property (padding, margin, border width…) on each physical
 * side and its logical alias, from whichever spelling React Native's style
 * gave it: the side itself, the start/end or inline/block alias, the axis
 * shorthand, then the shorthand; `0px` when none did.
 */
function boxEdges(
  style: {[string]: unknown},
  flat: {readonly [string]: unknown},
  property: string,
  suffix: string,
  direction: 'ltr' | 'rtl',
): void {
  const read = (name: string): unknown => flat[property + name + suffix];
  const startSide = direction === 'rtl' ? 'Right' : 'Left';
  const values: {[string]: unknown} = {};
  for (const side of SIDES) {
    const horizontal = side === 'Left' || side === 'Right';
    const inline =
      side === startSide
        ? (read('Start') ?? read('InlineStart'))
        : horizontal
          ? (read('End') ?? read('InlineEnd'))
          : side === 'Top'
            ? read('BlockStart')
            : read('BlockEnd');
    const value =
      read(side) ??
      inline ??
      (horizontal
        ? (read('Horizontal') ?? read('Inline'))
        : (read('Vertical') ?? read('Block'))) ??
      flat[property + suffix] ??
      0;
    const resolved = resolvedValue(property + side + suffix, value);
    values[side] = resolved;
    style[property + side + suffix] = resolved;
  }
  const endSide = startSide === 'Left' ? 'Right' : 'Left';
  style[property + 'InlineStart' + suffix] = values[startSide];
  style[property + 'InlineEnd' + suffix] = values[endSide];
  style[property + 'BlockStart' + suffix] = values.Top;
  style[property + 'BlockEnd' + suffix] = values.Bottom;
}

const g: {[string]: unknown} = globalThis as $FlowFixMe;
if (typeof g.getComputedStyle !== 'function') {
  g.getComputedStyle = computedStyleOf;
}
