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
 * HTML forms — §4.10.
 *
 * Every control here is a real platform control: a `UISwitch` and a `UIMenu` on
 * iOS, a `CheckBox` and a modal list on Android. That is the point of the
 * screen — not that the elements exist, but that each one is the thing the
 * platform would have drawn anyway, reached through the HTML element that means
 * it.
 *
 * Each example shows the live value beneath the control, because a form control
 * that renders is only half of one: what matters is what it reports, when, and
 * what a `<form>` would submit for it. Cases where the platform deliberately
 * differs from the web are marked **deviation** and are written up in
 * `expo-intrinsics/__docs__/SpecDeviations.md`.
 *
 * `@noflow`: the intrinsics have no JSX types.
 */

import {
  CARD_COLOR,
  SECONDARY_COLOR,
  SEPARATOR_COLOR,
  TERTIARY_COLOR,
} from './themed';
import * as React from 'react';
import {useCallback, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';

import '@react-native/expo-intrinsics-poc';

/*
 * Label sits TIGHT to what it labels: iOS grouped forms hold a caption ~4pt
 * off its row, Material puts a field label 4dp off its field — both nearer
 * than the note text is to the next case. Group-internal spacing smaller
 * than group-external is what makes the label read as belonging to the
 * control below it rather than floating between two.
 */
const LABEL = {
  fontSize: 12,
  color: SECONDARY_COLOR,
  marginTop: 16,
  marginBottom: 2,
};
const NOTE = {
  fontSize: 11,
  color: TERTIARY_COLOR,
  marginBottom: 4,
  lineHeight: 15,
};
const READOUT = {
  fontSize: 12,
  color: '#0a84ff',
  marginTop: 4,
  fontFamily: 'Menlo',
};
/*
 * A control and its label on one line.
 *
 * Spaced for NATIVE controls rather than for the web's density. A checkbox here
 * is a real `UISwitch` (51x31) and a radio is a drawn indicator at the platform
 * tap size, so the 10/8 that reads as comfortable next to a 13px web checkbox
 * leaves a 44pt control almost touching its label. iOS puts appreciably more
 * air around a control than a browser does, and the demos are what someone
 * judges the elements by.
 *
 * This is demo layout, not the user-agent sheet: the UA `fieldset` surface is
 * the platform's own group idiom (DOM-CSS-DEVIATION(fieldset-native-surface))
 * and is left alone here.
 */
const ROW = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 14,
  marginBottom: 14,
};

function Case({title, note, children, readout}) {
  return (
    <View style={{marginBottom: 8}}>
      <Text style={LABEL}>{title}</Text>
      {note != null ? <Text style={NOTE}>{note}</Text> : null}
      {children}
      {readout != null ? <Text style={READOUT}>{readout}</Text> : null}
    </View>
  );
}

function Screen({intro, children}) {
  return (
    <ScrollView contentContainerStyle={{padding: 16, paddingBottom: 48}}>
      {intro != null ? (
        <Text style={{fontSize: 13, color: SECONDARY_COLOR, lineHeight: 18}}>
          {intro}
        </Text>
      ) : null}
      {children}
    </ScrollView>
  );
}

/* ---------------------------------------------------------------- text ---- */

function TextInputs() {
  const [values, setValues] = useState({});
  /*
   * The value is read HERE, not inside the updater below. React pools synthetic
   * events and nullifies `nativeEvent` once the handler returns, and a state
   * updater runs later — so reading `e.nativeEvent.value` from inside it gets
   * null and throws. Capture first, then update.
   */
  const set = name => e => {
    const value = e.nativeEvent.value;
    setValues(v => ({...v, [name]: value}));
  };

  return (
    <Screen
      intro={
        'The textual input types. They all resolve to the platform text field; ' +
        'what type changes is the keyboard, the masking and the semantics — not ' +
        'a different widget.'
      }>
      <Case
        title='type="text" — the default'
        readout={`value: ${JSON.stringify(values.text ?? '')}`}>
        <input type="text" placeholder="Your name" onInput={set('text')} />
      </Case>

      <Case
        title='type="password" — masked'
        note="The one type that is secure, decided in C++ so the two platforms cannot disagree about which types are masked."
        readout={`length: ${(values.password ?? '').length}`}>
        <input
          type="password"
          placeholder="Password"
          onInput={set('password')}
        />
      </Case>

      <Case
        title='type="email" — email keyboard'
        readout={`value: ${JSON.stringify(values.email ?? '')}`}>
        <input
          type="email"
          placeholder="you@example.com"
          onInput={set('email')}
        />
      </Case>

      <Case
        title='type="url", type="tel", type="search" — each with its own keyboard'
        note="Type it into each and watch the keyboard change: a URL keyboard has a slash and .com, a tel keyboard is a keypad, a search keyboard has a Search return key.">
        <input type="url" placeholder="https://" style={{marginBottom: 8}} />
        <input type="tel" placeholder="+44 …" style={{marginBottom: 8}} />
        <input type="search" placeholder="Search" />
      </Case>

      <Case
        title='type="number" — numeric keyboard'
        readout={`value: ${JSON.stringify(values.number ?? '')}`}>
        <input type="number" placeholder="0" onInput={set('number')} />
      </Case>
    </Screen>
  );
}

