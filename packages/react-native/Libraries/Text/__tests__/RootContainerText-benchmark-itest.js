/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:*
 * @fantom_native_opt false
 * @fantom_js_bytecode false
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import * as ReactNativeFeatureFlags from 'react-native/src/private/featureflags/ReactNativeFeatureFlags';

/*
 * Text under a ROOT CONTAINER, which is what apps actually render: a
 * paragraph of prose with styled runs inside it, not N independent lines.
 *
 * The styled run is a nested <Text>. That is the only inline element React
 * Native ships — there is deliberately no <span> here — so it is both the
 * classic idiom and the string-children idiom for "part of this sentence
 * looks different".
 *
 * Two things this suite exists to catch:
 *
 *  - A nested element makes the paragraph report per-element boxes for
 *    `getBoundingClientRect()`. That work must not make a plain <Text>
 *    slower, and must not make a <Text> WITH nested runs meaningfully
 *    slower than upstream, which offers no such boxes at all. The `plain`
 *    and `runs` rows are the pair that shows it: they render the same
 *    characters and differ only in whether the sentence is split into
 *    styled runs.
 *
 *  - Whether string children still win when the text sits under one
 *    container rather than one container apiece. The per-line container
 *    that dominates TextAlternatives is gone here: every tier has exactly
 *    one root box.
 */

const PARAGRAPHS = 200;
const RUNS_PER_PARAGRAPH = 5;

const styles = StyleSheet.create({
  // Both roots carry a style prop, so the tiers differ in the root ELEMENT and
  // as little else as they can. Without it the bare root paid for a prop the
  // <Text> root did not, which is the same order as the result.
  //
  // `collapsable` is the one asymmetry left and it is not a real one: the View
  // root needs it to survive flattening, and a root <Text> is a
  // ParagraphShadowNode, which carries `FormsView` and always mounts a view
  // anyway. Passing it to <Text> would be a prop the tier does not need — and
  // `TextProps` does not accept it, which is how that was noticed.
  textRoot: {},
  // `display: 'block'` is load-bearing, not decoration. A default View is a
  // FLEX container, and a flex container blockifies its inline-level children
  // (css-flexbox-1 4), so each inline run would break the sentence into a
  // separate layout -- ten boxes where <Text> establishes one inline
  // formatting context.
  block: {display: 'block'},
});

function words(p: number, i: number): string {
  return `paragraph ${p} segment ${i} with some words in it `;
}

/** One root <Text>, whole sentence unsplit: no nested element anywhere. */
function plainParagraphs(): Array<React.Node> {
  const out: Array<React.Node> = [];
  for (let p = 0; p < PARAGRAPHS; p++) {
    let all = '';
    for (let i = 0; i < RUNS_PER_PARAGRAPH * 2; i++) {
      all += words(p, i);
    }
    out.push(<Text key={String(p)}>{all}</Text>);
  }
  return out;
}

/*
 * Same characters, split into alternating plain and bold runs.
 *
 * Both tiers use <b> for the bold run. It is the inline text element either
 * root can hold, so the runs are identical and the comparison is about the
 * ROOT: a <Text> paragraph against a block container of bare strings. Using a
 * nested <Text> here instead made the classic tier carry a style prop per run
 * that the bare tier did not.
 */
function runChildren(p: number): Array<React.Node> {
  const kids: Array<React.Node> = [];
  for (let i = 0; i < RUNS_PER_PARAGRAPH; i++) {
    kids.push(words(p, i * 2));
    kids.push(<b key={String(i)}>{words(p, i * 2 + 1)}</b>);
  }
  return kids;
}

/** The classic idiom: a root <Text> holding the runs. */
function textParagraphs(): Array<React.Node> {
  const out: Array<React.Node> = [];
  for (let p = 0; p < PARAGRAPHS; p++) {
    out.push(
      // No `collapsable={false}` here, unlike the View tier: a root <Text> is
      // a ParagraphShadowNode, which carries `FormsView` in its base traits
      // and so always mounts a view of its own. There is nothing to prevent
      // flattening, and the prop is not one `TextProps` accepts.
      <Text key={String(p)} style={styles.textRoot}>
        {runChildren(p)}
      </Text>,
    );
  }
  return out;
}

function bareParagraphs(): Array<React.Node> {
  const out: Array<React.Node> = [];
  for (let p = 0; p < PARAGRAPHS; p++) {
    out.push(
      <View key={String(p)} collapsable={false} style={styles.block}>
        {runChildren(p)}
      </View>,
    );
  }
  return out;
}

/** The root boxes with no text, so the text itself can be isolated. */
function emptyParagraphs(): Array<React.Node> {
  const out: Array<React.Node> = [];
  for (let p = 0; p < PARAGRAPHS; p++) {
    out.push(<View key={String(p)} collapsable={false} />);
  }
  return out;
}

const stringChildrenEnabled = ReactNativeFeatureFlags.enableStringChildren();

let root: Fantom.Root;

const render = (children: Array<React.Node>) => () => {
  Fantom.runTask(() => root.render(<View>{children}</View>));
};

Fantom.unstable_benchmark
  .suite('Text under a root container', {
    minIterations: 30,
    disableOptimizedBuildCheck: true,
  })
  .test('root boxes only, no text (the floor)', render(emptyParagraphs()), {
    beforeEach: () => {
      root = Fantom.createRoot();
    },
    afterEach: () => {
      root.destroy();
    },
  })
  .test('root <Text>, plain sentence', render(plainParagraphs()), {
    beforeEach: () => {
      root = Fantom.createRoot();
    },
    afterEach: () => {
      root.destroy();
    },
  })
  .test('root <Text>, 5 <b> runs', render(textParagraphs()), {
    beforeEach: () => {
      root = Fantom.createRoot();
    },
    afterEach: () => {
      root.destroy();
    },
  })
  .test(
    'root View, bare strings + 5 <b> runs',
    () => {
      Fantom.runTask(() =>
        root.render(
          <View>
            {stringChildrenEnabled ? bareParagraphs() : textParagraphs()}
          </View>,
        ),
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
