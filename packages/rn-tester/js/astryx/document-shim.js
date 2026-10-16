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
import type {ComplexSelector, Stylesheet} from './css/parse';
import type {Spec as ClipboardSpec} from 'react-native/src/private/specs_DEPRECATED/modules/NativeClipboard';

import {
  currentContext,
  installStylesheet,
  removeStylesheet,
  replaceStylesheet,
} from './css';
import {selectorMatches} from './css/match';
import {compileSelector} from './css/parse';
import {recordOf} from './elementRegistry';
import {installIntlShim} from './intl-shim';
import {Dimensions, Platform, TurboModuleRegistry} from 'react-native';
import matchMedia from 'react-native/Libraries/Utilities/matchMedia';

/**
 * A `document` for the vendored Astryx sources, installed on the global when
 * none exists.
 *
 * Astryx is written for the DOM. Most of its document use sits behind
 * `typeof document === 'undefined'`, which React Native satisfied by having no
 * document at all; with 0.7.0 the theme provider reaches `document` with no
 * guard (`Theme.tsx` injects its generated CSS through a `<style>` element),
 * and a vendored source cannot be edited. So the document exists, and it is as
 * small as the sources' use of it: an event target that nothing dispatches to,
 * a `head`, `body` and `documentElement` that accept children, `createElement`
 * for elements the sources build and never see rendered, and lookups over
 * that tree of its own elements.
 *
 * What it does with what it is handed: a `<style>` element in the document
 * installs its text as a stylesheet in the fork's CSS engine
 * (`js/astryx/css`), which is how a theme's token overrides reach the
 * elements under `[data-astryx-theme]`. As in CSSOM, the sheet follows its
 * element: it is dropped when the element leaves the document and replaced in
 * place when the text changes. And `getElementById`, `querySelector` and the
 * rest find the elements appended to it, which is how a source that injects a
 * sheet once (`ensureSlideRules`, for every layer) knows it already has.
 *
 * What this changes for guarded code: every `typeof document === 'undefined'`
 * site in the vendored sources now takes its browser branch. Those branches
 * read `activeElement` (null here), `body` (present), or subscribe to
 * document events (never fired), and each handles the null it gets.
 * DOM-CSS-LIMITATION(document-is-a-stub): the lookups see only elements made
 * with this document's `createElement`, not the rendered ones, and a source
 * that needs a selection or a measured range gets nothing, so the behaviour
 * it implements does not happen; the components the templates use do not need
 * one. The window does not scroll either: a page scrolls in its screen's
 * scroll view, so `scrollX` and `scrollY` read 0 and `scrollTo` does nothing,
 * and a scroll lock that restores the window's position restores nothing.
 */

type Listener = (event: unknown) => unknown;

type ForwardedTarget = {
  addEventListener(type: string, listener: Listener, options?: unknown): void,
  removeEventListener(
    type: string,
    listener: Listener,
    options?: unknown,
  ): void,
  ...
};

class ShimEventTarget {
  _listeners: Map<string, Set<Listener>> = new Map();
  // Every listener, with its options, and the renderer's documents each one is
  // added to as well (`forwardTo`)
  _registrations: Array<{type: string, listener: Listener, options: unknown}> =
    [];
  _forwardedTo: Array<ForwardedTarget> = [];

  addEventListener(type: string, listener: ?Listener, options?: unknown): void {
    if (listener == null) {
      return;
    }
    let set = this._listeners.get(type);
    if (set == null) {
      set = new Set();
      this._listeners.set(type, set);
    }
    if (set.has(listener)) {
      return;
    }
    set.add(listener);
    this._registrations.push({type, listener, options});
    for (const target of this._forwardedTo) {
      target.addEventListener(type, listener, options);
    }
  }

  removeEventListener(
    type: string,
    listener: ?Listener,
    options?: unknown,
  ): void {
    if (listener == null) {
      return;
    }
    this._listeners.get(type)?.delete(listener);
    this._registrations = this._registrations.filter(
      registration =>
        registration.type !== type || registration.listener !== listener,
    );
    for (const target of this._forwardedTo) {
      target.removeEventListener(type, listener, options);
    }
  }