function TextAttributes() {
  const [v, setV] = useState('');

  return (
    <Screen
      intro={
        'The attributes of a text field, each shown on its own so the effect is ' +
        'attributable to one thing.'
      }>
      <Case
        title="placeholder"
        note="Shown when the field is empty, in the platform's own placeholder colour.">
        <input placeholder="Placeholder text" />
      </Case>

      <Case
        title="maxLength — 5 characters"
        note="Absent means no limit; 0 is a real limit meaning nothing may be typed. The distinction is why the C++ default is -1 rather than 0."
        readout={`${v.length}/5`}>
        <input
          maxLength={5}
          placeholder="Max 5"
          onInput={e => setV(e.nativeEvent.value)}
        />
      </Case>

      <Case title="readOnly — selectable but not editable">
        <input readOnly defaultValue="You can select this, not edit it" />
      </Case>

      <Case
        title="disabled"
        note="Inert and drawn that way. The text greys: Android's EditText does it from its own disabled colours, and on iOS it is set on the field, because UITextField — unlike a range or a select, which grey themselves from isEnabled — changes nothing but whether it accepts input.">
        <input disabled defaultValue="Disabled" style={{marginBottom: 8}} />
        <input defaultValue="Enabled — compare" />
      </Case>

      <Case
        title="spellCheck={false} — no red underlines"
        note="Default is true, matching HTML. Type a misspelled word into each.">
        <input
          spellCheck={false}
          placeholder="No spellcheck"
          style={{marginBottom: 8}}
        />
        <input placeholder="Spellcheck on (default)" />
      </Case>

      <Case
        title="autoComplete — the platform's own autofill"
        note="Feeds iOS textContentType and Android autofill hints, so the QuickType bar and Autofill offer the right thing.">
        <input
          autoComplete="username"
          placeholder="Username"
          style={{marginBottom: 8}}
        />
        <input
          type="password"
          autoComplete="current-password"
          placeholder="Current password"
          style={{marginBottom: 8}}
        />
        <input autoComplete="one-time-code" placeholder="One-time code" />
      </Case>

      <Case
        title="enterKeyHint — what the return key says"
        note="go, done, next, search, send. The label on the return key changes; the key still returns.">
        <input
          enterKeyHint="search"
          placeholder="enterKeyHint=search"
          style={{marginBottom: 8}}
        />
        <input
          enterKeyHint="send"
          placeholder="enterKeyHint=send"
          style={{marginBottom: 8}}
        />
        <input enterKeyHint="done" placeholder="enterKeyHint=done" />
      </Case>

      <Case
        title="inputMode — the keyboard, independent of the type"
        note="For when the semantic type and the keyboard you want disagree: a text field that should still show a numeric pad.">
        <input
          inputMode="numeric"
          placeholder="inputMode=numeric"
          style={{marginBottom: 8}}
        />
        <input
          inputMode="decimal"
          placeholder="inputMode=decimal"
          style={{marginBottom: 8}}
        />
        <input inputMode="email" placeholder="inputMode=email" />
      </Case>
    </Screen>
  );
}

