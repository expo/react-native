/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 * @format
 */

'use strict';

/**
 * The cross-branch benchmark: the tiers that exist on BOTH upstream `main` and
 * the text-children branch, so the same file can be dropped into either tree
 * and produce numbers that are comparable.
 *
 * ## Why this file exists at all
 *
 * Comparing a `<Text>` on main against a bare string on the branch means
 * comparing two different binaries, and absolute times drift several percent
 * between builds of the same code. A raw millisecond figure from one build set
 * beside one from another is not a measurement, it is two measurements with a
 * story attached.
 *
 * What makes it a measurement is a CONTROL that exists identically in both
 * trees and whose cost neither change touches: the floor tier — the same rows,
 * with no text in them at all. Every other tier is reported as its MARGINAL
 * over that floor, computed inside its own build. Anything that differs
 * between the two binaries but not between the tiers — compiler, allocator,
 * how warm the machine is — is in both terms and cancels in the subtraction.
 * The floor's own value is reported too, so the size of that common-mode
 * difference is visible rather than assumed away.
 *
 * This file must stay byte-identical in both trees. It uses nothing the branch
 * added: no bare strings, no `whiteSpace`, no intrinsics. `@noflow` because
 * one of the two trees types `NativeText` differently and a type error in one
 * of them would mean the two files were no longer the same file.
 *
 * The bare-string tiers live in `DeviceTextBenchmarkExample.js`, which runs
 * only on the branch and measures them against this same floor.
 *
 * ## The rest of the method
 *
 * Tiers run round-robin rather than one at a time, so drift over the session is
 * common-mode and cancels in the floor subtraction instead of landing on
 * whichever tier ran late. Every tier renders text of identical length but
 * shares no string with any other, so the content-keyed measure caches cannot
 * carry work from the tier that ran first into the ones after it. Every row
 * carries `collapsable={false}` so a row materialises whatever its child is.
 * Warm-up rounds are counted in ROUNDS, so every tier is warm before any tier
 * is sampled, and the session reports its own drift so a run that was still
 * warming up says so.
 */

import * as React from 'react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {NativeText} from 'react-native/Libraries/Text/TextNativeComponent';

const ROWS = 1000;
const MESSAGES = 100;
const LINES_PER_MESSAGE = 10;
const WARMUP = 8;
const ITERATIONS = 10;
const ROUNDS = WARMUP + ITERATIONS;
const COLLECTOR = 'http://localhost:8347/results';

// One character, distinct per tier, so every tier renders text of identical
// length while sharing no string with any other.
function line(i, tag) {
  return `Line ${i} of ${tag} benchmark text`;
}

function messageBody(m, tag) {
  const lines = [];
  for (let i = 0; i < LINES_PER_MESSAGE; i++) {
    lines.push(line(m * LINES_PER_MESSAGE + i, tag));
  }
  return lines.join('\n');
}

function articleBody(tag) {
  const lines = [];
  for (let i = 0; i < ROWS; i++) {
    lines.push(line(i, tag));
  }
  return lines.join('\n');
}

function rowsOnly(tag) {
  const rows = [];
  for (let i = 0; i < ROWS; i++) {
    rows.push(<View key={String(i)} collapsable={false} />);
  }
  return rows;
}

function rowsWithText(tag) {
  const rows = [];
  for (let i = 0; i < ROWS; i++) {
    rows.push(
      <View key={String(i)} collapsable={false}>
        <Text>{line(i, tag)}</Text>
      </View>,
    );
  }
  return rows;
}

function rowsWithNativeText(tag) {
  const rows = [];
  for (let i = 0; i < ROWS; i++) {
    rows.push(
      <View key={String(i)} collapsable={false}>
        <NativeText>{line(i, tag)}</NativeText>
      </View>,
    );
  }
  return rows;
}

function messagesWithTextBodies(tag) {
  const rows = [];
  for (let m = 0; m < MESSAGES; m++) {
    rows.push(
      <View key={String(m)} collapsable={false}>
        <Text>{messageBody(m, tag)}</Text>
      </View>,
    );
  }
  return rows;
}

function articleWithText(tag) {
  return [
    <View key="a" collapsable={false}>
      <Text>{articleBody(tag)}</Text>
    </View>,
  ];
}

function siblingNativeTexts(tag) {
  const rows = [];
  for (let i = 0; i < ROWS; i++) {
    rows.push(<NativeText key={String(i)}>{line(i, tag)}</NativeText>);
  }
  return rows;
}

const TIERS = [
  ['settings rows only (floor)', rowsOnly],
  ['settings rows + Text', rowsWithText],
  ['settings rows + NativeText', rowsWithNativeText],
  ['messages: Text bodies', messagesWithTextBodies],
  ['article: one Text', articleWithText],
  ['community: sibling NativeText', siblingNativeTexts],
];

