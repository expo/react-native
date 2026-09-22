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
 * Demo app for the expo-intrinsics elements. Content runs edge to edge so
 * `<native:scroll>` has non-zero safe-area insets to reserve (in RN Tester
 * they are zero). See ui-metrics.md, "RN Tester content never reaches the
 * system bars".
 *
 * It uses the elements (`<div>`, `<p>`, `<button>`, `<a>`) instead of `View`,
 * `Text` and `Pressable`, because they are what it demonstrates.
 */

import '@react-native/expo-intrinsics-poc';

import env from '../expo-intrinsics/src/env';
import NativeScroll from '../expo-intrinsics/src/NativeScroll';
import {systemColor} from '../expo-intrinsics/src/systemColors';
import Composer, {ComposerBar} from './Composer';
import useHeaderEdgeEffects from './headerEdge';
import ChatScreen from './screens/ChatScreen';
import VirtualizedScreen from './screens/VirtualizedScreen';
import {uiColor} from './uiColors';
import * as React from 'react';
import {useCallback, useRef, useState} from 'react';
import {Platform, StyleSheet, UIManager} from 'react-native';

/*
 * Android: without these, `react-native-screens` fills the toolbar with
 * `colorPrimary` and draws the title in the on-surface colour, which clash
 * under a Material 3 theme. iOS: none, because any background colour replaces
 * the system's translucent bar.
 */
const HEADER_COLOURS =
  Platform.OS === 'ios'
    ? null
    : {
        backgroundColor: uiColor('systemBackground'),
        titleColor: uiColor('label'),
        color: uiColor('label'),
      };

/*
 * iOS only. There the translucent bar is part of `safeAreaInsets`, which
 * `<native:scroll>` already reserves. On Android no inset covers a translucent
 * toolbar, so content would start behind the title.
 */
const HEADER_TRANSLUCENT = Platform.OS === 'ios';

const ROWS = 10;

function Row({index}) {
  return <div style={styles.contentRow}>{'row ' + index}</div>;
}

/*
 * `react-native-screens` isn't linked on Android in this repo yet (an
 * unresolved vtable in `RNSFullWindowOverlay`), so `screens` is null there and
 * `App` switches screens with state. The JS package still resolves on Android,
 * so the `try` alone doesn't detect this; the view manager check does.
 */
let screens = null;
try {
  screens = require('react-native-screens');
  // Not `getViewManagerConfig`, which raises a soft error in bridgeless mode.
  if (UIManager.hasViewManagerConfig('RNSScreenStackHeaderConfig') !== true) {
    screens = null;
  } else {
    screens.enableScreens(true);
  }
} catch {
  screens = null;
}

/**
 * Props are set only by UI tests, from launch environment variables (iOS:
 * `initialProperties` in AppDelegate.mm). A normal launch passes none.
 */
