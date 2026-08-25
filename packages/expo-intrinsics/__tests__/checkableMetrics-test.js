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
 * A radio's box on iOS holds the CHECKMARK, and where that mark lives is a
 * layout decision before it is a visual one.
 *
 * UIKit has no radio control — `PickerStyle.radioGroup` is macOS-only — so a
 * run of radios is presented as the platform's list and the chosen row carries
 * a checkmark. The question is whose box the mark sits in, and the answer is
 * forced: the list cell's trailing accessory occupies space the cell reserves
 * INSIDE itself, but a row's contents were positioned by Yoga across the row's
 * full width and cannot be re-flowed afterwards. A row with anything at its
 * trailing edge had the checkmark drawn straight through it — a price at the
 * end of a row and the mark rendered on top of one another.
 *
 * In the element's own box the space is reserved by the layout that already
 * exists: `<input type="radio">` is a box in the row, the author's content
 * flows after it, and nothing can land underneath. It is also where HTML puts
 * the control.
 *
 * The height is the load-bearing half — Yoga measures the row and UIKit draws
 * the cell behind it, and if they disagree the disagreement is visible. A row
 * measured at its label's 20pt got a section 20pt tall, UIKit drew its cell
 * taller, and each group showed its first row with the rest clipped square.
 *
 * 52 is the platform's STANDARD ROW HEIGHT, not the HIG's 44pt minimum target.
 * Measured against Settings on the same device: its rows are 52pt, and a 44pt
 * row reads as cramped beside them.
 *
 * This replaced two earlier attempts, both pinned by tests that are now gone: a
 * 22pt ring in a 22pt box (half the HIG minimum, reported as hard to hit), then
 * a 22pt ring in a 44pt box with the target beyond it (which measured correctly
 * and still looked like a small control in a lot of air). What went in both
 * cases was the RING, not the box.
 */
describe('a radio reserves the box for what its platform draws', () => {
  test('iOS draws nothing, but still reserves the platform row height', () => {
    expect(RADIO_FOOTPRINT_BY_PLATFORM.ios).toEqual({
      // No ink: the checkmark is the list's own accessory, and a second one
      // here put two checkmarks on the chosen row.
      width: 0,
      height: 52,
      marginInlineEnd: 0,
      verticalAlign: 'middle',
    });
  });

  test('Android keeps the 48dp Material touch target', () => {
    // Android HAS a radio control, so it uses it. The element is the semantic
    // and the control is each platform's answer to it.
    expect(RADIO_FOOTPRINT_BY_PLATFORM.android).toEqual({
      width: 48,
      height: 48,
      marginInlineEnd: -4,
      verticalAlign: 'middle',
    });
  });

  test('only the platform that draws a control reserves width for one', () => {
    // A box is reserved if and only if there is ink to put in it. Android has a
    // real RadioButton; iOS has no radio control and lets the list's accessory
    // be the indicator, so the element itself takes no width at all.
    expect(RADIO_FOOTPRINT_BY_PLATFORM.ios.width).toBe(0);
    expect(RADIO_FOOTPRINT_BY_PLATFORM.android.width).toBeGreaterThanOrEqual(48);
  });

  test("the iOS box is the platform's standard row height", () => {
    // The number the list cell is given. Yoga measures the row, the cell takes
    // that height, and a row containing a radio is therefore never shorter than
    // the platform's standard row — which is what stops a section being sized
    // for less content than UIKit puts in it.
    expect(RADIO_FOOTPRINT_BY_PLATFORM.ios.height).toBe(52);
  });

  test('the standard row height clears the HIG minimum target', () => {
    // The two are different numbers and it matters which one this is: 44 is the
    // smallest a control may be, 52 is how tall a list row IS. Using the
    // minimum as the standard is what made the list look cramped next to
    // Settings.
    expect(RADIO_FOOTPRINT_BY_PLATFORM.ios.height).toBeGreaterThan(44);
  });
});
