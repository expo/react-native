/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 * @format
 */

/**
 * Which element a tap actually lands on, for text a View paints itself.
 *
 * `getBoundingClientRect()` says where things are; this says whether the
 * engine agrees when a finger arrives. The two are the same question asked
 * twice, and they can disagree — painting and hit-testing are separate code
 * paths on both platforms — so the corpus checks both.
 *
 * Every element records itself when clicked, in fire order, WITHOUT stopping
 * propagation. So one tap answers both halves at once: the first id is the
 * target the engine resolved, and the rest are the ancestors it bubbled
 * through (DOM §2.9 — target first, then outward).
 *
 * Read by text-conformance/verify-events.js, which taps the middle of each
 * probe's published rect.
 */

import * as React from 'react';
import {View} from 'react-native';

import '@react-native/expo-intrinsics-poc';

function record(id) {
  return event => {
    const fired = globalThis.__textTargets ?? [];
    // The point comes along for the ride: when a tap lands somewhere
    // unexpected, this is what says whether the coordinate was wrong or the
    // dispatch was.
    const source = event?.clientX != null ? event : event?.nativeEvent;
    fired.push({
      id,
      x: source?.clientX ?? null,
      y: source?.clientY ?? null,
      // Screen coordinates as well, because the two spaces are NOT the same on
      // Android: `getBoundingClientRect()` is relative to the screen while a
      // pointer event's client coordinates are relative to the React root
      // view, which sits below the status bar. They coincide on iOS only
      // because the root view is at the window origin there. The verifier
      // calibrates on the screen pair, which is the one that matches the
      // rects it aims with.
      screenX: source?.screenX ?? null,
      screenY: source?.screenY ?? null,
    });
    globalThis.__textTargets = fired;
  };
}

function useRects(refs) {
  React.useEffect(() => {
    const publish = () => {
      const out = globalThis.__textTargetRects ?? {};
      for (const name of Object.keys(refs)) {
        const node = refs[name].current;
        if (node != null && typeof node.getBoundingClientRect === 'function') {
          const r = node.getBoundingClientRect();
          out[name] = {x: r.x, y: r.y, w: r.width, h: r.height};
        }
      }
      globalThis.__textTargetRects = out;
    };
    const t1 = setTimeout(publish, 600);
    const t2 = setTimeout(publish, 2200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [refs]);
}

function TextEventTargetsScreen() {
  const refs = React.useRef({
    bareText: React.createRef(),
    spanProbe: React.createRef(),
    beforeSpan: React.createRef(),
    innerProbe: React.createRef(),
    atomicBox: React.createRef(),
    afterAtomic: React.createRef(),
    blockChild: React.createRef(),
  }).current;
  useRects(refs);

  return (
    // The root records every click with its point, which is how the verifier
    // calibrates: it clicks a few known screen positions, reads back where the
    // app thought they were, and solves for the transform. Deriving it from
    // window geometry instead was wrong by ~20pt across and ~50pt down, and
    // wrong in a way that looked like a hit-testing bug rather than a pointer
    // one.
    <View style={styles.screen} onClick={record('screen')}>

      {/* 1. Bare text is not a target: the tap resolves to the View. */}
      <View style={styles.row} onClick={record('row-bare')}>
        <span ref={refs.bareText}>bare text has no element of its own</span>
      </View>

      {/* 2. An inline element with a handler IS the target, and bubbles. */}
      <View style={styles.row} onClick={record('row-span')}>
        <span ref={refs.beforeSpan}>before </span>
        <span
          ref={refs.spanProbe}
          onClick={record('span')}
          style={styles.marked}>
          the span
        </span>
      </View>

      {/* 3. The innermost element wins. */}
      <View style={styles.row} onClick={record('row-nested')}>
        <span onClick={record('outer')} style={styles.marked}>
          out <b ref={refs.innerProbe} onClick={record('inner')}>in</b> out
        </span>
      </View>

      {/* 4. An atomic inline is its own target; the text after it is not. */}
      <View style={styles.row} onClick={record('row-atomic')}>
        <span>a </span>
        <div ref={refs.atomicBox} onClick={record('atomic')} style={styles.box} />
        <span ref={refs.afterAtomic}> text after the box</span>
      </View>

      {/* 5. A block child between two runs. */}
      <View style={styles.row} onClick={record('row-block')}>
        <span>above</span>
        <div ref={refs.blockChild} onClick={record('block')} style={styles.bar} />
        <span>below</span>
      </View>
    </View>
  );
}

const styles = {
  screen: {backgroundColor: '#ffffff', padding: 8, minHeight: 500},
  row: {
    display: 'block',
    marginTop: 10,
    padding: 6,
    backgroundColor: '#f1f5f9',
    color: '#000000',
    fontSize: 16,
  },
  marked: {backgroundColor: '#fde68a'},
  box: {display: 'inline-block', width: 40, height: 16, backgroundColor: '#6ea8fe'},
  bar: {height: 16, backgroundColor: '#f4a261'},
};

export default {
  title: 'Text event targets',
  category: 'Basic',
  description:
    'Which element a tap lands on for text a View paints itself, and how it ' +
    'bubbles. Read by text-conformance/verify-events.js.',
  examples: [
    {
      title: 'Targets',
      render: () => <TextEventTargetsScreen />,
    },
  ],
};