function ControlledInputs() {
  const [upper, setUpper] = useState('');
  const [noDigits, setNoDigits] = useState('');
  const [capped, setCapped] = useState('');
  const [rejected, setRejected] = useState(0);

  /*
   * The synchronous path. `onBeforeInput` runs *before* the control applies the
   * edit, on each platform's own pre-commit hook, so a refusal or a substitution
   * is never drawn even for a frame. Calling `setValue` substitutes; calling
   * `preventDefault` refuses.
   */
  const toUpper = useCallback(e => {
    const proposed = e.nativeEvent.value;
    if (proposed !== proposed.toUpperCase()) {
      e.nativeEvent.setValue(proposed.toUpperCase());
    }
  }, []);

  const blockDigits = useCallback(e => {
    if (/\d/.test(e.nativeEvent.value)) {
      e.nativeEvent.preventDefault();
      setRejected(n => n + 1);
    }
  }, []);

  return (
    <Screen
      intro={
        'A controlled input needs the value to be decided before anything is ' +
        'drawn. onBeforeInput is dispatched synchronously — on ' +
        'shouldChangeCharactersInRange on iOS and an InputFilter on Android — so ' +
        'the transform is invisible rather than corrected a frame later.'
      }>
      <Case
        title="onBeforeInput + setValue — uppercase as you type"
        note="No flicker: the lowercase character is never applied, so it is never drawn. Compare with a value-prop round trip, which shows the rejected character for one frame."
        readout={`value: ${JSON.stringify(upper)}`}>
        <input
          placeholder="Type lowercase"
          onBeforeInput={toUpper}
          onInput={e => setUpper(e.nativeEvent.value)}
        />
      </Case>

      <Case
        title="onBeforeInput + preventDefault — refuse digits"
        note="The keystroke never lands. The counter shows how many edits were refused."
        readout={`value: ${JSON.stringify(noDigits)} · refused: ${rejected}`}>
        <input
          placeholder="Letters only"
          onBeforeInput={blockDigits}
          onInput={e => setNoDigits(e.nativeEvent.value)}
        />
      </Case>

      <Case
        title="Controlled the ordinary way — a value prop"
        note="This is how React controls an input on the web too: let the character land, run the handler, write the prop back. Rejecting a character is simply not changing the state. Nothing here needs preventDefault."
        readout={`value: ${JSON.stringify(capped)}`}>
        <input
          value={capped}
          placeholder="Max 10, enforced in state"
          onInput={e => setCapped(e.nativeEvent.value.slice(0, 10))}
        />
      </Case>

      <Case
        title="Uncontrolled — defaultValue"
        note="The native view owns the text. defaultValue is applied once when the view is created and never again, which is why resetting one has to recreate it.">
        <input defaultValue="Owned by the native view" />
      </Case>
    </Screen>
  );
}

/* ------------------------------------------------------------ checkable ---- */

function Checkables() {
  const [checked, setChecked] = useState(false);
  const [size, setSize] = useState('m');

  return (
    <Screen
      intro={
        'Checkboxes and radios. A checkbox is a UISwitch on iOS and a CheckBox ' +
        'on Android — deviation: iOS has no checkbox, and a form boolean there ' +
        'is a switch. Both announce correctly to assistive technology as what ' +
        'they are.'
      }>
      <Case title="Controlled checkbox" readout={`checked: ${String(checked)}`}>
        <View style={ROW}>
          <input
            type="checkbox"
            checked={checked}
            onChange={e => setChecked(e.nativeEvent.checked)}
          />
          <Text>Subscribe</Text>
        </View>
      </Case>

      <Case
        title="Uncontrolled checkbox — defaultChecked"
        note="Tracked in state internally so what is drawn and what would be submitted cannot drift apart.">
        <View style={ROW}>
          <input type="checkbox" defaultChecked />
          <Text>Checked to begin with</Text>
        </View>
      </Case>

      <Case title="disabled">
        <View style={ROW}>
          <input type="checkbox" disabled />
          <Text style={{color: TERTIARY_COLOR}}>Disabled, off</Text>
        </View>
        <View style={ROW}>
          <input type="checkbox" disabled defaultChecked />
          <Text style={{color: TERTIARY_COLOR}}>Disabled, on</Text>
        </View>
      </Case>

      <Case
        title="Radio group — tied together by a shared name"
        note="Deviation: a real RadioButton on Android; on iOS a ring drawn from platform materials, because UIKit has no radio control. HTML radios are separate elements linked only by name, which no single UIKit control can express."
        readout={`size: ${size}`}>
        {[
          ['s', 'Small'],
          ['m', 'Medium'],
          ['l', 'Large'],
        ].map(([value, text]) => (
          <View key={value} style={ROW}>
            <input
              type="radio"
              name="size"
              value={value}
              checked={size === value}
              onChange={() => setSize(value)}
            />
            <Text>{text}</Text>
          </View>
        ))}
      </Case>
    </Screen>
  );
}

/* -------------------------------------------------------------- numeric ---- */

