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

/**
 * The chat composer (`Composer`) and the keyboard-accessory bar it sits in
 * (`ComposerBar`). Used by `App.js` and `screens/ChatScreen.js`.
 */

import '@react-native/expo-intrinsics-poc';

import env from '../expo-intrinsics/src/env';
import NativeButton from '../expo-intrinsics/src/NativeButton';
import NativeKeyboardAccessory from '../expo-intrinsics/src/NativeKeyboardAccessory';
import NativePopover from '../expo-intrinsics/src/NativePopover';
import NativeScroll from '../expo-intrinsics/src/NativeScroll';
import {systemColor} from '../expo-intrinsics/src/systemColors';
import {BALLOON_BLUE, accentColor, uiColor} from './uiColors';
import * as React from 'react';
import {
  Animated,
  DynamicColorIOS,
  Platform,
  PlatformColor,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';

/*
 * Duration of the pill's shrink back to one line after a send, in ms. Chosen,
 * not measured: native Messages doesn't animate it. See ui-metrics.md,
 * "Composer growth".
 */
const FIELD_SHRINK = 180;

// How long the pill keeps its height after `handoff` clears, in ms. See `held`.
const FIELD_SHRINK_DELAY = 120;

/*
 * The pill's one-line height: native Messages' 40 pt on iOS, Material's 56 dp
 * text field on Android. See ui-metrics.md, "Composer field height".
 */
const LINE = Platform.OS === 'ios' ? 40 : 56;
/*
 * iOS: native Messages' 40 pt `+` circle. Android: Material's 48 dp touch
 * target. See ui-metrics.md, "Plus button (Android)".
 */
const PLUS = Platform.OS === 'ios' ? 40 : 48;
const PLUS_GLYPH = 27;
/*
 * The `+` glyph's bar length and thickness (pt on iOS, dp on Android). Drawn
 * as two bars, not typed: SF Pro's `+` is heavier than native Messages' glyph,
 * and a text glyph in a fixed box clips at large text sizes. On iOS a 2.25 pt
 * bar renders 2.00 pt wide, which matches native Messages. See ui-metrics.md,
 * "Plus glyph".
 */
const PLUS_ICON = Platform.OS === 'ios' ? 15.3333 : 24;
const PLUS_ICON_STROKE = Platform.OS === 'ios' ? 2.25 : 2;
// The send button and caret colour: the sent balloon's bottom stop on iOS.
// See ui-metrics.md, "Send blue and caret".
const SEND_FILL = Platform.select({
  ios: DynamicColorIOS({
    light: BALLOON_BLUE.light.bottom,
    dark: BALLOON_BLUE.dark.bottom,
  }),
  android: PlatformColor('?attr/colorPrimary'),
  default: BALLOON_BLUE.light.bottom,
});
/*
 * The audio glyph colour. iOS: the placeholder colour, as in native Messages;
 * it's translucent, so it adapts to what's behind the field. Elsewhere: an
 * opaque copy of its light-mode value. See ui-metrics.md, "Composer audio
 * glyph".
 */
const MIC_TINT = Platform.select({
  ios: PlatformColor('placeholderText'),
  default: 'rgb(180, 184, 191)',
});
/*
 * The audio glyph's bar heights, width and gap, in pt. Drawn here because
 * native Messages' glyph is a ChatKit asset, not an SF Symbol, so `system:`
 * can't load it. See ui-metrics.md, "Composer audio glyph".
 */
const AUDIO_BARS = [4, 8, 16, 8, 4];
const AUDIO_BAR_W = 2;
const AUDIO_BAR_GAP = 2;
const AUDIO_H = Math.max(...AUDIO_BARS);
const AUDIO_W =
  AUDIO_BARS.length * AUDIO_BAR_W + (AUDIO_BARS.length - 1) * AUDIO_BAR_GAP;
// Native Messages' send button width, in pt. See ui-metrics.md, "Composer
// send button".
const SEND_W = 38;
/*
 * The send button's gap to the pill's edge, in pt: `SEND_INSET` above and
 * below, `SEND_INSET_TRAILING` on the right. `SEND_INSET_TRAILING` also sets
 * the field's text width; see `paddingRight` in `styles.field`. See
 * ui-metrics.md, "Composer send button".
 */
const SEND_INSET = 6;
const SEND_INSET_TRAILING = 6.5;
/*
 * Puts the audio glyph's right end 11.9 pt from the pill's right edge, as in
 * native Messages. The pill's `paddingRight` (`SEND_INSET_TRAILING`) is part
 * of that distance. See ui-metrics.md, "Composer audio glyph".
 */
const AUDIO_INSET_TRAILING = 11.9 - SEND_INSET_TRAILING;
const SEND_H = LINE - 2 * SEND_INSET;
/*
 * Native Messages' `+` card height, in pt. Used as the card's maximum height
 * (`panelMetrics`). See ui-metrics.md, "Plus card geometry".
 */
const PANEL_HEIGHT = 452;
const AnimatedScroll = Animated.createAnimatedComponent(NativeScroll);
const AnimatedDiv = Animated.createAnimatedComponent('div');
/*
 * Animated so `onDockChange` can set `barTopValue` and `barHeightValue` with
 * the native driver. The flying balloon is positioned from the bar's top and
 * height; a JS handler gets them a frame late, and the bar can move 79 pt in
 * one frame. See `drawn` in `screens/ChatScreen.js` and ui-metrics.md, "Bar
 * travel in the keyboard's first frame".
 */
const AnimatedKeyboardAccessory = Animated.createAnimatedComponent(
  NativeKeyboardAccessory,
);
/*
 * Native Messages' `+` card: inset from the screen's edges, and corner radius
 * (circular, not continuous), in pt. See ui-metrics.md, "Plus card geometry".
 */
const PANEL_CARD_INSET = 11;
const PANEL_CARD_RADIUS = 30;
/*
 * The card's list fades in on native Messages' opacity spring, starting
 * `PANEL_CONTENT_DELAY` ms after the card starts growing. Without the fade,
 * the growing card looks like a list scrolling in. See ui-metrics.md, "Plus
 * card content arrival".
 *
 * DOM-CSS-DEVIATION(panel-content-fades-without-the-blur): native Messages
 * also un-blurs the list. The transition engine can't animate `filter`, and
 * animating it from JS would cost a commit per frame.
 */
const PANEL_CONTENT_DELAY = 25;
const PANEL_CONTENT_SPRING = {mass: 1, stiffness: 203.35, damping: 28.5202};
/*
 * Native Messages' `+` card rows, in pt: row height, tile diameter, and the
 * tile's and label's x from the card's left edge. See ui-metrics.md, "Plus
 * card geometry".
 */
const PANEL_ROW = 66;
const PANEL_TILE = 38;
const PANEL_TILE_GLYPH = 18;
const PANEL_TILE_INSET = 34;
const PANEL_LABEL_X = 99;
/*
 * Native Messages' `+` card label size, in pt. Not a system text style. See
 * ui-metrics.md, "Plus card geometry".
 */
const PANEL_LABEL_SIZE = 24;
const GAP = 12;

/*
 * Which `+` implementation renders:
 *
 *   'html'   — `<button>` with a `<menu>` child.
 *   'native' — `<native:button>` (`UIButton` + `UIMenu`), for comparison.
 *   'panel'  — the `<native:popover>` card of tiles.
 *   'both'   — all three side by side.
 *
 * iOS uses 'panel' because native Messages opens a card of tiles, which a
 * `UIMenu` can't draw. `<native:popover>` is iOS-only, so Android uses
 * 'html'.
 */
const PLUS_KIND = Platform.OS === 'ios' ? 'panel' : 'html';

/*
 * The field's glass on iOS, also on the HTML `+` variant. UIKit's glass
 * container merges only its own kind: `<native:button>` builds the same
 * kind around its button, which is why the panel `+` merges with the field.
 */
const FIELD_GLASS_KEYWORD = '-apple-system-glass-material';
const showsHTMLPlus = PLUS_KIND === 'html' || PLUS_KIND === 'both';
const showsNativePlus = PLUS_KIND === 'native' || PLUS_KIND === 'both';
const showsPanelPlus = PLUS_KIND === 'panel' || PLUS_KIND === 'both';
// Maximum field height, in lines, when the host doesn't pass `getRoom`.
const FALLBACK_LINES = 5;
// The field's most lines, whatever the room: native Messages' limit
const MAX_LINES = 12;
/*
 * Height of one line of the field's text, in pt:
 * `[UIFont systemFontOfSize:17].lineHeight`. Not rounded, because
 * `FIELD_INSET` and the height limits are derived from it. See ui-metrics.md,
 * "Composer line box".
 *
 * DOM-CSS-LIMITATION(no-font-on-a-control): font styles don't reach
 * `<textarea>` (`ElementTextAreaProps` has no text props), so the field always
 * uses the 17 pt system font. Native Messages uses the same size.
 */
const LINE_HEIGHT = 20.2871;

const FIELD_INSET = (LINE - LINE_HEIGHT) / 2;
/*
 * Height of the fade at the top of the bar's material, in pt, as in native
 * Messages. See ui-metrics.md, "Composer bar top fade".
 */
const FADE = 30;
/*
 * Opacity of the bar's material (`appleVisualEffectOpacity`), 0 to 1. Lower
 * values show more of the unblurred content behind the bar. Tuned on an iOS
 * device in dark mode; the simulator renders blur differently. See
 * ui-metrics.md, "Composer bar material strength".
 */
const BAR_MATERIAL_STRENGTH = 0.7;

/*
 * No fill on iOS: `EXPMaterialSurface` would draw it on top of the bar's blur.
 * See ui-metrics.md, "Composer bar fill (Android)".
 */
const BAR_FILL = Platform.select({
  ios: undefined,
  default: 'rgba(250, 255, 255, 0.70)',
});

/*
 * Space above the pill inside the bar, in pt: none on iOS, as in native
 * Messages; 8 on Android, as in Google Messages. `screens/ChatScreen.js` adds
 * it to the flying balloon's start position. See ui-metrics.md, "Composer bar
 * top padding".
 */
export const BAR_TOP_PADDING: number = Platform.OS === 'ios' ? 0 : 8;

// The bar's side margins while it's raised on the keyboard, in pt.
export const COMPOSER_MARGIN = 16;
/**
 * Must equal `TRANSCRIPT_MARGIN` in `screens/ChatScreen.js`, so the pill's
 * right edge lines up with a sent balloon's right edge. See ui-metrics.md,
 * "Composer side margins".
 */
export const COMPOSER_MARGIN_TRAILING: number = COMPOSER_MARGIN;

/**
 * The bar's side and bottom margins when docked (keyboard down) on iOS, in pt:
 * native Messages' value, which follows the screen's rounded corner. See
 * ui-metrics.md, "Composer landmarks, docked".
 */
export const COMPOSER_CONCENTRIC = 28;

/**
 * Android has no rounded screen corner to follow, so its side margins don't
 * change when docked, as in Google Messages.
 */
export const COMPOSER_DOCKED_SIDE: number =
  Platform.OS === 'ios' ? COMPOSER_CONCENTRIC : COMPOSER_MARGIN;

/**
 * Space between the pill row and the keyboard, in pt. iOS: 16, with nothing
 * above the row, as in native Messages. Android: the top padding, so the row
 * is centred. See ui-metrics.md, "Composer raised bottom".
 */
export const COMPOSER_BOTTOM_RAISED: number =
  Platform.OS === 'ios' ? 16 : BAR_TOP_PADDING;

export const COMPOSER_DOCKED_BOTTOM: number =
  Platform.OS === 'ios' ? COMPOSER_CONCENTRIC : COMPOSER_BOTTOM_RAISED;
/**
 * @param onSend called with the trimmed text. The host must clear `value`.
 * @param actions optional `{id, label, symbol, tint, destructive, onPress}`
 *   list. If non-empty, a `+` button opens it. `symbol` is an SF Symbol name;
 *   `tint` is an `accentColor` name.
 */
export default function Composer({
  value,
  onChangeText,
  onSend,
  onFocus,
  /**
   * Called when the user taps the field and that tap gives it focus: the start
   * of composing. Focus the app restores — the `+` card handing the keyboard
   * back as it closes, a return from another app — is not one, so a host that
   * moves the transcript on the start of composing doesn't move it then.
   */
  onComposeStart,
  inputRef,
  /**
   * Focus when the composer is added to the window. Unlike calling `focus()`
   * afterwards, this keeps the keyboard up across a screen push instead of
   * dismissing it and showing it again.
   */
  autoFocus,
  /**
   * Called with the pill's `{width, height}` when it changes. A size rather
   * than a window position: on iOS the pill is in the keyboard's window, whose
   * coordinates differ from the app window's.
   */
  onFieldSize,
  /**
   * Ref to the pill `<div>`. `screens/ChatScreen.js` measures it against
   * `boxRef` to start the flying balloon on the field.
   */
  fieldRef,
  /**
   * Sent text for the field to keep showing from the send tap until the sent
   * balloon is visible. While set, typing and the send button are ignored.
   */
  handoff,
  /**
   * Set while the host is animating. The field then defers the keyboard
   * rebuild that follows a controlled clear. See `quiet` in
   * `ElementTextAreaShadowNode.h` and ui-metrics.md, "Keyboard rebuild during
   * a send".
   */
  quiet = false,
  actions = [],
  /**
   * Returns how many pt of the host's content are still visible, which is how
   * far the field may grow. Called when the field's text height changes. A
   * function, not a number, because the value changes every frame of a
   * keyboard drag.
   */
  getRoom,
}) {
  /*
   * `handoff` counts as a draft so the send button stays while the field
   * shows sent text. Removing the button would widen the field and rewrap
   * that text.
   */
  const hasDraft = value.trim() !== '' || handoff != null;
  const shown = handoff ?? value;
  // From a hook, so the panel re-renders when the text size changes.
  const {
    fontScale,
    width: windowWidth,
    height: windowHeight,
  } = useWindowDimensions();
  const tile = PANEL_TILE * fontScale;
  const tileMetrics = {
    width: tile,
    height: tile,
    borderRadius: tile / 2,
    lineHeight: tile,
    fontSize: PANEL_TILE_GLYPH * fontScale,
  };
  const glyphMetrics = {
    width: PANEL_TILE_GLYPH * fontScale,
    height: PANEL_TILE_GLYPH * fontScale,
    // Symbols aren't square; `<img>`'s default `fill` would stretch them.
    objectFit: 'contain',
  };
  const rowMetrics = {minHeight: PANEL_ROW * fontScale};
  /*
   * `height: undefined` clears `styles.panelBox`'s height, so the card is as
   * tall as its list, up to `PANEL_HEIGHT`. Labels can wrap, so the height
   * can't be computed from the row count.
   *
   * The box is the window's width, not the bar's content width it sits in:
   * the card inside it is as wide as its labels, and inside the bar's margins
   * "Load earlier messages" wrapped. See ui-metrics.md, "Plus card geometry".
   */
  const panelMetrics = {
    height: undefined,
    maxHeight: PANEL_HEIGHT,
    // The shorter side in either orientation: in landscape a card as wide as
    // the window fills the screen and leaves nowhere to tap outside it
    width: Math.min(windowWidth, windowHeight),
  };
  /*
   * `NativePopover` animates the `+` into the card (UIKit's zoom
   * transition), so nothing here animates the button.
   */
  const [panelOpen, setPanelOpen] = React.useState(false);
  const plusRef = React.useRef(null);
  // Whether the field has focus, and whether the touch now on it began while
  // it didn't. See `onComposeStart`.
  const focused = React.useRef(false);
  const tappedToFocus = React.useRef(false);
  const panelContentOpacity = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const contents = Animated.spring(panelContentOpacity, {
      toValue: panelOpen ? 1 : 0,
      useNativeDriver: true,
      delay: panelOpen ? PANEL_CONTENT_DELAY : 0,
      ...PANEL_CONTENT_SPRING,
    });
    contents.start();
    return () => {
      contents.stop();
    };
  }, [panelOpen, panelContentOpacity]);
  /*
   * `NativePopover` ignores `anchor.y`: the measured y is where the bar
   * sits with the keyboard down, not where it's drawn.
   */
  const [anchor, setAnchor] = React.useState(null);
  const openPanel = React.useCallback(() => {
    if (panelOpen) {
      setPanelOpen(false);
      return;
    }
    plusRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 0) {
        setAnchor({x, y, width, height});
      }
      setPanelOpen(true);
    });
  }, [panelOpen]);
  /*
   * The textarea's text height, from `onContentSizeChange`. The field is
   * sized by hand because `field-sizing: content` isn't implemented.
   */
  const [contentHeight, setContentHeight] = React.useState(0);
  /*
   * The field's maximum height: `grown + getRoom()`, updated when the text
   * height changes. `getRoom()` shrinks as the field grows (the field's height
   * is the transcript's bottom inset), but the sum stays the same, so the
   * limit doesn't oscillate.
   */
  const grownRef = React.useRef(LINE);
  const [ceiling, setCeiling] = React.useState(null);
  // `contentHeight` doesn't include the field's padding. Capped at the
  // field's own `maxHeight` too: the room can be taller than 12 lines, and
  // the pill (`pillHeight`) follows this while the field stops at its limit
  const grown = Math.min(
    Math.max(contentHeight + 2 * FIELD_INSET, LINE),
    ceiling ?? LINE + (FALLBACK_LINES - 1) * LINE_HEIGHT,
    LINE + (MAX_LINES - 1) * LINE_HEIGHT,
  );
  grownRef.current = grown;
  /*
   * After a send, the pill keeps its height for `FIELD_SHRINK_DELAY` after
   * `handoff` clears, then shrinks. A height transition that starts while the
   * send's other state updates are still committing is cut off by them and
   * jumps.
   */
  const [held, setHeld] = React.useState(null);
  const heldFrom = React.useRef(null);
  React.useEffect(() => {
    if (handoff != null) {
      heldFrom.current = grownRef.current;
      return;
    }
    const from = heldFrom.current;
    heldFrom.current = null;
    if (from == null || from <= LINE + 0.5) {
      return;
    }
    setHeld(from);
    const timer = setTimeout(() => setHeld(null), FIELD_SHRINK_DELAY);
    return () => clearTimeout(timer);
  }, [handoff]);

  const previousGrown = React.useRef(grown);
  const shrinkingUntil = React.useRef(0);
  const now = Date.now();
  const pillHeight = held ?? grown;
  if (pillHeight < previousGrown.current - 0.5) {
    shrinkingUntil.current = now + FIELD_SHRINK + 40;
  }
  /*
   * Stays true for the length of the shrink. The duration must be set in the
   * same commit as the height change, and a later commit with `0ms` would end
   * the transition early.
   */
  const shrinking = now < shrinkingUntil.current;
  React.useEffect(() => {
    previousGrown.current = pillHeight;
  });
  return (
    /*
     * `box-none` so touches between the controls reach the keyboard
     * accessory, which lets a drag down from the composer dismiss the
     * keyboard.
     */
    <div style={styles.row} pointerEvents="box-none">
      {actions.length > 0 && showsHTMLPlus && (
        /*
         * On a `<button>`, `appleVisualEffect` makes a UIKit glass button,
         * which draws the glass under the label. The platform draws the
         * `<menu>`.
         */
        <button
          type="button"
          style={styles.plus}
          appleVisualEffect={FIELD_GLASS_KEYWORD}
          accessibilityLabel={PLUS_KIND === 'both' ? 'More, HTML' : 'More'}>
          <div style={styles.plusIcon}>
            <div style={styles.plusBarH} />
            <div style={styles.plusBarV} />
          </div>
          <menu>
            {actions.map(action => (
              <li
                key={action.id}
                id={action.id}
                icon={`system:${action.symbol}`}
                destructive={action.destructive === true}
                onClick={action.onPress}>
                {action.label}
              </li>
            ))}
          </menu>
        </button>
      )}
      {actions.length > 0 && showsNativePlus && (
        <NativeButton
          configuration="glass"
          title="+"
          titleSize={PLUS_GLYPH}
          style={styles.plus}
          accessibilityLabel={PLUS_KIND === 'both' ? 'More, native' : 'More'}
          commands={actions.map(action => ({
            id: action.id,
            label: action.label,
            destructive: action.destructive === true,
          }))}
          onCommand={id => {
            const chosen = actions.find(action => action.id === id);
            chosen?.onPress();
          }}
        />
      )}
      {actions.length > 0 && showsPanelPlus && (
        /*
         * A `<native:button>`: an interactive glass effect view hosting a
         * plain `UIButton` whose "+" is its own configuration, as the native
         * chat's `+` is. The press and the card's zoom carry the glyph with the
         * glass; a `<button>` with children drew the glyph above the glass, and
         * it stayed behind while the glass morphed.
         */
        <NativeButton
          ref={plusRef}
          configuration="glass"
          title="+"
          titleSize={PLUS_GLYPH}
          style={styles.plus}
          accessibilityLabel={PLUS_KIND === 'both' ? 'More, panel' : 'More'}
          onPress={openPanel}
        />
      )}
      {/*
        `collapsable={false}` keeps this `<div>` as the textarea's parent view.
        If Fabric flattens it, touches on the field don't reach the interactive
        glass, and nothing looks wrong.
      */}
      <div
        collapsable={false}
        ref={fieldRef}
        style={[
          styles.glass,
          shrinking ? styles.glassShrinking : styles.glassSettled,
          // `held` keeps the old height briefly after a send.
          {height: pillHeight},
        ]}
        onLayout={event => {
          const {width, height} = event.nativeEvent.layout;
          onFieldSize?.({width, height});
        }}
        appleVisualEffect={FIELD_GLASS_KEYWORD}>
        <textarea
          ref={inputRef}
          autoFocus={autoFocus}
          quiet={quiet}
          // HTML's default is 2 rows.
          rows={1}
          /*
           * Native Messages' caret is the send button's blue. Unset, UIKit
           * uses the app's tint colour.
           */
          caretColor={SEND_FILL}
          onContentSizeChange={event => {
            setContentHeight(event.nativeEvent.contentSize.height);
            // Updated from the same event so both state changes render
            // together. See `ceiling`.
            const room = getRoom?.();
            if (room != null) {
              setCeiling(Math.max(LINE, grownRef.current + room));
            }
          }}
          style={[styles.field, {height: grown}]}
          placeholder="Message"
          value={shown}
          // `onInput` fires on every keystroke (`onChange` fires on commit, as
          // in HTML). Ignored while `handoff` is set: the field is showing the
          // sent text, and a keystroke would be added to it.
          onInput={event => {
            if (handoff != null) {
              return;
            }
            onChangeText(event.nativeEvent.value);
          }}
          onPointerDown={() => {
            // Only a tap on a field that doesn't have focus starts composing
            tappedToFocus.current = !focused.current;
          }}
          onPointerCancel={() => {
            tappedToFocus.current = false;
          }}
          onFocus={event => {
            focused.current = true;
            if (tappedToFocus.current) {
              tappedToFocus.current = false;
              onComposeStart?.();
            }
            onFocus?.(event);
          }}
          onBlur={() => {
            focused.current = false;
            tappedToFocus.current = false;
          }}
        />
        {/*
          Decoration only: there's no audio recording behind it, so it isn't a
          button.
        */}
        {!hasDraft && AUDIO_GLYPH}
        {hasDraft && (
          <button
            type="button"
            style={styles.send}
            accessibilityLabel="Send"
            onClick={() => {
              // `handoff` is set: this message has already been sent.
              if (handoff != null) {
                return;
              }
              onSend(value.trim());
            }}>
            {/*
              U+2191, not `system:arrow.up`: no `arrow.up` weight matches
              native Messages' arrow. See ui-metrics.md, "Send arrow ink".
            */}
            <span style={styles.glyph}>↑</span>
          </button>
        )}
      </div>
      <NativePopover
        visible={panelOpen}
        anchor={anchor}
        onClose={() => setPanelOpen(false)}
        style={[styles.panelBox, panelMetrics]}>
        <div style={styles.panelCard}>
          <AnimatedScroll
            style={[styles.panelList, {opacity: panelContentOpacity}]}>
            {actions.map(action => (
              <button
                key={action.id}
                type="button"
                style={[styles.panelItem, rowMetrics]}
                // The iOS UI tests find rows by this label.
                aria-label={action.label}
                onClick={() => {
                  setPanelOpen(false);
                  action.onPress();
                }}>
                <div
                  aria-hidden={true}
                  style={[
                    styles.panelTile,
                    // Not `em` units: those only work for `font-size` here.
                    tileMetrics,
                    action.tint != null && {
                      backgroundColor: accentColor(action.tint),
                    },
                    action.destructive === true && styles.panelTileDestructive,
                  ]}>
                  {/*
                    An `<img>`, not a text glyph: flexbox centres an image
                    exactly, while a glyph is centred by its font's line box.
                    See `expo-intrinsics/__docs__/SymbolSource.md`.
                  */}
                  <img
                    src={`system:${action.symbol ?? 'circle'}`}
                    tintColor="#ffffff"
                    style={glyphMetrics}
                  />
                </div>
                <span style={styles.panelLabel}>{action.label}</span>
              </button>
            ))}
          </AnimatedScroll>
        </div>
      </NativePopover>
    </div>
  );
}

