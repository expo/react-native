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
 * The keyboard inside a native navigator: a tab bar at the bottom of the
 * window, a safe area under it, and a keyboard arriving over both. A composer
 * docked to the keyboard clears the tab bar when the keyboard is away and sits
 * on the keyboard when it is not, with one number doing both jobs.
 *
 * The tabs are `@expo/ui`'s `TabView`. Its native side is present on iOS and
 * absent on Android, so the require is guarded and Android falls back to a
 * plain segmented control. Only the universal entry is used: Metro cannot
 * serve the `@expo/ui/swift-ui` subpath, whose `exports` point at TypeScript
 * source, and the failure breaks the whole bundle rather than one module.
 *
 * `@noflow`: the intrinsics have no JSX types.
 */

// $FlowFixMe[cannot-resolve-module] @expo/ui ships TypeScript source
const ExpoUI = (() => {
  try {
    // $FlowFixMe[cannot-resolve-module]
    return require('@expo/ui/swift-ui');
  } catch (error) {
    global.__kbShowcaseError = String((error && error.message) || error);
    return null;
  }
})();
const {Host, TabView} = ExpoUI ?? {};

import {
  CARD_COLOR,
  GROUPED_PAGE_COLOR,
  LABEL_COLOR,
  SECONDARY_COLOR,
  SEPARATOR_COLOR,
} from '../HTMLElements/themed';
import * as React from 'react';
import {useState} from 'react';
import {Keyboard, Platform, View, useWindowDimensions} from 'react-native';

const hasNativeTabs = Host != null && TabView != null && Platform.OS === 'ios';

const ROWS = 40;

/**
 * Native controls inside a native scroll view, arbitrating natively. Three
 * things to try: a tap fires and the count goes up; a press that becomes a
 * drag scrolls the list and does not fire, the highlight taken away when the
 * scroll view claims the gesture between two recognizers; and the highlight
 * waits, since `delaysContentTouches` gives the scroll view its moment first.
 * Nothing here sets a prop for any of that.
 */
function Controls() {
  const [taps, setTaps] = useState(0);
  const [last, setLast] = useState('nothing yet');

  const rows = [];
  for (let i = 1; i <= ROWS; i++) {
    rows.push(
      <div
        key={i}
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          paddingBlock: 8,
          paddingInline: 16,
          borderBottomWidth: 1,
          borderColor: SEPARATOR_COLOR,
          backgroundColor: CARD_COLOR,
        }}>
        <span style={{fontSize: 16, color: LABEL_COLOR}}>{'Row ' + i}</span>
        <button
          onClick={() => {
            setTaps(n => n + 1);
            setLast('button on row ' + i);
          }}>
          {'Press ' + i}
        </button>
      </div>,
    );
  }

  return (
    <div style={{display: 'flex', flexDirection: 'column', flex: 1}}>
      {/* The readout is OUTSIDE the scroll view on purpose: a drag that scrolls
          must leave it unchanged, and a counter that scrolled away with the
          content would make that impossible to see. */}
      <div
        // A live status, so it is named rather than left as loose text: assistive
        // technology should be able to ask what the count is, and inside the
        // SwiftUI tab host the text spans do not surface on their own.
        accessibilityLabel={taps + ' presses, last ' + last}
        style={{
          // A column, said out loud: `<div>` is display:block, so two `<span>`s
          // inside it are inline and flow onto the SAME line — the count and its
          // caption ran together.
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          paddingBlock: 10,
          paddingInline: 16,
          backgroundColor: CARD_COLOR,
          borderBottomWidth: 1,
          borderColor: SEPARATOR_COLOR,
        }}>
        <span
          style={{
            fontSize: 15,
            color: LABEL_COLOR,
            fontVariant: ['tabular-nums'],
          }}>
          {taps + ' presses · last: ' + last}
        </span>
        <span style={{fontSize: 13, color: SECONDARY_COLOR}}>
          Drag from a button: the list scrolls and this does not change.
        </span>
      </div>

      <native:scroll style={{flex: 1, backgroundColor: GROUPED_PAGE_COLOR}}>
        {rows}
      </native:scroll>
    </div>
  );
}

function Field({label, children, note}) {
  return (
    <div
      style={{
        paddingBlock: 10,
        paddingInline: 16,
        borderBottomWidth: 1,
        borderColor: SEPARATOR_COLOR,
        backgroundColor: CARD_COLOR,
      }}>
      <span style={{fontSize: 13, color: SECONDARY_COLOR}}>{label}</span>
      {children}
      {note != null ? (
        <span style={{fontSize: 12, color: SECONDARY_COLOR}}>{note}</span>
      ) : null}
    </div>
  );
}

/**
 * Form controls, deliberately longer than the screen.
 *
 * The last few fields are the ones that matter: focusing one near the bottom has
 * to bring it clear of the keyboard, and it has to stay clear as the keyboard
 * settles rather than arriving there and then being covered.
 */