function NumericControls() {
  const [volume, setVolume] = useState(50);
  const [fine, setFine] = useState(0.5);

  return (
    <Screen
      intro={
        'Controls that carry a number: a slider, and the two elements that show ' +
        'one without taking input.'
      }>
      <Case
        title='type="range" — a UISlider / Material Slider'
        readout={`value: ${volume}`}>
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          onInput={e => setVolume(Number(e.nativeEvent.value))}
        />
      </Case>

      <Case
        title="min, max, step — a stepped range"
        note="step=0.25 over 0–1: the thumb snaps."
        readout={`value: ${fine}`}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.25}
          value={fine}
          onInput={e => setFine(Number(e.nativeEvent.value))}
        />
      </Case>

      <Case title="A wider range, styled">
        <input
          type="range"
          min={0}
          max={100}
          defaultValue={30}
          style={{width: 280}}
        />
      </Case>

      <Case title="disabled range">
        <input type="range" min={0} max={100} defaultValue={60} disabled />
      </Case>

      <Case
        title="<progress> — how far along a task is"
        note="Follows the range above, to show it is the same number in a different element.">
        <progress value={volume} min={0} max={100} style={{width: 280}} />
      </Case>

      <Case
        title="<progress> with no value — indeterminate"
        note="HTML's rule: a progress element with no value is indeterminate, and both platforms animate it.">
        <progress style={{width: 280}} />
      </Case>

      <Case
        title="<meter> — a measurement within a known range"
        note="Different meaning from progress: a gauge, not a task. They share a control here because the platforms have one bar.">
        <meter value={0.7} min={0} max={1} style={{width: 280}} />
      </Case>
    </Screen>
  );
}

/* --------------------------------------------------------------- choice ---- */

function SelectControls() {
  const [fruit, setFruit] = useState('banana');

  return (
    <Screen
      intro={
        'A <select> written the way HTML writes it, with <option> children. ' +
        'The options are read in JavaScript and handed to the control as one ' +
        'prop — an <option> is never mounted, because a platform menu is handed ' +
        'a list rather than laying out child views. Deviation: a pop-up UIMenu ' +
        'on iOS and a modal list on Android, deliberately different, and ' +
        'deliberately not the wheel Safari shows for a web page.'
      }>
      <Case title="Controlled" readout={`value: ${fruit}`}>
        <select value={fruit} onChange={e => setFruit(e.nativeEvent.value)}>
          <option value="apple">Apple</option>
          <option value="banana">Banana</option>
          <option value="cherry">Cherry</option>
        </select>
      </Case>

      <Case
        title="An option with no value takes its text as its value"
        note="HTML's rule, honoured by collectOptions.">
        <select defaultValue="Cherry">
          <option>Apple</option>
          <option>Banana</option>
          <option>Cherry</option>
        </select>
      </Case>

      <Case
        title="A disabled option"
        note="Present in the menu but not choosable.">
        <select>
          <option value="a">Available</option>
          <option value="b" disabled>
            Sold out
          </option>
          <option value="c">Also available</option>
        </select>
      </Case>

      <Case
        title="<optgroup>"
        note="Deviation: its options are kept and its heading is dropped, because neither platform's control draws group headers in a flat list. Losing the heading beats losing the options.">
        <select>
          <optgroup label="Citrus">
            <option value="orange">Orange</option>
            <option value="lemon">Lemon</option>
          </optgroup>
          <optgroup label="Berries">
            <option value="strawberry">Strawberry</option>
            <option value="raspberry">Raspberry</option>
          </optgroup>
        </select>
      </Case>

      <Case
        title="An untouched select submits its first option"
        note="Not an empty string — a browser selects the first option when nothing matches, and so does this.">
        <select>
          <option value="first">First (what an untouched form submits)</option>
          <option value="second">Second</option>
        </select>
      </Case>

      <Case title="disabled">
        <select disabled>
          <option>Cannot be opened</option>
        </select>
      </Case>

      <Case
        title="A label attribute overrides the text"
        note="What the menu shows comes from label when present.">
        <select>
          <option value="1" label="One (from label)">
            ignored text
          </option>
          <option value="2">Two</option>
        </select>
      </Case>
    </Screen>
  );
}

/* ------------------------------------------------------------- pickers ---- */

