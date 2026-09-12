/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

'use strict';

import env from '../../../../expo-intrinsics/src/env';
import NativeSafeArea from '../../../../expo-intrinsics/src/NativeSafeArea';
import * as React from 'react';
import {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';

/**
 * `env(safe-area-inset-*)`, shown rather than described.
 *
 * The first version of this screen printed four boxes and their measurements and
 * left the reader to work out what was interesting about them. It was not clear,
 * and that is a fault in the demo: the claim here is about WHEN a number arrives,
 * which no arrangement of numbers states on its own. So each section now says
 * what to look at, and the middle one puts the two mechanisms side by side so the
 * difference is a thing you can see rather than a thing you are told.
 */

/** How many times a box has been laid out, and at what size. */
function useLayoutLog() {
  const [log, setLog] = useState([]);
  const onLayout = event => {
    const {width, height} = event.nativeEvent.layout;
    setLog(previous => [...previous, `${Math.round(width)}×${Math.round(height)}`]);
  };
  return [log, onLayout];
}

/* ------------------------------------------------------------ what it is  */

/**
 * The four values, at the size they resolved to.
 *
 * Drawn as bars rather than printed as numbers because the number on its own
 * invites the question "compared to what": a 62-point bar next to the words
 * "the status bar" is the comparison.
 */
function Resolved() {
  const [top, setTop] = useState(null);
  const [bottom, setBottom] = useState(null);
  const read = set => e => set(Math.round(e.nativeEvent.layout.height));

  return (
    <View style={styles.section}>
      <Text style={styles.lead}>
        The tinted bars are exactly as tall as the space the system is covering
        at each edge of this surface. Nothing measured them in JavaScript.
      </Text>
      <View style={styles.pair}>
        <Text style={styles.pairLabel}>top</Text>
        <View
          style={[styles.band, {height: env('safe-area-inset-top')}]}
          onLayout={read(setTop)}
        />
        <Text style={styles.pairValue}>{top ?? '…'}</Text>
      </View>
      <View style={styles.pair}>
        <Text style={styles.pairLabel}>bottom</Text>
        <View
          style={[styles.band, {height: env('safe-area-inset-bottom')}]}
          onLayout={read(setBottom)}
        />
        <Text style={styles.pairValue}>{bottom ?? '…'}</Text>
      </View>
      <Text style={styles.note}>
        On a notched iPhone held upright these are about 62 and 34. Turn the
        device sideways and both change — the top usually to 0.
      </Text>
    </View>
  );
}

/* ------------------------------------------------- the point of the thing  */

/** A box whose height comes from `env()`: resolved before the first layout. */
function ResolvedInLayout() {
  const [log, onLayout] = useLayoutLog();
  return (
    <View style={styles.column}>
      <Text style={styles.columnTitle}>env()</Text>
      <View
        style={[styles.sample, {height: env('safe-area-inset-top')}]}
        onLayout={onLayout}
      />
      <Text style={styles.count}>
        {log.length} layout{log.length === 1 ? '' : 's'}
      </Text>
      <Text style={styles.trail}>{log.join(' → ') || '…'}</Text>
    </View>
  );
}

/**
 * The same height, delivered the way JavaScript has to deliver it.
 *
 * A safe area read in JS cannot be known until something has been measured, so
 * the first render states a value nobody has yet — zero — and an effect corrects
 * it. That is not a strawman: it is the shape of every `useSafeAreaInsets()`,
 * and the second entry in the trail below is the frame you can see move on a
 * real launch.
 */
function ResolvedInJavaScript({target}) {
  const [log, onLayout] = useLayoutLog();
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (target != null) {
      setHeight(target);
    }
  }, [target]);
  return (
    <View style={styles.column}>
      <Text style={styles.columnTitle}>read in JS</Text>
      <View style={[styles.sample, styles.sampleJs, {height}]} onLayout={onLayout} />
      <Text style={styles.count}>
        {log.length} layout{log.length === 1 ? '' : 's'}
      </Text>
      <Text style={styles.trail}>{log.join(' → ') || '…'}</Text>
    </View>
  );
}

function Comparison() {
  const [target, setTarget] = useState(null);
  return (
    <View style={styles.section}>
      <Text style={styles.lead}>
        Two boxes that end up the same height. Count the layouts underneath: the
        left one is laid out once, at the right size. The right one is laid out
        at zero first and corrected — that second layout is the shift you see on
        a launch or a rotation.
      </Text>
      {/* A hidden probe supplies the JS column with the same number, so the two
          differ only in HOW it arrives, not in what it is. */}
      <View
        style={{height: env('safe-area-inset-top'), position: 'absolute', opacity: 0}}
        onLayout={e => setTarget(Math.round(e.nativeEvent.layout.height))}
      />
      <View style={styles.columns}>
        <ResolvedInLayout />
        <ResolvedInJavaScript target={target} />
      </View>
      <Text style={styles.note}>
        Rotate the device and watch both counts. The left goes up by one; the
        right goes up by two.
      </Text>
    </View>
  );
}

/* ---------------------------------------------------------- the details  */