function Forms() {
  const notes = React.useRef(null);
  return (
    /* `<native:scroll>` rather than `<ScrollView>` with four props: the
       keyboard behaviour is the element's default. */
    <div style={{display: 'flex', flexDirection: 'column', flex: 1}}>
      <native:scroll style={{flex: 1, backgroundColor: GROUPED_PAGE_COLOR}}>
        <div
          style={{display: 'flex', flexDirection: 'row', gap: 8, padding: 8}}>
          {/* The last field is the one that has to clear the keyboard, and it is
            reachable from here because `<input>` can now be focused. */}
          <button onClick={() => notes.current?.focus()}>
            Focus last field
          </button>
          <button onClick={() => Keyboard.dismiss()}>Dismiss</button>
        </div>
        <Field label="Your name">
          <input
            placeholder="Ada Lovelace"
            style={{fontSize: 17, height: 34}}
          />
        </Field>
        <Field label="Email — brings the email keyboard">
          <input
            type="email"
            placeholder="you@example.com"
            style={{fontSize: 17, height: 34}}
          />
        </Field>
        <Field label="Phone — brings the number pad">
          <input
            type="tel"
            placeholder="+44"
            style={{fontSize: 17, height: 34}}
          />
        </Field>
        <Field label="Password — masked, no autocorrect">
          <input
            type="password"
            placeholder="••••••••"
            style={{fontSize: 17, height: 34}}
          />
        </Field>
        <Field label="Search">
          <input
            type="search"
            placeholder="Search"
            style={{fontSize: 17, height: 34}}
          />
        </Field>
        <Field label="Subscribed">
          <input type="checkbox" defaultChecked />
        </Field>
        <Field label="Plan">
          <select>
            <option value="free">Free</option>
            <option value="pro">Pro</option>
          </select>
        </Field>
        <Field label="Volume">
          <input type="range" defaultValue="40" />
        </Field>
        <Field label="Notes — the last field, and the one that has to clear the keyboard">
          <textarea
            ref={notes}
            placeholder="Anything else"
            rows={3}
            style={{fontSize: 17}}
          />
        </Field>
      </native:scroll>

      {/*
        OPAQUE for a reason rather than by default: a "Done" toolbar is chrome
        over a form, and a form has fields and separators running right up to it
        — let the page show through and the bar stops reading as a separate
        surface. The chat-demo app's chat bar takes the other option,
        because a transcript behind a composer is what the native chat does and
        it reads correctly there.

        Same element, one prop apart. It carries whatever background the author
        sets and none if they set none.
      */}
      <native:keyboardaccessory
        style={{
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'flex-end',
          gap: 8,
          paddingInline: 12,
          paddingBlock: 8,
          borderTopWidth: 1,
          borderColor: SEPARATOR_COLOR,
          backgroundColor: CARD_COLOR,
        }}>
        <button onClick={() => notes.current?.focus()}>Focus last field</button>
        <button onClick={() => Keyboard.dismiss()}>Done</button>
      </native:keyboardaccessory>
    </div>
  );
}

function NativeTabs() {
  // The pages get an explicit height: a tab's children are React Native views
  // hosted back inside SwiftUI, and the flex context does not cross that
  // boundary, so `flex: 1` collapses every page. A demo's approximation; the
  // general answer is for the hosted subtree to inherit a height.
  const {height} = useWindowDimensions();
  // The floating tab bar takes the bottom 83pt and the header the top; without
  // allowing for the tab bar the composer lands underneath it
  const TAB_BAR = 83;
  const pageHeight = height - 148 - TAB_BAR;
  return (
    <Host style={{flex: 1}} useViewportSizeMeasurement={true}>
      <TabView defaultSelection="controls">
        <TabView.Tab value="controls" label="Controls" systemImage="hand.tap">
          <View style={{height: pageHeight}}>
            <Controls />
          </View>
        </TabView.Tab>
        <TabView.Tab
          value="forms"
          label="Forms"
          systemImage="list.bullet.rectangle">
          <View style={{height: pageHeight}}>
            <Forms />
          </View>
        </TabView.Tab>
      </TabView>
    </Host>
  );
}

// A plain fallback where `@expo/ui` has no native side
function FallbackTabs() {
  const [tab, setTab] = useState('controls');
  return (
    <div style={{display: 'flex', flexDirection: 'column', flex: 1}}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          gap: 8,
          padding: 8,
          backgroundColor: CARD_COLOR,
          borderBottomWidth: 1,
          borderColor: SEPARATOR_COLOR,
        }}>
        <button onClick={() => setTab('controls')}>Controls</button>
        <button onClick={() => setTab('forms')}>Forms</button>
      </div>
      {global.__kbShowcaseError != null ? (
        <div style={{padding: 8, backgroundColor: '#fff3cd'}}>
          <span style={{fontSize: 11, color: '#664d03'}}>
            {'native tabs unavailable: ' + String(global.__kbShowcaseError)}
          </span>
        </div>
      ) : null}
      {tab === 'controls' ? <Controls /> : <Forms />}
    </div>
  );
}

export default {
  title: 'Keyboard: a small app',
  category: 'UI',
  description:
    'Native controls and form screens inside a native tab bar — the case where the keyboard, ' +
    'the tab bar and the safe area all have an opinion about where the bottom is.',
  examples: [
    {
      name: 'app',
      fullBleed: true,
      title: 'Native tabs: controls and forms',
      description:
        'SwiftUI’s own TabView on iOS. Drag from a button and the list scrolls ' +
        'without pressing it; the form brings its last field clear of the keyboard.',
      render: () => (hasNativeTabs ? <NativeTabs /> : <FallbackTabs />),
    },
  ],
};
