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

/**
 * Where a message sits in its RUN — the three flags the native chat's grouping
 * needs,
 * computed from a message and its neighbours.
 *
 * A run is a maximal stretch from one sender. The grouping is three things at
 * once and any one alone reads as a bug: the sender's name goes on the FIRST of
 * the run (`startsRun`), the tail goes on the LAST (`endsRun`), and the extra
 * space between runs is paid by a message that ENDS a run and has another run
 * after it (`separatesRun`).
 *
 * The one rule that is not just "did the sender change" is the receipt: a
 * message that wears the read receipt keeps its tail even mid-run, because the
 * tail's drop is part of the height the receipt was measured against and losing
 * it pulls the receipt up. That is why `endsRun` also fires on
 * `index === wearsReceipt`. Reported from a device: "if it has the indicator,
 * it has the tail." Kept pure and apart from `ChatScreen` so these rules can be
 * exercised without a renderer — see `__tests__/runGrouping-test.js`.
 *
 * The second such rule is the REACTION, and it was measured on the native chat
 * in the simulator rather than guessed (captures and numbers in
 * `~/.config/tuft/probes/reaction-groundtruth/`). A message whose NEXT message
 * carries a reaction ends its run and grows a tail — 40.00pt to 46.00pt, the
 * tail's 6.667, in both a two- and a three-message run. The badge hangs off the
 * reacted balloon's top corner, and the tail is how the native chat separates the
 * two.
 *
 * Three things deliberately NOT done here, each because it is not what was
 * measured:
 *
 *   - The reacted message does not end its OWN run. Measured on a middle
 *     message: it stayed 40.00 with no tail and the one after it stayed 4.33
 *     away, still grouped.
 *   - `startsRun` is untouched. It drives the SENDER'S NAME, and the oracle can
 *     only produce sent balloons, so whether a reacted received message repeats
 *     its sender's name is unmeasured. A tail is what was seen; a name is not.
 *   - `separatesRun` keeps its old meaning exactly. The extra inter-run space is
 *     NOT unconditional: the native chat opens room above a reacted balloon only
 *     when
 *     the badge would actually collide with the balloon above. With the balloon
 *     above ending 30pt further right the gap stayed at the 4.33 run spacing;
 *     with the two in the same column it opened to 32.00. That is a geometry
 *     question about two widths, not a grouping one.
 *
 * @param message the message in question
 * @param previous the message before it, or undefined at the top
 * @param next the message after it, or undefined at the bottom
 * @param index the message's index in the transcript
 * @param wearsReceipt the index of the message currently wearing the receipt,
 *   or -1/undefined for none
 * @param reactions the transcript's map from message id to an array of reaction
 *   ids, or undefined where reactions are not in play
 */
export function runFlags(message, previous, next, index, wearsReceipt, reactions) {
  const startsRun = previous?.from !== message.from;
  const closesOnItsOwn = next?.from !== message.from || index === wearsReceipt;
  const endsRun = closesOnItsOwn || isReactedTo(next, reactions);
  /* Not `endsRun`: see the third bullet above — a tail, but no extra gap. */
  const separatesRun = closesOnItsOwn && next != null;
  return {startsRun, endsRun, separatesRun};
}

/**
 * Whether a message carries at least one reaction.
 *
 * Takes the whole map rather than one message's entry so the caller can pass
 * what it already holds, and tolerates `undefined` at both levels: `next` is
 * undefined at the bottom of the transcript, and a transcript with no reactions
 * at all never builds the map.
 */
function isReactedTo(message, reactions) {
  const on = message == null ? null : reactions?.[message.id];
  return on != null && on.length > 0;
}
