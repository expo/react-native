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
 * A small app whose window reaches its own edges.
 *
 * RN Tester cannot answer the safe-area question: measured there, its scroll
 * view sits at y=535 with a height of 1631 in a 2400-tall window whose bars are
 * [0,136,0,63] — it never overlaps one, so the reservation correctly computes
 * zero and there is nothing to look at. This app draws edge to edge so the same
 * code has something to reserve.
 *
 * ## It is written in the elements, not in `View` and `Text`
 *
 * Every box here is a `<div>`, every run of prose is a `<p>` or a bare string,
 * every control is a `<button>` and every link is an `<a>`. That is the point:
 * this is the demo for those elements, and a demo written in the primitives
 * they replace would be evidence that they are not ready.
 *
 * It is not only tidier. Three things on this screen are better for it:
 *
 *  - `<button>` draws its own press state NATIVELY, at the view level. A
 *    `Pressable` setting `opacity` from React state puts a render between the
 *    finger landing and anything happening.
 *  - `<button>` and `<a>` announce themselves to VoiceOver by being what they
 *    are. A `Pressable` wrapping a `<Text>` announces nothing, and has to be
 *    told its own role.
 *  - Colours come from the CSS system palette, so the app follows the platform
 *    into dark mode instead of carrying a table of light-mode hexes.
 */

import '@react-native/expo-intrinsics-poc';

import env from '../expo-intrinsics/src/env';
import NativeScroll from '../expo-intrinsics/src/NativeScroll';
import {systemColor} from '../expo-intrinsics/src/systemColors';
import Composer, {ComposerBar} from './Composer';
import ChatScreen from './screens/ChatScreen';
import VirtualizedScreen from './screens/VirtualizedScreen';
import {uiColor} from './uiColors';
import * as React from 'react';
import {useCallback, useRef, useState} from 'react';
import {Platform, StyleSheet, UIManager} from 'react-native';

/**
 * The header's colours on Android, where the platform's own are not agreed.
 *
 * `react-native-screens` paints the toolbar with `colorPrimary` — the Material 2
 * app bar, a filled brand-coloured strip — and leaves the title the theme's
 * on-surface ink. Under a Material 3 theme those two disagree: dark text on a
 * deep primary. Material 3's top app bar is a SURFACE with on-surface ink, so
 * that is what is stated here, for the title and for the back chevron alike.
 *
 * iOS gets nothing: its bar is the system's own translucent material, and a
 * colour of any kind would replace it with a solid one.
 */
const HEADER_COLOURS =
  Platform.OS === 'ios'
    ? null
    : {
        backgroundColor: uiColor('systemBackground'),
        titleColor: uiColor('label'),
        color: uiColor('label'),
      };

const ROWS = 10;

function Row({index}) {
  return <div style={styles.contentRow}>{'row ' + index}</div>;
}

/*
 * The navigator, required rather than imported — and then ASKED FOR.
 *
 * `react-native-screens` is not autolinked on Android in this repo yet (an
 * unresolved vtable in `RNSFullWindowOverlay`), and a top-level import takes the
 * whole app down at startup there. So the stack is optional: iOS gets the real
 * native navigator, Android gets the same screens without one, and neither
 * needs a separate copy of the screens themselves.
 *
 * The `try` alone is not enough, though it reads as though it were. The
 * JavaScript package resolves perfectly well on Android — it is in
 * `node_modules` — so nothing throws, `screens` comes back non-null, and the
 * app mounts a `<ScreenStackHeaderConfig>` with no view manager behind it and
 * red-boxes the surface at startup. What is missing is the NATIVE half, and the
 * only way to find that out is to ask about the native half.
 */
let screens = null;
try {
  screens = require('react-native-screens');
  // `hasViewManagerConfig` is a capability query rather than a lookup: it
  // answers without the soft error that fetching a missing config raises.
  if (UIManager.hasViewManagerConfig('RNSScreenStackHeaderConfig') !== true) {
    screens = null;
  } else {
    screens.enableScreens(true);
  }
} catch {
  screens = null;
}

