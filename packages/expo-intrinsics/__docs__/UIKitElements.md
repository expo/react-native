# The native elements: UIKit and Android View implementations, written from scratch

**Scope, decided.** Every interactive HTML element gets a **UIKit**
implementation and an **Android View** implementation, written for this catalog,
**landing together per element**. An element is not done on one platform; it is
done on both, or it is in progress.

SwiftUI and Jetpack Compose are out of scope for now. React Native's components
are not used — not `TextInput`, not `Switch`, not `ScrollView`, not `Pressable`.
RN's source is a _reference_, as are the best community packages, and nothing
more.

Two bars, both absolute:

1. **No compromise in UI/UX** against a native app built without Expo. If a
   first-party iOS app does it, the element does it.
2. **The full DOM API** for each element — properties, attributes, events and
   methods — not the subset that happens to be easy.

This supersedes the automatic-SwiftUI design in
[`NativeBackedElements.md`](NativeBackedElements.md) §3 and the Expo UI backing
described in [`PlatformFidelity.md`](PlatformFidelity.md). Implicit selection of
a SwiftUI control by ancestry is not happening: the same tag must not render two
different controls depending on where it sits.

---

## 1. What "no compromise" actually requires

This is the part that is easy to underestimate, so it is written down as a
checklist rather than a sentiment. A control is not done until all of it is
true:

- **Platform interaction.** Native gesture recognizers (§2), correct highlight
  and selection feedback, correct cancellation when a scroll claims the gesture,
  and the platform's own haptics where the platform uses them.
- **Text input behaviour**: the system keyboard and its accessory view, the
  input assistant bar, autocorrect and autofill (`textContentType`), the loupe
  and selection handles, undo/redo, dictation, hardware-keyboard shortcuts,
  Smart Punctuation, and `inputAccessoryView`.
- **Accessibility**: correct traits and roles, VoiceOver _and TalkBack_ order
  and announcements, Dynamic Type and Android font scale, Bold Text, Reduce
  Motion, Increase Contrast, Switch Control and Full Keyboard Access.
- **Appearance**: light/dark, tint colour inheritance, `UIUserInterfaceStyle`
  and Material theming (including Material You dynamic colour), RTL mirroring,
  and each platform's own control metrics — not approximations of them.
- **System integration**: Handoff and Spotlight where relevant, Live Text,
  pasteboard behaviour, drag and drop, Scribble on iPad; on Android,
  edge-to-edge insets, predictive back, and the text toolbar.

Anything in this list that an element _cannot_ do gets written down in the
limitations register rather than quietly skipped. That is the difference between
a gap and a defect.

## 2. The gesture floor

**Every element here uses native gesture recognizers. None uses React Native's
responder system.** Flag-gated, so nothing already shipping moves.

The responder system arbitrates in JavaScript, so a press resolves a frame or
more after the touch, and a gesture that a scroll should claim cannot be handed
over without a round trip. Native recognizers arbitrate in the platform's own
arena:

- **iOS** — `UIGestureRecognizer` dependencies, `requires(toFail:)`, and the
  scroll view's `panGestureRecognizer`, with `delaysContentTouches` deciding
  when a press may begin at all.
- **Android** — `ViewGroup.onInterceptTouchEvent`, `requestDisallowIntercept`,
  the nested-scrolling contract, and `ViewConfiguration`'s touch slop and tap
  timeouts.

Either way the result is what makes a button inside a scrollable feel correct:
the scroll wins, the press cancels, no JS involved. The two platforms reach it
through different mechanisms, which is exactly why the Android implementation
has to be written against Android's model rather than translated from the iOS
one.

Mixing the two is worse than either, because arbitration has to happen
somewhere. Hence one flag for the whole new-element surface rather than a
per-element choice.

React Native Gesture Handler is the design reference. It is **not a dependency**
of this repo, so this is work to build, not a package to adopt.

### What building it actually taught us

Two findings changed the design, and both came from running it.

