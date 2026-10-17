/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

'use strict';

import {compileSelector} from '../css/parse';
import {forwardShimEventsTo, installDocumentShim} from '../document-shim';
import {Dimensions} from 'react-native';

// Installed here: the import is evaluated when first used
installDocumentShim();
const doc: $FlowFixMe = (globalThis as $FlowFixMe).document;

afterEach(() => {
  for (const child of doc.head.childNodes.slice()) {
    doc.head.removeChild(child);
  }
});

describe('the document shim', () => {
  it('answers selectors over its own elements', () => {
    // Empty, so it installs no sheet
    const style = doc.createElement('style');
    style.setAttribute('data-following', '');
    style.className = 'one two';
    doc.head.appendChild(style);
    expect(doc.head.querySelector('[data-following]')).toBe(style);
    expect(doc.querySelector('style.two')).toBe(style);
    expect(doc.querySelectorAll('head > style, body > style')).toEqual([style]);
    expect(doc.querySelector('[data-missing]')).toBe(null);
    expect(style.getAttribute('class')).toBe('one two');
    expect(style.closest('head')).toBe(doc.head);
    expect(doc.head.contains(style)).toBe(true);
    expect(doc.body.contains(style)).toBe(false);
  });

  it('hands its listeners and the window’s to the targets in the event path, now and later', () => {
    const recorder = () => {
      const added: Array<[string, unknown, unknown]> = [];
      const removed: Array<[string, unknown]> = [];
      return {
        added,
        removed,
        addEventListener: (
          type: string,
          listener: unknown,
          options: unknown,
        ): void => {
          added.push([type, listener, options]);
        },
        removeEventListener: (type: string, listener: unknown): void => {
          removed.push([type, listener]);
        },
      };
    };
    const pageDocument = recorder();
    const pageWindow = recorder();
    const before = () => {};
    const after = () => {};
    const resize = () => {};
    doc.addEventListener('pointerdown', before, true);
    forwardShimEventsTo(pageDocument, pageWindow);
    // Once per target, however often it is asked
    forwardShimEventsTo(pageDocument, pageWindow);
    doc.addEventListener('click', after, true);
    (globalThis as $FlowFixMe).addEventListener('resize', resize);
    expect(pageDocument.added).toEqual([
      ['pointerdown', before, true],
      ['click', after, true],
    ]);
    expect(pageWindow.added.filter(([type]) => type === 'resize')).toEqual([
      ['resize', resize, undefined],
    ]);
    doc.removeEventListener('pointerdown', before, true);
    expect(pageDocument.removed).toEqual([['pointerdown', before]]);
    doc.removeEventListener('click', after, true);
    (globalThis as $FlowFixMe).removeEventListener('resize', resize);
  });
});

describe('CSS.escape', () => {
  const CSS: $FlowFixMe = (globalThis as $FlowFixMe).CSS;

  it('serializes an identifier as CSSOM does', () => {
    expect(CSS.escape('\0')).toBe('\uFFFD');
    expect(CSS.escape('0a')).toBe('\\30 a');
    expect(CSS.escape('-0a')).toBe('-\\30 a');
    expect(CSS.escape('-')).toBe('\\-');
    expect(CSS.escape('_r_1_')).toBe('_r_1_');
    expect(CSS.escape(':r1:')).toBe('\\:r1\\:');
    expect(CSS.escape('\u00abr1\u00bb')).toBe('\u00abr1\u00bb');
  });

  it('round-trips an id through the selector parser', () => {
    for (const id of [':r1:', '\u00abr1\u00bb', '_r_1_', '1a']) {
      const selector: $FlowFixMe = compileSelector('#' + CSS.escape(id));
      expect(JSON.stringify(selector)).toContain(JSON.stringify(id));
    }
  });
});

describe('getSelection', () => {
  it('answers null, which callers read as no Selection API', () => {
    expect((globalThis as $FlowFixMe).getSelection()).toBe(null);
    expect(doc.getSelection()).toBe(null);
  });
});

describe('the window', () => {
  it('has a scroll position of 0 and scroll methods that do nothing', () => {
    const g: $FlowFixMe = globalThis;
    expect(g.scrollX).toBe(0);
    expect(g.scrollY).toBe(0);
    expect(() => g.scrollTo(0, 120)).not.toThrow();
    expect(g.scrollY).toBe(0);
  });

  it('has the viewport’s size, the window’s', () => {
    const g: $FlowFixMe = globalThis;
    const {width, height} = Dimensions.get('window');
    expect(g.innerWidth).toBe(width);
    expect(g.innerHeight).toBe(height);
  });
});
