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
      // 12pt to the label; the system form's 8 reads as tight beside a 63pt switch
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

/**
 * A radio's box on iOS is zero wide and its row is the platform's standard
 * height. UIKit has no radio control, so a run of radios is presented as the
 * platform's list with a checkmark on the chosen row, drawn by the list's
 * trailing accessory; the element itself has no ink, so it takes no width.
 * Yoga measures the row and UIKit draws the cell behind it at that height, so
 * a row holding a radio is never shorter than the platform's 52pt standard
 * row (Settings' rows measure 52; the HIG's 44 is the minimum target and reads
 * as cramped beside them).
 */
describe('a radio reserves the box for what its platform draws', () => {
  test('iOS draws nothing, but still reserves the platform row height', () => {
    expect(RADIO_FOOTPRINT_BY_PLATFORM.ios).toEqual({
      // No ink: the checkmark is the list's own accessory
      width: 0,
      height: 52,
      marginInlineEnd: 0,
      verticalAlign: 'middle',
    });
  });

  test('Android keeps the 48dp Material touch target', () => {
    // Android has a radio control and uses it
    expect(RADIO_FOOTPRINT_BY_PLATFORM.android).toEqual({
      width: 48,
      height: 48,
      marginInlineEnd: -4,
      verticalAlign: 'middle',
    });
  });

  test('only the platform that draws a control reserves width for one', () => {
    // A box is reserved only where there is ink to put in it
    expect(RADIO_FOOTPRINT_BY_PLATFORM.ios.width).toBe(0);
    expect(RADIO_FOOTPRINT_BY_PLATFORM.android.width).toBeGreaterThanOrEqual(
      48,
    );
  });

  test("the iOS box is the platform's standard row height", () => {
    // The height the list cell is given, so a section is never sized for less
    // than UIKit draws in it
    expect(RADIO_FOOTPRINT_BY_PLATFORM.ios.height).toBe(52);
  });

  test('the standard row height clears the HIG minimum target', () => {
    // 52 is how tall a list row is; 44 is the smallest a control may be
    expect(RADIO_FOOTPRINT_BY_PLATFORM.ios.height).toBeGreaterThan(44);
  });
});