function PickerControls() {
  const [date, setDate] = useState('');
  const [bounded, setBounded] = useState('2026-06-15');
  const [time, setTime] = useState('09:30');
  const [stamp, setStamp] = useState('2026-06-15T09:30');
  const [colour, setColour] = useState('#0a84ff');
  const [file, setFile] = useState(null);

  return (
    <Screen
      intro={
        'The types that open something. Each is the system picker where one ' +
        'exists; where one does not, the deviation is noted.'
      }>
      <Case
        title='type="date" — the system date picker'
        note="An empty date input is where the two platforms differ: iOS shows today, because a compact UIDatePicker always displays some date, while Android shows a yyyy-mm-dd placeholder. A browser shows an empty field. The reported value is the empty string on both until something is picked."
        readout={`value: ${JSON.stringify(date)}`}>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.nativeEvent.value)}
        />
      </Case>

      <Case
        title='type="date" with min and max — a bounded year'
        note="Try to scroll past either end. Note these are controlled with value: defaultValue is not a prop on the date types, only on the textual ones."
        readout={`value: ${bounded}`}>
        <input
          type="date"
          min="2026-01-01"
          max="2026-12-31"
          value={bounded}
          onChange={e => setBounded(e.nativeEvent.value)}
        />
      </Case>

      <Case title='type="time"' readout={`value: ${time}`}>
        <input
          type="time"
          value={time}
          onChange={e => setTime(e.nativeEvent.value)}
        />
      </Case>

      <Case
        title='type="datetime-local"'
        note="Two pills, a date and a time, which is why this type has a wider user-agent width than the other two."
        readout={`value: ${stamp}`}>
        <input
          type="datetime-local"
          value={stamp}
          onChange={e => setStamp(e.nativeEvent.value)}
        />
      </Case>

      <Case
        title='type="color"'
        note="Deviation: UIColorPickerViewController on iOS — spectrum, sliders and eyedropper. On Android, a swatch grid, because Android has no system colour picker in either the framework or Material."
        readout={`value: ${colour}`}>
        <View style={ROW}>
          <input
            type="color"
            value={colour}
            onChange={e => setColour(e.nativeEvent.value)}
          />
          <View
            style={{
              width: 44,
              height: 28,
              borderRadius: 4,
              backgroundColor: colour,
              borderWidth: 1,
              borderColor: SEPARATOR_COLOR,
            }}
          />
        </View>
      </Case>

      <Case
        title='type="file"'
        note="Deviation, twice over: the system document picker rather than an action sheet offering Photos, and change reports a URI with name, size and type rather than the bytes — reading every picked file into memory is an out-of-memory crash waiting for the first video."
        readout={
          file == null
            ? 'no file chosen'
            : `${file.name} · ${file.size} bytes · ${file.type}`
        }>
        <input
          type="file"
          onChange={e => setFile(e.nativeEvent.files?.[0] ?? null)}
        />
      </Case>

      <Case title="accept and multiple">
        <input type="file" accept="image/*" style={{marginBottom: 8}} />
        <input type="file" multiple />
      </Case>
    </Screen>
  );
}

/* ------------------------------------------------------------- textarea ---- */

function TextAreas() {
  const [v, setV] = useState('');

  return (
    <Screen intro="Multi-line text. rows sets the visible height, as in HTML.">
      <Case title="<textarea rows={4}>" readout={`${v.length} characters`}>
        <textarea
          rows={4}
          placeholder="Write something longer…"
          onInput={e => setV(e.nativeEvent.value)}
        />
      </Case>

      <Case title="rows={2} and rows={8}">
        <textarea rows={2} placeholder="Two rows" style={{marginBottom: 8}} />
        <textarea rows={8} placeholder="Eight rows" />
      </Case>

      <Case
        title="defaultValue as children"
        note="HTML puts a textarea's initial text between the tags rather than in an attribute, and that works here.">
        <textarea rows={3}>{'Initial text,\nwritten as children.'}</textarea>
      </Case>

      <Case title="maxLength, readOnly, disabled">
        <textarea
          rows={2}
          maxLength={20}
          placeholder="Max 20"
          style={{marginBottom: 8}}
        />
        <textarea
          rows={2}
          readOnly
          defaultValue="Read-only"
          style={{marginBottom: 8}}
        />
        <textarea rows={2} disabled defaultValue="Disabled" />
      </Case>

      <Case title="Styled">
        <textarea
          rows={3}
          placeholder="Styled like the rest of the app"
          style={{
            borderWidth: 2,
            borderColor: '#0a84ff',
            borderRadius: 10,
            padding: 10,
            fontSize: 16,
          }}
        />
      </Case>
    </Screen>
  );
}

