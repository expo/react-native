/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import {CHECKABLE_FOOTPRINT_BY_PLATFORM} from '../src/uaStyles';

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