/**
 * The whole app on ONE native stack.
 *
 * Every screen is a real `Screen` in a real `ScreenStack`, including the home
 * screen — which is what gives it the platform's large title, its collapse on
 * scroll, and a genuine back button with the interactive swipe, rather than a
 * row of blue words that only look like navigation.
 *
 * The large title matters for what this app is FOR, and not by getting in the
 * way of it. An iOS large title is translucent and content scrolls UNDER it, so
 * the scroll view still runs to the top of the window and still has a top inset
 * to reserve — the demo's subject survives, and gets more realistic for having a
 * real header above it instead of nothing.
 */
export default function App({seedMessages, initialScreen, initialProfiling}) {
  // `initialScreen` arrives with `seedMessages` from the launch environment —
  // a test-only fast path past the home screen; a person always starts at
  // 'insets'. The home screen is still beneath, so popping back works.
  const [screen, setScreen] = useState(initialScreen ?? 'insets');
  /*
   * How long the chat's conversation is: the launch environment's number for
   * the tests, or the home screen's picker, which is how a long conversation
   * is opened on a phone.
   */
  const [seed, setSeed] = useState(seedMessages ?? 3);
  /*
   * Whether the chat measures itself and shows what it found. Off unless asked
   * for: the counting is cheap but a demo should not spend its frames on it,
   * and the banner covers the top of the transcript.
   */
  const [showsPerformance, setShowsPerformance] = useState(
    initialProfiling === true,
  );
  /*
   * The message the reader is showing, if any.
   *
   * A message too long to draw in a balloon is previewed there and read here,
   * which is the shape the platform's own chat gives it — the preview, the
   * chevron and the pushed plain-text screen were all observed directly on the
   * simulator. The reader is its own pushed screen, not a variant of the
   * balloon: a truncated balloon is a preview with a chevron, and the length
   * rule lives with the message, not with the balloon class that draws it.
   *
   * Kept on the app rather than on the chat screen because the reader is a
   * SCREEN, and screens live here.
   */
  const [readerMessage, setReaderMessage] = useState(null);
  const openReader = useCallback(message => {
    setReaderMessage(message);
    setScreen('reader');
  }, []);

  if (screens == null) {
    // Android, for now: the same screens, stacked by state instead.
    if (screen === 'chat') {
      return (
        <ChatScreen
          seedMessages={seed}
          showsPerformance={showsPerformance}
          onExit={() => setScreen('insets')}
          onOpenReader={openReader}
        />
      );
    }
    if (screen === 'virtualized') {
      return <VirtualizedScreen onExit={() => setScreen('insets')} />;
    }
    return (
      <InsetsScreen
        onGo={setScreen}
        seed={seed}
        onSeed={setSeed}
        showsPerformance={showsPerformance}
        onShowPerformance={setShowsPerformance}
      />
    );
  }

  const {Screen, ScreenStack, ScreenStackHeaderConfig} = screens;
  return (
    <ScreenStack style={styles.fill}>
      <Screen key="home" style={StyleSheet.absoluteFill}>
        {/*
          Translucent, so the screen's content runs UNDER the bar rather than
          starting below it — which is what makes a large title collapse as you
          scroll, and what puts the scroll view's own top edge at the top of the
          window where it belongs.

          Nothing here computes the header's height. A translucent bar is part
          of the view controller's safe area, so UIKit publishes it through
          `safeAreaInsets` and `<native:scroll>` already reserves whatever it
          finds there — the same path that reserves the status bar and the
          keyboard. Measuring the header and subtracting it by hand would be a
          second source of truth for a number the platform already states.
        */}
        <ScreenStackHeaderConfig
          {...HEADER_COLOURS}
          title="Safe areas"
          largeTitle={true}
          translucent={true}
          /*
           * Transparent, through iOS's own nav-bar appearance API.
           *
           * `react-native-screens` calls `configureWithTransparentBackground` on
           * the `UINavigationBarAppearance` when — and only when — a background
           * colour is given with zero alpha; with no colour at all it calls
           * `configureWithOpaqueBackground`, which is a solid bar whatever
           * `translucent` says. So "transparent" here is a colour, and the
           * platform draws the rest.
           */
          /*
           * Translucent with no colour: the system's own bar background — Liquid
           * Glass — with the large title floating over the content and the scroll
           * view's soft edge fading it. A transparent bar has no backdrop of its
           * own; on iOS 27 the soft effect beneath it is a fade, not a blur that
           * fills the bar.
           */
        />
        <InsetsScreen
          onGo={setScreen}
          seed={seed}
          onSeed={setSeed}
          showsPerformance={showsPerformance}
          onShowPerformance={setShowsPerformance}
        />
      </Screen>
      {screen === 'chat' && (
        <Screen
          key="chat"
          style={StyleSheet.absoluteFill}
          stackPresentation="push"
          // The system's own back — the button, the title, and the interactive
          // swipe — so dismissing by gesture and by button land in one place.
          onDismissed={() => setScreen('insets')}>
          <ScreenStackHeaderConfig
            {...HEADER_COLOURS}
            title="Chat"
            /*
             * The chevron alone. `backTitleVisible={false}` is a kill switch in
             * `react-native-screens`: it forces `backButtonDisplayMode=minimal`,
             * which is UIKit's own "icon only" mode rather than a blank title
             * pushed into the label.
             */
            backTitleVisible={false}
            translucent={true}
          />
          <ChatScreen
            seedMessages={seed}
            showsPerformance={showsPerformance}
            onOpenReader={openReader}
          />
        </Screen>
      )}
      {screen === 'reader' && readerMessage != null && (
        <Screen
          key="reader"
          style={StyleSheet.absoluteFill}
          stackPresentation="push"
          onDismissed={() => setScreen('chat')}>
          <ScreenStackHeaderConfig
            {...HEADER_COLOURS}
            /*
             * The message's own opening words, as the native reader titles it —
             * and truncated the same way, because a title is one line whatever
             * the message is.
             */
            title={readerTitle(readerMessage.text)}
            backTitleVisible={false}
            translucent={true}
          />
          <ReaderScreen text={readerMessage.text} />
        </Screen>
      )}
      {screen === 'virtualized' && (
        <Screen
          key="virtualized"
          style={StyleSheet.absoluteFill}
          stackPresentation="push"
          onDismissed={() => setScreen('insets')}>
          <ScreenStackHeaderConfig
            {...HEADER_COLOURS}
            title="Virtualized rows"
            backTitleVisible={false}
            translucent={true}
          />
          <VirtualizedScreen />
        </Screen>
      )}
    </ScreenStack>
  );
}

