/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 */

/**
 * A `<style>` in the stub document is a sheet in the renderer's style engine
 * while it is in the document and has text (HTML §4.2.6): installed when it
 * is inserted, replaced in its own cascade position when its text changes,
 * and removed when it leaves. Astryx's layers inject their sheets this way.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import type {HostInstance} from 'react-native';

import {jsx} from '../jsx-runtime';
import {counters} from '../native-css/engine';
import * as Fantom from '@react-native/fantom';
import {createRef} from 'react';

const doc: $FlowFixMe = (globalThis as $FlowFixMe).document;

// The height a `<div>` of this class lays out at, as the engine styles it now
function heightOf(className: string): number {
  Fantom.runTask(() => {
    // Installed by the renderer
    (globalThis as $FlowFixMe).__cssEngine.flush();
  });
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(jsx('div', {ref, className}) as $FlowFixMe);
  });
  const height = ref.current?.getBoundingClientRect().height ?? NaN;
  Fantom.runTask(() => root.destroy());
  return height;
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
  for (const child of doc.body.childNodes.slice()) {
    doc.body.removeChild(child);
  }
});

test('a sheet injected once by id is installed once', () => {
  // Astryx's `ensureSlideRules`, which every layer calls
  const ensure = () => {
    if (doc.getElementById('slide-rules')) {
      return;
    }
    const style = doc.createElement('style');
    style.id = 'slide-rules';
    style.textContent = '.slide { height: 12px; }';
    doc.head.appendChild(style);
  };
  const before = counters.sheets;
  ensure();
  ensure();
  ensure();
  expect(counters.sheets - before).toBe(1);
  expect(doc.getElementById('slide-rules')?.tagName).toBe('STYLE');
  expect(heightOf('slide')).toBe(12);
});

test("drops a <style>'s rules when it leaves the document", () => {
  const style = styleElement('.gone { height: 12px; }');
  doc.head.appendChild(style);
  expect(heightOf('gone')).toBe(12);
  style.remove();
  expect(heightOf('gone')).toBe(0);
  // Back in the document, back in the cascade
  doc.head.appendChild(style);
  expect(heightOf('gone')).toBe(12);
});

test('installs a <style> only once it is in the document', () => {
  const style = styleElement('.later { height: 12px; }');
  const container = doc.createElement('div');
  container.appendChild(style);
  expect(heightOf('later')).toBe(0);
  doc.body.appendChild(container);
  expect(heightOf('later')).toBe(12);
});

test('replaces a <style> whose text changes in its own cascade position', () => {
  const first = styleElement('.x { height: 10px; }');
  const second = styleElement('.x { height: 20px; }');
  doc.head.appendChild(first);
  doc.head.appendChild(second);
  expect(heightOf('x')).toBe(20);
  // The earlier sheet changes, and the later one still wins
  first.textContent = '.x { height: 30px; }';
  expect(heightOf('x')).toBe(20);
  // Once the later one stops saying anything about height, the earlier one's
  // new text shows
  second.textContent = '.x { width: 10px; }';
  expect(heightOf('x')).toBe(30);
});

test('reads a <style> written as text nodes', () => {
  const style = doc.createElement('style');
  style.appendChild(doc.createTextNode('.text { height: 12px; }'));
  doc.head.appendChild(style);
  expect(heightOf('text')).toBe(12);
});
