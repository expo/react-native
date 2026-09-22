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
 * Run flags for one message. A run is consecutive messages from one sender.
 * `startsRun`: show the sender's name. `endsRun`: draw the tail. `separatesRun`:
 * add the extra space that follows a run.
 *
 * `endsRun` is also true in the middle of a run when:
 *   - the message shows the read receipt (`index === wearsReceipt`), because
 *     without the tail the balloon is shorter and the receipt moves up;
 *   - the next message has a reaction, because native Messages draws a tail
 *     there to separate this balloon from the next one's reaction badge. See
 *     ui-metrics.md, "Reaction run grouping".
 *
 * Separate from `ChatScreen.js` so `__tests__/runGrouping-test.js` can run
 * without a renderer.
 *
 * @param message the message in question
 * @param previous the message before it, or undefined at the top
 * @param next the message after it, or undefined at the bottom
 * @param index the message's index in the transcript
 * @param wearsReceipt the index of the message showing the read receipt, or
 *   -1/undefined for none
 * @param reactions the transcript's map from message id to an array of reaction
 *   ids, or undefined where reactions are not in play
 */
export function runFlags(
  message,
  previous,
  next,
  index,
  wearsReceipt,
  reactions,
) {
  const startsRun = previous?.from !== message.from;
  const closesOnItsOwn = next?.from !== message.from || index === wearsReceipt;
  const endsRun = closesOnItsOwn || isReactedTo(next, reactions);
  // Not `endsRun`: a tail added for a reaction adds no extra space. (Native
  // Messages adds it only if the badge would overlap the balloon above.)
  const separatesRun = closesOnItsOwn && next != null;
  return {startsRun, endsRun, separatesRun};
}

function isReactedTo(message, reactions) {
  const on = message == null ? null : reactions?.[message.id];
  return on != null && on.length > 0;
}