/**
 * The keyboard-accessory bar that holds a `Composer`: its material, top fade
 * and margins, which change when the keyboard docks.
 */
export function ComposerBar({
  children,
  /** Rendered in `styles.flightLayer`; used for the flying balloon. */
  overlay,
  /** Ref to the `styles.flightLayer` view, measured against `boxRef`. */
  flightLayerRef,
  /** Ref to the keyboard accessory. */
  boxRef,
  /**
   * Called with the bar's drawn top (app-window y) and height, in pt, on every
   * frame the bar moves. Layout measurements are wrong while the keyboard
   * animates.
   */
  onBarTop,
  /*
   * Animated values for the same top and height, set by the native driver.
   * They update a frame before `onBarTop`. Pass both or neither; they are
   * read only on the first render.
   */
  barTopValue,
  barHeightValue,
}: {
  children: React.Node,
  overlay?: React.Node,
  flightLayerRef?: {current: mixed},
  boxRef?: {current: mixed},
  onBarTop?: (top: number, height: number) => void,
  barTopValue?: mixed,
  barHeightValue?: mixed,
}): React.Node {
  /*
   * `onDockChange`'s `docked`: 1 with the keyboard down, 0 with it up,
   * fractional in between. `Keyboard` events can't provide this; see
   * `ExpoKeyboardAccessoryEventEmitter.h`. An `Animated.Value` because it
   * changes every frame of the keyboard animation.
   */
  const docked = React.useRef(new Animated.Value(1)).current;
  /*
   * Created once: passing a new native-driven `Animated.event` re-attaches it
   * to the view, and a new one per render would do that on every keystroke.
   * `onBarTop` is read through `heard` so it can still change.
   */
  const heard = React.useRef(onBarTop);
  heard.current = onBarTop;
  const onDockChange = React.useRef(null);
  if (onDockChange.current == null) {
    const tell = event => {
      docked.setValue(event.nativeEvent.docked);
      const {top, height} = event.nativeEvent;
      if (typeof top === 'number' && typeof height === 'number') {
        heard.current?.(top, height);
      }
    };
    onDockChange.current =
      barTopValue != null && barHeightValue != null
        ? Animated.event(
            [{nativeEvent: {top: barTopValue, height: barHeightValue}}],
            {useNativeDriver: true, listener: tell},
          )
        : tell;
  }
  /*
   * `paddingBottom` is the whole distance to the screen's bottom edge; the
   * accessory adds no safe-area inset (`automaticInsets={false}`). Docked on
   * iOS it's 28 pt, less than the 34 pt safe area, as in native Messages. See
   * ui-metrics.md, "Composer bottom padding".
   */
  const padding = {
    paddingLeft: docked.interpolate({
      inputRange: [0, 1],
      outputRange: [COMPOSER_MARGIN, COMPOSER_DOCKED_SIDE],
    }),
    paddingRight: docked.interpolate({
      inputRange: [0, 1],
      outputRange: [COMPOSER_MARGIN_TRAILING, COMPOSER_DOCKED_SIDE],
    }),
    paddingBottom: docked.interpolate({
      inputRange: [0, 1],
      outputRange: [COMPOSER_BOTTOM_RAISED, COMPOSER_DOCKED_BOTTOM],
    }),
  };
  return (
    <AnimatedKeyboardAccessory
      /*
       * A blur material, not a fill, because native Messages blurs what's
       * under the bar. It's on the accessory, not a child box: docked, the
       * accessory extends below React's content through the home indicator
       * area, and a child's material would stop short of the screen's edge.
       */
      appleVisualEffectOpacity={BAR_MATERIAL_STRENGTH}
      appleVisualEffect="-apple-system-blur-material-chrome"
      appleVisualEffectFade={FADE}
      // `padding` already includes the home indicator area.
      automaticInsets={false}
      ref={boxRef}
      style={styles.bar}
      onDockChange={onDockChange.current}>
      {/*
        First child, so the field and `+` draw over the flying balloon, as in
        native Messages. `collapsable={false}` because `flightLayerRef` is
        measured while this view is empty, and Fabric removes an empty view
        that draws nothing.
      */}
      <div ref={flightLayerRef} collapsable={false} style={styles.flightLayer}>
        {overlay}
      </div>
      {/*
        `-apple-system-glass-container` merges the `+` and field glass when a
        press brings them within 12 pt. Not on the accessory: its own fill or
        material would draw over the merged glass. `AnimatedDiv` wraps a host
        `<div>` because wrapping a composite component sends the animated
        padding to the wrong view.
      */}
      <AnimatedDiv
        collapsable={false}
        appleVisualEffect="-apple-system-glass-container"
        /*
         * Read by `MaterialCheck.swift` for the bar's top edge. On this box
         * because on iOS the accessory's own view is hidden and only its
         * children are drawn (in the keyboard's window).
         */
        testID="composer-bar"
        style={[styles.barBox, padding]}>
        {children}
      </AnimatedDiv>
    </AnimatedKeyboardAccessory>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: BAR_FILL,
    display: 'flex',
    flexDirection: 'column',
  },
  /*
   * Pinned to the bar's bottom, which stays put when the pill shrinks (the bar
   * gets shorter from the top). `screens/ChatScreen.js` positions the flying
   * balloon from this edge (`barBottom`).
   */
  flightLayer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 0,
    pointerEvents: 'none',
  },

  barBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    paddingTop: BAR_TOP_PADDING,
    /*
     * Landscape safe-area insets, as margins so they add to `padding`
     * (`env()` can't be used inside `calc()`) and the bar's background still
     * spans the screen. See ui-metrics.md, "Composer landscape insets".
     */
    marginLeft: env('safe-area-inset-left'),
    marginRight: env('safe-area-inset-right'),
  },
  row: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: GAP,
  },
  // The pill. `display: 'flex'` because a `<div>` is block by default here.
  glass: {
    /*
     * Android has no glass, so the pill gets Google Messages' fill
     * (`systemGray5` maps to `colorSurfaceContainerHighest`). See
     * ui-metrics.md, "Composer field fill (Android)".
     */
    ...Platform.select({
      ios: null,
      default: {backgroundColor: uiColor('systemGray5')},
    }),
    display: 'flex',
    flexDirection: 'row',
    /*
     * iOS: no background colour or shadow. A background colour draws above the
     * glass and hides its press effect. A shadow on a translucent view shows
     * as a bright rectangle inside the pill.
     */
    alignItems: 'stretch',
    flex: 1,
    paddingRight: SEND_INSET_TRAILING,
    borderRadius: LINE / 2,
    // Duration comes from `glassShrinking` / `glassSettled`.
    transitionProperty: 'height',
    transitionTimingFunction: 'ease-out',
    /*
     * DOM-CSS-LIMITATION(clipping-eats-the-shadow): on iOS, `overflow: hidden`
     * sets `masksToBounds`, which also clips a `box-shadow` (CSS draws it
     * outside the box). The pill doesn't set `overflow`; `EXPMaterialSurface`
     * clips the glass to the radius.
     */
  },
  field: {
    flex: 1,
    minHeight: LINE,
    /*
     * Must be a style (Yoga) limit: only that turns on `RCTUITextView`
     * scrolling. A native height limit crops the text instead.
     */
    maxHeight: LINE + (MAX_LINES - 1) * LINE_HEIGHT,
    /*
     * Per edge, not `borderWidth`: the user-agent style sets each edge, and
     * Yoga lets a per-edge value beat a shorthand from any style layer.
     */
    borderTopWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    /*
     * Native Messages' caret inset, in pt. `lineFragmentPadding` is 0, so this
     * is the whole inset. See ui-metrics.md, "Composer text insets".
     */
    paddingLeft: 16,
    /*
     * Set so the field's text width equals a sent balloon's, and a message
     * doesn't rewrap when sent. The field's width also depends on `SEND_W`,
     * `SEND_INSET_TRAILING`, `paddingLeft`, `PLUS`, `GAP` and the bar margins;
     * the balloon's on `BALLOON_PLUS_RESERVE` and `BUBBLE_PADDING` in
     * `screens/ChatScreen.js`. `WrapCheck.swift` checks they match. See
     * ui-metrics.md, "Text column: composer field vs balloon".
     */
    paddingRight: 5,
    // Per edge, like the borders.
    paddingTop: FIELD_INSET,
    paddingBottom: FIELD_INSET,
    backgroundColor: 'transparent',
    color: systemColor('FieldText'),
  },
  plus: {
    width: PLUS,
    height: PLUS,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    /*
     * No `borderRadius` on Android: there any radius counts as a custom
     * surface (`authorStatesSurface` in `expo-intrinsics/src/Button.js`) and
     * turns off Material's button background and ripple.
     */
    ...Platform.select({
      ios: {borderRadius: PLUS / 2},
      default: {marginBottom: (LINE - PLUS) / 2},
    }),
  },
  /*
   * Growing uses `0ms` (no animation), as in native Messages. The pill's
   * height is also the accessory's, which UIKit animates with the keyboard,
   * and animating it here too makes it jitter. Both styles set a duration
   * because a transition uses the style after the change.
   */
  glassShrinking: {transitionDuration: `${FIELD_SHRINK}ms`},
  glassSettled: {transitionDuration: '0ms'},

  plusIcon: {
    width: PLUS_ICON,
    height: PLUS_ICON,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusBarH: {
    position: 'absolute',
    width: PLUS_ICON,
    height: PLUS_ICON_STROKE,
    borderRadius: PLUS_ICON_STROKE / 2,
    /*
     * `label`, not native Messages' grey `#858E99`, which is too faint on
     * glass. See ui-metrics.md, "Plus glyph colour".
     */
    backgroundColor: uiColor('label'),
  },
  plusBarV: {
    position: 'absolute',
    width: PLUS_ICON_STROKE,
    height: PLUS_ICON,
    borderRadius: PLUS_ICON_STROKE / 2,
    backgroundColor: uiColor('label'),
  },
  // Bottom-aligned for the same reason as `styles.send`.
  audio: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: AUDIO_BAR_GAP,
    width: AUDIO_W,
    height: AUDIO_H,
    alignSelf: 'flex-end',
    marginRight: AUDIO_INSET_TRAILING,
    marginBottom: (LINE - AUDIO_H) / 2,
  },
  audioBar: {
    width: AUDIO_BAR_W,
    backgroundColor: MIC_TINT,
    borderRadius: AUDIO_BAR_W / 2,
  },
  /*
   * Bottom-aligned with a margin rather than centred, so the button stays on
   * the last line as the field grows.
   */
  send: {
    width: SEND_W,
    height: SEND_H,
    borderRadius: SEND_H / 2,
    alignSelf: 'flex-end',
    marginBottom: SEND_INSET,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    backgroundColor: SEND_FILL,
  },
  panelBox: {
    // Cleared by `panelMetrics`.
    height: PANEL_HEIGHT,
    display: 'flex',
    flexDirection: 'column',
    paddingTop: PANEL_CARD_INSET,
  },
  /*
   * iOS: the card is the popover's own glass platter, which `NativePopover`
   * presents around this box's first child and animates the `+` into. A
   * background colour here would cover that glass, so only Android sets one,
   * with the radius Android draws.
   */
  panelCard: {
    display: 'flex',
    flexShrink: 1,
    /*
     * No fixed width: the demo's labels are longer than native Messages', so
     * the card sizes to them — and not to the box, which is the window's width.
     */
    alignSelf: 'flex-start',
    marginLeft: PANEL_CARD_INSET,
    marginRight: PANEL_CARD_INSET,
    marginBottom: PANEL_CARD_INSET,
    borderRadius: PANEL_CARD_RADIUS,
    backgroundColor: Platform.select({
      ios: 'transparent',
      default: uiColor('secondarySystemGroupedBackground'),
    }),
    // Android only; on iOS the glass has its own shadow.
    ...Platform.select({
      ios: {},
      default: {boxShadow: '0 8px 24px rgba(0, 0, 0, 0.16)'},
    }),
    overflow: 'hidden',
  },
  panelList: {flex: 1, paddingVertical: PANEL_CARD_INSET},
  panelItem: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: PANEL_ROW,
    paddingLeft: PANEL_TILE_INSET,
    paddingRight: 16,
    gap: PANEL_LABEL_X - PANEL_TILE_INSET - PANEL_TILE,
    // Otherwise each `<button>` gets the platform's button background.
    appearance: 'none',
  },
  panelTile: {
    display: 'flex',
    width: PANEL_TILE,
    height: PANEL_TILE,
    /*
     * Otherwise a long label at large text sizes squeezes the tile into an
     * oval.
     */
    flexShrink: 0,
    borderRadius: PANEL_TILE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: uiColor('systemBlue'),
  },
  panelTileDestructive: {backgroundColor: uiColor('systemRed')},
  panelLabel: {
    flex: 1,
    fontSize: PANEL_LABEL_SIZE,
    color: uiColor('label'),
    // `<button>` centres its text by default.
    textAlign: 'left',
  },
  // `lineHeight: SEND_H` centres the arrow vertically in the button.
  glyph: {
    fontSize: 22,
    fontWeight: '600',
    color: '#ffffff',
    lineHeight: SEND_H,
  },
});

// Must stay below `styles`, which it reads at module scope.
const AUDIO_GLYPH = (
  <div aria-hidden={true} style={styles.audio}>
    {AUDIO_BARS.map((height, index) => (
      <div key={index} style={[styles.audioBar, {height}]} />
    ))}
  </div>
);