/* -------------------------------------------------------------- buttons ---- */

function Buttons() {
  const [count, setCount] = useState(0);

  return (
    <Screen
      intro={
        'A <button> inside a form submits it by default — type defaults to ' +
        '"submit", which is the most surprising rule in HTML forms and the one ' +
        'ported web code relies on. Outside a form there is nothing to submit, ' +
        'so it is inert.'
      }>
      <Case title="<button> with a click handler" readout={`clicks: ${count}`}>
        <button type="button" onClick={() => setCount(n => n + 1)}>
          Press me
        </button>
      </Case>

      <Case
        title="Press feedback is the platform's"
        note="Held down, it highlights the way every other button on the device does — the same gesture recognisers, not a JavaScript approximation.">
        <button type="button">Hold this down</button>
      </Case>

      <Case
        title="disabled"
        note="Greyed by the user-agent stylesheet rather than by the control: a button's label is whatever elements it contains, so the colour is inherited by them. An author colour still wins.">
        {/* One inline flow, exactly as HTML lays out adjacent buttons: two
            inline-blocks separated by a word space, sharing a line. The Case
            frame is a flex column, which had been stacking them edge-to-edge
            with no gap at all — a layout no platform's forms would show. */}
        <div>
          <button type="button" disabled>
            Disabled
          </button>{' '}
          <button type="button">Enabled — compare</button>
        </div>
      </Case>

      <Case
        title='<input type="submit"> and <input type="reset">'
        note='Their label is the value attribute, defaulting to "Submit" and "Reset" — HTML has no children on these.'>
        <View style={{...ROW, marginTop: 4}}>
          <input type="submit" />
          <input type="reset" />
          <input type="button" value="Custom label" />
        </View>
      </Case>

      <Case title="Styled buttons">
        <button
          type="button"
          style={{
            backgroundColor: '#0a84ff',
            paddingVertical: 12,
            paddingHorizontal: 20,
            borderRadius: 10,
            color: '#ffffff',
            fontWeight: '600',
            marginBottom: 8,
          }}>
          Filled
        </button>
        {/* `backgroundColor` is stated because the user-agent fill stays
            otherwise — the same thing a browser does, where an outlined button
            keeps `ButtonFace` until the author clears it. An outlined button
            IS an author decision about the background, so it says so. */}
        <button
          type="button"
          style={{
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            borderColor: '#0a84ff',
            paddingVertical: 12,
            paddingHorizontal: 20,
            borderRadius: 10,
            color: '#0a84ff',
            fontWeight: '600',
          }}>
          Outlined
        </button>
      </Case>
    </Screen>
  );
}

/* -------------------------------------------------------------- <form> ---- */

function entriesOf(formData) {
  const out = [];
  for (const [k, v] of formData.entries()) {
    out.push(`${k}=${String(v)}`);
  }
  return out.join('\n');
}

