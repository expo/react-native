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
 * The keyboard inside a real native navigator.
 *
 * Every keyboard demo so far has been a screen on its own, which is the easy
 * case. The hard case is the one apps actually ship: a native tab bar at the
 * bottom of the window, a safe area under that, and a keyboard that has to
 * arrive over both without any of the three disagreeing about where the bottom
 * is. A composer docked to the keyboard has to clear the tab bar when the
 * keyboard is away and sit on the keyboard when it is not — and it is the same
 * number doing both jobs, which is the whole argument for treating the
 * obstruction as one quantity.
 *
 * The tabs are SwiftUI's own `TabView`, not a JavaScript imitation of one, so
 * the tab bar is a real platform view with real platform insets.
 *
 * `@expo/ui`'s native side is present on iOS in this checkout and absent on
 * Android, which has no Expo autolinking configured. The require is guarded and
 * Android falls back to a plain segmented control, so the two screens can still
 * be exercised there — the point of the screens is the keyboard, not the tabs.
 *
 * `@noflow`: the intrinsics have no JSX types.
 */

/*
 * The universal entry only. `TabView` lives in `@expo/ui/swift-ui`, which this
 * checkout's Metro cannot serve: the subpath is reachable only through the
 * package's `exports` map, which points at TypeScript source, and importing it
 * fails with "Failed to get the SHA-1 … The file is not watched" — through a
 * watchman reset and a cache reset alike, and with or without a resolver entry
 * pointing straight at the file. The universal entry is unaffected because it is
 * the package's `main`, which is why the existing Expo UI screen never hit this.
 *
 * Requiring it anyway does not degrade to a fallback: it breaks the whole bundle,
 * because the failure is in Metro rather than in the module. So this asks for the
 * entry that works and the screens run under plain tabs.
 *
 * The screens are the part that is about the keyboard. The tab bar is the part
 * that is about packaging, and it is worth coming back to — a native tab bar is
 * exactly the neighbour that makes keyboard insets interesting.
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

/* ------------------------------------------------------------- controls --- */

const ROWS = 40;

/**
 * Native controls inside a native scroll view, arbitrating natively.
 *
 * This replaced a chat, which demonstrated the keyboard twice — the forms tab
 * already does that, and better, because a form is where an app actually meets
 * one. What had no demo at all was the thing underneath both: whether a control
 * and a scroll view can agree about a finger without JavaScript in the loop.
 *
 * Three behaviours, and each is a thing to TRY rather than to read:
 *
 *  1. **Tap a button and it fires.** The count goes up and the last action is
 *     named.
 *  2. **Press a button and drag** — the list scrolls and the button does NOT
 *     fire. The press highlight appears under the finger and is taken away when
 *     the scroll view claims the gesture. That claim happens in UIKit's own
 *     arena, between two gesture recognizers, not after a round trip through
 *     JavaScript.
 *  3. **The highlight waits.** A press inside a scroll view is deliberately not
 *     drawn instantly — `delaysContentTouches` gives the scroll view its moment
 *     to decide first, which is why a flick down a list does not leave a trail
 *     of flashing buttons behind it.
 *
 * Nothing here sets a prop to get any of that. `<button>` reports and draws its
 * own press on the native view, and `<native:scroll>` is a real scroll view, so
 * the two arbitrate the way any two native controls do.
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

/* --------------------------------------------------------------- forms --- */

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
      <div style={{display: 'flex', flexDirection: 'row', gap: 8, padding: 8}}>
        {/* The last field is the one that has to clear the keyboard, and it is
            reachable from here because `<input>` can now be focused. */}
        <button onClick={() => notes.current?.focus()}>Focus last field</button>
        <button onClick={() => Keyboard.dismiss()}>Dismiss</button>
      </div>
      <Field label="Your name">
        <input placeholder="Ada Lovelace" style={{fontSize: 17, height: 34}} />
      </Field>
      <Field label="Email — brings the email keyboard">
        <input type="email" placeholder="you@example.com" style={{fontSize: 17, height: 34}} />
      </Field>
      <Field label="Phone — brings the number pad">
        <input type="tel" placeholder="+44" style={{fontSize: 17, height: 34}} />
      </Field>
      <Field label="Password — masked, no autocorrect">
        <input type="password" placeholder="••••••••" style={{fontSize: 17, height: 34}} />
      </Field>
      <Field label="Search">
        <input type="search" placeholder="Search" style={{fontSize: 17, height: 34}} />
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

/* ---------------------------------------------------------------- tabs --- */

function NativeTabs() {
  /*
   * The pages get an explicit height rather than `flex: 1`.
   *
   * A tab's children are React Native views hosted back inside SwiftUI, and the
   * flex context does not cross that boundary: with `flex: 1` the tab bar
   * rendered correctly and every page collapsed to nothing. `Host`'s
   * `useViewportSizeMeasurement` fixes the SwiftUI side of the same question but
   * not this one, so the size is stated.
   *
   * The subtraction is the tab bar and the bottom safe area, which the pages sit
   * above. It is a demo's approximation and not a general answer — the general
   * answer is for the hosted subtree to inherit a height, which is a question
   * about hosting rather than about keyboards.
   */
  const {height} = useWindowDimensions();
  // Measured on this device: the floating tab bar occupies the bottom 83pt and
  // the screen's own header takes the top. Without allowing for the tab bar the
  // composer lands UNDERNEATH it — the accessibility tree put the Send button at
  // y=764 inside a tab bar spanning 726 to 809, and taps meant for the composer
  // reached the tab bar instead.
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
        <TabView.Tab value="forms" label="Forms" systemImage="list.bullet.rectangle">
          <View style={{height: pageHeight}}>
            <Forms />
          </View>
        </TabView.Tab>
      </TabView>
    </Host>
  );
}

/**
 * A plain fallback where `@expo/ui` has no native side, so the two screens are
 * still reachable. Not a native navigator and not pretending to be one.
 */
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