  /**
   * Adds this target's listeners, now and later, to the event target that
   * stands for it in the renderer's event paths, where the page's events are
   * dispatched: an event that reaches it reaches `document` (or `window`), as
   * it does on the web, so a source counting presses at the document
   * (Astryx's gesture counter, its modality tracking) sees them.
   */
  forwardTo(target: ForwardedTarget): void {
    if (this._forwardedTo.includes(target)) {
      return;
    }
    this._forwardedTo.push(target);
    for (const {type, listener, options} of this._registrations) {
      target.addEventListener(type, listener, options);
    }
  }

  dispatchEvent(event: {type: string, ...}): boolean {
    const set = this._listeners.get(event.type);
    if (set != null) {
      for (const listener of Array.from(set)) {
        listener(event);
      }
    }
    return true;
  }
}

class ShimClassList {
  _set: Set<string> = new Set();
  add(...names: Array<string>): void {
    names.forEach(n => this._set.add(n));
  }
  remove(...names: Array<string>): void {
    names.forEach(n => this._set.delete(n));
  }
  contains(name: string): boolean {
    return this._set.has(name);
  }
  toggle(name: string, force?: boolean): boolean {
    const on = force ?? !this._set.has(name);
    if (on) {
      this._set.add(name);
    } else {
      this._set.delete(name);
    }
    return on;
  }
}

const ZERO_RECT = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
};

class ShimElement extends ShimEventTarget {
  tagName: string;
  nodeName: string;
  nodeType: number = 1;
  ownerDocument: ShimDocument;
  parentNode: ?ShimElement = null;
  parentElement: ?ShimElement = null;
  childNodes: Array<ShimElement> = [];
  children: Array<ShimElement> = [];
  attributes: Map<string, string> = new Map();
  dataset: {[string]: string} = {};
  style: {[string]: string} = {};
  classList: ShimClassList = new ShimClassList();
  _textContent: string = '';
  // The sheet a connected `<style>` installed, and the text it was made from
  _sheet: ?Stylesheet = null;
  _sheetText: string = '';

  constructor(tagName: string, ownerDocument: ShimDocument) {
    super();
    this.tagName = tagName.toUpperCase();
    this.nodeName = this.tagName;
    this.ownerDocument = ownerDocument;
  }

  get textContent(): string {
    return this._textContent;
  }
  set textContent(value: string): void {
    this._textContent = String(value);
    this._syncStylesheet();
  }
  get innerHTML(): string {
    return this._textContent;
  }
  set innerHTML(value: string): void {
    this._textContent = String(value);
    this._syncStylesheet();
  }
  get innerText(): string {
    return this._textContent;
  }
  set innerText(value: string): void {
    this._textContent = String(value);
    this._syncStylesheet();
  }