function WholeForm() {
  const [submitted, setSubmitted] = useState(null);
  const [method, setMethod] = useState('get');

  const onSubmit = useCallback(event => {
    // The DOM's order: the handler sees the event before the default action, so
    // preventDefault here stops the submission.
    event.preventDefault();
    setSubmitted({
      entries: entriesOf(event.formData),
      url: event.url,
      method: event.method,
      enctype: event.enctype,
      body: event.body == null ? 'null (GET)' : String(event.body),
    });
  }, []);

  return (
    <Screen
      intro={
        'A whole form. Every control registers with it, so submitting collects ' +
        'a FormData from all of them — including the uncontrolled ones, which ' +
        'keep their value in the native view and would otherwise have nothing ' +
        'to report. Reset puts them all back, which means recreating the native ' +
        'views, because defaultValue is applied once and never again.'
      }>
      <View style={{marginTop: 12}}>
        <form action="/api/signup" method={method} onSubmit={onSubmit}>
          <View style={{gap: 10}}>
            <Text style={NOTE}>name</Text>
            <input name="name" defaultValue="Ada" placeholder="Name" />

            <Text style={NOTE}>email</Text>
            <input name="email" type="email" placeholder="you@example.com" />

            <Text style={NOTE}>
              plan (select — untouched submits the first option)
            </Text>
            <select name="plan">
              <option value="free">Free</option>
              <option value="pro">Pro</option>
            </select>

            <Text style={NOTE}>
              newsletter (an unchecked box contributes nothing at all — not an
              empty string)
            </Text>
            <View style={ROW}>
              <input type="checkbox" name="newsletter" defaultChecked />
              <Text>Subscribe</Text>
            </View>

            <Text style={NOTE}>
              tier (radio — only the checked one is submitted)
            </Text>
            <View style={ROW}>
              <input type="radio" name="tier" value="monthly" defaultChecked />
              <Text>Monthly</Text>
              <input type="radio" name="tier" value="yearly" />
              <Text>Yearly</Text>
            </View>

            <Text style={NOTE}>notes</Text>
            <textarea name="notes" rows={2} placeholder="Anything else?" />

            <Text style={NOTE}>
              method — GET serialises the fields into the URL; POST encodes a
              body. Change it and submit again.
            </Text>
            {/* Nameless on purpose: a control without a name is never
                submitted (HTML §4.10.18.6), so the chooser can live inside
                the form — where the submit row needs to be — without
                touching the payload. Selection is fully controlled. */}
            <View style={ROW}>
              {['get', 'post'].map(m => (
                <View key={m} style={ROW}>
                  <input
                    type="radio"
                    value={m}
                    checked={method === m}
                    onChange={() => setMethod(m)}
                  />
                  <Text>{m.toUpperCase()}</Text>
                </View>
              ))}
            </View>

            <View style={{...ROW, marginTop: 4}}>
              <button type="submit">Submit</button>
              <button type="reset">Reset</button>
              <button type="button" onClick={() => setSubmitted(null)}>
                Clear output
              </button>
            </View>
          </View>
        </form>
      </View>

      {submitted != null ? (
        <View
          style={{
            marginTop: 12,
            padding: 12,
            backgroundColor: CARD_COLOR,
            borderRadius: 8,
          }}>
          <Text style={{fontWeight: '600', marginBottom: 6}}>Submission</Text>
          <Text style={{fontFamily: 'Menlo', fontSize: 11, lineHeight: 17}}>
            {`method:  ${submitted.method}\n` +
              `enctype: ${submitted.enctype}\n` +
              `url:     ${submitted.url}\n` +
              `body:    ${submitted.body}\n\n` +
              `entries:\n${submitted.entries}`}
          </Text>
        </View>
      ) : (
        <Text style={{...NOTE, marginTop: 12}}>
          Submit the form to see the FormData it produces.
        </Text>
      )}

      <Text style={{...NOTE, marginTop: 16}}>
        With no handler installed, a string action does nothing at all — no
        navigation and deliberately no network request. Firing a fetch and
        dropping the response is not "the default minus the navigation": it
        sends the user's data with no result and nothing to stop it happening
        twice. Handling belongs to whoever owns navigation.
      </Text>
    </Screen>
  );
}

function FunctionAction() {
  const [log, setLog] = useState([]);

  return (
    <Screen
      intro={
        'React 19 lets action be a function, and resets the uncontrolled fields ' +
        'once it succeeds — but only on success. An action that throws leaves ' +
        'what the user typed alone, which is the whole point: there would be ' +
        'nothing worse than clearing a form because the server was down.'
      }>
      <View style={{marginTop: 12, gap: 10}}>
        <form
          action={formData => {
            setLog(l => [`ok: ${entriesOf(formData)}`, ...l]);
          }}>
          <View style={{gap: 10}}>
            <input name="succeeds" defaultValue="cleared on success" />
            <button type="submit">Submit (succeeds)</button>
          </View>
        </form>

        <form
          action={formData => {
            setLog(l => [`threw: ${entriesOf(formData)}`, ...l]);
            throw new Error('server unavailable');
          }}>
          <View style={{gap: 10}}>
            <input name="throws" defaultValue="kept when the action throws" />
            <button type="submit">Submit (throws)</button>
          </View>
        </form>
      </View>

      <Text style={{...READOUT, marginTop: 12}}>
        {log.length === 0 ? 'no submissions yet' : log.join('\n')}
      </Text>
    </Screen>
  );
}

