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

import {currentContext} from './css';
import {selectorMatches} from './css/match';
import {compileSelector} from './css/parse';
import {forwardShimEventsTo} from './document-shim';
import {observeRegistrations, recordOf} from './elementRegistry';
import {setAnchorNames} from './overlay/anchorNames';
import {isTopLayerHandle} from './overlay/topLayerHandles';
import {StyleSheet} from 'react-native';
import LegacySyntheticEvent from 'react-native/src/private/renderer/events/LegacySyntheticEvent';
import Event from 'react-native/src/private/webapis/dom/events/Event';
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
 *   writes kept over them;
 * - selectors (`matches`, `closest`, `querySelector`, `querySelectorAll`)
 *   through the stylesheet engine's own selector matcher, over the element's
 *   descriptor and the native node tree;
 * - `window.getComputedStyle` from the style the element resolved to.
 *
 * DOM-CSS-LIMITATION(dom-methods-are-a-subset): `scrollTo`, `scrollBy`,
 * `scrollIntoView` and `animate` do nothing here — the platform's scrolling
 * is driven through the elements' props —
 * and an attribute written with `setAttribute` is readable but reaches no
 * native prop.
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
  const override = record.overrides.get(name);
  if (override !== undefined) {
    return override;
  }
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
    const record = recordOf(this);
    if (record != null) {
      record.overrides.set(name, String(value));
    }
  },
);
define(
  elementPrototype,
  'removeAttribute',
  function (this: Object, name: string): void {
    const record = recordOf(this);
    if (record != null) {
      record.overrides.set(name, null);
    }
  },
);
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
    // Overrides written with setAttribute take part in matching
    if (record.overrides.size === 0) {
      return record.descriptor;
    }
    const attributes = {...record.descriptor.attributes};
    for (const [name, value] of record.overrides) {
      if (value == null) {
        delete attributes[name];
      } else {
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
    const shimElement = shimDocument()?.getElementById(id);
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

// The page's events are dispatched in the renderer's document, the root of
// every element's event path; the global `document` the sources listen on is
// the stub. Each renderer document an element registers from is handed the
// stub's listeners (and `window`'s), so a press reaches them as on the web.
let lastRendererDocument: unknown = null;
observeRegistrations(instance => {
  const rendererDocument = (instance as $FlowFixMe).ownerDocument;
  if (rendererDocument == null || rendererDocument === lastRendererDocument) {
    return;
  }
  lastRendererDocument = rendererDocument;
  forwardShimEventsTo(rendererDocument);
});

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
    if (nodes == null || !Array.from(nodes).some(isTopLayerHandle)) {
      return nodes;
    }
    const flattened: Array<unknown> = [];
    const add = (child: $FlowFixMe) => {
      if (isTopLayerHandle(child)) {
        Array.from(read(child) as $FlowFixMe).forEach(add);
      } else {
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
 * `element.style`, a CSSStyleDeclaration of sorts: reads answer from the
 * style the element resolved to (so `el.style.anchorName` is `''` rather than
 * a property of `undefined`), and writes (`el.style.top = '4px'`,
 * `setProperty`, `cssText`) are kept on the element and read back. They reach
 * no native prop, as DOM-CSS-LIMITATION(dom-methods-are-a-subset) says:
 * the sources write inline style to position a floating layer or to lock a
 * scroll, which this platform's elements do through their own props.
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
  const writes: Map<string, string> = new Map();
  const read = (name: string): string => {
    const written = writes.get(name);
    if (written != null) {
      return written;
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
      if (value == null || value === '') {
        writes.delete(key);
      } else {
        writes.set(key, String(value));
      }
      // An anchor name is the one inline write something else reads: the
      // element a top-layer popover is placed against
      if (key === 'anchorName') {
        setAnchorNames(instance, writes.get(key) ?? '');
      }
    },
    removeProperty: (name: string): string => {
      const key = camel(name);
      const had = writes.get(key) ?? '';
      methods.setProperty(key, null);
      return had;
    },
    item: (index: number): string => Array.from(writes.keys())[index] ?? '',
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
        return writes.size;
      }
      if (name === 'cssText') {
        return Array.from(writes)
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
      return typeof name === 'string' && (name in target || writes.has(name));
    },
  });
}

const CAMEL_UPPER = /[A-Z]/g;
function kebab(name: string): string {
  return name.replace(CAMEL_UPPER, c => `-${c.toLowerCase()}`);
}

// ---- the rest ------------------------------------------------------------

const noop = () => {};
for (const method of ['scrollTo', 'scrollBy', 'scrollIntoView']) {
  define(elementPrototype, method, noop);
}

// The popover methods (HTML §6.12.2) show and hide the element: the runtime
// renders a popover `display: none` until it is shown, and `:popover-open`
// matches while it is. A change fires `toggle` after it, as a task, with the
// old and new states. A shown popover is drawn in the top layer, placed by
// anchor positioning (overlay/TopLayerElement.js), on the platforms that have
// one. DOM-CSS-LIMITATION(popover-is-not-in-the-top-layer)
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
  record.dialogMode = mode;
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
    record.dialogMode = null;
    record.setDialogMode(null);
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
  // What `matches(':popover-open')` reads now, before React renders the
  // element with its new state
  record.descriptor = {
    ...record.descriptor,
    states: {...record.descriptor.states, popoverOpen: open},
  };
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

// `click()` from script runs the element's authored click handler, which is
// what activating it means here; the platform's own controls are pressed by
// their native views, which a script cannot reach. An element without a
// handler does nothing, where an undefined method aborted the app.
define(elementPrototype, 'click', function (this: Object): void {
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

function webTouch(touch: {[string]: unknown}, target: unknown): WebTouch {
  return {
    identifier: touch.identifier,
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

// ---- getComputedStyle ----------------------------------------------------

const KEBAB = /-([a-z])/g;
function camel(name: string): string {
  return name.replace(KEBAB, (_, c) => c.toUpperCase());
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
      const v = style[name.startsWith('--') ? name : camel(name)];
      return v == null ? '' : String(v);
    },
    enumerable: false,
  });
  return style;
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
