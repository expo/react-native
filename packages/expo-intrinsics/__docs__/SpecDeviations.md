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

### `<button>` containing a `<menu>` is a menu button, and the `<menu>` is not laid out

**The spec:** `<menu>` is a list of commands — "a semantic alternative to `<ul>`",
and on the web it lays out as one. Nothing in HTML says a button containing one
should open it.

**Here:** a `<button>` whose child is a `<menu>` is a MENU BUTTON: one tap opens
the platform's own menu, built from the `<menu>`'s children. Nothing of the
`<menu>` is rendered. Each `<li>` carries its own `onClick`, which is what
`<menu>` means — a list of commands, not a list of labels the button switches
on — and `destructive`/`disabled` are read off it.

**Why:** the alternative is drawing a menu, and a drawn menu is not the
platform's. The platform's is a `UIMenu` on iOS and a `PopupMenu` on Android,
both of which the system positions and composites; both also decide their own
placement against whatever else is on screen, including the keyboard, which is
a judgement neither element wants to make. Leaving the `<menu>` in the tree
would lay it out as a column of labels inside the button, which is the web's
answer and not a menu.

`destructive` is an attribute on iOS and a colour on Android
(`?attr/colorError`), because that is how each platform says it.

**The two platforms show the commands in opposite orders when the menu opens
upward, and that is left alone.** `UIMenu` defaults to
`preferredElementOrder = .automatic`, which reverses the list when the menu is
above its button so the first command is nearest the thumb; Android's
`PopupMenu` keeps insertion order wherever it opens. Forcing either to match the
other would make the menu read as foreign on that platform — the same reasoning
that gives `<input type="checkbox">` a switch on one and a checkbox on the
other. Verified on both: the same seven commands, in reverse of each other, both
opening above the composer.

**The one place it is not simply "give the button a menu":** presenting a menu
LIFTS its source view into a window at level 1, and an accessory's window is at
level 10000001 — so a menu presented from a `+` inside a composer lifts that `+`
out of sight. Above the normal window level the menu is presented from an
invisible anchor and opened by the real button's own touch, so the button stays
where it is. See `DOM-CSS-LIMITATION(overlay-cannot-cover-the-keys)` and
`MenuCheck` in the keyboard demo's UI tests.

---

### `<select>` presents each platform's own chooser, not a common one

**The spec:** a `<select>` is a list of options; how it is presented is the user
agent's business.

**What we do:** a pop-up `UIMenu` on iOS, a modal list on Android. Deliberately
_different_ on each. Neither is a wheel — the wheel is what Safari shows for
`<select>` on iOS, and it is a _web_ affordance rather than a native one, so an
app using it looks like a web page.

**Why:** this is the principle working as intended rather than a deviation from
it — the element is the semantic, and the control is each platform's answer.

### A `<select>` in a flex container stretches, like it does on the web

**The spec:** a flex item with `align-self: stretch` — the default — fills its
container's cross axis. A `<select>` is not exempt.

**What we do:** the same. This used to be a deviation: the user-agent style set
`alignSelf: 'flex-start'` on `<select>`, so it shrink-wrapped in a plain column.

**Why it was removed.** The reason given for it was "an inline-level control
never fills its container on the web", which is true of a BLOCK container and not
of a flex one — put a `<select>` in `display: flex; flex-direction: column` in
Safari and it stretches. So the rule was not the web's behaviour.

And `align-self` is not axis-specific, which is what made it cost more than it
bought: in a column it controls the width, but in a ROW it controls the vertical
position. It pinned every `<select>` to the top of its row and beat the row's own
`alignItems: 'center'` — measured in a 44-point settings row as 0.3 points above
the control and 8.0 below it. There is no way to say "do not stretch
horizontally" without also saying "sit at the top vertically".

An author who wants shrink-to-fit writes the `alignSelf: 'flex-start'` they would
have written on the web.

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
shifts the run by half the ascent. The LINE box does not grow — the
paragraph keeps its interior rhythm — but the RUN'S BOX reserves the shifted
ink at its edges (half the shifted fragment's font size above a superscript,
below a subscript), so nothing clips and the ink can never escape the
element to paint over a sibling: an `x²` on a paragraph's first line keeps
the top of its 2 *inside its own box* instead of riding into the element
above (`SupInkReserved-itest`).

**The spec:** Safari grows the line box under a shifted run — measured
30.53px against the surrounding 24px rhythm — visibly pushing the next line
down.