function GroupingAndLabels() {
  return (
    <Screen
      intro={'The elements that structure a form rather than carry a value.'}>
      <Case
        title="<fieldset> and <legend>"
        note="A group of related controls with a caption. Deviation: a browser notches the legend into the fieldset's top border; here it renders above the box, the way iOS grouped settings and Material set a group's label — see DOM-CSS-DEVIATION(fieldset-legend-position).">
        <fieldset>
          <legend>Delivery</legend>
          {/* The LAST row sheds its bottom margin: the box's symmetric UA
              padding is the vertical rhythm, and a trailing row margin
              stacked on it read as "too much bottom padding" (12 above the
              first row, 12 + 14 under the last). */}
          <View style={ROW}>
            <input
              type="radio"
              name="delivery"
              value="standard"
              defaultChecked
            />
            <Text>Standard</Text>
          </View>
          <View style={{...ROW, marginBottom: 0}}>
            <input type="radio" name="delivery" value="express" />
            <Text>Express</Text>
          </View>
        </fieldset>
      </Case>

      <Case
        title="<label htmlFor> — names the control"
        note='Invisible on screen and the most common real accessibility failure in a form: without it a screen reader announces "switch, off" and never says what it switches. Turn on VoiceOver or TalkBack and compare the two below.'>
        <View style={ROW}>
          <input id="remember" type="checkbox" />
          <label htmlFor="remember">Remember me</label>
        </View>
        <View style={ROW}>
          <input type="checkbox" />
          <Text>Unlabelled, for comparison</Text>
        </View>
      </Case>

      <Case
        title="<label> wrapping its control"
        note="HTML's other association, and the one that needs no id. The label is an inline element, so it is written as a run of text with the control inside it — and the control sits on the label's line, because an inline box shares its parent's formatting context. Its whole text content becomes the name, nested elements included.">
        <div style={{fontSize: 16}}>
          <label>
            <input type="checkbox" />
            {' Subscribe to the '}
            <strong>weekly</strong>
            {' newsletter'}
          </label>
        </div>
      </Case>

      <Case
        title="A label names a select and a textarea too"
        note="Same association, any control.">
        <label htmlFor="plan">Choose a plan</label>
        <select id="plan">
          <option value="free">Free</option>
          <option value="pro">Pro</option>
        </select>
        <View style={{height: 10}} />
        <label htmlFor="notes">Your notes</label>
        <textarea id="notes" rows={2} placeholder="Anything else?" />
      </Case>

      <Case
        title="Deviation: tapping a label does not activate its control"
        note="Intentional, not a gap — see DOM-CSS-DEVIATION(label-activation). The association names the control for assistive technology, which is the half that matters. Label-click activation is a pointer-era affordance for 13px targets; the platforms' own 44pt/48dp controls ARE the touch target, and neither iOS Settings nor Material rows toggle from their caption text.">
        <View style={ROW}>
          <input id="tapme" type="checkbox" />
          <label htmlFor="tapme">
            Tapping this text does not toggle the box
          </label>
        </View>
      </Case>

      <Case
        title="<output>"
        note="The result of a calculation, as a text-level element.">
        <div style={{fontSize: 16}}>
          Subtotal <output>£24.00</output> plus delivery <output>£3.99</output>.
        </div>
      </Case>
    </Screen>
  );
}

export default {
  title: 'HTML: forms',
  category: 'UI',
  description:
    'Form controls — §4.10. Every one is a real platform control reached ' +
    'through the HTML element that means it.',
  examples: [
    {name: 'text', title: 'Text input types', fullBleed: true, render: () => <TextInputs />},
    {
      name: 'textAttributes',
      fullBleed: true,
      title: 'Text field attributes',
      render: () => <TextAttributes />,
    },
    {
      name: 'controlled',
      fullBleed: true,
      title: 'Controlled input & onBeforeInput',
      render: () => <ControlledInputs />,
    },
    {
      name: 'checkable',
      fullBleed: true,
      title: 'Checkbox and radio',
      render: () => <Checkables />,
    },
    {
      name: 'numeric',
      fullBleed: true,
      title: 'Range, progress and meter',
      render: () => <NumericControls />,
    },
    {
      name: 'select',
      fullBleed: true,
      title: 'Select and options',
      render: () => <SelectControls />,
    },
    {
      name: 'pickers',
      fullBleed: true,
      title: 'Date, time, colour and file',
      render: () => <PickerControls />,
    },
    {name: 'textarea', title: 'Textarea', fullBleed: true, render: () => <TextAreas />},
    {name: 'buttons', title: 'Buttons', fullBleed: true, render: () => <Buttons />},
    {
      name: 'form',
      fullBleed: true,
      title: 'A whole form & submission',
      render: () => <WholeForm />,
    },
    {
      name: 'functionAction',
      fullBleed: true,
      title: 'A function action',
      render: () => <FunctionAction />,
    },
    {
      name: 'grouping',
      fullBleed: true,
      title: 'Fieldset, legend, label, output',
      render: () => <GroupingAndLabels />,
    },
  ],
};
