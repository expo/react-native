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

import type {RNTesterModule} from '../../types/RNTesterTypes';

import {DEMO_THEME, ThemingNote} from '../TextChildren/TextChildrenShared';

import * as React from 'react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {NativeText} from 'react-native/Libraries/Text/TextNativeComponent';

// On-device text benchmark: the same tiers as the Fantom
// StringChildrenCosting suite, but end-to-end in a real app build — JS
// render, commit, native layout, mount, all measured as the time from
// setState to the mounted tier's first onLayout. Results render on screen
// and POST to a host collector (scripts/device-bench-collect.py), which is
// how release builds (no inspector) report numbers.
//
// Methodology mirrors the harness suites: every tier renders inside the
// SAME plain parent View; tiers that need a container of their own render
// it as content and pay for it.
//
// Fairness rule: every tier's row container carries `collapsable={false}`
// to materialize exactly like the floor's rows. A prop-less View row
// flattens away when its child is a <Text> but cannot flatten around a
// bare string (the runs live on it) — without the pin, the Text tiers
// silently skip the per-row View mount the floor prices in, and the
// floor-subtracted marginal over-credits them by one host view per row.

const ROWS = 1000;
const MESSAGES = 100;
const LINES_PER_MESSAGE = 10;
// Warmup is counted in ROUNDS, so every tier is warm before any tier is
// sampled — code paths, inline caches, allocator, view pools and all.
//
// Eight rather than three because the drift control said so: at three, the
// second half of the session still ran 15.4% FASTER than the first (measured
// on the simulator), i.e. the samples were still riding the warm-up curve. At
// eight, drift is +5.7% — small, and now positive, which is the system
// slowly heating rather than still warming up. Raise it if the control on
// your device reports more.
const WARMUP = 8;
const ITERATIONS = 10;
const COLLECTOR = 'http://localhost:8347/results';

// `tag` is ONE character, distinct per tier, so every tier renders text of
// the identical length and shape while sharing no string with any other tier.
//
// Without it the tiers all render the same strings, and the content-keyed
// caches (the C++ measure cache, and on iOS the run text-storage cache) carry
// work from whichever tier ran first into every tier after it. That is an
// order effect with a direction: the first TEXT tier pays the cold cost and
// the rest are measured warm, which flatters whatever runs later.
function line(i: number, tag: string): string {
  return `Line ${i} of ${tag} benchmark text`;
}

function messageBody(m: number, tag: string): string {
  const lines: Array<string> = [];
  for (let i = 0; i < LINES_PER_MESSAGE; i++) {
    lines.push(line(m * LINES_PER_MESSAGE + i, tag));
  }
  return lines.join('\n');
}

function articleBody(tag: string): string {
  const lines: Array<string> = [];
  for (let i = 0; i < ROWS; i++) {
    lines.push(line(i, tag));
  }
  return lines.join('\n');
}

function rowsOnly(_tag: string): Array<React.Node> {
  const rows: Array<React.Node> = [];
  for (let i = 0; i < ROWS; i++) {
    rows.push(<View key={String(i)} collapsable={false} />);
  }
  return rows;
}

function rowsWithBareString(tag: string): Array<React.Node> {
  const rows: Array<React.Node> = [];
  for (let i = 0; i < ROWS; i++) {
    rows.push(
      // $FlowFixMe[incompatible-type] bare string child under View
      <View key={String(i)} collapsable={false}>
        {line(i, tag)}
      </View>,
    );
  }
  return rows;
}

function rowsWithText(tag: string): Array<React.Node> {
  const rows: Array<React.Node> = [];
  for (let i = 0; i < ROWS; i++) {
    rows.push(
      <View key={String(i)} collapsable={false}>
        <Text>{line(i, tag)}</Text>
      </View>,
    );
  }
  return rows;
}

function rowsWithNativeText(tag: string): Array<React.Node> {
  const rows: Array<React.Node> = [];
  for (let i = 0; i < ROWS; i++) {
    rows.push(
      <View key={String(i)} collapsable={false}>
        <NativeText>{line(i, tag)}</NativeText>
      </View>,
    );
  }
  return rows;
}

function messagesWithTextBodies(tag: string): Array<React.Node> {
  const rows: Array<React.Node> = [];
  for (let m = 0; m < MESSAGES; m++) {
    rows.push(
      <View key={String(m)} collapsable={false}>
        <Text>{messageBody(m, tag)}</Text>
      </View>,
    );
  }
  return rows;
}