  // `id` and `className` reflect their attributes, as on the DOM
  get id(): string {
    return this.attributes.get('id') ?? '';
  }
  set id(value: string): void {
    this.attributes.set('id', String(value));
  }
  get className(): string {
    return Array.from(this.classList._set).join(' ');
  }
  set className(value: string): void {
    this.classList._set = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  setAttribute(name: string, value: unknown): void {
    if (name === 'class') {
      this.className = String(value);
      return;
    }
    this.attributes.set(name, String(value));
  }
  getAttribute(name: string): ?string {
    if (name === 'class') {
      return this.classList._set.size > 0 ? this.className : null;
    }
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name: string): boolean {
    return this.getAttribute(name) != null;
  }
  removeAttribute(name: string): void {
    if (name === 'class') {
      this.classList._set = new Set();
      return;
    }
    this.attributes.delete(name);
  }

  get isConnected(): boolean {
    return isUnder(this, this.ownerDocument.documentElement);
  }

  appendChild<T extends ShimElement>(child: T): T {
    return this.insertBefore(child, null);
  }
  insertBefore<T extends ShimElement>(child: T, before: ?ShimElement): T {
    // A fragment inserts its children, and is left empty
    if (child.nodeType === 11) {
      for (const inner of child.childNodes.slice()) {
        this.insertBefore(inner, before);
      }
      return child;
    }
    child.parentNode?.removeChild(child);
    const index = before == null ? -1 : this.childNodes.indexOf(before);
    if (index === -1) {
      this.childNodes.push(child);
    } else {
      this.childNodes.splice(index, 0, child);
    }
    this.children = this.childNodes.filter(node => node.nodeType === 1);
    child.parentNode = this;
    child.parentElement = this;
    if (child.nodeType === 3) {
      this._childTextChanged();
    }
    syncStylesheetsUnder(child);
    return child;
  }
  removeChild<T extends ShimElement>(child: T): T {
    this.childNodes = this.childNodes.filter(c => c !== child);
    this.children = this.children.filter(c => c !== child);
    child.parentNode = null;
    child.parentElement = null;
    if (child.nodeType === 3) {
      this._childTextChanged();
    }
    syncStylesheetsUnder(child);
    return child;
  }
  remove(): void {
    this.parentNode?.removeChild(this);
  }
  contains(other: unknown): boolean {
    let node: unknown = other;
    while (node instanceof ShimElement) {
      if (node === this) {
        return true;
      }
      node = node.parentNode;
    }
    return false;
  }
  closest(selectors: string): ?ShimElement {
    return closestFrom(this, selectors);
  }
  matches(selectors: string): boolean {
    const descriptor = descriptorOf(this);
    const ctx = currentContext();
    return compiledSelectors(selectors).some(selector =>
      selectorMatches(selector, descriptor, ctx),
    );
  }
  querySelector(selectors: string): ?ShimElement {
    for (const element of elementsUnder(this)) {
      if (element.matches(selectors)) {
        return element;
      }
    }
    return null;
  }
  querySelectorAll(selectors: string): Array<ShimElement> {
    return Array.from(elementsUnder(this)).filter(element =>
      element.matches(selectors),
    );
  }
  getElementsByTagName(tagName: string): Array<ShimElement> {
    const wanted = tagName.toUpperCase();
    return Array.from(elementsUnder(this)).filter(
      element => wanted === '*' || element.tagName === wanted,
    );
  }
  getElementsByClassName(names: string): Array<ShimElement> {
    const wanted = names.split(/\s+/).filter(Boolean);
    return Array.from(elementsUnder(this)).filter(element =>
      wanted.every(name => element.classList.contains(name)),
    );
  }
  getBoundingClientRect(): typeof ZERO_RECT {
    return ZERO_RECT;
  }
  getClientRects(): Array<typeof ZERO_RECT> {
    return [];
  }
  focus(): void {}
  blur(): void {}
  scrollIntoView(): void {}
  click(): void {}

  // A `<style>` written as text nodes (`style.appendChild(createTextNode(css))`)
  // has their text as its own
  _childTextChanged(): void {
    if (this.tagName === 'STYLE') {
      this._textContent = this.childNodes
        .filter(node => node.nodeType === 3)
        .map(node => node._textContent)
        .join('');
      this._syncStylesheet();
    }
  }

  /**
   * Keeps a `<style>`'s sheet in step with the element: installed while the
   * element is in the document and has text, replaced in its cascade position
   * when the text changes, removed when the element leaves the document.
   */
  _syncStylesheet(): void {
    if (this.tagName !== 'STYLE') {
      return;
    }
    const text = this._textContent;
    const wanted = this.isConnected && text.trim() !== '';
    const sheet = this._sheet;
    if (!wanted) {
      if (sheet != null) {
        removeStylesheet(sheet);
        this._sheet = null;
        this._sheetText = '';
      }
      return;
    }
    if (sheet != null && this._sheetText === text) {
      return;
    }
    try {
      this._sheet =
        sheet == null
          ? installStylesheet(text)
          : replaceStylesheet(sheet, text);
      this._sheetText = text;
    } catch (e) {
      if (__DEV__) {
        console.warn(
          `astryx: a <style> element's text could not be installed as a stylesheet: ${String(
            e?.message ?? e,
          )}. The element's rules do not apply; check the CSS for a syntax the engine does not parse.`,
        );
      }
    }
  }
}

// Every element in a subtree, the root first, in document order
function* elementsUnder(root: ShimElement): Iterable<ShimElement> {
  for (const child of root.childNodes) {
    if (child.nodeType === 1) {
      yield child;
      yield* elementsUnder(child);
    }
  }
}

function syncStylesheetsUnder(root: ShimElement): void {
  root._syncStylesheet();
  for (const element of elementsUnder(root)) {
    element._syncStylesheet();
  }
}

function descriptorOf(element: ShimElement): ElementDescriptor {
  const attributes: {[string]: unknown} = {};
  for (const [name, value] of element.attributes) {
    attributes[name] = value;
  }
  if (element.classList._set.size > 0) {
    attributes.class = element.className;
  }
  const parent = element.parentElement;
  return {
    tag: element.tagName.toLowerCase(),
    classes: Array.from(element.classList._set),
    attributes,
    states: {},
    parent:
      parent != null && parent.nodeType === 1 ? descriptorOf(parent) : null,
    isRoot: element === element.ownerDocument.documentElement,
  };
}

// A selector list's members, compiled once per distinct text
const compiledLists: Map<string, Array<ComplexSelector>> = new Map();

function compiledSelectors(selectors: string): Array<ComplexSelector> {
  let list = compiledLists.get(selectors);
  if (list == null) {
    list = splitSelectorList(selectors).map(compileSelector);
    compiledLists.set(selectors, list);
  }
  return list;
}

// Splits a selector list at its top-level commas, leaving the ones inside
// `:is()`, attribute brackets and quotes alone
function splitSelectorList(text: string): Array<string> {
  const members = [];
  let depth = 0;
  let quote: ?string = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote != null) {
      if (ch === '\\') {
        i++;
      } else if (ch === quote) {
        quote = null;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '(' || ch === '[') {
      depth++;
    } else if (ch === ')' || ch === ']') {
      depth--;
    } else if (ch === ',' && depth === 0) {
      members.push(text.slice(start, i));
      start = i + 1;
    }
  }
  members.push(text.slice(start));
  return members.map(member => member.trim()).filter(member => member !== '');
}