**A gesture recognizer is the wrong place for press state.** A scroll view's
`delaysContentTouches` holds a touch back to see whether a scroll was meant, and
it does that by delaying delivery **to the view**. Recognizers sit outside that:
UIKit hands them the touch immediately whatever the scroll view later decides.
So a recognizer-driven press lights up the instant the finger lands and
un-lights when the pan takes over — the flicker you see swiping across a list in
an app that rolled its own touch handling. Measured: a 120ms swipe starting on a
button still registered a press. `UIControl` tracks touches at the _view_ level
for exactly this reason, and moving the press there fixed it, with no timing
reimplemented — the platform simply chooses when to deliver the touch.

React Native also hard-codes `delaysContentTouches = NO` on every scroll view,
because its JavaScript touchables re-implement the delay themselves in
`delayPressIn`. Under the flag that goes back to the platform's default.

**On Android the framework's copy of the rule cannot run.**
`ReactViewGroup.onTouchEvent` returns `true` without calling `super`, because
React Native dispatches touches in JavaScript — so `View.onTouchEvent`, which
already implements all of this, never executes for any element built on it. A
`<button>` that waited for `setPressed` was therefore never pressed at all;
logging showed every `ACTION_DOWN`/`MOVE`/`UP` arriving with `setPressed` never
called once. The rule is restated in the view, but using the platform's own
signals rather than invented ones: `ViewGroup.shouldDelayChildPressedState`
decides whether there is a delay, and the timings are `ViewConfiguration`'s
(`getTapTimeout`, `getPressedStateDuration`, `scaledTouchSlop`).

The two platforms end up at the same behaviour from opposite ends — iOS delays
_delivery_, Android delays the _press_ — which is the clearest illustration of
why each side has to be written against its own model.

## 3. Element → native backing, both platforms

| Element                                                        | UIKit                                                       | Android View                        | Notes                                                                                                                   |
| -------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `<button>`                                                     | custom view + recognizers                                   | custom `View` + interception        | author-styleable box, but its default chrome is **measured from the platform's own button** and its press feedback is the platform's — a 0.75 dim on iOS, a `colorControlHighlight` ripple on Android. Not a `UIButton`/`MaterialButton` *skin*, but no longer indifferent to them either |
| `<a>`                                                          | inline text run + recognizers                               | `ClickableSpan`                     | must work mid-paragraph, so it is a text run, not a box                                                                 |
| `<input type=text\|password\|email\|number\|tel\|url\|search>` | `UITextField`                                               | `EditText`                          | keyboard type, secure entry, autofill (`textContentType` / `autofillHints`)                                             |
| `<textarea>`                                                   | `UITextView`                                                | `EditText` multiline                | initial value is the element's children, not `value`                                                                    |
| `<input type=checkbox>`                                        | `UISwitch`, or a checkbox when `appearance` asks            | `MaterialSwitch` / `CheckBox`       | the iOS form idiom is a switch; the HTML semantic is a tri-state box                                                    |
| `<input type=radio>`                                           | custom, grouped by `name`                                   | `RadioButton`                       | UIKit has no radio; Android does                                                                                        |
| `<input type=range>`                                           | `UISlider`                                                  | Material `Slider`                   |                                                                                                                         |
| `<input type=date\|time\|datetime-local>`                      | `UIDatePicker`                                              | `MaterialDatePicker` / `TimePicker` | compact and inline presentations both required                                                                          |
| `<input type=color>`                                           | `UIColorPickerViewController`                               | **no platform picker**              | a real asymmetry: Android has no system colour picker, so this is a documented gap, not a port                          |
| `<input type=file>`                                            | `UIDocumentPickerViewController` / `PHPickerViewController` | Storage Access Framework            | needs an SDK dependency; scope decision pending                                                                         |
| `<select>`                                                     | `UIButton` + `UIMenu`                                       | `ExposedDropdownMenu` / `Spinner`   | the current native dropdown idiom on each                                                                               |
| `<progress>`                                                   | `UIProgressView`                                            | `LinearProgressIndicator`           | indeterminate when `value` is absent, per HTML                                                                          |
| `<meter>`                                                      | custom                                                      | custom                              | no equivalent on either; thresholds are HTML-specific                                                                   |
| `<details>`/`<summary>`                                        | custom disclosure                                           | custom disclosure                   | each platform's own animation curves                                                                                    |
| `<dialog>`                                                     | presentation controller                                     | `Dialog`                            | pairs with the existing top-layer work                                                                                  |
| `<video>`                                                      | `AVPlayerViewController`                                    | Media3 / ExoPlayer                  |                                                                                                                         |
| `<audio>`                                                      | `AVPlayer` + transport                                      | Media3 / ExoPlayer                  |                                                                                                                         |
| `<native:scroll-view>`                                         | `UIScrollView`                                              | `NestedScrollView`-class            | §2 arbitration; not RN's `ScrollView`                                                                                   |