**Why:** the platforms' own typography keeps ruled rhythm under super- and
subscripts, and it reads better; the size (the half of the rule the sheet can
own) is kept spec-identical so only the line-growth behaviour differs.
Painting changed to make this safe; layout did not.

---

### `<fieldset>` is the platform's group surface

`DOM-CSS-DEVIATION(fieldset-native-surface)`

**What we do:** a rounded, outlined surface in the platform's own tokens —
iOS: 10pt radius, hairline in `separator`, 12pt block padding; Android: 12dp
radius, `colorOutlineVariant`, 16dp padding; 16 inline padding on both.

**The spec:** html.css draws `border: groove 2px ThreeDFace` with
`padding: 0.35em 0.75em 0.625em` — metrics tuned around 13px web controls.

**Why:** wrapped around a 44pt switch or a 56dp text field, the web's 5.6px
of top padding reads as a rendering mistake. What a native form actually
puts around a group of related controls is an inset-grouped section (iOS) or
an outlined card (Material), and this is that, in each platform's tokens —
adaptive in dark mode for free.

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

### `url`, `email` and `password` fields are not spell-checked

`DOM-CSS-DEVIATION(no-spellcheck-on-url-email-password)`

HTML lists Email and URL among the types a user agent *should* consider
checkable (§6.8.5). No system field on either platform checks them, and for
good reason: an address is not prose, so every one of them reads as a
misspelling and the field fills with red underlines that mean nothing. On iOS
the effect is worse than noise — the predictive bar appears above the keyboard
with nothing to put in it, which is how this was reported from a device.

So the three default to unchecked. It is a DEFAULT, not a refusal: an author who
writes `spellCheck` gets what they asked for. That is the difference between
this and the `autocorrect` rule beside it, where the spec itself makes the
refusal absolute for the same three types.

### Tapping a `<label>` does not activate its control

`DOM-CSS-DEVIATION(label-activation)`

**What we do:** `<label htmlFor>` (and a label wrapping its control)
associates for ACCESSIBILITY — the control announces with the label's text —
but tapping the label's text does not toggle or focus the control.

**The spec:** HTML §4.10.4 — activating a label dispatches the activation to
its labeled control; on the web, clicking the word toggles the checkbox.

**Why:** label-click activation is a pointer-era affordance: a 13px web
checkbox is a hard mouse target, so the label doubles as one. The platforms'
own forms do the opposite — a UISwitch or a Material checkbox IS the touch
target, at 44pt/48dp, and neither iOS Settings nor Material rows toggle from
their caption text; making text toggle a control it does not visually
resemble also fights the platform gesture system (text selection,
scrolling). Intentional, not a gap; the association half — the part
assistive technology needs — is fully carried.

---

## The platform cannot

### `font-size` does not reach a control

`DOM-CSS-LIMITATION(no-font-on-a-control)` — a real gap, not yet closed.

`ElementTextAreaProps` and `ElementTextInputProps` extend `ViewProps`, which
carries no text attributes, so nothing in the font shorthand reaches
`<textarea>` or `<input>`. Each control sets the platform's own — the text area
is `[UIFont systemFontOfSize:17]`, chosen in `init` — and a `font-size` written
by an author is read by the style system, applied to the box, and ignored by the
control inside it. That last part is the trap: the property does not fail, it
does nothing, and a composer with `fontSize: 16` renders at seventeen.

Closing it means giving the control-backed elements the text attributes the text
elements already have, and applying them to the backing control's `font`.

### `overflow: hidden` clips a `box-shadow` away

`DOM-CSS-LIMITATION(clipping-eats-the-shadow)` — a real deviation, and it has a
workaround rather than a fix.

**What CSS says:** a `box-shadow` is painted OUTSIDE the border box, and the
element's own `overflow` says nothing about it. A clipped box still casts one.

**What happens here:** `overflow: hidden` becomes `clipsToBounds`, which is
`CALayer.masksToBounds`, and that clips everything the layer draws outside its
bounds — the shadow included. Measured on the keyboard demo's composer: the
field's shadow reads four levels darker than the bar at its edge without the
clip and a third of one with it, which is the difference between a field that
has an edge and a lighter patch of bar.

**The workaround** is the one the web uses for the reverse problem: put the
shadow on a wrapper and the clip on the child. Where nothing actually needs the
clip — a box whose corners are rounded by its own background rather than by a
child overflowing them — dropping `overflow: hidden` is the simpler answer.

