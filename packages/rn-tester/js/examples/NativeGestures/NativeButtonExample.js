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
 * `<button>` on the native gesture floor.
 *
 * What this exists to demonstrate — and what the numbers on screen are for — is
 * that the press state is decided by the platform rather than by JavaScript:
 *
 *  - **press in / press out** are reported natively, so `:active`-style feedback
 *    does not wait for a JS round trip;
 *  - **a scroll cancels the press**, decided in the platform's own gesture
 *    arbitration. The buttons are deliberately inside a scroll view so this is
 *    testable: press one, drag vertically, and the press must release *and* not
 *    click;
 *  - **a press does not even begin** if the finger was on its way past. Inside a
 *    scrolling container both platforms hold the press back briefly to see
 *    whether a scroll was meant, which is why swiping across a list of buttons
 *    in a native app never flashes them. `press-ins` staying at 0 after a quick
 *    swipe is that behaviour;
 *  - **click still fires exactly once**, because none of this dispatches
 *    activation — that already arrives natively through the pointer path. A
 *    doubled count here would mean both paths are firing.
 */

import * as React from 'react';
import {useState} from 'react';
import {ScrollView, Text, View} from 'react-native';

function TrackedButton({label, disabled, touchAction}) {
  const [pressed, setPressed] = useState(false);
  const [clicks, setClicks] = useState(0);
  const [presses, setPresses] = useState(0);

  return (
    <View style={{marginBottom: 14}}>
      <button
        disabled={disabled}
        touchAction={touchAction}
        onPressChange={e => {
          const next = e.nativeEvent.pressed;
          setPressed(next);
          if (next) {
            setPresses(n => n + 1);
          }
        }}
        onClick={() => setClicks(n => n + 1)}
        style={{
          paddingVertical: 14,
          paddingHorizontal: 18,
          borderRadius: 10,
          // The press feedback is driven entirely by the native recognizer.
          backgroundColor: disabled
            ? '#d7d7db'
            : pressed
              ? '#0a3d91'
              : '#0a84ff',
        }}>
        <Text style={{color: 'white', fontSize: 16}}>{label}</Text>
      </button>
      <Text style={{fontSize: 13, color: '#48484a', marginTop: 4}}>
        {`pressed: ${pressed ? 'YES' : 'no'}   press-ins: ${presses}   clicks: ${clicks}`}
      </Text>
    </View>
  );
}

function TrackedAnchor() {
  const [clicks, setClicks] = useState(0);
  return (
    <View style={{marginBottom: 14}}>
      <div>
        <a href="https://example.com" onClick={() => setClicks(n => n + 1)}>
          A link with href
        </a>
        {'   '}
        <a>An anchor without href</a>
      </div>
      <Text style={{fontSize: 13, color: '#48484a', marginTop: 4}}>
        {`link clicks: ${clicks}`}
      </Text>
    </View>
  );
}

function TrackedRange() {
  const [value, setValue] = useState(50);
  const [committed, setCommitted] = useState(null);
  const [inputs, setInputs] = useState(0);

  return (
    <View style={{marginBottom: 14}}>
      <Text style={{fontSize: 13, color: '#6b6b70', marginBottom: 4}}>
        {'<input type="range"> — a real UISlider / seek bar'}
      </Text>
      {/* The control that the drag-ownership work exists for: scrubbing this
          inside the scroll view must move the thumb, not scroll the list. */}
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        onInput={e => {
          setValue(e.nativeEvent.value);
          setInputs(n => n + 1);
        }}
        onChange={e => setCommitted(e.nativeEvent.value)}
      />
      <Text style={{fontSize: 13, color: '#48484a', marginTop: 4}}>
        {`value: ${value}   inputs: ${inputs}   committed: ${
          committed == null ? '—' : committed
        }`}
      </Text>
    </View>
  );
}