class ShimDocument extends ShimEventTarget {
  nodeType: number = 9;
  documentElement: ShimElement;
  head: ShimElement;
  body: ShimElement;
  activeElement: ?ShimElement = null;
  visibilityState: string = 'visible';
  hidden: boolean = false;
  readyState: string = 'complete';
  dir: string = '';
  cookie: string = '';
  title: string = '';
  defaultView: unknown;

  constructor() {
    super();
    this.documentElement = new ShimElement('html', this);
    this.head = this.documentElement.appendChild(new ShimElement('head', this));
    this.body = this.documentElement.appendChild(new ShimElement('body', this));
    this.defaultView = globalThis;
  }

  createElement(tagName: string): ShimElement {
    return new ShimElement(tagName, this);
  }
  createElementNS(namespace: ?string, tagName: string): ShimElement {
    return new ShimElement(tagName, this);
  }
  createTextNode(text: string): ShimElement {
    const node = new ShimElement('#text', this);
    node.nodeType = 3;
    node._textContent = String(text);
    return node;
  }
  createDocumentFragment(): ShimElement {
    const node = new ShimElement('#document-fragment', this);
    node.nodeType = 11;
    return node;
  }
  createRange(): {
    setStart(): void,
    setEnd(): void,
    selectNodeContents(): void,
    collapse(): void,
    getBoundingClientRect(): typeof ZERO_RECT,
    getClientRects(): Array<typeof ZERO_RECT>,
  } {
    return {
      setStart() {},
      setEnd() {},
      selectNodeContents() {},
      collapse() {},
      getBoundingClientRect: () => ZERO_RECT,
      getClientRects: () => [],
    };
  }
  // No selection, which the vendored sources read as the Selection API being
  // unavailable; each caller checks for null
  getSelection(): null {
    return null;
  }
  getElementById(id: string): ?ShimElement {
    if (this.documentElement.id === id) {
      return this.documentElement;
    }
    for (const element of elementsUnder(this.documentElement)) {
      if (element.id === id) {
        return element;
      }
    }
    return null;
  }
  querySelector(selectors: string): ?ShimElement {
    return this.documentElement.matches(selectors)
      ? this.documentElement
      : this.documentElement.querySelector(selectors);
  }
  querySelectorAll(selectors: string): Array<ShimElement> {
    return [
      this.documentElement,
      ...elementsUnder(this.documentElement),
    ].filter(element => element.matches(selectors));
  }
  getElementsByTagName(tagName: string): Array<ShimElement> {
    const wanted = tagName.toUpperCase();
    return [
      this.documentElement,
      ...elementsUnder(this.documentElement),
    ].filter(element => wanted === '*' || element.tagName === wanted);
  }
  getElementsByClassName(names: string): Array<ShimElement> {
    return this.documentElement.getElementsByClassName(names);
  }
  elementFromPoint(x: number, y: number): ?ShimElement {
    return null;
  }
  hasFocus(): boolean {
    return false;
  }
}