**The fix**, if it is wanted, is to draw the shadow on a sibling layer behind
the view rather than on the view's own, so that masking the view does not mask
it. That is how a browser paints it, and it is what `<div>` would need for the
two properties to be independent the way CSS has them.


### A closing `<select>` menu ghosts under a scroll — UIKit's own behavior

`DOM-CSS-DEVIATION(select-dismissal-ghost)` — informational; nothing to fix.

**What happens:** pick an option in a `<select>`'s pop-up menu and
immediately drag-scroll while the ~0.4s close animation runs, and the
collapsing menu platter hangs at its pre-scroll screen position for the
rest of the animation instead of following the button.

**Why this is the platform, not the fork:** established by elimination on a
real device with a real finger. The fork's select is a near-stock pop-up
`UIButton` (`showsMenuAsPrimaryAction` + `changesSelectionAsPrimaryAction`);
the same gesture reproduces the identical ghost in (1) a pure-UIKit screen
inside RNTester with no React Native views (`rntester://nativeprobe`), and
(2) a standalone 25KB UIKit-only app with no dependencies at all. Meanwhile
every PROGRAMMATIC scroll dispatched during the dismissal — plain, animated,
60fps continuous, with the menu and configuration reassigned mid-flight —
tracks perfectly in the same probes. The distinguishing variable is the
finger: during a drag the main run loop sits in `UITrackingRunLoopMode`,
which starves the default-mode machinery UIKit appears to use to retarget
the closing platter.

**Why we don't work around it:** the earlier mitigation froze ancestor
scrolling for the menu's lifetime, which fought the user's scroll and could
be silently undone by any props update re-applying `scrollEnabled`; there
is no public API to move UIKit's platter mid-animation. Stock behavior is
what every native app exhibits under this gesture, so stock is what the
element does.

---

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

### Four chat surfaces are drawn on iOS and ignored on Android

**The spec:** three of these are not in it at all — `-apple-visual-effect` and
`-apple-balloon-tail` are WebKit-private properties, and
`<native:keyboardpanel>` is an element we added. The fourth,
`background-attachment: fixed`, is ordinary CSS.

**Here:** all four reach the shadow node on both platforms, and only iOS draws
them. On Android a material box keeps whatever background it was given, a
balloon is a plain rounded rectangle, a fixed background scrolls with its box,
and a panel does not open.

**Why:** they are at different distances from Android for different reasons, and
lumping them together as "iOS-only" would hide that.

| | why it is iOS-only | what closes it |
|---|---|---|
| `-apple-visual-effect` | the keywords are Apple's and so are `UIBlurEffect`/`UIGlassEffect` | Android's `RenderEffect` blur is a *different construction*, which is why the property is spelled `-apple-` rather than pretending to be portable |
| `-apple-balloon-tail` | nothing — unfinished | the same path in a `Drawable` |
| `background-attachment: fixed` | nothing — unfinished | a drawable that resolves its bounds against the window, invalidated as the scroll moves |
| `<native:keyboardpanel>` | **the platform cannot**: an IME belongs to another process, so nothing an app owns can stand in its place | a view positioned where the keyboard was, animated by the machinery the accessory already uses — same element, same meaning, different construction |
| `<native:menubutton>` | it is a `UIButtonConfiguration` and a `UIMenu` — it exists to be the PLATFORM's control and nothing of ours | nothing: use `<button>` with a `<menu>` child, which says the same thing in HTML's own words and works on both platforms |

Markers: `ios-only-materials`, `ios-only-balloon-tail`,
`ios-only-fixed-background`, `ios-only-keyboard-panel`, `ios-only-menu-button`.

---

## Not built yet

- **Four ARIA attributes still do nothing:** `aria-modal`, `aria-required`,
  `aria-describedby` and `aria-controls`. The rest — `label`, `labelledby`,
  `hidden`, `busy`, `checked`, `disabled`, `expanded`, `selected`, `live`, and
  the four `valueXXX` — reach the platform on every element. These four are
  missing from the base view config's attribute list, so they never arrive at
  the shadow node at all, which makes closing them a change in two places
  rather than one.

  ARIA is applied per element rather than in the base props, and deliberately:
  each `convertRawProp` costs about a percent of a mount, so reading a dozen of
  them in `AccessibilityProps` would tax every `<View>` in every app for a
  spelling only these elements accept.
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