function messagesWithBareBodies(tag: string): Array<React.Node> {
  const rows: Array<React.Node> = [];
  for (let m = 0; m < MESSAGES; m++) {
    rows.push(
      // $FlowFixMe[incompatible-type] whiteSpace is a new style key
      <View
        key={String(m)}
        collapsable={false}
        style={{whiteSpace: 'pre-line'}}>
        {messageBody(m, tag)}
      </View>,
    );
  }
  return rows;
}

function articleWithText(tag: string): Array<React.Node> {
  return [
    <View key="a" collapsable={false}>
      <Text>{articleBody(tag)}</Text>
    </View>,
  ];
}

function articleBare(tag: string): Array<React.Node> {
  return [
    // $FlowFixMe[incompatible-type] whiteSpace is a new style key
    <View key="a" collapsable={false} style={{whiteSpace: 'pre-line'}}>
      {articleBody(tag)}
    </View>,
  ];
}

function siblingNativeTexts(tag: string): Array<React.Node> {
  const rows: Array<React.Node> = [];
  for (let i = 0; i < ROWS; i++) {
    rows.push(<NativeText key={String(i)}>{line(i, tag)}</NativeText>);
  }
  return rows;
}

const TIERS: Array<[string, (tag: string) => Array<React.Node>]> = [
  ['settings rows only (floor)', rowsOnly],
  ['settings rows + bare string', rowsWithBareString],
  ['settings rows + Text', rowsWithText],
  ['settings rows + NativeText', rowsWithNativeText],
  ['messages: Text bodies', messagesWithTextBodies],
  ['messages: bare bodies', messagesWithBareBodies],
  ['article: one Text', articleWithText],
  ['article: bare block', articleBare],
  ['community: sibling NativeText', siblingNativeTexts],
];