// Whether `root` is the element or one of its ancestors
function isUnder(element: ShimElement, root: ShimElement): boolean {
  for (let node: ?ShimElement = element; node != null; node = node.parentNode) {
    if (node === root) {
      return true;
    }
  }
  return false;
}

// The element or its nearest ancestor element that matches `selectors`
function closestFrom(element: ShimElement, selectors: string): ?ShimElement {
  for (
    let node: ?ShimElement = element;
    node != null;
    node = node.parentElement
  ) {
    if (node.nodeType === 1 && node.matches(selectors)) {
      return node;
    }
  }
  return null;
}

// `window`'s event-target methods, where the global has none
const windowTarget: ShimEventTarget = new ShimEventTarget();

/**
 * Adds the listeners on `document` and on `window` to the event targets that
 * stand for them above every renderer document, now and as they are added,
 * so the page's events reach them; see `ShimEventTarget.forwardTo`.
 * dom-compat.js puts those targets in the renderer's event paths.
 */
export function forwardShimEventsTo(
  pageDocument: ForwardedTarget,
  pageWindow: ForwardedTarget,
): void {
  const shim: unknown = (globalThis as $FlowFixMe).document;
  if (shim instanceof ShimDocument) {
    shim.forwardTo(pageDocument);
  }
  windowTarget.forwardTo(pageWindow);
}

/**
 * Installs the document, and the event-target methods `window` lacks, once.
 * `window` is React Native's own global; only what is missing is added.
 */
export function installDocumentShim(): void {
  const g: {[string]: unknown} = globalThis as $FlowFixMe;
  if (g.document == null) {
    g.document = new ShimDocument();
  }
  for (const method of [
    'addEventListener',
    'removeEventListener',
    'dispatchEvent',
  ]) {
    if (typeof g[method] !== 'function') {
      // $FlowFixMe[prop-missing]
      g[method] = windowTarget[method].bind(windowTarget);
    }
  }
  // The DOM's classes, for `instanceof` checks (`active instanceof
  // HTMLElement`). React Native defines `HTMLElement`, which the fork's
  // elements are instances of; the per-tag classes are answered by the
  // element's tag, so `input instanceof HTMLInputElement` is true of an
  // `<input>`, as Astryx's field containers expect before focusing one.
  const classes: {[string]: unknown} = {
    Node: ShimEventTarget,
    Element: ShimElement,
    HTMLElement: ShimElement,
    HTMLInputElement: elementClassForTag('input'),
    HTMLTextAreaElement: elementClassForTag('textarea'),
    HTMLSelectElement: elementClassForTag('select'),
    HTMLLabelElement: elementClassForTag('label'),
    SVGElement: ShimElement,
    Document: ShimDocument,
    EventTarget: ShimEventTarget,
  };
  for (const name of Object.keys(classes)) {
    if (g[name] == null) {
      g[name] = classes[name];
    }
  }
  if (g.Event == null) {
    g.Event = class ShimEvent {
      type: string;
      defaultPrevented: boolean = false;
      constructor(type: string) {
        this.type = type;
      }
      preventDefault(): void {
        this.defaultPrevented = true;
      }
      stopPropagation(): void {}
    };
  }
  if (g.CustomEvent == null) {
    g.CustomEvent = g.Event;
  }
  // React Native's `matchMedia`, which an app gets only with the color spaces
  // flag on; the stylesheet engine answers `@media` by the same grammar
  if (typeof g.matchMedia !== 'function') {
    g.matchMedia = matchMedia;
  }
  if (typeof g.getSelection !== 'function') {
    g.getSelection = (): null => null;
  }
  // The viewport's size (cssom-view-1 §8), the window's, which `vh`, `dvh`
  // and media queries also read: a bottom sheet's detents are fractions of
  // it, and an undefined one makes every one of them `NaN`
  const viewport: Array<[string, () => number]> = [
    ['innerWidth', () => Dimensions.get('window').width],
    ['innerHeight', () => Dimensions.get('window').height],
  ];
  for (const [name, get] of viewport) {
    if (g[name] == null) {
      Object.defineProperty(g, name, {
        configurable: true,
        enumerable: true,
        get,
      });
    }
  }
  // The window's scroll position and methods, which Astryx's scroll lock
  // reads and restores; see DOM-CSS-LIMITATION(document-is-a-stub)
  for (const name of ['scrollX', 'scrollY', 'pageXOffset', 'pageYOffset']) {
    if (g[name] == null) {
      g[name] = 0;
    }
  }
  for (const name of ['scrollTo', 'scrollBy', 'scroll']) {
    if (typeof g[name] !== 'function') {
      g[name] = (): void => {};
    }
  }
  // `CSS.escape`, which Astryx's dialog uses to find its title by id; the
  // other members of the CSS namespace are absent, and the code that uses them
  // checks for them first
  if (g.CSS == null) {
    g.CSS = {escape: escapeIdentifier};
  }
  // `navigator.clipboard` over React Native's clipboard module; Astryx's copy
  // buttons write to it
  const navigator: ?{[string]: unknown} = g.navigator as $FlowFixMe;
  if (navigator != null && navigator.clipboard == null) {
    navigator.clipboard = clipboard;
  }
  // What the page can learn of its platform: the user agent names React
  // Native and the OS, not a browser, so the sources' Safari workarounds (the
  // bottom sheet's visual-viewport keyboard tracking) stay off, as they must
  // without a visual viewport; `platform` is the device's, which is what
  // shows ⌘ rather than Ctrl in a shortcut
  if (navigator != null && navigator.userAgent == null) {
    navigator.userAgent = `ReactNative (${
      Platform.OS === 'ios'
        ? 'iOS'
        : Platform.OS === 'android'
          ? 'Android'
          : Platform.OS
    } ${String(Platform.Version)})`;
  }
  if (navigator != null && navigator.platform == null) {
    navigator.platform =
      Platform.OS === 'ios'
        ? Platform.isPad
          ? 'iPad'
          : 'iPhone'
        : Platform.OS === 'android'
          ? 'Linux armv8l'
          : Platform.OS;
  }
  if (navigator != null && navigator.maxTouchPoints == null) {
    navigator.maxTouchPoints = 5;
  }
}

