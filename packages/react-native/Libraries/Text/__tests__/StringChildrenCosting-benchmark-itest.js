/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:true
 * @fantom_native_opt false
 * @fantom_js_bytecode false
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {ScrollView, Text, View} from 'react-native';
import {NativeText} from 'react-native/Libraries/Text/TextNativeComponent';

/*
 * Text cost in the shapes real apps actually render.
 *
 * Every scenario is something you can picture on a screen, and every tier
 * within a scenario renders the SAME content and the SAME containers — only
 * the way text is expressed changes. To isolate what the text itself costs,
 * subtract the `rows only, no text` floor from a row scenario: real apps
 * already have the rows.
 *
 * Scenarios:
 *  - A settings-style list: 1,000 single-line rows. Rows exist regardless
 *    (they carry press handlers, padding, separators); the tiers compare
 *    what putting one line of text INSIDE each row costs.
 *  - A message list: 100 rows, each with a 10-line body (a chat or comment
 *    screen). Today's idiom is one <Text> per body (Text preserves \n); the
 *    bare tier renders the same body string under whiteSpace:'pre-line'.
 *  - An article: one 1,000-line text block.
 *
 * Fairness rule (found the hard way): every tier's row container must
 * materialize exactly like the floor's — hence `collapsable={false}` on all
 * of them. A prop-less View row flattens away when its child is a <Text>,
 * but CANNOT flatten when it holds a bare string (the runs live on it), so
 * without the pin the Text tiers silently skip the per-row View mount the
 * floor prices in and floor-subtraction over-credits them by one host view
 * per row. Same rule for the article: both tiers pay the same container.
 *
 *  - The community benchmark's shape (kept for apples-to-apples with
 *    fast-text/react-native-boost): 1,000 sibling text components with no
 *    row containers — not a shape real apps render, labeled as such.
 */

const ROWS = 1000;
const MESSAGES = 100;
const LINES_PER_MESSAGE = 10;

function line(i: number): string {
  return `Line ${i} of benchmark text content`;
}

function messageBody(m: number): string {
  const lines: Array<string> = [];
  for (let i = 0; i < LINES_PER_MESSAGE; i++) {
    lines.push(line(m * LINES_PER_MESSAGE + i));
  }
  return lines.join('\n');
}

function articleBody(): string {
  const lines: Array<string> = [];
  for (let i = 0; i < ROWS; i++) {
    lines.push(line(i));
  }
  return lines.join('\n');
}

// --- A settings-style list: 1,000 single-line rows -------------------------

function rowsOnly(): Array<React.Node> {
  const rows: Array<React.Node> = [];
  for (let i = 0; i < ROWS; i++) {
    rows.push(<View key={String(i)} collapsable={false} />);
  }
  return rows;
}

function rowsWithBareString(): Array<React.Node> {
  const rows: Array<React.Node> = [];
  for (let i = 0; i < ROWS; i++) {
    rows.push(
      // $FlowFixMe[incompatible-type] bare string child under View
      <View key={String(i)} collapsable={false}>
        {line(i)}
      </View>,
    );
  }
  return rows;
}

function rowsWithText(): Array<React.Node> {
  const rows: Array<React.Node> = [];
  for (let i = 0; i < ROWS; i++) {
    rows.push(
      <View key={String(i)} collapsable={false}>
        <Text>{line(i)}</Text>
      </View>,
    );
  }
  return rows;
}

function rowsWithNativeText(): Array<React.Node> {
  const rows: Array<React.Node> = [];
  for (let i = 0; i < ROWS; i++) {
    rows.push(
      <View key={String(i)} collapsable={false}>
        <NativeText>{line(i)}</NativeText>
      </View>,
    );
  }
  return rows;
}

// --- A message list: 100 rows, 10-line bodies ------------------------------

function messagesWithTextBodies(): Array<React.Node> {
  const rows: Array<React.Node> = [];
  for (let m = 0; m < MESSAGES; m++) {
    rows.push(
      <View key={String(m)} collapsable={false}>
        <Text>{messageBody(m)}</Text>
      </View>,
    );
  }
  return rows;
}

function messagesWithBareBodies(): Array<React.Node> {
  const rows: Array<React.Node> = [];
  for (let m = 0; m < MESSAGES; m++) {
    rows.push(
      // $FlowFixMe[incompatible-type] whiteSpace is a new style key
      <View key={String(m)} collapsable={false} style={{whiteSpace: 'pre-line'}}>
        {messageBody(m)}
      </View>,
    );
  }
  return rows;
}

// --- An article: one 1,000-line block --------------------------------------

function articleWithText(): Array<React.Node> {
  return [
    <View key="a" collapsable={false}>
      <Text>{articleBody()}</Text>
    </View>,
  ];
}

function articleBare(): Array<React.Node> {
  return [
    // $FlowFixMe[incompatible-type] whiteSpace is a new style key
    <View key="a" collapsable={false} style={{whiteSpace: 'pre-line'}}>
      {articleBody()}
    </View>,
  ];
}

// --- The community benchmark's shape (not a real-app shape) ----------------

function siblingNativeTexts(): Array<React.Node> {
  const rows: Array<React.Node> = [];
  for (let i = 0; i < ROWS; i++) {
    rows.push(<NativeText key={String(i)}>{line(i)}</NativeText>);
  }
  return rows;
}

let root: Fantom.Root;

const suite = Fantom.unstable_benchmark.suite('StringChildren costing', {
  minIterations: 20,
  disableOptimizedBuildCheck: true,
});

const TIERS = [
  ['settings list: 1k rows only, no text (the floor)', rowsOnly],
  ['settings list: 1k rows + bare string each', rowsWithBareString],
  ['settings list: 1k rows + <Text> each', rowsWithText],
  ['settings list: 1k rows + NativeText each', rowsWithNativeText],
  ['message list: 100 rows, 10-line <Text> bodies', messagesWithTextBodies],
  ['message list: 100 rows, 10-line bare bodies', messagesWithBareBodies],
  ['article: one 1k-line <Text>', articleWithText],
  ['article: one 1k-line bare block', articleBare],
  [
    'community shape: 1k sibling NativeText, no rows (not a real-app shape)',
    siblingNativeTexts,
  ],
];

for (const [label, make] of TIERS) {
  suite.test(
    String(label),
    () => {
      Fantom.runTask(() =>
        // Every tier renders inside the same harness: a ScrollView, because
        // that is where real lists and articles live AND because a bounded
        // box lets platform text engines clamp layout work at the viewport —
        // a 1,000-line tier would silently lay out a screenful and report a
        // flattering number. The sanity suite asserts full content heights.
        // $FlowFixMe[not-a-function] tuple element is the make function
        root.render(<ScrollView>{make()}</ScrollView>),
      );
    },
    {
      beforeEach: () => {
        root = Fantom.createRoot();
      },
      afterEach: () => {
        root.destroy();
      },
    },
  );
}