function median(samples: Array<number>): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Spread as a percentage of the median. A median on its own will happily
// report 56ms and 95ms for the same tier on two runs of a busy machine and
// look equally confident both times; this is what says "do not trust me".
// Reported per tier, because a single tier going unstable is the usual case.
function spreadPercent(samples: Array<number>): number {
  if (samples.length < 4) {
    return 0;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const p50 = sorted[Math.floor(sorted.length / 2)];
  return p50 > 0 ? ((q3 - q1) / p50) * 100 : 0;
}

const ROUNDS = WARMUP + ITERATIONS;

// Round-robin, not one tier at a time.
//
// Running every iteration of a tier back to back makes tier identity and
// position in the session the SAME variable, so anything that drifts over a
// run — thermal throttling, heap growth, GC pressure — lands entirely on
// whichever tiers happen to run late. It lands hardest on the floor, which
// runs first and is subtracted from every other tier: measure the floor at its
// coolest and every marginal above it is inflated.
//
// Interleaving spreads each tier across the whole session instead, so drift
// becomes common-mode and cancels in the subtraction. The rotation gives each
// tier a different position every round rather than a fixed one, and it is
// deterministic — a shuffle would make two runs incomparable for no gain.
function tierOrderForRound(round: number): Array<number> {
  const order: Array<number> = [];
  for (let i = 0; i < TIERS.length; i++) {
    order.push((i + round) % TIERS.length);
  }
  return order;
}

// One character per tier; see `line`.
const TIER_TAGS = 'ABCDEFGHIJKLMNOP';

function BenchRunner(): React.Node {
  const [round, setRound] = useState(0);
  const [slot, setSlot] = useState(0);
  const [content, setContent] = useState<React.Node>(null);
  const [results, setResults] = useState<{[string]: number}>({});
  const [spreads, setSpreads] = useState<{[string]: number}>({});
  const [drift, setDrift] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const startRef = useRef(0);
  // Samples per tier, in round order, so the drift control can compare the
  // first half of the session against the second.
  const samplesRef = useRef<Array<Array<number>>>(TIERS.map(() => []));

  const tierIndex = tierOrderForRound(round)[slot];

  const scheduleNext = useCallback((nextRound: number, nextSlot: number) => {
    // Unmount, let the frame settle, then mount the next measurement.
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

  // The laid-out height of each tier.
  //
  // A tier compared against a version of itself that laid out LESS text is not
  // a comparison — a clamped or partial layout measures a fraction of the work
  // and reports a flattering time, and it reads as a speedup rather than as
  // two runs answering different questions. This benchmark went without the
  // check for a while and duly produced one: a bare-string tier at 66ms
  // against its usual ~115, in the same session as an article tier at 15ms
  // against its usual ~46. Two tiers anomalously fast at once is what a
  // partial layout looks like, and nothing else in the harness could say so.
  const heightsRef = useRef<{[string]: number}>({});

  const onTierLayout = useCallback((event: any) => {
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
      // Publish what is known so far, so the screen fills in as it goes
      // rather than staying blank until the end.
      setResults(prev => {
        const next = {...prev};
        for (let t = 0; t < TIERS.length; t++) {
          if (samplesRef.current[t].length > 0) {
            next[TIERS[t][0]] = median(samplesRef.current[t]);
          }
        }
        return next;
      });
      setSpreads(prev => {
        const next = {...prev};
        for (let t = 0; t < TIERS.length; t++) {
          if (samplesRef.current[t].length > 0) {
            next[TIERS[t][0]] = spreadPercent(samplesRef.current[t]);
          }
        }
        return next;
      });
    }

    if (nextRound >= ROUNDS) {
      // Drift control: the same tiers, first half of the session vs second.
      // If the order mattered, this is where it shows up.
      const firsts: Array<number> = [];
      const lasts: Array<number> = [];
      for (const perTier of samplesRef.current) {
        const half = Math.floor(perTier.length / 2);
        if (half > 0) {
          firsts.push(median(perTier.slice(0, half)));
          lasts.push(median(perTier.slice(half)));
        }
      }
      if (firsts.length > 0) {
        const a = firsts.reduce((x, y) => x + y, 0);
        const b = lasts.reduce((x, y) => x + y, 0);
        setDrift(((b - a) / a) * 100);
      }
    }
    scheduleNext(nextRound, nextSlot);
  }, [round, slot, tierIndex, scheduleNext]);

  useEffect(() => {
    scheduleNext(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!done) {
      return;
    }
    const payload = {
      platform: String(global.navigator?.product ?? 'ReactNative'),
      n: ROWS,
      iterations: ITERATIONS,
      // Interleaved rounds with per-tier content; numbers are NOT comparable
      // with runs from the blocked design that preceded it.
      method: 'interleaved-v2',
      driftPercent: drift,
      results,
      spreadPercent: spreads,

      heights: heightsRef.current,
    };
    fetch(COLLECTOR, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
    }).catch(() => {
      // No collector listening — results stay on screen.
    });
  }, [done, results, drift, spreads]);

  return (
    <View>
      {/* The readout gets the padding; the measured mount area below stays
          full-bleed — padding there would narrow the tiers' available width
          and change what the benchmark measures (wrapping, line count). */}
      <View style={{paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20}}>
        <ThemingNote>
          {'Tiers run interleaved, one per round, each on its own strings — ' +
            'so no tier warms another’s caches and drift lands on all of ' +
            'them equally. Drift below is the control: 2nd half of the ' +
            'session vs 1st. Tiers are unstyled on purpose.'}
        </ThemingNote>
        <Text
          style={{
            fontWeight: 'bold',
            color: DEMO_THEME.fg,
            fontSize: 16,
            // Tabular figures keep the ticking iteration counter (and the
            // DONE readout) from jiggling as digits change width.
            fontVariant: ['tabular-nums'],
            marginBottom: 8,
          }}>
          {done
            ? 'DONE'
            : `round ${round + 1}/${ROUNDS} — ${TIERS[tierIndex]?.[0] ?? ''}`}
        </Text>
        {drift != null ? (
          <Text
            style={{
              lineHeight: 22,
              color: Math.abs(drift) > 5 ? '#d06000' : DEMO_THEME.muted,
            }}>
            {`drift (2nd half vs 1st): ${drift > 0 ? '+' : ''}${drift.toFixed(
              1,
            )}%`}
          </Text>
        ) : null}
        {Object.keys(results).map(label => (
          <Text
            key={label}
            style={{
              lineHeight: 22,
              color: (spreads[label] ?? 0) > 15 ? '#d06000' : DEMO_THEME.fg,
            }}>
            {`${label}: ${results[label].toFixed(1)}ms ±${(
              spreads[label] ?? 0
            ).toFixed(0)}%`}
          </Text>
        ))}
      </View>
      {/* The measured tier mounts inside the same plain wrapper each time;
          opacity keeps it cheap to look at without affecting mount cost. */}
      {/* The measured tier mounts inside a ScrollView: real lists and
          articles live in one, and its unbounded main axis prevents the
          platform text engine from clamping layout work at the viewport —
          outside a scroll container a 1,000-line tier lays out only a
          screenful and reports a flattering number. */}
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

export default ({
  title: 'DeviceTextBenchmark',
  description:
    'End-to-end text mount benchmark: Text vs NativeText vs bare strings, ' +
    'measured setState -> onLayout in a real app build. The readout is ' +
    'themed; the measured tiers are deliberately unstyled — see the note ' +
    'on the screen.',
  examples: [
    {
      title: 'Run (auto-starts)',
      render: (): React.Node => <BenchRunner />,
    },
  ],
}: RNTesterModule);