export default function App({
  seedMessages,
  initialScreen,
  initialProfiling,
  deliveredAfterMs,
}) {
  const [screen, setScreen] = useState(initialScreen ?? 'insets');
  const [seed, setSeed] = useState(seedMessages ?? 3);
  const [showsPerformance, setShowsPerformance] = useState(
    initialProfiling === true,
  );
  const [readerMessage, setReaderMessage] = useState(null);
  const openReader = useCallback(message => {
    setReaderMessage(message);
    setScreen('reader');
  }, []);

  if (screens == null) {
    // Android (no `react-native-screens`): switch screens with state.
    if (screen === 'chat') {
      return (
        <ChatScreen
          seedMessages={seed}
          deliveredAfterMs={deliveredAfterMs}
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
        <ScreenStackHeaderConfig
          {...HEADER_COLOURS}
          title="Safe areas"
          largeTitle={true}
          translucent={HEADER_TRANSLUCENT}
          /*
           * No background colour, so iOS draws its default bar material. Don't
           * pass a transparent colour: on iOS 27 the soft scroll edge is only a
           * fade, so the bar would have no backdrop.
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
          onDismissed={() => setScreen('insets')}>
          <ScreenStackHeaderConfig
            {...HEADER_COLOURS}
            title="Chat"
            backTitleVisible={false}
            translucent={HEADER_TRANSLUCENT}
          />
          <ChatScreen
            seedMessages={seed}
            deliveredAfterMs={deliveredAfterMs}
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
            title={readerTitle(readerMessage.text)}
            backTitleVisible={false}
            translucent={HEADER_TRANSLUCENT}
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
            translucent={HEADER_TRANSLUCENT}
          />
          <VirtualizedScreen />
        </Screen>
      )}
    </ScreenStack>
  );
}

/**
 * Reads `env()` back from the laid-out height of hidden boxes sized with it,
 * rather than measuring in JS, because `env()` is what this row demonstrates.
 */
function EnvReadout() {
  const [sizes, setSizes] = useState({top: null, bottom: null});
  const measure = edge => event => {
    const height = event?.nativeEvent?.layout?.height;
    if (height == null) {
      return;
    }
    setSizes(previous => ({...previous, [edge]: Math.round(height)}));
  };
  return (
    <React.Fragment>
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
 * The `href` is needed: an `<a>` without one is a placeholder, not a link.
 * `preventDefault()` stops it being followed.
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
      {/* Hidden so VoiceOver doesn't read "›" in the link's name. The `<div>`
          is needed: `accessibilityElementsHidden` has no effect on an inline
          `<span>`. */}
      <div accessibilityElementsHidden={true}>
        <span style={styles.navChevron}>›</span>
      </div>
    </a>
  );
}

/**
 * An iOS inset grouped-list section: a heading above a rounded card. Not a
 * `<fieldset>`, which is for form controls and adds a border and legend.
 */
function Section({title, children}) {
  return (
    <div style={styles.section}>
      <h2 style={styles.sectionTitle}>{title}</h2>
      <div style={styles.card}>{children}</div>
    </div>
  );
}

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
 * One `<p>`, not a label and value in a flex row: in a flex row this narrow
 * the value wraps and its "pt" is cut off.
 */
function ReadoutLine({label, value}) {
  return <p style={styles.readoutLine}>{`${label}  ${value} pt`}</p>;
}

function readerTitle(text) {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= READER_TITLE_CHARS) {
    return flat;
  }
  const cut = flat.slice(0, READER_TITLE_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

const READER_TITLE_CHARS = 34;

/** Full text of a message too long for a balloon, opened by `onOpenReader`. */
function ReaderScreen({text}) {
  const headerEdgeEffects = useHeaderEdgeEffects();
  return (
    <NativeScroll
      edgeEffects={headerEdgeEffects}
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
  const headerEdgeEffects = useHeaderEdgeEffects();
  const [reserve, setReserve] = useState(true);
  const [chat, setChat] = useState(false);
  const [rowCount, setRowCount] = useState(ROWS);
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
  const count = rowCount;
  for (let i = 1; i <= count; i++) {
    rows.push(<Row key={i} index={i} />);
  }

  return (
    <div style={styles.screen}>
      {/* `NativeScroll` is `<native:scroll>`; this app's build doesn't
          transform namespaced JSX. */}
      <NativeScroll
        edgeEffects={headerEdgeEffects}
        style={[styles.fill, styles.scrollTint]}
        contentAnchor={chat ? 'bottom' : 'top'}
        onScroll={readMetrics}
        // Insets can change without a scroll, e.g. when the keyboard opens.
        onInsetChange={readMetrics}
        automaticInsets={reserve ? undefined : {top: false, bottom: false}}>
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
                <option value="10000">10000</option>
                <option value="30000">30000</option>
                <option value="100000">100000</option>
              </select>
            </SettingRow>
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

      <ComposerBar>
        {/* The chat screen's `Composer`: its field grows while the keyboard is
            up, which changes the bottom inset this screen shows. */}
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
 * UIKit colours via `uiColor`, not `systemColor`: CSS `Canvas` and `Field` are
 * both white in light mode, so the cards would not show against the page.
 */
const GROUPED_PAGE = uiColor('systemGroupedBackground');
const GROUPED_CARD = uiColor('secondarySystemGroupedBackground');
const SEPARATOR = uiColor('separator');

/*
 * Translucent, so it works in light and dark mode on both platforms without a
 * colour per mode.
 */
const INSET_TINT = 'rgba(0, 122, 255, 0.16)';

const styles = StyleSheet.create({
  readerScroll: {flex: 1, backgroundColor: systemColor('Canvas')},
  readerBody: {paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40},
  readerText: {
    fontSize: 17,
    lineHeight: 22,
    color: systemColor('CanvasText'),
  },
  /*
   * Every flex container here sets `display: 'flex'`: a `<div>` is
   * `display: block`, which ignores `flexDirection`, `gap` and
   * `justifyContent`.
   */
  screen: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    backgroundColor: systemColor('Canvas'),
  },
  fill: {flex: 1},
  /* `content` is opaque, so this tint shows only in the reserved insets. */
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
  readout: {
    display: 'flex',
    flexDirection: 'column',
    marginTop: 6,
    marginBottom: 8,
  },
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
  /* 44 pt: iOS's minimum touch target and list row height. */
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
  /* `marginLeft`, so the separator starts at the label, as in iOS lists. */
  rowSeparated: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: SEPARATOR,
    marginLeft: 16,
    paddingLeft: 0,
  },
  rowLabel: {fontSize: 17, color: systemColor('CanvasText'), flex: 1},
  rowValue: {fontSize: 17, color: systemColor('GrayText')},
  probe: {height: 0, overflow: 'hidden'},
  actionRow: {
    justifyContent: 'flex-start',
    color: systemColor('LinkText'),
    fontSize: 17,
  },
  navChevron: {fontSize: 17, color: systemColor('GrayText')},
  tabular: {fontVariant: ['tabular-nums']},
});
