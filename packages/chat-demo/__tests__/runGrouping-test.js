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
 * The run-grouping rules — name on the first of a run, tail on the last, extra
 * space between runs, and the device-reported exception that a receipt-bearing
 * message keeps its tail. Each was a separate report to get right, so each has
 * a case here rather than trusting the one-liner.
 */

import {runFlags} from '../runGrouping';

const me = {from: 'me', id: 'm0'};
const them = {from: 'Ada Lovelace', id: 't0'};
const other = {from: 'Grace Hopper', id: 'o0'};

// A helper: run flags for `messages[index]`, with no receipt in play (-1).
function flagsAt(messages, index, wearsReceipt = -1, reactions = undefined) {
  return runFlags(
    messages[index],
    messages[index - 1],
    messages[index + 1],
    index,
    wearsReceipt,
    reactions,
  );
}

test('a lone message both starts and ends its run', () => {
  const {startsRun, endsRun, separatesRun} = flagsAt([me], 0);
  expect(startsRun).toBe(true);
  expect(endsRun).toBe(true);
  // ...but it does not SEPARATE, because there is no run after it.
  expect(separatesRun).toBe(false);
});

test('the middle of a same-sender run neither starts nor ends it', () => {
  const run = [me, me, me];
  const {startsRun, endsRun, separatesRun} = flagsAt(run, 1);
  expect(startsRun).toBe(false);
  expect(endsRun).toBe(false);
  expect(separatesRun).toBe(false);
});

test('the first of a run starts it; the last ends and separates it', () => {
  const convo = [them, me, me, other];
  // index 1: sender changed from them→me, so it starts a run;
  expect(flagsAt(convo, 1).startsRun).toBe(true);
  // index 2: last `me` before `other` — ends the run, and separates (other follows);
  const last = flagsAt(convo, 2);
  expect(last.endsRun).toBe(true);
  expect(last.separatesRun).toBe(true);
  // index 2 does not START (previous is also me);
  expect(flagsAt(convo, 2).startsRun).toBe(false);
});

test('the very last message ends its run but does not separate', () => {
  const convo = [them, me, me];
  const tail = flagsAt(convo, 2);
  expect(tail.endsRun).toBe(true);
  // next is undefined, so there is no run to be apart from.
  expect(tail.separatesRun).toBe(false);
});

test('a message wearing the receipt keeps its tail mid-run', () => {
  // Two `me` messages in a run: index 0 would normally NOT end the run (index 1
  // is also `me`), but if it wears the receipt it must — the device rule.
  const run = [me, me];
  expect(flagsAt(run, 0).endsRun).toBe(false); // no receipt: mid-run, no tail
  expect(flagsAt(run, 0, /* wearsReceipt */ 0).endsRun).toBe(true); // wears it: keeps tail
});

test('the receipt rule still separates when a run follows', () => {
  const run = [me, me, other];
  // index 0 wears the receipt: ends its run AND a run (index 1's) follows.
  const {endsRun, separatesRun} = flagsAt(run, 0, 0);
  expect(endsRun).toBe(true);
  expect(separatesRun).toBe(true);
});

/*
 * The reaction rules, measured on the native chat in the simulator rather than
 * guessed.
 * Captures and numbers: `~/.config/tuft/probes/reaction-groundtruth/`.
 */

test('the message before a reacted one ends its run and takes the tail', () => {
  // Three of mine in one run. Without reactions, index 0 is mid-run: no tail.
  const run = [{...me, id: 'a'}, {...me, id: 'b'}, {...me, id: 'c'}];
  expect(flagsAt(run, 0).endsRun).toBe(false);
  // A reaction on 'b' — measured: the balloon above went 40.00 to 46.00.
  expect(flagsAt(run, 0, -1, {b: ['up']}).endsRun).toBe(true);
});

test('a reacted message does not end its OWN run', () => {
  // Measured on a middle message: it stayed 40.00 with no tail, and the one
  // after it stayed 4.33 away, still grouped.
  const run = [{...me, id: 'a'}, {...me, id: 'b'}, {...me, id: 'c'}];
  expect(flagsAt(run, 1, -1, {b: ['up']}).endsRun).toBe(false);
});

test('the tail a reaction forces does NOT also open the inter-run gap', () => {
  // The native chat opens room above a reacted balloon only when the badge would
  // collide with the balloon above — a geometry question, not a grouping one.
  // With the balloon above ending 30pt further right the gap stayed at 4.33.
  const run = [{...me, id: 'a'}, {...me, id: 'b'}, {...me, id: 'c'}];
  const {endsRun, separatesRun} = flagsAt(run, 0, -1, {b: ['up']});
  expect(endsRun).toBe(true);
  expect(separatesRun).toBe(false);
});

test('a sender change still separates, reactions or not', () => {
  // The old meaning of `separatesRun` is untouched.
  const convo = [{...me, id: 'a'}, {...them, id: 'b'}];
  expect(flagsAt(convo, 0, -1, {b: ['up']}).separatesRun).toBe(true);
  expect(flagsAt(convo, 0).separatesRun).toBe(true);
});

test('an empty reaction list is not a reaction', () => {
  // A message whose reactions were all removed must group as if it never had any.
  const run = [{...me, id: 'a'}, {...me, id: 'b'}];
  expect(flagsAt(run, 0, -1, {b: []}).endsRun).toBe(false);
  expect(flagsAt(run, 0, -1, {}).endsRun).toBe(false);
  expect(flagsAt(run, 0, -1, undefined).endsRun).toBe(false);
});