function TrackedCheckbox() {
  const [checked, setChecked] = useState(false);
  const [changes, setChanges] = useState(0);
  return (
    <View style={{marginBottom: 14}}>
      <Text style={{fontSize: 13, color: '#6b6b70', marginBottom: 4}}>
        {'<input type="checkbox"> — a UISwitch on iOS, a CheckBox on Android'}
      </Text>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => {
          setChecked(e.nativeEvent.checked);
          setChanges(n => n + 1);
        }}
      />
      <Text style={{fontSize: 13, color: '#48484a', marginTop: 4}}>
        {`checked: ${checked ? 'YES' : 'no'}   changes: ${changes}`}
      </Text>
    </View>
  );
}

/*
 * A *controlled* text field — the case that catches the bug worth catching.
 *
 * The value lives in React state, so every keystroke round-trips through
 * JavaScript and comes back as a prop. If the element wrote that prop back
 * blindly, fast typing would rewind the field and characters would drop or
 * swap, because the value for keystroke N arrives after N+1 has been typed.
 * `mostRecentEventCount` is what stops it: the count of edits JavaScript has
 * processed, echoed back so the view can tell a current value from a stale one.
 *
 * The mirrored text below is the check — it must always match the field.
 */
function TrackedTextInput() {
  const [value, setValue] = useState('');
  const [eventCount, setEventCount] = useState(0);
  const [inputs, setInputs] = useState(0);
  const [committed, setCommitted] = useState(null);
  const [changes, setChanges] = useState(0);
  const [focused, setFocused] = useState(false);
  return (
    <View style={{marginBottom: 14}}>
      <Text style={{fontSize: 13, color: '#6b6b70', marginBottom: 4}}>
        {'<input type="text"> — a UITextField on iOS, an EditText on Android'}
      </Text>
      <input
        type="text"
        placeholder="Type here"
        value={value}
        mostRecentEventCount={eventCount}
        onInput={e => {
          setValue(e.nativeEvent.value);
          setEventCount(e.nativeEvent.eventCount);
          setInputs(n => n + 1);
        }}
        onChange={e => {
          setCommitted(e.nativeEvent.value);
          setChanges(n => n + 1);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <Text style={{fontSize: 13, color: '#48484a', marginTop: 4}}>
        {`text: ${JSON.stringify(value)}   inputs: ${inputs}   ` +
          `committed: ${committed == null ? '—' : JSON.stringify(committed)}   ` +
          `changes: ${changes}   focused: ${focused ? 'YES' : 'no'}`}
      </Text>
    </View>
  );
}

/* An uncontrolled field, whose `defaultValue` seeds it once and is never
   written again — the other half of the HTML contract. */
function TrackedUncontrolledInput() {
  const [committed, setCommitted] = useState(null);
  return (
    <View style={{marginBottom: 14}}>
      <Text style={{fontSize: 13, color: '#6b6b70', marginBottom: 4}}>
        {'<input type="email" defaultValue> — uncontrolled, email keyboard'}
      </Text>
      <input
        type="email"
        defaultValue="a@b.com"
        onChange={e => setCommitted(e.nativeEvent.value)}
      />
      <Text style={{fontSize: 13, color: '#48484a', marginTop: 4}}>
        {`email committed: ${committed == null ? '—' : JSON.stringify(committed)}`}
      </Text>
    </View>
  );
}

/* `<textarea>` — the multi-line control, with the same controlled-value
   handshake as `<input>`. Return must insert a newline here rather than
   committing, which is why this element has no submit event. */
function TrackedTextArea() {
  const [value, setValue] = useState('');
  const [eventCount, setEventCount] = useState(0);
  const [inputs, setInputs] = useState(0);
  return (
    <View style={{marginBottom: 14}}>
      <Text style={{fontSize: 13, color: '#6b6b70', marginBottom: 4}}>
        {'<textarea> — a UITextView on iOS, a multi-line EditText on Android'}
      </Text>
      <textarea
        rows={3}
        placeholder="Multiple lines"
        value={value}
        mostRecentEventCount={eventCount}
        onInput={e => {
          setValue(e.nativeEvent.value);
          setEventCount(e.nativeEvent.eventCount);
          setInputs(n => n + 1);
        }}
      />
      <Text style={{fontSize: 13, color: '#48484a', marginTop: 4}}>
        {`lines: ${value.split('\n').length}   chars: ${value.length}   inputs: ${inputs}`}
      </Text>
    </View>
  );
}

/* `<progress>` and `<meter>` — readouts, not controls. The indeterminate case
   is the one worth seeing: a `<progress>` with no `value` is a task with no
   known end, which each platform draws its own way. */
function TrackedProgress() {
  const [value, setValue] = useState(0.3);
  return (
    <View style={{marginBottom: 14}}>
      <Text style={{fontSize: 13, color: '#6b6b70', marginBottom: 4}}>
        {'<progress>, indeterminate <progress>, and <meter>'}
      </Text>
      <progress value={value} max={1} />
      <progress />
      <meter value={0.7} min={0} max={1} />
      <button
        onClick={() =>
          setValue(v => (v >= 1 ? 0 : Math.round((v + 0.25) * 100) / 100))
        }
        style={{
          paddingVertical: 8,
          paddingHorizontal: 12,
          borderRadius: 8,
          backgroundColor: '#0a84ff',
          marginTop: 6,
        }}>
        <Text style={{color: 'white', fontSize: 14}}>Advance</Text>
      </button>
      <Text style={{fontSize: 13, color: '#48484a', marginTop: 4}}>
        {`progress value: ${value}`}
      </Text>
    </View>
  );
}

/* `<select>` written the way HTML writes it. The tag resolves to a JavaScript
   component that reads these `<option>` children and hands the control a list —
   a native select is given its options, it does not lay them out. */
function TrackedSelect() {
  const [value, setValue] = useState('b');
  const [changes, setChanges] = useState(0);
  return (
    <View style={{marginBottom: 14}}>
      <Text style={{fontSize: 13, color: '#6b6b70', marginBottom: 4}}>
        {
          '<select> with <option> children — a UIMenu on iOS, a Spinner on Android'
        }
      </Text>
      <select
        value={value}
        onChange={e => {
          setValue(e.nativeEvent.value);
          setChanges(n => n + 1);
        }}>
        <option value="a">Apple</option>
        <option value="b">Banana</option>
        <option value="c" disabled={true}>
          Cherry
        </option>
        <option value="d">Damson</option>
      </select>
      <Text style={{fontSize: 13, color: '#48484a', marginTop: 4}}>
        {`selected: ${value}   changes: ${changes}`}
      </Text>
    </View>
  );
}

/* Radios. Exclusivity is the form's job in the DOM, not the control's, so the
   group is held in state here — which is also the check that a chosen radio
   cannot be un-chosen by tapping it again. */
function TrackedRadios() {
  const [choice, setChoice] = useState('one');
  const [changes, setChanges] = useState(0);
  const choose = next => {
    setChoice(next);
    setChanges(n => n + 1);
  };
  return (
    <View style={{marginBottom: 14}}>
      <Text style={{fontSize: 13, color: '#6b6b70', marginBottom: 4}}>
        {'<input type="radio"> — a RadioButton on Android, drawn on iOS'}
      </Text>
      <View style={{flexDirection: 'row', alignItems: 'center'}}>
        <input
          type="radio"
          name="pick"
          value="one"
          checked={choice === 'one'}
          onChange={() => choose('one')}
        />
        <Text style={{marginRight: 16}}>One</Text>
        <input
          type="radio"
          name="pick"
          value="two"
          checked={choice === 'two'}
          onChange={() => choose('two')}
        />
        <Text>Two</Text>
      </View>
      <Text style={{fontSize: 13, color: '#48484a', marginTop: 4}}>
        {`choice: ${choice}   changes: ${changes}`}
      </Text>
    </View>
  );
}

/* Date and time. The value crosses in the DOM's own string format, which is
   what makes the same code work on the web. */
function TrackedDates() {
  const [date, setDate] = useState('2026-03-14');
  const [time, setTime] = useState('09:30');
  return (
    <View style={{marginBottom: 14}}>
      <Text style={{fontSize: 13, color: '#6b6b70', marginBottom: 4}}>
        {'<input type="date"> and "time" — platform pickers'}
      </Text>
      <input
        type="date"
        value={date}
        min="2020-01-01"
        max="2030-12-31"
        onChange={e => setDate(e.nativeEvent.value)}
      />
      <input
        type="time"
        value={time}
        onChange={e => setTime(e.nativeEvent.value)}
      />
      <Text style={{fontSize: 13, color: '#48484a', marginTop: 4}}>
        {`date: ${date}   time: ${time}`}
      </Text>
    </View>
  );
}

/* Colour. The one element where the platforms are unequal: iOS presents the
   system picker, Android a swatch grid, because it has no system picker. */
function TrackedColor() {
  const [color, setColor] = useState('#34c759');
  const [changes, setChanges] = useState(0);
  return (
    <View style={{marginBottom: 14}}>
      <Text style={{fontSize: 13, color: '#6b6b70', marginBottom: 4}}>
        {'<input type="color"> — system picker on iOS, swatch grid on Android'}
      </Text>
      <input
        type="color"
        value={color}
        onChange={e => {
          setColor(e.nativeEvent.value);
          setChanges(n => n + 1);
        }}
      />
      <Text style={{fontSize: 13, color: '#48484a', marginTop: 4}}>
        {`colour: ${color}   changes: ${changes}`}
      </Text>
    </View>
  );
}

/* Files. The picker returns handles rather than bytes — a browser hands
   `FormData` the file's contents, which would be an out-of-memory crash for a
   video here. */
function TrackedFile() {
  const [files, setFiles] = useState([]);
  return (
    <View style={{marginBottom: 14}}>
      <Text style={{fontSize: 13, color: '#6b6b70', marginBottom: 4}}>
        {'<input type="file"> — the system document picker on both'}
      </Text>
      <input
        type="file"
        accept="image/*,.pdf"
        multiple={true}
        onChange={e => setFiles(e.nativeEvent.files)}
      />
      <Text style={{fontSize: 13, color: '#48484a', marginTop: 4}}>
        {files.length === 0
          ? 'no files chosen'
          : files.map(f => `${f.name} (${f.type || 'unknown'})`).join(', ')}
      </Text>
    </View>
  );
}

/* A real `<form>`: named controls, a submit button with no handler of its own,
   and React 19's function action. The point being demonstrated is that none of
   the controls are told about the form — they find it, and an *uncontrolled*
   input still submits, because the control remembers what the native view
   holds. */
function TrackedForm() {
  const [submitted, setSubmitted] = useState(null);
  const [submits, setSubmits] = useState(0);
  return (
    <View style={{marginBottom: 14}}>
      <Text style={{fontSize: 13, color: '#6b6b70', marginBottom: 4}}>
        {'<form action={fn}> — named controls gathered into FormData'}
      </Text>
      <form
        action={formData => {
          const parts = [];
          for (const [name, value] of formData) {
            parts.push(`${name}=${String(value)}`);
          }
          setSubmitted(parts.join(' '));
          setSubmits(n => n + 1);
        }}>
        {/* Uncontrolled on purpose: its value lives in the native view, and
            the form still gets it. */}
        <input type="text" name="who" defaultValue="ada" />
        <input type="checkbox" name="agree" defaultChecked={true} />
        <select name="fruit" defaultValue="b">
          <option value="a">Apple</option>
          <option value="b">Banana</option>
        </select>
        {/* No onClick: HTML's default type for a button is submit. */}
        <button
          style={{
            paddingVertical: 10,
            paddingHorizontal: 16,
            borderRadius: 8,
            backgroundColor: '#0a84ff',
            marginTop: 6,
          }}>
          <Text style={{color: 'white', fontSize: 15}}>Submit</Text>
        </button>
      </form>
      <Text style={{fontSize: 13, color: '#48484a', marginTop: 4}}>
        {`submits: ${submits}   submitted: ${submitted == null ? '—' : submitted}`}
      </Text>
    </View>
  );
}

/* The controlled-input question: does rejecting or transforming a keystroke
   need preventDefault? On the web it does not — React lets the character land
   and then writes the value back if the prop disagrees. This does the same:
   type lowercase, and the field must end up uppercase, with anything after a
   digit refused outright. */
function TrackedTransformInput() {
  const [value, setValue] = useState('');
  const [eventCount, setEventCount] = useState(0);
  const [rejected, setRejected] = useState(0);
  return (
    <View style={{marginBottom: 14}}>
      <Text style={{fontSize: 13, color: '#6b6b70', marginBottom: 4}}>
        {'controlled <input>: uppercases, and refuses digits'}
      </Text>
      <input
        type="text"
        value={value}
        mostRecentEventCount={eventCount}
        // Synchronous: this runs *before* the control applies the edit, so a
        // refused or transformed keystroke is never drawn. Compare with the
        // `onInput` path below, which corrects the field a frame later.
        onBeforeInput={e => {
          const next = e.nativeEvent.value;
          if (/[0-9]/.test(next)) {
            e.nativeEvent.preventDefault();
            setRejected(n => n + 1);
            return;
          }
          const upper = next.toUpperCase();
          if (upper !== next) {
            e.nativeEvent.setValue(upper);
          }
        }}
        onInput={e => {
          setValue(e.nativeEvent.value);
          setEventCount(e.nativeEvent.eventCount);
        }}
      />
      <Text style={{fontSize: 13, color: '#48484a', marginTop: 4}}>
        {`value: ${JSON.stringify(value)}   rejected: ${rejected}`}
      </Text>
    </View>
  );
}

function NativeButtons() {
  return (
    <ScrollView
      style={{maxHeight: 460}}
      contentContainerStyle={{padding: 16}}
      testID="native-button-scroll">
      <Text style={{fontSize: 13, color: '#6b6b70', marginBottom: 12}}>
        Press a button and drag vertically: the press must release and the click
        count must not change — the scroll claims the gesture in the platform's
        own arbitration.
      </Text>

      {/* Bare text children, which is how HTML buttons are actually written.
          The generic box paints an anonymous inline formatting context for
          them; this is here to prove the interactive box does too, rather than
          silently rendering an empty rectangle. */}
      <View style={{marginBottom: 14}}>
        <button
          style={{
            paddingVertical: 14,
            paddingHorizontal: 18,
            borderRadius: 10,
            backgroundColor: '#34c759',
          }}>
          Bare text child
        </button>
      </View>

      {/* Anchors. The UA style is a function of props here, exactly as a
          browser's `a:link` selector is: only the one with an href is blue and
          underlined, and the bare anchor is ordinary text.

          The counter also checks the claim that matters for anchors inside a
          scrollable: a tap on the link must click, and a press-then-drag must
          scroll *without* clicking, decided natively. */}
      <TrackedAnchor />

      <TrackedRange />
      <TrackedCheckbox />
      <TrackedTextInput />
      <TrackedUncontrolledInput />
      <TrackedTextArea />
      <TrackedSelect />
      <TrackedRadios />
      <TrackedDates />
      <TrackedColor />
      <TrackedFile />
      <TrackedForm />
      <TrackedTransformInput />
      <TrackedProgress />

      <TrackedButton label="Press me" />
      {/* `touch-action: none` claims the gesture, so dragging from this one
          must NOT scroll the list and must NOT release the press — the rule
          that makes a slider usable inside a scrollable. The button above it
          is the control: same drag, but the scroll wins. */}
      <TrackedButton
        label="Owns the drag (touch-action: none)"
        touchAction="none"
      />
      <TrackedButton label="Disabled" disabled={true} />

      {Array.from({length: 8}, (_, i) => (
        <TrackedButton key={i} label={`Row ${i + 1}`} />
      ))}
    </ScrollView>
  );
}

export default {
  title: 'Native gesture buttons',
  category: 'UI',
  description:
    '<button> backed by element-button, with press state from a real platform ' +
    'gesture recognizer instead of the JS responder system.',
  examples: [
    {
      name: 'nativeButtons',
      title: '<button> press state and scroll cancellation',
      render: () => <NativeButtons />,
    },
  ],
};
