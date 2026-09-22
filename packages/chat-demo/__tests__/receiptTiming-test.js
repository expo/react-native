/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import {
  RECEIPT_HANDOVER_GAP_MS,
  RECEIPT_INK_DELAY_MS,
  RECEIPT_LAYOUT_MS,
  RECEIPT_LEAVE_MS,
  TAIL_MORPH_MS,
} from '../receiptTiming';

/*
 * When the receipt moves to the next message, the receipt's space
 * (`RECEIPT_LAYOUT_MS`) and the previous balloon's tail collapse (`tailMorph`
 * in expo-intrinsics/src/NativeChatBubble.js) both change the transcript's
 * layout. They must end on the same frame.
 */
test('everything that moves the transcript shares one duration', () => {
  expect(RECEIPT_LAYOUT_MS).toBe(TAIL_MORPH_MS);
});

// Otherwise the old receipt's text is clipped as its row collapses.
test('the old receipt is gone before its row has finished closing', () => {
  expect(RECEIPT_LEAVE_MS).toBeLessThan(RECEIPT_LAYOUT_MS);
});

/*
 * The renderer has no `transitionend` event, so the new receipt's delay is the
 * old receipt's fade-out plus the gap. See ui-metrics.md, "Receipt handover".
 */
test('the new receipt waits out the old one and the gap after it', () => {
  expect(RECEIPT_INK_DELAY_MS).toBe(RECEIPT_LEAVE_MS + RECEIPT_HANDOVER_GAP_MS);
  expect(RECEIPT_HANDOVER_GAP_MS).toBeGreaterThan(0);
});