const TIER_TAGS = 'ABCDEFGHIJKLMNOP';

function median(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function spreadPercent(samples) {
  if (samples.length < 4) {
    return 0;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const p50 = sorted[Math.floor(sorted.length / 2)];
  return p50 === 0 ? 0 : ((q3 - q1) / p50) * 100;
}

function tierOrderForRound(round) {
  const order = [];
  for (let i = 0; i < TIERS.length; i++) {
    order.push((i + round) % TIERS.length);
  }
  return order;
}

function BenchRunner({onDone}) {
  const [round, setRound] = useState(0);
  const [slot, setSlot] = useState(0);
  const [content, setContent] = useState(null);
  const [results, setResults] = useState({});
  const [spreads, setSpreads] = useState({});
  const [drift, setDrift] = useState(null);
  const [done, setDone] = useState(false);
  const startRef = useRef(0);
  const samplesRef = useRef(TIERS.map(() => []));

  const tierIndex = tierOrderForRound(round)[slot];

  const scheduleNext = useCallback((nextRound, nextSlot) => {
    setContent(null);
    setTimeout(() => {
      if (nextRound >= ROUNDS) {
        setDone(true);
        return;
      }
      setRound(nextRound);
      setSlot(nextSlot);
      const nextTier = tierOrderForRound(nextRound)[nextSlot];
      const make = TIERS[nextTier][1];
      const node = make(TIER_TAGS[nextTier]);
      startRef.current = global.performance.now();
      setContent(node);
    }, 50);
  }, []);

  // The laid-out height of the measured tier, per tier.
  //
  // Without it a tier can be compared against a version of itself that laid
  // out LESS text — a paragraph clamped at the viewport measures a fraction of
  // the work and reports a flattering time — and the difference reads as a
  // regression rather than as two engines answering different questions. Any
  // tier whose height differs between the two builds is not comparable, and
  // saying so requires measuring it.
  const heightsRef = useRef({});

  const onTierLayout = useCallback(
    event => {
      if (startRef.current === 0) {
        return;
      }
      const elapsed = global.performance.now() - startRef.current;
      const laidOut = event?.nativeEvent?.layout?.height;
      if (laidOut != null) {
        heightsRef.current[TIERS[tierIndex][0]] = laidOut;
      }
      startRef.current = 0;
      if (round >= WARMUP) {
        samplesRef.current[tierIndex].push(elapsed);
      }

      const lastSlot = slot + 1 >= TIERS.length;
      const nextRound = lastSlot ? round + 1 : round;
      const nextSlot = lastSlot ? 0 : slot + 1;

      if (lastSlot) {
        setResults(() => {
          const next = {};
          for (let t = 0; t < TIERS.length; t++) {
            if (samplesRef.current[t].length > 0) {
              next[TIERS[t][0]] = median(samplesRef.current[t]);
            }
          }
          return next;
        });
        setSpreads(() => {
          const next = {};
          for (let t = 0; t < TIERS.length; t++) {
            if (samplesRef.current[t].length > 0) {
              next[TIERS[t][0]] = spreadPercent(samplesRef.current[t]);
            }
          }
          return next;
        });
        // Second half of the sampled session against the first: a run still
        // riding the warm-up curve, or one being throttled, says so here rather
        // than quietly reporting a confident-looking median.
        const perTier = [];
        for (let t = 0; t < TIERS.length; t++) {
          const s = samplesRef.current[t];
          if (s.length >= 4) {
            const half = Math.floor(s.length / 2);
            const first = median(s.slice(0, half));
            const second = median(s.slice(half));
            if (first > 0) {
              perTier.push(((second - first) / first) * 100);
            }
          }
        }
        if (perTier.length > 0) {
          setDrift(perTier.reduce((a, b) => a + b, 0) / perTier.length);
        }
      }

      scheduleNext(nextRound, nextSlot);
    },
    [round, slot, tierIndex, scheduleNext],
  );

  useEffect(() => {
    scheduleNext(0, 0);
  }, [scheduleNext]);

  useEffect(() => {
    if (!done) {
      return;
    }
    const payload = {
      suite: 'shared-text-benchmark',
      rows: ROWS,
      warmup: WARMUP,
      iterations: ITERATIONS,
      drift,
      results,
      spreads,
      heights: heightsRef.current,
    };
    fetch(COLLECTOR, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
    })
      .catch(() => {
        // Release builds have no inspector, and the on-screen table is the
        // fallback when no collector is listening.
      })
      .then(() => {
        // The memory pass only starts once the speed pass has reported, so the
        // two never overlap and neither is measuring the other.
        if (onDone) {
          onDone();
        }
      });
  }, [done, drift, results, spreads, onDone]);

  const floor = results['settings rows only (floor)'];

  return (
    <View>
      <View style={{paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20}}>
        <Text style={{fontWeight: 'bold', fontSize: 16, marginBottom: 8}}>
          {done
            ? 'DONE'
            : `round ${round + 1}/${ROUNDS} — ${TIERS[tierIndex]?.[0] ?? ''}`}
        </Text>
        {drift != null ? (
          <Text style={{lineHeight: 22}}>
            {`drift (2nd half vs 1st): ${drift > 0 ? '+' : ''}${drift.toFixed(1)}%`}
          </Text>
        ) : null}
        {TIERS.map(([name]) => {
          const value = results[name];
          if (value == null) {
            return null;
          }
          const marginal =
            floor == null || name === TIERS[0][0] ? null : value - floor;
          return (
            <Text key={name} style={{lineHeight: 22}}>
              {`${name}: ${value.toFixed(1)}ms` +
                (marginal == null
                  ? ''
                  : ` (marginal ${marginal.toFixed(1)}ms)`) +
                ` ±${(spreads[name] ?? 0).toFixed(0)}%`}
            </Text>
          );
        })}
      </View>
      {/* Identical to DeviceTextBenchmarkExample's measured mount, and it has
          to be: the tier mounts inside a ScrollView because its unbounded main
          axis stops the platform text engine clamping layout at the viewport —
          outside one, a 1,000-line tier lays out only a screenful and reports a
          flattering number. The clip and opacity keep it cheap to display
          without changing what is measured. */}
      <View style={{opacity: 0.2, maxHeight: 200, overflow: 'hidden'}}>
        {content != null ? (
          <ScrollView>
            <View onLayout={onTierLayout}>{content}</View>
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Memory mode: what a tier actually costs the process, rather than what a
 * struct-size table says it should.
 *
 * Each tier is mounted, held long enough for layout and mounting to settle,
 * announced to the collector, unmounted, and announced again. The collector —
 * `scripts/device-bench-rss.py` — samples the app's resident set at each
 * announcement, so the tier's retained memory is the difference between the
 * two. That needs no model of which nodes a tier creates, which is exactly the
 * part that would otherwise have to be argued rather than measured, and it
 * works identically on both trees.
 *
 * Two passes. The first is discarded: the first mount of anything grows the
 * allocator's arenas and the view pools, and charging that to whichever tier
 * happened to run first is how a memory benchmark lies.
 */
const MEMORY_PASSES = 2;
const MEMORY_SETTLE_MS = 1200;

function Runner() {
  const [phase, setPhase] = useState('speed');
  return phase === 'speed' ? (
    <BenchRunner onDone={() => setPhase('memory')} />
  ) : (
    <MemoryRunner />
  );
}

function MemoryRunner() {
  const [status, setStatus] = useState('starting');
  const [memoryContent, setMemoryContent] = useState(null);
  const doneRef = useRef(false);

  useEffect(() => {
    if (doneRef.current) {
      return;
    }
    doneRef.current = true;
    let cancelled = false;

    const announce = (pass, tier, phase) =>
      fetch(COLLECTOR, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({suite: 'shared-text-memory', pass, tier, phase}),
      }).catch(() => {});

    const wait = ms => new Promise(r => setTimeout(r, ms));

    const run = async () => {
      for (let pass = 0; pass < MEMORY_PASSES; pass++) {
        for (let t = 0; t < TIERS.length; t++) {
          const [name, make] = TIERS[t];
          if (cancelled) {
            return;
          }
          setStatus(`pass ${pass + 1}/${MEMORY_PASSES}: ${name}`);
          setMemoryContent(make(TIER_TAGS[t]));
          await wait(MEMORY_SETTLE_MS);
          await announce(pass, name, 'mounted');
          setMemoryContent(null);
          await wait(MEMORY_SETTLE_MS);
          await announce(pass, name, 'unmounted');
        }
      }
      setStatus('DONE');
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View>
      <View style={{paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20}}>
        <Text style={{fontWeight: 'bold', fontSize: 16}}>{status}</Text>
      </View>
      <View style={{opacity: 0.2, maxHeight: 200, overflow: 'hidden'}}>
        {memoryContent != null ? (
          <ScrollView>
            <View>{memoryContent}</View>
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

export default {
  title: 'Shared text benchmark',
  category: 'Basic',
  description:
    'Text vs NativeText, in tiers that exist on both upstream main and the ' +
    'text-children branch, reported as marginals over a shared floor.',
  examples: [
    {
      title: 'Run (speed, then memory)',
      render: () => <Runner />,
    },
  ],
};