/**
 * CSSOM's "serialize an identifier" (cssom-1 §2.1), which `CSS.escape` is:
 * the string as a CSS identifier, with what cannot appear in one escaped.
 */
function escapeIdentifier(value: string): string {
  const text = String(value);
  let result = '';
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    const first = text.charCodeAt(0);
    if (code === 0) {
      result += '\uFFFD';
    } else if (
      (code >= 0x1 && code <= 0x1f) ||
      code === 0x7f ||
      (index === 0 && code >= 0x30 && code <= 0x39) ||
      (index === 1 && code >= 0x30 && code <= 0x39 && first === 0x2d)
    ) {
      result += '\\' + code.toString(16) + ' ';
    } else if (index === 0 && code === 0x2d && text.length === 1) {
      result += '\\' + text.charAt(index);
    } else if (
      code >= 0x80 ||
      code === 0x2d ||
      code === 0x5f ||
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a)
    ) {
      result += text.charAt(index);
    } else {
      result += '\\' + text.charAt(index);
    }
  }
  return result;
}

const clipboard = {
  writeText(text: string): Promise<void> {
    const module = TurboModuleRegistry.get<ClipboardSpec>('Clipboard');
    if (module == null) {
      return Promise.reject(noClipboardError());
    }
    module.setString(text);
    return Promise.resolve();
  },
  readText(): Promise<string> {
    const module = TurboModuleRegistry.get<ClipboardSpec>('Clipboard');
    if (module == null) {
      return Promise.reject(noClipboardError());
    }
    return module.getString();
  },
};

function noClipboardError(): Error {
  return new Error(
    'navigator.clipboard could not reach the clipboard: the app has no ' +
      '"Clipboard" native module. Link React Native\'s core modules to copy ' +
      'and paste from a page.',
  );
}

installDocumentShim();
installIntlShim();

/**
 * A DOM class for one tag: a shim element is an instance, as before, and so
 * is an element the JSX runtime rendered with that tag.
 */
function elementClassForTag(tag: string): Class<ShimElement> {
  return class extends ShimElement {
    static [Symbol.hasInstance](value: unknown): boolean {
      return (
        value instanceof ShimElement || recordOf(value)?.descriptor.tag === tag
      );
    }
  };
}