function AsPadding() {
  return (
    <View style={styles.section}>
      <Text style={styles.lead}>
        The ordinary use: keep content clear of the status bar without knowing
        how tall it is. The tint is the padding; the white box is your content.
      </Text>
      <View style={[styles.padded, {paddingTop: env('safe-area-inset-top')}]}>
        <View style={styles.inner}>
          <Text style={styles.innerLabel}>content starts below the inset</Text>
        </View>
      </View>
      <Text style={styles.code}>paddingTop: env('safe-area-inset-top')</Text>
    </View>
  );
}

function Fallback() {
  const [height, setHeight] = useState(null);
  return (
    <View style={styles.section}>
      <Text style={styles.lead}>
        The second argument is what the length computes to where the value is
        UNKNOWN — not a minimum. On an edge that reports zero you get zero, which
        is what a browser gives you too.
      </Text>
      <View
        style={[styles.band, {height: env('safe-area-inset-bottom', 24)}]}
        onLayout={e => setHeight(Math.round(e.nativeEvent.layout.height))}
      />
      <Text style={styles.code}>height: env('safe-area-inset-bottom', 24)</Text>
      <Text style={styles.note}>
        {height === 24
          ? 'reading 24 — nothing has published a bottom inset here'
          : `reading ${height ?? '…'} — the published inset won, not the 24`}
      </Text>
    </View>
  );
}

function Edges() {
  return (
    <View style={styles.section}>
      <Text style={styles.lead}>
        A screen already sitting below a native header says so by naming the edge
        it does not want. The other three are still reserved.
      </Text>
      <NativeSafeArea edges={{top: false}} style={styles.padded}>
        <View style={styles.inner}>
          <Text style={styles.innerLabel}>no top inset; the rest kept</Text>
        </View>
      </NativeSafeArea>
      <Text style={styles.code}>
        {'<NativeSafeArea edges={{top: false}}>'}
      </Text>
    </View>
  );
}

function InsideCalc() {
  return (
    <View style={styles.section}>
      <Text style={styles.lead}>
        `env()` is only recognised as a WHOLE value. Inside `calc()` it is not a
        length at all, so this box has no padding — visibly missing rather than
        quietly half-right.
      </Text>
      <View
        style={[styles.padded, {paddingTop: 'calc(env(safe-area-inset-top) + 8px)'}]}>
        <View style={styles.inner}>
          <Text style={styles.innerLabel}>nothing above this</Text>
        </View>
      </View>
      <Text style={styles.code}>
        paddingTop: 'calc(env(safe-area-inset-top) + 8px)'
      </Text>
    </View>
  );
}

exports.title = 'env(safe-area-inset-*)';
exports.category = 'UI';
exports.description =
  'The safe area as a CSS length the renderer resolves during layout. Rotate the device: the values change and each box is laid out once more, not twice.';
exports.examples = [
  {
    title: 'What it resolves to',
    description: 'Bars drawn at exactly the size the system is covering.',
    render: () => <Resolved />,
  },
  {
    title: 'Why it is worth doing this way',
    description: 'The same height, arriving two different ways. Count the layouts.',
    render: () => <Comparison />,
  },
  {
    title: 'As padding',
    description: 'The ordinary use.',
    render: () => <AsPadding />,
  },
  {
    title: 'The fallback',
    description: 'For an unknown value, not a minimum.',
    render: () => <Fallback />,
  },
  {
    title: 'Naming edges',
    description: 'What a screen under a native header writes.',
    render: () => <Edges />,
  },
  {
    title: 'Inside calc()',
    description: 'Not supported, and visibly so.',
    render: () => <InsideCalc />,
  },
];

const INSET_TINT = '#cfe0ff';
const styles = StyleSheet.create({
  section: {gap: 8},
  lead: {fontSize: 14, color: '#1c1c1e', lineHeight: 20},
  note: {fontSize: 12, color: '#5f6368', lineHeight: 17},
  code: {fontFamily: 'Menlo', fontSize: 11, color: '#5f6368'},

  pair: {flexDirection: 'row', alignItems: 'center', gap: 10},
  pairLabel: {fontSize: 12, color: '#5f6368', width: 50},
  pairValue: {fontFamily: 'Menlo', fontSize: 13, color: '#1c1c1e', width: 34},
  band: {flex: 1, minHeight: 2, backgroundColor: INSET_TINT, borderRadius: 2},

  columns: {flexDirection: 'row', gap: 12},
  column: {flex: 1, gap: 4},
  columnTitle: {fontFamily: 'Menlo', fontSize: 12, color: '#1c1c1e'},
  sample: {minHeight: 2, backgroundColor: INSET_TINT, borderRadius: 2},
  sampleJs: {backgroundColor: '#ffd9b3'},
  count: {fontSize: 13, color: '#1c1c1e'},
  trail: {fontFamily: 'Menlo', fontSize: 10, color: '#5f6368'},

  padded: {backgroundColor: INSET_TINT, borderRadius: 8},
  inner: {backgroundColor: '#ffffff', borderRadius: 6, padding: 10},
  innerLabel: {fontSize: 13, color: '#1c1c1e'},
});
