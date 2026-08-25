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
  CHECKABLE_FOOTPRINT_BY_PLATFORM,
  RADIO_FOOTPRINT_BY_PLATFORM,
} from '../src/uaStyles';

/*
 * The checkable's box is the size its backing control ENFORCES, and each
 * literal here is measured, not chosen — see the table's own comment. The
 * ObjC twin (`EXPElementCheckboxGeometryTests`) measures the live UISwitch;
 * this side pins the sheet to the same literals, so a drift on either side
 * fails a named test instead of gluing labels to switches on device.
 */
describe('checkable footprint states the control, not a wish', () => {
  test('iOS is the UISwitch UIKit actually enforces (iOS 26: 63x28)', () => {
    expect(CHECKABLE_FOOTPRINT_BY_PLATFORM.ios).toEqual({
      width: 63,
      height: 28,
      // 12pt to the label. 8 was the system form's number and read as tight
      // against a 63pt switch on a device.
      marginInlineEnd: 12,
      verticalAlign: 'middle',
    });
  });

  test('Android is the 48dp Material touch target, label pulled to its edge', () => {
    expect(CHECKABLE_FOOTPRINT_BY_PLATFORM.android).toEqual({
      width: 48,
      height: 48,
      marginInlineEnd: -4,
      verticalAlign: 'middle',
    });
  });
});

/*
 * A radio's box is its INK, and its target reaches past it.
 *
 * These were once the same number: the box was made 44pt so that the Human
 * Interface Guidelines' minimum was met by layout alone. That worked and cost
 * something — 11pt of empty target all round a 22pt circle reads as a lot of
 * air in a stack of radios, and reported from a device the control STILL felt
 * small to aim at, because a target is only as findable as the ink advertising
 * it.
 *
 * So the box is now the ink plus a modest ring, and the 44pt guarantee moved to
 * `pointInside:` — `kEXPRadioTouchTarget` in `EXPElementRadioComponentView`,
 * pinned by `EXPElementRadioHitAreaTests`, which is where to look for it now.
 * It is deliberately NOT assertable from this table any more: asserting it here
 * would be asserting the wrong thing, since the sheet no longer decides it.
 */
describe('radio footprint is the ink, with the target beyond it', () => {
  test('iOS is the ink plus a ring, not the target', () => {
    expect(RADIO_FOOTPRINT_BY_PLATFORM.ios).toEqual({
      width: 32,
      height: 32,
      // The 22pt circle sits 5pt inside a 32pt box, so this leaves 12pt of
      // visible spacing before the label.
      marginInlineEnd: 7,
      verticalAlign: 'middle',
    });
  });

  test('Android is the 48dp Material touch target', () => {
    expect(RADIO_FOOTPRINT_BY_PLATFORM.android).toEqual({
      width: 48,
      height: 48,
      marginInlineEnd: -4,
      verticalAlign: 'middle',
    });
  });

  test('the box is never smaller than the ink it centres', () => {
    // What this table CAN still answer. The circle is drawn at
    // `kEXPRadioIndicatorDiameter` and centred in whatever box it is given, so
    // a box below that would clip the control rather than pad it.
    for (const box of [
      RADIO_FOOTPRINT_BY_PLATFORM.ios,
      RADIO_FOOTPRINT_BY_PLATFORM.android,
    ]) {
      expect(box.width).toBeGreaterThanOrEqual(22);
      expect(box.height).toBeGreaterThanOrEqual(22);
    }
  });
});
