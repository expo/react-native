/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:true
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../src/private/__tests__/utilities/ensureInstance';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {Text, View} from 'react-native';
// The element catalog, for intrinsic tags in the cross-element cases.
import '@react-native/expo-intrinsics-poc';

/*
 * Cases derived from web-platform-tests, cited per test. These complement the
 * Safari-pinned WhiteSpace suites: each test here mirrors the assertion shape
 * of a specific WPT file, translated to the deterministic measurer's
 * observables (10pt per character, 20pt per line).
 *
 * Where the engine deliberately diverges from a WPT expectation, the test
 * documents the divergence instead of faking a pass.
 */

const CHAR = 10;
const LINE = 20;
const SHRINK = {alignSelf: 'flex-start'};

function rectOfBox(children: React.Node, style: {...} = {}): ClientRect {
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View collapsable={false} style={{width: 400}}>
        <View ref={ref} style={{...SHRINK, ...style}}>
          {children}
        </View>
      </View>,
    );
  });
  return ensureInstance(
    ref.current,
    ReactNativeElement,
  ).getBoundingClientRect();
}

// --- css/css-cascade/all-prop-001.html -------------------------------------
// WPT asserts `all` resets every property EXCEPT direction/unicode-bidi. The
// scoped translation: our `all` covers exactly the inherited text set, so a
// NON-inherited property on the same element must be untouched by it.

test('all-prop-001: `all` does not reset non-cascading properties on the element', () => {
  const rect = rectOfBox('probe', {
    // $FlowExpectedError[incompatible-type] the `all` reset is new
    all: 'initial',
    width: 50,
    height: 60,
  });
  // `width`/`height` are not in the cascaded set; `all: initial` on the same
  // element leaves them in force (WPT: the excluded properties keep their
  // explicitly set values).
  expect(rect.width).toBe(50);
  expect(rect.height).toBe(60);
});

test('all-prop-001: a longhand in the same declaration beats `all` on an inline element', () => {
  // WPT all-prop shapes set `all` alongside longhands; per shorthand rules
  // the longhand wins. Block-level version is pinned in CascadeBoundary;
  // this is the inline (nested <Text>) version.
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[incompatible-type] inheritable keys are new
      <View collapsable={false} style={{color: 'red', display: 'block'}}>
        <Text style={{all: 'unset'}}>
          {'inherits red '}
          {/* $FlowExpectedError[incompatible-type] the `all` reset is new */}
          <Text style={{all: 'initial', color: 'blue'}}>fresh then blue</Text>
        </Text>
      </View>,
    );
  });
  const out =
    JSON.stringify(
      root.getRenderedOutput({props: ['foregroundColor']}).toJSX(),
    ) ?? '';
  expect(out).toContain('rgba(0, 0, 255, 1)');
  expect(out).not.toContain(
    '"rgba(255, 0, 0, 1)","children":"fresh then blue"',
  );
});

// --- css/css-text/white-space processing -----------------------------------

test('segment break transformation: a newline becomes a space under `normal` (css-text-3 §4.1.2)', () => {
  const rect = rectOfBox('a\nb');
  // "a b": three characters, one line.
  expect(rect.width).toBe(3 * CHAR);
  expect(rect.height).toBe(LINE);
});

test('collapsing crosses inline element boundaries (WPT white-space boundary shapes)', () => {
  // "a " + <span> b</span>: the space run spans the element boundary and
  // collapses to ONE space — "a b".
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View collapsable={false} style={{width: 400}}>
        <View ref={ref} style={{...SHRINK, display: 'block'}}>
          {'a '}
          {/* $FlowExpectedError[not-a-component] catalog element */}
          <span> b</span>
        </View>
      </View>,
    );
  });
  const rect = ensureInstance(
    ref.current,
    ReactNativeElement,
  ).getBoundingClientRect();
  expect(rect.width).toBe(3 * CHAR);
});

test('control-chars-00B: a vertical tab is NOT collapsible white space', () => {
  // WPT control-chars-* pin that only space/tab/newline/CR/FF participate in
  // collapsing; U+000B is content.
  const rect = rectOfBox('ab');
  expect(rect.width).toBe(3 * CHAR);
  expect(rect.height).toBe(LINE);
});

test('break-spaces-001: spaces are preserved, including trailing (css-text-3 §4.1.3)', () => {
  const rect = rectOfBox('ab   ', {
    // $FlowExpectedError[incompatible-type] whiteSpace is a new style key
    whiteSpace: 'break-spaces',
  });
  // Five characters: trailing spaces take up space under break-spaces.
  expect(rect.width).toBe(5 * CHAR);
});

test('pre-line drops spaces at a segment start (WPT pre-line shapes)', () => {
  const rect = rectOfBox('a\n  b', {
    // $FlowExpectedError[incompatible-type] whiteSpace is a new style key
    whiteSpace: 'pre-line',
  });
  // Two lines; the second line's leading spaces are removed, so each line is
  // exactly one character wide.
  expect(rect.height).toBe(2 * LINE);
  expect(rect.width).toBe(1 * CHAR);
});

test('multi-byte UTF-8 content survives collapsing untouched (encoding safety)', () => {
  // The collapse pass and its identity probes scan BYTES. UTF-8 makes that
  // legal (continuation bytes are >= 0x80, so ASCII white space can never
  // appear inside a character); this pins it with characters whose OTHER
  // encodings would confuse a byte scan: U+2020 DAGGER is 0x20 0x20 ("  ")
  // in UCS-2. The daggers must neither collapse nor corrupt, and the single
  // spaces between them must collapse normally.
  const root = Fantom.createRoot();
  const ref = createRef<HostInstance>();
  Fantom.runTask(() => {
    root.render(
      <View collapsable={false} style={{width: 400}}>
        <View ref={ref} style={SHRINK}>
          {'†  † 漢字 😀'}
        </View>
      </View>,
    );
  });
  const out = JSON.stringify(root.getRenderedOutput({props: []}).toJSX()) ?? '';
  // Double space collapsed to one, all multi-byte characters intact:
  expect(out).toContain('† † 漢字 😀');
  expect(out).not.toContain('†  †');
});

test('multi-byte UTF-8 content is preserved verbatim under pre (encoding safety)', () => {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View collapsable={false} style={{width: 400}}>
        {/* $FlowExpectedError[incompatible-type] whiteSpace is a new style key */}
        <View style={{whiteSpace: 'pre'}}>{'漢  字\n† '}</View>
      </View>,
    );
  });
  const out = JSON.stringify(root.getRenderedOutput({props: []}).toJSX()) ?? '';
  // JSON.stringify escapes the newline; the raw content is 漢··字⏎†·.
  expect(out).toContain('漢  字\\n† ');
});

test('leading and trailing white space at the IFC edges is removed (css-text-3 §4.1.3)', () => {
  const rect = rectOfBox('  probe  ');
  expect(rect.width).toBe(5 * CHAR);
});