/**
 * What `env()` resolved to, as a value in a list row.
 *
 * A bar as tall as the inset it stands for has to be MEASURED against something
 * to be read, and a coloured rectangle in the middle of a settings screen reads
 * as decoration rather than as a reading. The number is the point, so it is a
 * value in a row, where a number on this screen belongs.
 *
 * Still `env()` doing the work — the height of a hidden probe rather than
 * anything JavaScript measured — because that is the claim being demonstrated.
 */
function EnvReadout() {
  const [sizes, setSizes] = useState({top: null, bottom: null});
  // Guarded: a layout event with nothing in it is not worth a red box, and the
  // reading is a diagnostic rather than the thing being demonstrated.
  const measure = edge => event => {
    const height = event?.nativeEvent?.layout?.height;
    if (height == null) {
      return;
    }
    setSizes(previous => ({...previous, [edge]: Math.round(height)}));
  };
  return (
    <React.Fragment>
      {/* The probes: boxes whose HEIGHT is the env value, so a wrong reading and
          a wrong layout cannot disagree. Zero-width and hidden from
          accessibility — they are an instrument, not content. */}
      <div style={styles.probe} accessibilityElementsHidden={true}>
        <div
          style={{height: env('safe-area-inset-top')}}
          onLayout={measure('top')}
        />
        <div
          style={{height: env('safe-area-inset-bottom')}}
          onLayout={measure('bottom')}
        />
      </div>
      <ValueRow label="env(safe-area-inset-top)" value={sizes.top} />
      <ValueRow
        label="env(safe-area-inset-bottom)"
        value={sizes.bottom}
        last={true}
      />
    </React.Fragment>
  );
}

/** A list row whose trailing edge is a measured number. */
function ValueRow({label, value, last}) {
  return (
    <div style={[styles.row, last !== true && styles.rowSeparated]}>
      <span style={styles.rowLabel}>{label}</span>
      <span style={[styles.rowValue, styles.tabular]}>
        {value == null ? '—' : value + 'pt'}
      </span>
    </div>
  );
}

