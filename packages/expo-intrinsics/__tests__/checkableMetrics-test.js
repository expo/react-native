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
      marginInlineEnd: 8,
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
 * A radio's box is its TOUCH TARGET, and these pin it there.
 *
 * The circle is small by design and the box used to be the same size, so the
 * control was only as tappable as it was visible — 22pt against the Human
 * Interface Guidelines' 44pt minimum, which is what made it hard to hit on a
 * device. The ink stays 22pt and is centred in the target by
 * `kEXPRadioIndicatorDiameter`; if that constant and this table ever disagree
 * the circle stops being centred, so both sides are stated as literals.
 */
describe('radio footprint is the touch target, not the ink', () => {
  test("iOS is the HIG's 44pt minimum", () => {
    expect(RADIO_FOOTPRINT_BY_PLATFORM.ios).toEqual({
      width: 44,
      height: 44,
      // The 22pt circle sits 11pt inside a 44pt box, so this leaves the ~8pt
      // of visible spacing a system form puts before a label.
      marginInlineEnd: -3,
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

  test('both platforms meet their own minimum tappable size', () => {
    for (const box of [
      RADIO_FOOTPRINT_BY_PLATFORM.ios,
      RADIO_FOOTPRINT_BY_PLATFORM.android,
    ]) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });
});
