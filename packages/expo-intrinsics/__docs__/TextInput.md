# `<input>` and `<textarea>`: doing better than React Native's TextInput

The brief is a text input that is both **synchronous** and **controlled** — the
two properties RN's `TextInput` cannot deliver together, and the reason masked,
formatted or limited inputs feel wrong in React Native apps.

The useful discovery is that **React Native already has the mechanism**, on both
platforms, and uses it for exactly one feature.

**Scope: nothing here changes React Native's `TextInput`.** The elements are new
surface and the change stays inside them. RN's implementation is studied because
it explains precisely why the synchronous path has to come from the backing
component rather than from JavaScript — and therefore why the element's
behaviour differs by tier, which is a thing to document rather than to fix by
patching shared code.

---

## What RN gets right, and it is more than it is given credit for

RN's controlled-value reconciliation is sound. Every native text change carries
an `eventCount`; JS records the most recent one; when JS pushes a value back it
sends that count along, and **native rejects the update if its own count has
moved on**. So a stale JS value cannot clobber newer keystrokes — the failure
mode people assume is happening is actually defended against.

Keep this protocol. It is the correct answer to "two sources of truth, one
asynchronous link", and the element should reuse it rather than invent another.

## Where it actually fails

The problem is not correctness, it is **latency of the decision**. A controlled
input's round trip is:

> keystroke → native applies it and draws → `onChange` → JS state → re-render →
> `useLayoutEffect` → `setTextAndSelection` back to native

Every step after "draws" happens _after the user has already seen the
character_. So anything that changes the text — a phone-number mask, an
uppercase transform, a length limit, a character whitelist — necessarily shows
the raw keystroke first and corrects it a frame or more later. That is the
visible jump in every masked-input library, and no amount of reconciliation
fixes it, because the decision is made on the wrong side of an asynchronous
boundary.

## The mechanism RN already has

Both platforms expose a **synchronous, per-keystroke veto and transform hook**
that runs _before_ the character is committed, and RN implements it on both:

**iOS** — `RCTTextInputComponentView.textInputShouldChangeText:inRange:`, called
from the `UITextField`/`UITextView` delegate. Its contract is already exactly
what is needed:

- return `nil` → the keystroke is **rejected**, nothing is drawn;
- return the same string → committed normally;
- return a **different** string → substituted synchronously, before display.

**Android** — `InputFilter` on the `EditText`, the same veto-or-substitute
contract.

And what does RN use this for? **`maxLength`, and nothing else.** On iOS the
method fires an async `onKeyPress` notification, applies `maxLength`, and
otherwise returns the text unchanged; on Android the filter list holds a
`LengthFilter`.

That single case is also the proof the approach works. **`maxLength` does not
flicker, while the same limit written in `onChangeText` does** — same behaviour,
same input, and the only difference is which side of the async boundary the
decision is made on. RN contains its own counter-example.

## What the element should do: `beforeinput`

The web already named this event. `beforeinput` fires **before** the DOM is
modified and is **cancelable** — `preventDefault()` rejects the input, and the
`data` it carries is what is about to be inserted. That is precisely the
contract of `textInputShouldChangeText` and `InputFilter`.

The element does **not** get this by modifying RN's `TextInput`. It gets it from
**Expo UI's `TextInput`**, which already runs `onChangeText` as a worklet on the
UI thread against a `useNativeState` value — the same synchronous-decision
property, reached through a component we depend on rather than through a change
to shared React Native code.

What `beforeinput` gives us is the _authoring surface_ over that: a
web-standard, cancelable event, rather than an Expo-UI-specific API leaking into
HTML.

```jsx
<input
  onBeforeInput={e => {
    'worklet';
    if (!/^[0-9]*$/.test(e.data)) e.preventDefault(); // reject, nothing drawn
  }}
  onChange={e => setValue(e.target.value)} // ordinary JS, async
/>
```

- **`onBeforeInput` runs synchronously**, on the UI thread as a worklet, and its
  return path maps onto the platform contract: cancelled → `nil` / filter
  rejects; text replaced → the substitute string. Nothing incorrect is ever
  drawn, so masks and limits do not jump.
- **`onChange` stays ordinary JavaScript** on the JS thread. It cannot affect
  what was committed — which is correct, and is also how the DOM behaves.
- **`value` stays controlled**, reconciled with RN's `eventCount` protocol.

Note this is a Fabric event-emitter path, not something an author has to know
about: `topBeforeInput` already exists in RN's event vocabulary
(`EventPerformanceLogger`), so the name is not being introduced from nothing.

## Why this makes "synchronous and controlled" stop being a contradiction

The two goals conflict only while the _decision_ about what text exists is made
in JS. Move that decision to the hook the platform already provides and the
conflict dissolves:

- **synchronous**, because the transform runs before the glyph is drawn;
- **controlled**, because `value` still governs, via a protocol that already
  rejects stale writes.

The author writes web-standard HTML. The behaviour is the platform's.

## Where Expo UI fits

Expo UI's `TextInput` reaches the same goal from the other direction: `value` is
an `ObservableState` from `useNativeState`, and `onChangeText` runs as a worklet
on the UI thread with no React render per keystroke. That is the right
architecture and the element should use it as the tier-1/tier-2 backing.

The trap, restated here because it is the easy mistake: wrapping it in HTML's
`<input value onChange>` **as a React controlled component** re-imposes a render
per keystroke and throws away exactly what Expo UI bought. The element's default
must be the DOM's own model — the input owns its value, `value` is an initial
value plus an override channel — with `beforeinput` as the synchronous hook.
HTML and Expo UI agree here; React's controlled-input convention is the outlier.

## Scope, in order

Everything below is inside the new elements. No file outside this package
changes, and RN's `TextInput` is used as-is where it is used at all.

1. **`<input>`/`<textarea>` elements**, uncontrolled by default — the input owns
   its value, `value` is an initial value plus an override channel. This is the
   DOM's own model and it is what keeps the value off the JS thread.
2. **Expo UI backing** for tiers 1 and 2, with `onBeforeInput` mapped onto its
   worklet `onChangeText`. This is where the synchronous transform comes from.
3. **The tier-3 fallback on RN's `TextInput`**, unmodified: the same element
   API, the same `eventCount` reconciliation for the controlled path, and
   `onBeforeInput` degraded to a JS-thread handler that cannot veto before draw.

### The one behavioural difference between tiers, stated rather than hidden

Tier 3 cannot make the transform synchronous, because the hook that would allow
it is inside RN's `TextInput` and we are not changing it. So on tier 3 a mask or
a whitelist shows the raw keystroke for a frame before correcting — RN's
existing behaviour, no worse and no better.

That is a real difference and it must be **documented per element, not papered
over**. The alternative — silently behaving differently depending on what is
installed, with no way for an author to know — is worse than the latency itself.
`maxLength` is the useful exception worth naming: it keeps working synchronously
even on tier 3, because RN already implements it on the native hook.

A future option, if the tier-3 gap turns out to matter: a small native text
input of our own inside this package, using the same platform hooks. That keeps
the change within the package's boundary. It is deliberately not step 1 — the
tiers above cover the cases that motivated this, and an extra native component
is a cost to justify with evidence rather than to assume.