/**
 * A link that navigates within the app.
 *
 * Written as `<a href>` with an `onClick` that calls `preventDefault()`, which
 * is how a router link is built and what the element's ordering is FOR: the
 * handler runs first, and the href is only followed if nothing claimed the
 * click. Writing `<a>` with no href would be a different element — the spec is
 * explicit that an anchor without one is a placeholder, not a link.
 */
function NavLink({to, children, onGo, last}) {
  return (
    <a
      href={`chatdemo://${to}`}
      onClick={event => {
        event.preventDefault();
        onGo(to);
      }}
      style={[styles.row, last !== true && styles.rowSeparated]}>
      <span style={styles.rowLabel}>{children}</span>
      {/* Decorative, and hidden from the name the row now computes from its
          contents — otherwise VoiceOver reads "Chat, with a composer, ›".
          On a `<div>` rather than the `<span>`: the flag reaches a box's view
          and is not forwarded through an inline element. */}
      <div accessibilityElementsHidden={true}>
        <span style={styles.navChevron}>›</span>
      </div>
    </a>
  );
}

/**
 * An inset grouped list, the way iOS actually builds one.
 *
 * Not a `<fieldset>`. A fieldset groups form CONTROLS for submission, and it
 * came with a border, a legend and a page-coloured fill that had to be undone
 * to look like anything — the semantics were right and the result was a box
 * inside a box. What this is, is a section of a settings list: a plain heading
 * sitting on the page above a rounded card. That is a presentational
 * arrangement, so it is built out of presentational elements and named for what
 * it is.
 *
 * The pieces that make it read as native rather than as a web page:
 *
 *  - the heading is OUTSIDE the card, on the page colour, not a legend notched
 *    into a border;
 *  - the card is inset from both edges and rounded, and clips its rows;
 *  - separators run BETWEEN rows only and start at the label's left edge, not
 *    at the card's — a line running the full width is the giveaway;
 *  - rows are 44 points tall, which is the platform's touch target and also
 *    what makes a list of them look like a list.
 */
function Section({title, children}) {
  return (
    <div style={styles.section}>
      <h2 style={styles.sectionTitle}>{title}</h2>
      <div style={styles.card}>{children}</div>
    </div>
  );
}

