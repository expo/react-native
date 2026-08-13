/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 * @fantom_native_opt false
 * @fantom_js_bytecode false
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {View} from 'react-native';

/*
 * What a block formatting context costs to lay out.
 *
 * `calculateBlockLayout` had no benchmark at all, which is why several rules
 * were added to its per-child loop — aspect-ratio, auto inline margins, the
 * RTL placement branch — with no way to say what they cost. Every row here is
 * a tree of `display: 'block'` boxes, so the block path runs for every child;
 * an equivalent flex tree sits beside the first one as the reference, since
 * the two paths do the same job for the same tree.
 */

const styles = {
  block: {display: 'block' as const},
  flex: {},
  leaf: {display: 'block' as const, height: 4},
  flexLeaf: {height: 4},
  // A definite width is what the auto-margin and aspect-ratio branches test
  // against; a container without one takes the shrink-wrap path instead.
  sized: {display: 'block' as const, width: 300},
};

/** A breadth^depth tree of block boxes. */
function blockTree(
  depth: number,
  breadth: number,
  key?: string,
): React.MixedElement {
  if (depth === 0) {
    return <View key={key} style={styles.leaf} />;
  }
  const children = [];
  for (let i = 0; i < breadth; i++) {
    children.push(blockTree(depth - 1, breadth, String(i)));
  }
  return (
    <View key={key} style={styles.block}>
      {children}
    </View>
  );
}

/** The same shape in flex, as the reference for what the block path costs. */
function flexTree(
  depth: number,
  breadth: number,
  key?: string,
): React.MixedElement {
  if (depth === 0) {
    return <View key={key} style={styles.flexLeaf} />;
  }
  const children = [];
  for (let i = 0; i < breadth; i++) {
    children.push(flexTree(depth - 1, breadth, String(i)));
  }
  return (
    <View key={key} style={styles.flex}>
      {children}
    </View>
  );
}

/** Block boxes that each carry a collapsing margin. */
function marginTree(count: number): React.MixedElement {
  const children = [];
  for (let i = 0; i < count; i++) {
    children.push(
      <View
        key={String(i)}
        style={{display: 'block', height: 10, marginVertical: 8}}
      />,
    );
  }
  return <View style={styles.sized}>{children}</View>;
}

const TREE_DEPTH = 4;
const TREE_BREADTH = 6;

let root = Fantom.createRoot();

Fantom.unstable_benchmark
  .suite('Block layout', {
    minIterations: 50,
    disableOptimizedBuildCheck: true,
  })
  .test(
    'mount: 1555-box block tree',
    () => {
      Fantom.runTask(() => root.render(blockTree(TREE_DEPTH, TREE_BREADTH)));
    },
    {
      beforeEach: () => {
        root = Fantom.createRoot();
      },
      afterEach: () => {
        root.destroy();
      },
    },
  )
  .test(
    'mount: the same tree in flex, for reference',
    () => {
      Fantom.runTask(() => root.render(flexTree(TREE_DEPTH, TREE_BREADTH)));
    },
    {
      beforeEach: () => {
        root = Fantom.createRoot();
      },
      afterEach: () => {
        root.destroy();
      },
    },
  )
  .test(
    'mount: 400 block siblings with collapsing margins',
    () => {
      Fantom.runTask(() => root.render(marginTree(400)));
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