Where the platforms genuinely differ — `type=color` being the clearest — the
answer is a recorded gap on one side, never a hand-rolled imitation of the
other's UI. A fake colour picker on Android would fail bar 1 by definition.

### An element may be a component, not a box

Most elements are a box the renderer mounts. `<select>` is not: its `<option>`
children are a _list handed to a control_, not boxes to lay out, so mounting
them would make views that are never on screen. It therefore resolves to a
JavaScript component that reads its children and passes them down as one prop.

The registry gained `registerFrameworkComponent(tag, Component)` for this, and
the reconciler asks it what a tag is — through a seam next to the existing
view-config fallback, in the vendored `ReactFabric-*` builds this project
already patches for `uaStyle` and `resolveUIViewClassName`.

Resolving there rather than in a JSX transform is the point. A JSX shim decides
an element's identity at _creation_, so the answer would depend on how the
element was made: `React.createElement('select', …)`, `cloneElement`, or a tree
built by anything other than the JSX runtime would all miss it, and it would
need an app-wide `jsxImportSource`. The reconciler sees every path, and it is
already where this project decides what a tag means.

The mechanism is React's own: the tag stays as the fiber's `elementType` while
the component becomes its `type` — the split lazy and `forwardRef` already use.
That is what keeps updates reconciling, since the re-render comparison is
`current.elementType === element.type`; putting the component in `elementType`
would tear the fiber down and rebuild it every render.

`<option>` needs no view config and no native counterpart, because it is never
mounted. It exists to be read.

## 4. The DOM API is part of the element

An element is not finished when it renders. Each carries its real API surface —
for `<input>` that means at minimum:

- **Properties**: `value`, `defaultValue`, `checked`, `defaultChecked`,
  `disabled`, `readOnly`, `required`, `placeholder`, `min`, `max`, `step`,
  `maxLength`, `pattern`, `selectionStart`, `selectionEnd`,
  `selectionDirection`.
- **Methods**: `focus()`, `blur()`, `select()`, `setSelectionRange()`,
  `setRangeText()`, `stepUp()`, `stepDown()`, `showPicker()`, `click()`.
- **Validity**: `validity`, `validationMessage`, `checkValidity()`,
  `reportValidity()`, and `:invalid` participating in the cascade.
- **Events**: `beforeinput` (cancelable, synchronous — see
  [`TextInput.md`](TextInput.md)), `input`, `change`, `focus`, `blur`,
  `keydown`/`keyup`, `select`.

`beforeinput` is the one that justifies writing our own control rather than
wrapping someone else's: both platforms expose a synchronous per-keystroke veto
(`textField:shouldChangeCharactersIn:` / `InputFilter`), and owning the control
is what makes that reachable. It is why masked and limited inputs can stop
flickering.

Uncontrolled by default, as the DOM specifies: the input owns its value and
`value` is an initial value plus an override channel.

## 5. Where the code lives

The catalog's existing native backings are already in the renderer, alongside
the components they extend:

- `ReactCommon/react/renderer/components/text/InlineTextTagShadowNodes.{h,cpp}`
- `ReactCommon/react/renderer/components/view/ElementBoxShadowNode.h`

Each new element is the standard Fabric set — `Props`, `ShadowNode`,
`ComponentDescriptor`, an iOS `ComponentView`, and a JS view config registered
through `registerFrameworkElement` — which is the same shape `<img>` already
uses, so the seam is proven.

## 6. Status

### The form controls, as built

Everything in this table is implemented on **both** platforms and exercised with
synthesised touches — `idb` on the iOS simulator, `adb` on the Android emulator
— rather than read. Where a row is not ticked it is because the check did not
run or did not pass, not because it looked right.

| Element                                                        | iOS backing                           | Android backing                | Verified                                                                                                                                            |
| -------------------------------------------------------------- | ------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<button>`                                                     | box + view-level press tracking       | `ReactViewGroup` + press rule  | press, click, scroll-cancel, scroll-delay, disabled, a11y — both                                                                                    |
| `<input type=range>`                                           | `UISlider`                            | `SeekBar`                      | scrub, `input`/`change`, vertical drag scrolls instead — both                                                                                       |
| `<input type=checkbox>`                                        | `UISwitch`                            | `CheckBox`                     | toggle, `change`, announces as a switch/checkbox — both                                                                                             |
| `<input type=radio>`                                           | drawn (UIKit has none)                | `RadioButton`                  | choose; re-tap does **not** un-choose — iOS                                                                                                         |
| `<input type=text\|password\|email\|number\|tel\|url\|search>` | `UITextField`                         | `EditText`                     | typing, controlled value, `change`-on-commit-only, `defaultValue` — both                                                                            |
| `<textarea>`                                                   | `UITextView` + placeholder label      | `EditText` multiline           | multi-line entry, Return inserts a newline — both                                                                                                   |
| `<select>` + `<option>`                                        | `UIButton` + `UIMenu`                 | `Spinner` (`MODE_DIALOG`)      | opens, checkmark, disabled option refused — both; **choosing verified on iOS only**                                                                 |
| `<input type=date\|time\|datetime-local>`                      | compact `UIDatePicker`                | picker dialogs                 | value in, value out, in HTML wire format — both                                                                                                     |
| `<progress>`, `<meter>`                                        | `UIProgressView` / activity indicator | `ProgressBar`                  | determinate, indeterminate, announces a percentage — both                                                                                           |
| `<input type=color>`                                           | `UIColorPickerViewController`         | swatch grid (no system picker) | picker opens, value returns as `#rrggbb`, one `change` per pick — iOS                                                                               |
| `<input type=file>`                                            | `UIDocumentPickerViewController`      | Storage Access Framework       | picker opens with `accept` honoured; **pick verified on Android** (name, MIME, size), iOS picker opens but the simulator has no documents to choose |
| `<input type=submit\|reset\|button>`                           | as `<button>`                         | as `<button>`                  | registered; not separately exercised                                                                                                                |

Gaps that are open and named rather than papered over:

- **No photo library or camera for `<input type="file">`.** Safari's file input
  offers Photos and the camera from an action sheet; this offers the document
  picker only, because `PHPickerViewController` and `UIImagePickerController`
  live in frameworks this target does not link today. A photo saved to Files is
  reachable; one straight from the library is not.
- **No arbitrary colour on Android.** Android has no system colour picker, in
  neither the framework nor Material, so `<input type="color">` offers a swatch
  grid there. Closing it means building a spectrum picker.
- **Choosing an option on Android is unverified.** The dropdown opens with the
  right options and refuses the disabled one, but no injected tap — dropdown or
  dialog, at coordinates confirmed against both `uiautomator` and a screenshot —
  ever selects a row. A `DatePickerDialog` in the same app accepts taps fine, so
  this looks like the harness rather than the control, but it has not been
  proven and the row is ticked accordingly.