/** A row whose trailing edge is a control. */
function SettingRow({label, htmlFor, children, last}) {
  return (
    <div style={[styles.row, last !== true && styles.rowSeparated]}>
      <label htmlFor={htmlFor} style={styles.rowLabel}>
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * A row that DOES something.
 *
 * Blue label, full width, no button chrome. In a grouped list the platform's
 * own action rows are exactly this: the row is the target and the label carries
 * the tint. A chrome button sitting inside a list row would be the un-native
 * thing here.
 */
function ActionRow({label, onPress, last, tabular}) {
  return (
    <button
      type="button"
      onClick={onPress}
      style={[
        styles.row,
        styles.actionRow,
        last !== true && styles.rowSeparated,
        tabular === true && styles.tabular,
      ]}>
      {label}
    </button>
  );
}

function LegendRow({swatch, children}) {
  return (
    <div style={styles.legendRow}>
      <div style={[styles.swatch, swatch]} />
      <span style={styles.legendText}>{children}</span>
    </div>
  );
}

/**
 * The safe-area screen, arranged so its own geometry is visible.
 *
 * The three quantities have three colours and nothing else does — a red outline
 * is the scroll view's own bounds, a blue band inside it is space it reserved
 * and will not put content in, and the page colour is content. Turning
 * reservation off makes the blue bands vanish and the content run under the
 * bars, which is the whole claim, visible rather than described.
 */
/**
 * One line of the readout: what it is, and what it currently is.
 *
 * ONE paragraph, not a label and a value in a flex row. A flex item that
 * shrink-wraps in a container this narrow gets a width its content does not
 * fit, so the value's own text wraps inside it — "-168 pt" comes out as "-168"
 * with the "pt" on a second line the row is too short to show. A single line of
 * text cannot have that problem, and all that is required is that a changing
 * number does not reflow the prose around it.
 */
function ReadoutLine({label, value}) {
  return <p style={styles.readoutLine}>{`${label}  ${value} pt`}</p>;
}

/**
 * A message's opening words, for the reader's navigation title.
 *
 * The native reader is titled with the message's own beginning, itself cut with
 * an ellipsis — a title is one line whatever the message is. Cut on a word so a
 * title never ends mid-syllable.
 */
function readerTitle(text) {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= READER_TITLE_CHARS) {
    return flat;
  }
  const cut = flat.slice(0, READER_TITLE_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** How much of the message the reader's title carries. */
const READER_TITLE_CHARS = 34;

/**
 * The whole of a message that was too long to draw in a balloon.
 *
 * Plain body copy on the page, full width with ordinary margins — no balloon,
 * no bubble, selectable. That is what the native reader is: measured on the
 * simulator, it renders the text as plain text on the page background rather
 * than as a scrollable balloon.
 */
function ReaderScreen({text}) {
  return (
    <NativeScroll
      edgeEffects={{top: 'soft'}}
      style={styles.readerScroll}
      contentInsetAdjustmentBehavior="automatic">
      <div style={styles.readerBody}>
        <p style={styles.readerText}>{text}</p>
      </div>
    </NativeScroll>
  );
}

function InsetsScreen({
  onGo,
  seed,
  onSeed,
  showsPerformance,
  onShowPerformance,
}) {
  const [reserve, setReserve] = useState(true);
  const [chat, setChat] = useState(false);
  // Grows on demand, which is the only way to see whether the view follows it.
  const [rowCount, setRowCount] = useState(ROWS);
  /*
   * What the scroll view is actually doing, as NUMBERS on their own lines.
   *
   * One sentence with the offset spliced into it reflows the whole paragraph on
   * every scroll, around a number changing sixty times a second — the thing you
   * are trying to read moves while you read it. A readout is a table: labels on
   * the left, values right-aligned in tabular figures, one row each. Nothing
   * moves but the digits.
   */
  const [metrics, setMetrics] = useState({
    offset: 0,
    insetTop: 0,
    insetBottom: 0,
    contentHeight: 0,
    viewportHeight: 0,
  });
  const readMetrics = event => {
    const {contentOffset, inset, contentSize, containerSize} =
      event.nativeEvent;
    setMetrics({
      offset: Math.round(contentOffset.y),
      insetTop: Math.round(inset.top),
      insetBottom: Math.round(inset.bottom),
      contentHeight: Math.round(contentSize.height),
      viewportHeight: Math.round(containerSize.height),
    });
  };
  const composer = useRef(null);
  const [draft, setDraft] = useState('');
  const rows = [];
  /*
   * ONE count, whatever the anchor is.
   *
   * The anchor decides where the list SITS, not how long it is. Keying the
   * count off it — `chat ? messages : ROWS` — leaves the list a constant 24
   * with the anchor at the top, so "Add a row" increments a number nothing
   * draws: a control wired to a quantity the screen ignores in one of its two
   * states does nothing, silently.
   */
  const count = rowCount;
  for (let i = 1; i <= count; i++) {
    rows.push(<Row key={i} index={i} />);
  }

  return (
    <div style={styles.screen}>
      {/* The element under test, imported as the component it is rather than
          written as <native:scroll>, because this app is built by Gradle and not
          by the toolchain that turns namespaced JSX into that component. Same
          component either way: the defaults are what is being judged. */}
      <NativeScroll
        edgeEffects={{top: 'soft'}}
        style={[styles.fill, styles.scrollTint]}
        contentAnchor={chat ? 'bottom' : 'top'}
        onScroll={readMetrics}
        /*
         * The same reading from the inset's own event, because the insets change
         * without anyone scrolling — the keyboard arriving is the obvious case,
         * and a screen that has never been dragged would otherwise show zeroes
         * for numbers that are not zero.
         */
        onInsetChange={readMetrics}
        automaticInsets={reserve ? undefined : {top: false, bottom: false}}>
        {/* Content carries the page colour so the scroll view's own tint shows
            through wherever content is NOT — which is exactly the reserved
            inset. */}
        <div style={styles.content}>
          <div style={styles.legend}>
            <h2 style={styles.legendTitle}>What the colours are</h2>
            <LegendRow swatch={styles.swatchInset}>
              space it reserved for a system bar or the keyboard
            </LegendRow>
            <LegendRow swatch={styles.swatchContent}>your content</LegendRow>
            <div style={styles.readout}>
              <ReadoutLine label="contentOffset" value={metrics.offset} />
              <ReadoutLine label="contentInset top" value={metrics.insetTop} />
              <ReadoutLine
                label="contentInset bottom"
                value={metrics.insetBottom}
              />
              <ReadoutLine
                label="contentSize height"
                value={metrics.contentHeight}
              />
              <ReadoutLine
                label="viewport height"
                value={metrics.viewportHeight}
              />
            </div>
            <p style={styles.legendNote}>
              {'A scroll view rests at MINUS its top inset, so the resting ' +
                'number is negative when it has one and 0 when it does not. ' +
                'Under a native header the reserve and the window\u2019s own ' +
                'safe area are different quantities — the header has already ' +
                'consumed the top — which is why this reports the offset ' +
                'rather than deriving a distance from env(). Drag the list ' +
                'under the bars: the blue bands are the only thing keeping ' +
                'the first and last rows reachable. Turn the switch below off ' +
                'and they go.'}
            </p>
          </div>

          <Section title="Screens">
            <NavLink to="chat" onGo={onGo}>
              Chat, with a composer
            </NavLink>
            {/* A long conversation, for the load caption the chat shows. */}
            <SettingRow label="Messages in the chat" htmlFor="seed">
              <select
                id="seed"
                value={String(seed)}
                onChange={event => onSeed(Number(event.nativeEvent.value))}>
                <option value="0">0</option>
                <option value="3">3</option>
                <option value="100">100</option>
                <option value="300">300</option>
                <option value="1000">1000</option>
                <option value="3000">3000</option>
              </select>
            </SettingRow>
            {/* What the chat measures about itself, and whether it says so. */}
            <SettingRow label="Chat performance banner" htmlFor="perf">
              <input
                id="perf"
                type="checkbox"
                checked={showsPerformance}
                onChange={event => onShowPerformance(event.nativeEvent.checked)}
              />
            </SettingRow>
            <NavLink to="virtualized" onGo={onGo} last={true}>
              Virtualized rows
            </NavLink>
          </Section>

          <Section title="Controls">
            <SettingRow label="Reserve the safe area" htmlFor="reserve">
              <input
                id="reserve"
                type="checkbox"
                checked={reserve}
                onChange={event => setReserve(event.nativeEvent.checked)}
              />
            </SettingRow>

            {/* What the anchor MEANS, because "top / bottom" does not say it.
                It only has an effect while the list is scrolled to the bottom,
                which is the definition rather than a limitation: an anchor to
                the bottom is only a claim about being at the bottom. */}
            <SettingRow label="Content anchor" htmlFor="anchor">
              <select
                id="anchor"
                value={chat ? 'bottom' : 'top'}
                onChange={event => {
                  setChat(event.nativeEvent.value === 'bottom');
                  setRowCount(ROWS);
                }}>
                <option value="top">top</option>
                <option value="bottom">bottom</option>
              </select>
            </SettingRow>

            {/* The count is in the label on purpose: it is the row total, and it
                also means a tap that did nothing is visible rather than needing
                to be inferred from the list. */}
            <p style={styles.sectionNote}>
              {'With the anchor at the top the keyboard reserves space and moves ' +
                'nothing — right when you are reading from the top. At the bottom ' +
                'the newest row stays visible, so content rises with the keyboard, ' +
                'and only while you are actually at the bottom. Whatever you focus ' +
                'is brought clear of the keyboard under either.'}
            </p>
            <ActionRow
              label={'Add a row (' + rowCount + ')'}
              tabular={true}
              last={true}
              onPress={() => setRowCount(n => n + 1)}
            />
          </Section>

          <Section title="Resolved by the renderer">
            <EnvReadout />
          </Section>
          {rows}
        </div>
      </NativeScroll>

      {/* Pinned to the very bottom of the window, under the navigation bar if
          nothing reserves room for it. Rides the keyboard when there is one. */}
      <ComposerBar>
        {/*
          The SAME composer the chat screen uses, including its `+`.

          The options behind it differ because the screens differ — that is the
          point of passing them in. What must not differ is the bar: the growing
          field is exactly what makes the obstruction change height while the
          keyboard is up, which is the case this screen exists to show.
        */}
        <Composer
          value={draft}
          onChangeText={setDraft}
          onSend={() => setDraft('')}
          inputRef={composer}
          actions={[
            {
              id: 'add',
              symbol: 'plus',
              tint: 'systemGreen',
              label: 'Add a row',
              onPress: () => setRowCount(n => n + 1),
            },
            {
              id: 'anchor',
              symbol: 'arrow.up.arrow.down',
              tint: 'systemIndigo',
              label: chat ? 'Anchor to the top' : 'Anchor to the bottom',
              onPress: () => {
                setChat(previous => !previous);
                setRowCount(ROWS);
              },
            },
            {
              id: 'reserve',
              symbol: 'rectangle',
              tint: 'systemOrange',
              label: reserve
                ? 'Stop reserving the safe area'
                : 'Reserve the safe area',
              onPress: () => setReserve(previous => !previous),
            },
            {
              id: 'hide',
              symbol: 'keyboard',
              tint: 'systemBlue',
              label: 'Dismiss the keyboard',
              onPress: () => composer.current?.blur(),
            },
          ]}
        />
      </ComposerBar>
    </div>
  );
}

/*
 * The grouped-list colours, which the CSS palette does not have.
 *
 * An inset grouped list is two colours in a specific relationship: a GREY page
 * with WHITE cards on it. The CSS system palette has `Canvas` and `Field` and
 * both are white in light mode, so a card drawn from it is invisible against
 * the page and the section reads as loose rows rather than as a list.
 *
 * These are UIKit's own semantic colours instead, which is what a native list
 * is actually made of and which follow light and dark without a table here.
 * Notably Safari's PRIVATE palette does expose the same three
 * (`-apple-system-grouped-background` and friends); the standard set is what is
 * missing them, which is a gap in CSS rather than in this app.
 *
 * Per platform, because these are UIKit's NAMES and Android does not have them:
 * `PlatformColor('systemGroupedBackground')` there resolves nothing and throws
 * `None of the paths in the resource_paths array resolved to a color resource`
 * at the first view it is applied to, taking the surface down. Material's own
 * surface roles are the same two-colour relationship under different names.
 */
const GROUPED_PAGE = uiColor('systemGroupedBackground');
const GROUPED_CARD = uiColor('secondarySystemGroupedBackground');
const SEPARATOR = uiColor('separator');

/*
 * The two colours that are NOT from the system palette, and why.
 *
 * The palette describes an interface; these two describe a MEASUREMENT — "this
 * line is the scroll view's edge", "this band is reserved space" — and a
 * diagram's key has to keep naming the same thing whatever the platform's
 * accent is set to. Everything else on this screen comes from `systemColor`.
 *
 * The tint is a WASH rather than a colour, which is what makes it follow the
 * appearance without a table of one value per mode. A flat `#cfe0ff` stays pale
 * in dark mode while the large title above it turns white, and white on ice
 * blue is hard to read. Painted as translucent accent over whatever is behind,
 * the band is pale over a white page and deep navy over a black one, and the
 * title is legible in both because it is always the page's own contrast that
 * decides.
 *
 * A `DynamicColorIOS` pair would fix the same symptom on one platform and leave
 * Android to be fixed separately; this is one rule for both.
 */
const INSET_TINT = 'rgba(0, 122, 255, 0.16)';

const styles = StyleSheet.create({
  /*
   * The reader's page: plain text on the page background, full width with
   * ordinary margins, the way the platform shows a message too long for a balloon.
   */
  readerScroll: {flex: 1, backgroundColor: systemColor('Canvas')},
  readerBody: {paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40},
  readerText: {
    fontSize: 17,
    lineHeight: 22,
    color: systemColor('CanvasText'),
  },
  /*
   * `display: 'flex'` is written out on every flex container in this file.
   *
   * `<div>` is display:block, which is correct and is the whole point of the
   * element — but `flexDirection`/`gap`/`justifyContent` are simply ignored
   * under block layout, where `View` would have applied them unasked. Without
   * it the legend's swatches and labels stack, the two nav links run together
   * on one line, and the bar's buttons lose every gap between them.
   */
  screen: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    backgroundColor: systemColor('Canvas'),
  },
  fill: {flex: 1},
  /*
   * The scroll view's reserved space, tinted.
   *
   * The tint is the SCROLL VIEW's background rather than a view placed at the
   * top: reserved space is not occupied by anything, so the only way to see it
   * is to let the thing underneath show through where content is not. Content
   * carries the page colour, so the blue is exactly the reservation and nothing
   * else.
   */
  scrollTint: {backgroundColor: INSET_TINT},
  content: {backgroundColor: GROUPED_PAGE},

  contentRow: {
    display: 'flex',
    flexDirection: 'column',
    height: 52,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: systemColor('GrayText'),
    color: systemColor('CanvasText'),
    fontSize: 15,
  },

  legend: {
    display: 'flex',
    flexDirection: 'column',
    margin: 16,
    padding: 16,
    gap: 8,
    borderRadius: 10,
    backgroundColor: GROUPED_CARD,
  },
  legendRow: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  legendText: {fontSize: 13, color: systemColor('CanvasText'), flex: 1},
  legendTitle: {
    fontSize: 15,
    color: systemColor('CanvasText'),
    marginBlock: 0,
  },
  legendNote: {
    fontSize: 12,
    color: systemColor('GrayText'),
    lineHeight: 17,
    marginBlock: 0,
    fontVariant: ['tabular-nums'],
  },
  /* The live numbers, one to a line — see `metrics` in `InsetsScreen`. */
  readout: {
    display: 'flex',
    flexDirection: 'column',
    marginTop: 6,
    marginBottom: 8,
  },
  /*
   * TABULAR figures. A proportional `1` is narrower than a `0`, so a counter set
   * in them jitters sideways as it counts even on a line of its own;
   * `tabular-nums` is the font feature that makes every digit the same width,
   * which is exactly what it is for.
   */
  readoutLine: {
    fontSize: 12,
    lineHeight: 18,
    marginBlock: 0,
    fontVariant: ['tabular-nums'],
    color: systemColor('GrayText'),
  },
  swatch: {width: 22, height: 14, borderRadius: 3},
  swatchInset: {backgroundColor: INSET_TINT},
  swatchContent: {
    backgroundColor: systemColor('Canvas'),
    borderWidth: 1,
    borderColor: systemColor('GrayText'),
  },

  /*
   * A section of a settings list: heading on the page, card below it.
   *
   * `marginTop` is larger than `marginBottom` because that is the rhythm iOS
   * uses — sections are separated by the space ABOVE the next heading, not by
   * padding around each card.
   */
  section: {display: 'flex', flexDirection: 'column', marginTop: 28},
  sectionNote: {
    fontSize: 13,
    color: systemColor('GrayText'),
    lineHeight: 17,
    marginBlock: 0,
    marginHorizontal: 32,
    marginTop: 6,
  },
  sectionTitle: {
    fontSize: 13,
    color: systemColor('GrayText'),
    marginBlock: 0,
    marginBottom: 7,
    marginHorizontal: 32,
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    marginHorizontal: 16,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: GROUPED_CARD,
  },
  /*
   * 44 points, the platform's touch target — and what makes a stack of these
   * read as a list rather than as a column of controls.
   */
  row: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: 16,
    gap: 12,
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  /*
   * The separator, and where it STARTS.
   *
   * Inset to the label's left edge rather than the card's, which is the detail
   * that stops a grouped list looking like a web table. Applied to every row
   * but the last, because the card's own edge closes the bottom.
   */
  rowSeparated: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: SEPARATOR,
    marginLeft: 16,
    paddingLeft: 0,
  },
  rowLabel: {fontSize: 17, color: systemColor('CanvasText'), flex: 1},
  rowValue: {fontSize: 17, color: systemColor('GrayText')},
  /* Zero-height instrument: the probes measure, they do not occupy. */
  probe: {height: 0, overflow: 'hidden'},
  /* An action row's label carries the tint; the row is the target. */
  actionRow: {
    justifyContent: 'flex-start',
    color: systemColor('LinkText'),
    fontSize: 17,
  },
  navChevron: {fontSize: 17, color: systemColor('GrayText')},
  tabular: {fontVariant: ['tabular-nums']},
});
