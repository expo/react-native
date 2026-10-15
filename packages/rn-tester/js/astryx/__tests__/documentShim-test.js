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

import {cssVersion, resetStylesheets, resolveCssForElement} from '../css';
import {compileSelector} from '../css/parse';
import {forwardShimEventsTo, installDocumentShim} from '../document-shim';

// Installed here: the import is evaluated when first used
installDocumentShim();
const doc: $FlowFixMe = (globalThis as $FlowFixMe).document;

function colorOf(className: string): unknown {
  const resolution = resolveCssForElement(
    {
      tag: 'div',
      classes: [className],
      attributes: {},
      states: {},
      parent: null,
    },
    {},
  );
  return (resolution.style as $FlowFixMe)?.color;
}

function styleElement(css: string): $FlowFixMe {
  const style = doc.createElement('style');
  style.textContent = css;
  return style;
}

afterEach(() => {
  for (const child of doc.head.childNodes.slice()) {
    doc.head.removeChild(child);
  }
  resetStylesheets();
});

describe('the document shim', () => {
  it('finds an element appended to it by id, so a sheet injected once is installed once', () => {
    // Astryx's `ensureSlideRules`, which every layer calls
    const ensure = () => {
      if (doc.getElementById('slide-rules')) {
        return;
      }
      const style = doc.createElement('style');
      style.id = 'slide-rules';
      style.textContent = '.slide { color: red; }';
      doc.head.appendChild(style);
    };
    const before = cssVersion();
    ensure();
    ensure();
    ensure();
    expect(cssVersion() - before).toBe(1);
    expect(doc.getElementById('slide-rules')?.tagName).toBe('STYLE');
    expect(colorOf('slide')).toBe('red');
  });

  it('answers selectors over its own elements', () => {
    const style = styleElement('.a { color: red; }');
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

  it("drops a <style>'s rules when it leaves the document", () => {
    const style = styleElement('.gone { color: red; }');
    doc.head.appendChild(style);
    expect(colorOf('gone')).toBe('red');
    style.remove();
    expect(colorOf('gone')).toBe(undefined);
    // Back in the document, back in the cascade
    doc.head.appendChild(style);
    expect(colorOf('gone')).toBe('red');
  });

  it('installs a <style> only once it is in the document', () => {
    const style = styleElement('.later { color: red; }');
    const container = doc.createElement('div');
    container.appendChild(style);
    expect(colorOf('later')).toBe(undefined);
    doc.body.appendChild(container);
    expect(colorOf('later')).toBe('red');
  });

  it('replaces a <style> whose text changes in its own cascade position', () => {
    const first = styleElement('.x { color: red; }');
    const second = styleElement('.x { color: blue; }');
    doc.head.appendChild(first);
    doc.head.appendChild(second);
    expect(colorOf('x')).toBe('blue');
    // The earlier sheet changes, and the later one still wins
    first.textContent = '.x { color: green; }';
    expect(colorOf('x')).toBe('blue');
    // Once the later one stops saying anything about colour, the earlier one's
    // new text shows
    second.textContent = '.x { width: 10px; }';
    expect(colorOf('x')).toBe('green');
  });

  it("hands its listeners to the renderer's documents, now and later", () => {
    const added: Array<[string, unknown, unknown]> = [];
    const removed: Array<[string, unknown]> = [];
    const rendererDocument = {
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
    const before = () => {};
    const after = () => {};
    doc.addEventListener('pointerdown', before, true);
    forwardShimEventsTo(rendererDocument);
    // Once per document, however often its elements register
    forwardShimEventsTo(rendererDocument);
    doc.addEventListener('click', after, true);
    expect(added).toEqual([
      ['pointerdown', before, true],
      ['click', after, true],
    ]);
    doc.removeEventListener('pointerdown', before, true);
    expect(removed).toEqual([['pointerdown', before]]);
    doc.removeEventListener('click', after, true);
  });

  it('reads a <style> written as text nodes', () => {
    const style = doc.createElement('style');
    style.appendChild(doc.createTextNode('.text { color: red; }'));
    doc.head.appendChild(style);
    expect(colorOf('text')).toBe('red');
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
});