### `<button>`'s chrome: measured, not styled to taste

The user-agent chrome was revisited end-to-end (2026-08-22), because the first
version was a CSS approximation that read as neither platform's button:

- **Metrics are measured from the platforms.** A probe binary run with
  `simctl spawn` read a real `UIButtonConfiguration.grayButtonConfiguration`:
  content insets 7/12, corner radius = half the height (a capsule), background
  exactly `secondarySystemFill`, title `systemBlue` (not `link` — a different
  blue, which is what we had). Android's numbers come from the SDK's own
  `Widget.Material.Button` resources: minHeight 48dip, padding 4/8, radius 4.
  `buttonMetrics-test.js` pins every one of these so they cannot drift back to
  guesses.
- **The minimum height is the accessible one.** UIKit applies no minimum — 44pt
  is the HIG's *touch target*, not the button's height — but a `<button>`'s box
  IS its touch target here, so the two collapse into one number: 44 on iOS,
  Android's own 48. An author `height`/`maxHeight` withdraws the minimum on the
  same cascade-origin grounds as the padding withdrawal.
- **Press feedback is drawn natively, per platform.** It used to be
  `opacity: 0.6` applied from React state — a JS round trip on the exact path
  the view-level touch tracking keeps native, with an invented number.
  Measured, UIKit's highlight is a uniform ×0.75 alpha on the whole button;
  Android's is a ripple (`Widget.Material.Button`'s background *is* a
  `<ripple>` over the shape). Each platform's view now draws its own: the dim
  in `EXPElementButtonComponentView`, a `RippleDrawable` installed as the
  feedback underlay in `ElementButtonView` — above the box's own background and
  border, masked to its corner radius, hotspot at the finger.
- **`<input type=submit|reset|button>` shares the chrome.** They resolved to
  `element-button` but appearance keys off the tag, so they had a button's
  behaviour and drew as bare text. `buttonUAStyle` is now shared by both
  registrations.

**Done and verified on both platforms: the gesture floor and `<button>`.**

`<button>` resolves to a new `element-button` component — the generic box plus a
press event emitter — whose platform views install a real recognizer behind
`enableNativeGestureRecognizers`. Verified with synthesised touches on the iOS
simulator (`idb`) and the Android emulator (`adb`), not by inspection:

| Behaviour                                          | iOS | Android |
| -------------------------------------------------- | --- | ------- |
| bare text children paint (`<button>Save</button>`) | ✓   | ✓       |
| press-in/press-out reported natively               | ✓   | ✓       |
| press releases when a scroll claims the gesture    | ✓   | ✓       |
| click suppressed by that scroll                    | ✓   | ✓       |
| click fires exactly once                           | ✓   | ✓       |
| `disabled`: no press, no click                     | ✓   | ✓       |
| announced as a button, with its label              | ✓   | ✓       |
| `disabled` exposed to assistive technology         | ✓   | ✓       |

Six defects were found by running it rather than reading it, each of which would
have shipped:

1. **Press stuck on during a scroll (iOS).** When the pan wins, UIKit _resets_
   the recognizer; `touchesCancelled:` is not guaranteed first. Clearing the
   flag in `reset` without reporting it left the button visually pressed for the
   whole scroll while the click was correctly suppressed.
2. **Disabled buttons still fired `onClick` (both).** Disabling the recognizer
   is not enough, because `click` comes from the pointer path, which knows
   nothing about the prop. Fixed by removing the view from hit-testing
   (`userInteractionEnabled` / `PointerEvents.NONE`), which is what the DOM
   does.
3. **Press events silently coalesced (Android).** `Event.canCoalesce()` defaults
   to `true`; a press-in and its press-out land in the same frame on a quick tap
   and collapsed into one event, so JS only ever saw `pressed=false`.
4. **Bare text children did not paint (both).** The button was built on the bare
   concrete shadow-node template rather than `AbstractViewShadowNode`, which is
   what carries the text-children machinery — so `<button>Save</button>` sized
   correctly and drew an empty rectangle. `AbstractViewShadowNode` now takes an
   event-emitter type parameter so an interactive box can keep that machinery.
