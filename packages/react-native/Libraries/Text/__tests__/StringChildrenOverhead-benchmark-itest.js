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

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {Text, View} from 'react-native';
import * as ReactNativeFeatureFlags from 'react-native/src/private/featureflags/ReactNativeFeatureFlags';

/*
 * What does `enableStringChildren` cost an app that never uses it?
 *
 * The flag's machinery touches every View, not just Views with bare-string
 * children: each prop clone compares inheritable text props against the
 * source, and each layout-configure pass folds the node's inheritable props
 * into the cascade and equality-checks the result against what every child
 * received last time. Style inheritance is the headline factor — with the
 * flag off, nothing outside <Text> inherits anything, so the flag's whole
 * inheritance apparatus is pure overhead for text-free trees.
 *
 * Every suite here runs under BOTH flag values (`enableStringChildren:*`), so
 * each pair of rows is the answer to "what does the flag cost for this
 * workload". The bare-string workload itself only exists with the flag on;
 * its comparison partner is the equivalent explicit-<Text> tree.
 */

const stringChildrenEnabled = ReactNativeFeatureFlags.enableStringChildren();

/** A breadth^depth tree of plain Views: no text anywhere. */
function viewTree(
  depth: number,
  breadth: number,
  key?: string,
): React.MixedElement {
  if (depth === 0) {
    return <View key={key} style={styles.leaf} />;
  }
  const children = [];
  for (let i = 0; i < breadth; i++) {
    children.push(viewTree(depth - 1, breadth, String(i)));
  }
  return (
    <View key={key} style={styles.container}>
      {children}
    </View>
  );
}

/** A single deep chain of Views, for cascade propagation depth. */
function viewChain(depth: number, inner: React.Node = null) {
  let node: React.Node = inner;
  for (let i = 0; i < depth; i++) {
    node = <View style={styles.container}>{node}</View>;
  }
  return node;
}

/** The classic text world: <Text> paragraphs with string children. */
function textTree(count: number) {
  const children = [];
  for (let i = 0; i < count; i++) {
    children.push(
      <View key={String(i)} style={styles.row}>
        <Text style={styles.text}>
          {'Row '}
          {i}
          {' with some text content that has to be measured'}
        </Text>
      </View>,
    );
  }
  return <View style={styles.container}>{children}</View>;
}

/** The same content as bare string children of Views (flag-on only). */
function bareStringTree(count: number) {
  const children = [];
  for (let i = 0; i < count; i++) {
    children.push(
      // $FlowFixMe[incompatible-type] bare string children under View
      <View key={String(i)} style={[styles.row, styles.text]}>
        {`Row ${i} with some text content that has to be measured`}
      </View>,
    );
  }
  return <View style={styles.container}>{children}</View>;
}

const styles = {
  container: {flex: 1},
  leaf: {width: 10, height: 10, backgroundColor: 'blue'},
  row: {padding: 2},
  text: {fontSize: 14},
};

// 4^0 + 4^1 + … + 4^5 = 1365 Views.
const TREE_DEPTH = 5;
const TREE_BREADTH = 4;
const CHAIN_DEPTH = 60;
const TEXT_ROWS = 200;

let root: Fantom.Root;

