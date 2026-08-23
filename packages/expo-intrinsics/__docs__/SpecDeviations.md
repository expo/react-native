# Where we depart from the web spec, and why

The bar is two things at once: **be web-spec compliant**, and **give each
platform its own native UI and UX**. They agree far more often than people
expect — most of HTML's semantics map cleanly onto native controls. Where they
disagree, native wins, and the departure is written down here rather than left
for someone to discover.

Every entry says what the spec asks for, what we do instead, why, and what it
would take to close — so a future reader can reopen it on evidence rather than
guess at the reasoning. Entries also appear as `DOM-CSS-LIMITATION` comments at
the code that causes them.

Three kinds of departure appear below, and they are not the same thing:

- **Native takes precedence** — the spec behaviour exists and we deliberately do
  something else, because following it would make the app feel wrong on the
  platform.
- **The platform cannot** — no native equivalent exists, so the best available
  answer is not the spec's.
- **Not built yet** — no principled disagreement, just unfinished.

---

## Native takes precedence

### Body text is the platform's size, not the web's 16px

**The spec:** a browser's root font size is `16px`, and every `em` in the
user-agent stylesheet resolves against it. A document with no author styles is
set in 16px.

**Here:** the root is the platform's own body text size — **17pt on iOS**
(`UIFont.systemFontSize`, which is also what
`preferredFont(forTextStyle: .body)` returns at the default content size) and
**16sp on Android** (Material's `bodyLarge`). Every `em`-derived value in the
user-agent sheet follows it, so headings and their margins keep their
proportions and change their absolute size.

**Why:** an app built from these elements should read like the platform without
being asked to. React Native's historical default of 14 is the odd one out — it
is neither the web's figure nor either platform's, and prose left at it renders
noticeably smaller than the same words anywhere else on the phone.

**What this costs.** A length quoted in `em` resolves to a different number of
points here than the same stylesheet would produce in a browser, and to a
different number on each platform. Proportions are preserved; absolute sizes are
not. Anything comparing a screenshot against a browser at 16px will differ by
that ratio, and the difference is not a bug.

**Where it lives.** One constant, in `TextAttributes::defaultTextAttributes()` —
mirrored by `ROOT_FONT_SIZE` in `uaStyles.js`, which must stay in step. It was
first attempted as a document-only default that left a plain `<Text>` at 14, and
that is _not_ a smaller version of the change but an inconsistent one:
`<View>{'hi'}</View>` and `<View><Text>hi</Text></View>` must measure the same,
and a split default makes them differ. One default in one place is the only
arrangement that holds.

### Cancelable events: text input is cancelable, other native defaults are not

**The spec:** `click`, `submit`, `beforeinput` and others are cancelable.
Calling `preventDefault()` stops the default action.

**What we do:**

- **`<form>` submission** is cancelable — implemented in JavaScript and tested.
- **Text input is cancelable**, synchronously. `onBeforeInput` runs _before_ the
  control applies the edit, and may refuse it with
  `event.nativeEvent.preventDefault()` or substitute with `setValue(text)`.
  Nothing intermediate is ever drawn.
- **A checkbox toggling on click is not.** The control toggles itself and then
  reports it.

**Why text input is synchronous.** A controlled input that transforms or refuses
a keystroke has to do it before the character is drawn. Letting it land and
correcting a frame later shows the rejected character — a flicker, and the kind
of detail that makes a field feel unlike every other field on the device. So the
event is dispatched on each platform's _own_ pre-commit hook —
`textField:shouldChangeCharactersInRange:` on iOS, `InputFilter` on Android —
where the answer can be exact.

It blocks both threads for the duration of the handler, which is the price of an
answer before the platform commits, and the same trade a browser makes. The
native side only takes that path when a handler is present, so a field without
one types exactly as it did before.

**Why a checkbox is not.** Nothing draws in between: a switch reports a toggle
it has already animated, so there is no flicker to prevent — only a state to
disagree with, and a controlled `checked` prop already does that without
blocking anything.

**One case can still flicker on Android.** `InputFilter` replaces the _edited
span_, so a substitution that changes text outside it — rewriting an earlier
character in response to a later keystroke — cannot be expressed as a filter
result and is applied just after, which can show a frame of the unsubstituted
text. Refusals and substitutions confined to the edit, which is nearly all of
them, are exact. iOS sets the whole field and has no such limit.

**Controlled inputs do not need any of this — and do not need it on the web
either.** This is worth stating because it looks like the obvious use for
`preventDefault`. A controlled `<input>` on the web does not cancel the
keystroke: React lets the character land, runs `onChange`, and then — if the
`value` prop disagrees with what the node holds — writes the prop back.
Rejecting a character is just _not changing the state_, and that works here too.
`onBeforeInput` exists for the stricter requirement: that nothing incorrect is
drawn even for a frame.

### `<select>` presents each platform's own chooser, not a common one

**The spec:** a `<select>` is a list of options; how it is presented is the user
agent's business.

**What we do:** a pop-up `UIMenu` on iOS, a modal list on Android. Deliberately
_different_ on each. Neither is a wheel — the wheel is what Safari shows for
`<select>` on iOS, and it is a _web_ affordance rather than a native one, so an
app using it looks like a web page.

**Why:** this is the principle working as intended rather than a deviation from
it — the element is the semantic, and the control is each platform's answer.

### `<input type="checkbox">` is a switch on iOS and a checkbox on Android

**The spec:** a checkbox is a box that is ticked.

**What we do:** a `UISwitch` on iOS, a `CheckBox` on Android.

**Why:** iOS has no checkbox. A form boolean there is a switch, and drawing a
tick box on iOS — or an iOS-style switch on Android — is exactly the "imported
UI" the bar exists to prevent. Both announce correctly to assistive technology
as what they are.

### A checkable in a line of text centres on the line

**The spec:** `vertical-align`'s initial value is `baseline`, and a browser's
~13px checkable sits with its bottom on the baseline, where it looks right.

**What we do:** the user-agent sheet gives `checkbox` and `radio`
`vertical-align: middle` (`DOM-CSS-DEVIATION(checkable-line-centering)`), and
their boxes are the platform's own — a 48dp Material touch target with the
24dp drawable centred inside it, a 28pt UISwitch.

**Why:** baseline-aligning the platform's BOX puts the visible control a
control-height off the words it labels — on Android the glyph rode ~12dp
above the text of `<label><input/> Subscribe</label>`, reading as two separate
lines. Material rows and iOS Settings rows centre the control against the
label line, so the sheet says so. `middle` is CSS's own middle — centred on
the baseline raised by half the x-height — so an author can still restore
`baseline` (or any other value) and win over the sheet, which
`CheckableLineCentering-itest` pins along with the centred geometry.

**To close:** nothing pending — this is native-takes-precedence by design. If
the controls ever become glyph-sized boxes, `baseline` becomes right again.

### `<a>` without `href` is not focusable

**What we do:** only an anchor with an `href` becomes an accessibility element,
and only that one gets the link colour and underline.

**Why:** this is the spec — an `<a>` with no `href` is a placeholder, not a link
— and it is noted here only because it looks like an omission.

---

### `<hr>` is the platform's separator, not the web's inset line

`DOM-CSS-DEVIATION(hr-separator-color)`

**What we do:** a 1px rule in the platform's own divider token — iOS
`separator`, Material `colorOutlineVariant` — which is lighter than the
web's, and adapts to dark mode for free.

**The spec:** html.css draws `border: 1px inset`, a 3D border with no system
colour behind it; at 1px it renders as a hard dark line.

**Why:** a thematic break drawn natively IS a separator, and both platforms
name a token for it. Neither HIG nor Material defines an `<hr>`; they define
dividers, and this is one.

---

### `<sup>`/`<sub>` shift inside the line box; the line does not grow

**What we do:** the user-agent sheet sizes both at `0.8333em` (exactly
Chrome's computed 13.3333px on a 16px root), and each platform's text stack
shifts the run by half the ascent. The line box does NOT grow: the paragraph
keeps its rhythm, and the shifted ink paints into overflow the run's canvas
reserves for it — half the font size above a superscript, below a subscript —
so nothing clips (an `x²` on a first line keeps the top of its 2).

**The spec:** Safari grows the line box under a shifted run — measured
30.53px against the surrounding 24px rhythm — visibly pushing the next line
down.

**Why:** the platforms' own typography keeps ruled rhythm under super- and
subscripts, and it reads better; the size (the half of the rule the sheet can
own) is kept spec-identical so only the line-growth behaviour differs.
Painting changed to make this safe; layout did not.

---

### `<legend>` sits above the fieldset's box, not notched into its border

`DOM-CSS-DEVIATION(fieldset-legend-position)`

**What we do:** a `<fieldset>` with a `<legend>` renders the legend ABOVE the
bordered box, separated by the legend's user-agent `margin-block-end` (6px);
the border encloses only the controls (Fieldset.js).

**Why:** a browser's fieldset layout notches the legend into the top border and
erases the border behind the text — a special layout neither platform can
express, since neither can interrupt a border behind a text run. And neither
platform's forms speak that idiom: iOS grouped settings and Material both set
a group's label above the group's surface, so the hoist is the platforms' own
convention rather than an approximation of the web's.

---

## The platform cannot

### `<input type="color">` offers a swatch grid on Android

**The spec:** a colour well opening a colour picker.

**What we do:** `UIColorPickerViewController` on iOS — the system picker, with
spectrum, sliders and eyedropper. On Android, a grid of swatches.

**Why:** Android has **no system colour picker**, in neither the framework nor
Material. Every Android app that offers one has built it, and a swatch grid is
what most apps that need a colour actually show.

**Cost:** an Android user cannot pick an arbitrary colour. Closing it means
building a spectrum picker, which is a piece of UI in its own right.

### `<input type="file">` cannot reach the photo library

**The spec:** a file picker; `accept="image/*"` should offer images.

**What we do:** the system document picker on both platforms, with `accept`
honoured.

**Why:** Safari's file input also offers Photos and the camera from an action
sheet. Matching that needs `PHPickerViewController` and
`UIImagePickerController`, which live in frameworks this target does not link.

**Cost:** a photo saved to Files is reachable; one straight from the library is
not.

### `<input type="file">` hands over a handle, not bytes

**The spec:** `FormData` carries the file's contents.

**What we do:** `change` reports a `content://` or `file://` URI, with the name,
size and MIME type.

**Why:** a browser hands `FormData` the bytes. Doing that here would mean
reading every picked file into memory — an out-of-memory crash the first time
someone picks a video.

### `<input type="radio">` is drawn on iOS

**The spec:** a radio button.

**What we do:** a real `RadioButton` on Android. On iOS, a ring that fills,
drawn from platform materials — `tintColor` and the separator colour — so it
follows the app's accent colour and both appearances.

**Why:** UIKit has no radio control. Its answer to "one of several" is a
segmented control or a table with a checkmark, and neither can be built from a
single element, because HTML's radios are separate elements tied together only
by a shared `name`. What Safari draws on iOS is a filling circle, so that is
what this draws.

---

## Known bugs

These are not disagreements with the spec. They are places the implementation
does not yet do what it intends to, kept here so they are not rediscovered.

These were found by putting the demos' own markup in front of real Safari and
comparing — see `text-conformance/`. None was visible from inside the
implementation, and two were not visible from Fantom either.

- **`marginBlock` is dropped for `<p>` specifically.** `p { margin-block: 1em }`
  reached the device as no margin at all: two adjacent paragraphs sat exactly
  one line apart, so the space _between_ paragraphs equalled the line spacing
  _inside_ one, and a `<blockquote>`'s `<footer>` sat on the last line of the
  quote. The same shorthand on `<blockquote>`, `<figure>` and `<dl>` applies
  normally, so it is not `marginBlock` in general.

  **Still open, and a workaround for it was tried and reverted.** Writing the
  `marginBlockStart`/`marginBlockEnd` longhands instead does restore the gap on
  both devices — and makes the user-agent default impossible for an author to
  override, which is worse.

  `applyAliasedProps` treats `marginBlock` as an alias _with_ precedence (it
  sets `Edge::Vertical` unconditionally) and the longhands as aliases _without_
  it (they fill `Edge::Top`/`Bottom` only while those are undefined). So a UA
  longhand beats an author shorthand: `<p style={{marginBlock: 0}}>` sets
  Vertical to 0, leaves Top/Bottom undefined, and the UA's 16pt fills them in.
  The cascade runs backwards, on the element authors restyle most.

  Two existing tests said so immediately — `<p> is block-level` measured 104
  where it expects 40, and `an author style beats the UA default` failed by
  name. A default nobody can override is a worse defect than a default that is
  missing, so the gap stays open and `ParagraphMargins-itest` now guards the
  shorthand rather than the longhands.

  Worth stating separately: **Fantom measures the correct 16pt either way**, so
  the obvious test — render two paragraphs, measure the gap — cannot see this
  bug. It did catch the regression the workaround introduced.

The other two found this way are fixed: `<abbr>`'s dotted underline (drawn by
CoreText and by Android's own dotted decoration, verified on both devices) and
the root font size, which is now the platform's body size and is described under
_Native takes precedence_ above.

A fourth, found by the conformance corpus rather than the demos, is also fixed:
**a box inside a `<span>` was placed as though the inline box occupied space
before it** — `<span>`-nested boxes reported _and drew_ at x=80 where Safari
puts them at 40, on iOS only. The cause was not in the text layout, which was
exactly right; an existing correction in `ViewShadowNode` was subtracting an
ancestor offset it read from a node that no longer carried it. See
`text-conformance/` for the full account. Both platforms now match Safari on all
24 cases.

The previous entry here — a disabled control not drawn as disabled — is fixed on
both platforms, and the colour now follows each platform's theme rather than
being a stated value. Closing the Android half needed a fix in React Native
itself: `PlatformColor` with a theme attribute resolved to an invisible colour,
because `ColorPropConverter` trusted `TypedValue.data` to hold a colour when the
platform's text colours are ColorStateLists and `data` holds a resource ID. See
`ColorPropConverterTest`.

---

## Not built yet

- **Text-level attributes are dropped.** The inline elements are registered as
  aliases of one generic inline backing, whose view config declares four
  attributes (`isHighlighted`, `isPressable`, `maxFontSizeMultiplier`,
  `nodeName`). So `<abbr title>`, `<time datetime>`, `<data value>`, `<q cite>`
  and `<del>`/`<ins>`'s `datetime` and `cite` never reach the native side and do
  nothing. The elements render correctly — this is the machine-readable half of
  them that is missing, and `title` in particular is the one an assistive
  technology would have announced. Adding them is a view config change plus
  somewhere for them to go on each platform.
- **`<img loading>` and `<img decoding>` are ignored**, and `crossorigin` and
  `referrerpolicy` do not reach the request.
- **`method="dialog"`** — closes the enclosing `<dialog>` without submitting.
  Not implemented because `<dialog>` is not.
- **A string `action` does not navigate.** The submission is announced and, with
  no handler installed, nothing happens — no navigation and deliberately no
  network request. See [Forms.md](Forms.md); handling belongs to whoever owns
  navigation.
- **Tables** — `display: table` and its siblings are not in Yoga. See the
  package README, which explains why this is deferred rather than blocked.
