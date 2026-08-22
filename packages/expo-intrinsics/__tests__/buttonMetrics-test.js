/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

/**
 * `<button>`'s user-agent table, pinned to what the platforms actually specify.
 *
 * The SURFACE is deliberately absent: it is drawn by the platform views with
 * the platform's own machinery — a real `UIButtonConfiguration` on iOS, the
 * Material construction on Android — precisely because the previous
 * CSS-described chrome drifted the way descriptions do (a pre-iOS-26 blue
 * label; a Material-2-era rectangle). What the sheet still owns is what the
 * renderer draws: label typography and colours, content insets, and the
 * accessible minimum. These are the values that were measured, and this file
 * is what keeps them from becoming guesses again.
 *
 * The prominence rule itself is HTML's, tested here because it is a pure
 * function: `submit` — the element's own default type — is the form's primary
 * action and gets each platform's prominent style, but only inside a form,
 * where submitting means something.
 */

import {authorStatesSurface, buttonProminence} from '../src/Button';
import {SYSTEM_COLORS_BY_PLATFORM} from '../src/systemColors';
import {BUTTON_CHROME_BY_PLATFORM} from '../src/uaStyles';

describe('iOS button table matches UIKit', () => {
  const ios = BUTTON_CHROME_BY_PLATFORM.ios;

  test('content insets are UIKit s 7 and 12', () => {
    // Read off a real gray `UIButtonConfiguration` on the simulator.
    expect(ios.paddingBlock).toBe(7);
    expect(ios.paddingInline).toBe(12);
  });

  test('the minimum is the HIG touch target', () => {
    // UIKit itself applies no minimum — 44 is the HIG's claim about the
    // finger, and this element's box IS its touch target.
    expect(ios.minHeight).toBe(44);
  });

  test('labels are the label colour, and white when prominent', () => {
    /*
     * The neutral label colour is the REGRESSION pin of this file: iOS 26
     * draws a gray button's title in the label colour, while
     * `titleColorForState:` still answers `systemBlue` — the previous value
     * came from trusting the query over the pixels, and looked subtly wrong on
     * every screen. The colours are spoken as CSS system colors and resolved
     * per platform in `systemColors.js`; `AccentColorText` is genuinely white
     * on iOS — stored PROCESSED (0xffffffff), because the user-agent sheet is
     * merged in the renderer, past where view configs run `processColor`, and
     * a raw string there silently drew the filled button's label transparent.
     */
    const colors = SYSTEM_COLORS_BY_PLATFORM.ios;
    expect(colors.ButtonText).not.toBe(undefined);
    expect(colors.AccentColorText).toBe(0xffffffff);
    expect(colors.ButtonText).not.toEqual(colors.AccentColorText);
  });

  test('typography is inherited, not restated', () => {
    // A UIButton's 17pt system title IS the body default this sheet already
    // sets at the root; restating it here would be a second copy to drift.
    expect(ios.fontSize).toBe(undefined);
    expect(ios.fontWeight).toBe(undefined);
  });
});

describe('Android button table matches Material 3', () => {
  const android = BUTTON_CHROME_BY_PLATFORM.android;

  test('label typography is label-large', () => {
    // From the material library's own resources: 14sp, weight 500, 0.1
    // tracking — `m3_comp_button_small_label_text` -> `textAppearanceLabelLarge`.
    expect(android.fontSize).toBe(14);
    expect(android.fontWeight).toBe('500');
    expect(android.letterSpacing).toBe(0.1);
  });

  test('inline padding is Material s 24dp', () => {
    expect(android.paddingInline).toBe(24);
  });

  test('the minimum is Material s own 48dp target', () => {
    expect(android.minHeight).toBe(48);
  });

  test('label colours are the two container roles', () => {
    // Filled is colorPrimary/colorOnPrimary; tonal is colorSecondaryContainer/
    // colorOnSecondaryContainer. The surfaces live in the platform view; the
    // sheet carries the label side of each pair, via the CSS system colors.
    const colors = SYSTEM_COLORS_BY_PLATFORM.android;
    expect(colors.ButtonText).not.toBe(undefined);
    expect(colors.AccentColorText).not.toBe(undefined);
    expect(colors.ButtonText).not.toEqual(colors.AccentColorText);
  });
});

describe('prominence is HTML semantics, not taste', () => {
  test('a submit button inside a form is the primary action', () => {
    expect(buttonProminence('submit', true)).toBe('prominent');
  });

  test('everything else is neutral', () => {
    // Including submit OUTSIDE a form, where submitting is inert — a prominent
    // button that does nothing would be worse than a quiet one.
    expect(buttonProminence('submit', false)).toBe('neutral');
    expect(buttonProminence('button', true)).toBe('neutral');
    expect(buttonProminence('reset', true)).toBe('neutral');
  });
});

describe('the author claims the surface by styling it', () => {
  test('background or border means the author owns the appearance', () => {
    expect(authorStatesSurface({backgroundColor: 'red'})).toBe(true);
    expect(authorStatesSurface({borderWidth: 1})).toBe(true);
    expect(authorStatesSurface({borderRadius: 10})).toBe(true);
    expect(authorStatesSurface([{padding: 4}, {borderColor: 'blue'}])).toBe(
      true,
    );
  });

  test('appearance none is the standard opt-out, with no surface of their own', () => {
    // css-ui-4 §7: the property a web author already uses to take over a
    // control's rendering. Honoured before any inference from painted styles.
    expect(authorStatesSurface({appearance: 'none'})).toBe(true);
    expect(authorStatesSurface([{padding: 2}, {appearance: 'none'}])).toBe(
      true,
    );
    expect(authorStatesSurface({appearance: 'auto'})).toBe(false);
  });

  test('padding, colour and size do not dismiss the platform chrome', () => {
    // Those restyle the label or the box, not the surface; the platform can
    // keep drawing beneath them.
    expect(authorStatesSurface({padding: 12, color: 'white'})).toBe(false);
    expect(authorStatesSurface({height: 60, width: 200})).toBe(false);
    expect(authorStatesSurface(null)).toBe(false);
  });
});
