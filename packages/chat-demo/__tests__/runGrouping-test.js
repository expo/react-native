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

import {runFlags} from '../runGrouping';

const me = {from: 'me', id: 'm0'};
const them = {from: 'Ada Lovelace', id: 't0'};
const other = {from: 'Grace Hopper', id: 'o0'};

// `wearsReceipt` is the index of the message showing the read receipt, or -1.
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
  expect(flagsAt(convo, 1).startsRun).toBe(true);
  const last = flagsAt(convo, 2);
  expect(last.endsRun).toBe(true);
  expect(last.separatesRun).toBe(true);
  expect(flagsAt(convo, 2).startsRun).toBe(false);
});

test('the very last message ends its run but does not separate', () => {
  const convo = [them, me, me];
  const tail = flagsAt(convo, 2);
  expect(tail.endsRun).toBe(true);
  expect(tail.separatesRun).toBe(false);
});

test('a message wearing the receipt keeps its tail mid-run', () => {
  const run = [me, me];
  expect(flagsAt(run, 0).endsRun).toBe(false);
  expect(flagsAt(run, 0, /* wearsReceipt */ 0).endsRun).toBe(true);
});

test('the receipt rule still separates when a run follows', () => {
  const run = [me, me, other];
  const {endsRun, separatesRun} = flagsAt(run, 0, 0);
  expect(endsRun).toBe(true);
  expect(separatesRun).toBe(true);
});

// Reaction rules measured on native Messages.
// See ui-metrics.md, "Reaction run grouping".

test('the message before a reacted one ends its run and takes the tail', () => {
  const run = [
    {...me, id: 'a'},
    {...me, id: 'b'},
    {...me, id: 'c'},
  ];
  expect(flagsAt(run, 0).endsRun).toBe(false);
  expect(flagsAt(run, 0, -1, {b: ['up']}).endsRun).toBe(true);
});

test('a reacted message does not end its OWN run', () => {
  const run = [
    {...me, id: 'a'},
    {...me, id: 'b'},
    {...me, id: 'c'},
  ];
  expect(flagsAt(run, 1, -1, {b: ['up']}).endsRun).toBe(false);
});

test('the tail a reaction forces does NOT also open the inter-run gap', () => {
  // Native Messages adds space above a reacted balloon only when its badge
  // would overlap the balloon above. That depends on widths, so `runFlags`
  // doesn't add it.
  const run = [
    {...me, id: 'a'},
    {...me, id: 'b'},
    {...me, id: 'c'},
  ];
  const {endsRun, separatesRun} = flagsAt(run, 0, -1, {b: ['up']});
  expect(endsRun).toBe(true);
  expect(separatesRun).toBe(false);
});

test('a sender change still separates, reactions or not', () => {
  const convo = [
    {...me, id: 'a'},
    {...them, id: 'b'},
  ];
  expect(flagsAt(convo, 0, -1, {b: ['up']}).separatesRun).toBe(true);
  expect(flagsAt(convo, 0).separatesRun).toBe(true);
});

test('an empty reaction list is not a reaction', () => {
  const run = [
    {...me, id: 'a'},
    {...me, id: 'b'},
  ];
  expect(flagsAt(run, 0, -1, {b: []}).endsRun).toBe(false);
  expect(flagsAt(run, 0, -1, {}).endsRun).toBe(false);
  expect(flagsAt(run, 0, -1, undefined).endsRun).toBe(false);
});