5. **The button was not a button to assistive technology (both).** VoiceOver
   reported `AXStaticText` with the label and no hint it could be activated,
   because a `<button>` is a styled box and nothing about the view says
   otherwise. Fixed with user-agent accessibility defaults —
   `accessible`/`AccessibilityTraits::Button` in the props for iOS, and
   focusability plus `getAccessibilityClassName()` on Android, which needs
   stating separately because Android applies view props from the JS payload
   rather than from the C++ props object.
6. **Painted text was invisible to assistive technology (both).** Text children
   are _drawn_ by their container rather than mounted as views, so no view in
   the tree carried the string: `<button>Save</button>` announced as a button
   with **no label at all**, and by the same mechanism a `<div>Hello</div>` was
   unreadable. Fixed by having the run expose its text —
   `RCTAnonymousTextRunView.accessibilityLabel` on iOS, a derived
   `contentDescription` in `ReactViewGroup` on Android — so the container's own
   label walk can collect it. This one is not specific to `<button>`; it was a
   gap in text children generally.

### `<a>`: what works today, verified

Not nothing — three of the four things an anchor needs are already true, on both
platforms, and were checked with real touches rather than assumed:

| Behaviour                                          | iOS | Android |
| -------------------------------------------------- | --- | ------- |
| user-agent link style, and **only** with an `href` | ✓   | ✓       |
| `onClick` fires on an inline anchor                | ✓   | ✓       |
| a scroll suppresses the click                      | ✓   | ✓       |
| press feedback (`:active`)                         | —   | —       |

The UA style is the catalog's first that is a **function of the element's own
props**, because `a:link` matches an anchor _with_ an href and a bare `<a>` is
ordinary text. That required widening `uaStyle` in the renderer from a fixed
object to "object or function of props".

What remains is press feedback, and the reason it is hard is below.

### Why `<a>`'s press state is a different problem

`<button>` was tractable because it generates a **box**, and a box has a view to
hang a recognizer on. An anchor does not: it is inline, its glyphs are painted
by the containing block's inline formatting context, and it has no view of its
own. Everything below was established while investigating it, so the next
attempt does not have to rediscover it.

**Activation already works.** A tap on an inline element resolves to that
element's own emitter through `touchEventEmitterAtPoint:`, which
`RCTViewComponentView` implements by asking each `RCTAnonymousTextRunView`
whether the point lands on one of its fragments. Bare text resolves to nothing
and falls through to the containing element, which is the DOM's rule — text
nodes are not event targets. So `<a onClick>` fires today, natively, via the
pointer path.

**Press state is the hard part, in three pieces:**

1. **Where the recognizer lives.** It cannot live on the anchor. It has to live
   on the containing box, which means the generic box grows one — and the design
   deliberately kept press emitters off every `<div>`. The likely answer is a
   recognizer installed only when a box actually contains interactive inline
   content, decided at mount.
2. **Which emitter receives it.** `touchEventEmitterAtPoint:` returns a
   `TouchEventEmitter`, and `dispatchEvent` is protected, so an anchor needs its
   own component and emitter (`inline-anchor`, mirroring `element-button` — a
   `TextShadowNode` subclass, since inline elements are text nodes) for the
   press to have anywhere to go.
3. **What pressing actually _looks_ like.** A box can restyle itself. An inline
   run cannot: its appearance comes from the attributed string the containing
   block painted, so native press feedback on a link means carrying pressed
   state into the text attributes and repainting the run — inside the text
   stack, on both platforms. This is the part that makes `<a>` a substantially
   bigger job than `<button>`, and it should not be started without budgeting
   for it.

`href` is separate and much smaller: opening a URL is a platform call, not a
gesture problem, and it can land independently of any of the above.

### Synchronous events: what exists, and the one piece that does not