const suite = Fantom.unstable_benchmark
  .suite('StringChildren overhead', {
    minIterations: 50,
    disableOptimizedBuildCheck: true,
  })
  .test(
    'mount: 1365-View tree, no text',
    () => {
      Fantom.runTask(() => root.render(viewTree(TREE_DEPTH, TREE_BREADTH)));
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
    'update non-inheritable style at root: 1365-View tree',
    () => {
      Fantom.runTask(() =>
        root.render(
          <View style={{backgroundColor: 'red'}}>
            {viewTree(TREE_DEPTH - 1, TREE_BREADTH)}
          </View>,
        ),
      );
    },
    {
      beforeEach: () => {
        root = Fantom.createRoot();
        Fantom.runTask(() =>
          root.render(
            <View style={{backgroundColor: 'green'}}>
              {viewTree(TREE_DEPTH - 1, TREE_BREADTH)}
            </View>,
          ),
        );
      },
      afterEach: () => {
        root.destroy();
      },
    },
  )
  .test(
    // The style-inheritance factor itself: with the flag on, an inheritable
    // prop change re-propagates the cascade through every descendant; with it
    // off, nothing inherits and this is an ordinary one-node prop update.
    'update inheritable style (color) at root: 1365-View tree',
    () => {
      Fantom.runTask(() =>
        root.render(
          // $FlowFixMe[incompatible-type] inheritable text style on View
          <View style={{color: 'red'}}>
            {viewTree(TREE_DEPTH - 1, TREE_BREADTH)}
          </View>,
        ),
      );
    },
    {
      beforeEach: () => {
        root = Fantom.createRoot();
        Fantom.runTask(() =>
          root.render(
            // $FlowFixMe[incompatible-type] inheritable text style on View
            <View style={{color: 'blue'}}>
              {viewTree(TREE_DEPTH - 1, TREE_BREADTH)}
            </View>,
          ),
        );
      },
      afterEach: () => {
        root.destroy();
      },
    },
  )
  .test(
    'update inheritable style (color) at root: 60-deep View chain',
    () => {
      Fantom.runTask(() =>
        root.render(
          // $FlowFixMe[incompatible-type] inheritable text style on View
          <View style={{color: 'red'}}>{viewChain(CHAIN_DEPTH)}</View>,
        ),
      );
    },
    {
      beforeEach: () => {
        root = Fantom.createRoot();
        Fantom.runTask(() =>
          root.render(
            // $FlowFixMe[incompatible-type] inheritable text style on View
            <View style={{color: 'blue'}}>{viewChain(CHAIN_DEPTH)}</View>,
          ),
        );
      },
      afterEach: () => {
        root.destroy();
      },
    },
  )
  .test(
    // Lever 1's target: the tree is text-free except ONE distant leaf, so the
    // dependents bit keeps the dirty walk to the one path that has a consumer.
    'update inheritable (color) at root: 1365 Views, one text leaf',
    () => {
      Fantom.runTask(() =>
        root.render(
          // $FlowFixMe[incompatible-type] inheritable text style on View
          <View style={{color: 'red'}}>
            {viewTree(TREE_DEPTH - 1, TREE_BREADTH)}
            <View>{'the one text leaf'}</View>
          </View>,
        ),
      );
    },
    {
      beforeEach: () => {
        root = Fantom.createRoot();
        Fantom.runTask(() =>
          root.render(
            // $FlowFixMe[incompatible-type] inheritable text style on View
            <View style={{color: 'blue'}}>
              {viewTree(TREE_DEPTH - 1, TREE_BREADTH)}
              <View>{'the one text leaf'}</View>
            </View>,
          ),
        );
      },
      afterEach: () => {
        root.destroy();
      },
    },
  )
  .test(
    // The `all: initial` boundary: the text-bearing subtree is sealed off, so
    // the ancestor's inheritable change has no dependents at all.
    'update inheritable (color) at root: text behind all:initial',
    () => {
      Fantom.runTask(() =>
        root.render(
          // $FlowFixMe[incompatible-type] inheritable text style on View
          <View style={{color: 'red'}}>
            {/* $FlowFixMe[incompatible-type] the `all` reset is new */}
            <View style={{all: 'initial'}}>{textTree(TEXT_ROWS)}</View>
          </View>,
        ),
      );
    },
    {
      beforeEach: () => {
        root = Fantom.createRoot();
        Fantom.runTask(() =>
          root.render(
            // $FlowFixMe[incompatible-type] inheritable text style on View
            <View style={{color: 'blue'}}>
              {/* $FlowFixMe[incompatible-type] the `all` reset is new */}
              <View style={{all: 'initial'}}>{textTree(TEXT_ROWS)}</View>
            </View>,
          ),
        );
      },
      afterEach: () => {
        root.destroy();
      },
    },
  )
  .test(
    'mount: 200 <Text> rows (classic text)',
    () => {
      Fantom.runTask(() => root.render(textTree(TEXT_ROWS)));
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

// The same content both ways: with the flag on, the rows are bare strings —
// the feature's own syntax; with it off, the equivalent tree an app must
// write today (explicit <Text>, identical to the row above). The comparison
// table therefore reads as "feature syntax vs status quo".
suite.test(
  'mount: 200 rows, feature syntax (bare strings ON / <Text> OFF)',
  () => {
    Fantom.runTask(() =>
      root.render(
        stringChildrenEnabled ? bareStringTree(TEXT_ROWS) : textTree(TEXT_ROWS),
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