For DOM events to _drive_ the native recognizers — rather than being reported
after the fact — a handler's `preventDefault()` has to be able to influence
arbitration while the gesture is still undecided. That needs the dispatch to be
synchronous. Most of that machinery is already in React Native:

1. **Synchronous dispatch exists.** `EventEmitter::experimental_flushSync(fn)`
   dispatches inside `fn` and then flushes through `EventDispatcher` →
   `EventQueue::experimental_flushSync` → `EventBeat::requestSynchronous`, which
   ends in `RuntimeScheduler::executeNowOnTheSameThread`. It runs the JavaScript
   on the calling thread rather than on the next beat, and it lives in shared
   C++, so it is not a per-platform build-out. Android additionally has
   `Event.experimental_isSynchronous()` for the same purpose.
2. **A real DOM `Event` exists**, with `preventDefault()` and `defaultPrevented`
   (`src/private/webapis/dom/events/Event.js`), and the pointer events the
   catalog relies on already dispatch through it.
3. **What is missing is the return channel.** Every
   `EventEmitter::dispatchEvent` overload returns `void`. Native can make
   JavaScript run synchronously, but it cannot learn what JavaScript decided —
   so `preventDefault()` on a `pointerdown` currently cannot tell a recognizer
   to stand down.

**Where the result would have to come from.** The JS boundary is a single call:
`UIManagerBinding::dispatchEventToJS` ends in

```cpp
eventHandler_->call(runtime, instanceHandle, type, payload);
```

and `jsi::Function::call` already returns a `jsi::Value` — it is simply
discarded. So the value exists at the boundary; what does not exist is a way to
carry it back to the caller, because events are **batched**: they go into
`EventQueue` and flush as a vector, and a batch has no natural place to put one
event's answer.

That points at the shape of the fix. Rather than threading a result back through
the queue, a cancelable event wants a path that bypasses batching entirely —
dispatch _this_ event, run its handlers now, return whether the default was
prevented — layered on the same `executeNowOnTheSameThread` machinery the
synchronous flush already uses. The batched path stays exactly as it is, which
matters: making every event synchronous would be a serious regression, and the
DOM only makes _some_ events cancelable.

The other half is React's: the handler on the JS side has to return the
`defaultPrevented` bit, which means the reconciler's `receiveEvent`
participates. That makes this a change with a React dependency, like the others
this stack already carries.

So the work is narrower than it first looks: not "build synchronous events", but
"give the synchronous path a result". That is the piece to design before `<a>` —
and before any element whose gesture is supposed to be cancelable from
JavaScript — because it decides whether recognizers can consult the DOM at all
or only report to it.

Worth noting what this does **not** block: activation, scroll-cancellation and
press state all already work without it, because those decisions are made
natively. It blocks the cases where the _author_ wants to intervene mid-gesture.

**A note on what the floor actually contributes.** `click` is _already_
dispatched natively by `RCTSurfacePointerHandler`, which already suppresses it
when an enclosing scroll view scrolled during the gesture. So the recognizer
deliberately does not emit activation — doing so double-fired every handler. Its
real contribution is the press _state_, which nothing reported before and which
`:active` needs.

## 7. Order

1. **The gesture floor** (§2) behind its flag. Everything else sits on it, and
   building buttons first means building them twice.
2. **`<button>` and `<a>`** — the smallest elements that exercise the floor
   completely, including press-cancels-on-scroll.
3. **Text input**: `<input type=text>` family and `<textarea>` on `UITextField`
   and `UITextView`, with `beforeinput` and the full text API. The flagship, and
   the one with the most surface.
4. **The widget controls**: range, checkbox, radio, select, date, progress.
5. **`<native:scroll-view>`**, then media.

Each step is **both platforms together**. A step is not finished when iOS works;
splitting them is how the Android implementation ends up as a thinner
translation of iOS decisions rather than the right thing for its own platform.
The one exception is a genuine platform gap (§3), which is recorded rather than
faked.
