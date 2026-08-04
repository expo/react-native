# Plan: user-agent styles for intrinsic elements

Right now an intrinsic element's default appearance is hand-written C++: a
`BTagProps` constructor sets `fontWeight = Bold`, an `ITagProps` sets
`fontStyle = Italic`. That is a *presentational hint*, not a stylesheet, and it
does not scale — every new element needs a props class, defaults are scattered
across headers, and anything block-level (`<p>`'s margins, `<ul>`'s indent,
`<button>`'s padding) has nowhere to go at all.

This plans the replacement, starting from how browsers do it.

---

## 1. How browsers organize it

Every engine ships the same thing: **one real CSS stylesheet, parsed by the
normal CSS machinery, applied at the lowest cascade origin.**

| Engine | File | Notes |
|---|---|---|
| WebKit | `Source/WebCore/css/html.css` | plus `quirks.css`, `mediaControls.css` |
| Blink | `third_party/blink/renderer/core/html/resources/html.css` | plus `quirks.css` |
| Gecko | `layout/style/res/html.css` | plus `forms.css`, `quirks.css` |

Four properties of that design matter, and are worth copying:

1. **It is data, not code.** The defaults are declarations in a stylesheet, not
   branches in the element implementation. Adding `<article>` means adding
   `article { display: block }` — no new class.
2. **It sits at the bottom of the cascade** (CSS Cascade §6.1: user-agent <
   user < author). An author declaration always wins over a UA one, with no
   special-casing, because it is simply a later origin. `!important` reverses
   the order, which is how `<a>`'s colour can be forced by a UA sheet in some
   engines.
3. **Elements are grouped by role, not alphabetically.** WebKit's `html.css`
   reads as: block-level containers, then headings, then lists, then inline
   presentational, then forms, then tables. That grouping is the documentation.
4. **Presentational hints are separate from the sheet.** `<b>`'s boldness is a
   UA *style rule*; `<font color>`'s effect is a *presentational hint*, which
   cascades even lower. We only need the former.

## 2. What "cascade origin" means here

RN has no cascade. Style resolution is: JS flattens `style` → props → native.
So "author wins over UA" has to be realised by *where* the merge happens.

Three candidate seams, with the trade-off that decides it:

**(a) Native defaults — what we do today.** Props class fills a value in if the
author did not set one. Cascade semantics are actually correct (author wins),
cost is zero, but it is code-per-element and cannot express layout defaults
without duplicating Yoga prop plumbing per element.

**(b) A wrapper component per intrinsic.** Register `<p>` as a composite that
renders the host with `style={[uaStyle, props.style]}`. Fully declarative and
trivially correct — style arrays already resolve last-wins. Cost: an extra
React element *per element instance*, in exactly the tree shape (long text runs
with many inline elements) where we care most about allocation.

**(c) The view config carries the UA style; the reconciler merges it.**
The renderer already has this exact seam for `recordNodeName` — a per-config
flag the reconciler acts on when creating the instance. A `uaStyle` on the view
config, merged beneath the author's resolved style at `createInstance`, is the
closest structural analogue to a browser: the *engine* consults the UA sheet,
author code never sees it, and there is no extra component or per-element code.

**Recommendation: (c).** It keeps the defaults as data (property 1), gets
origin ordering for free (property 2), and costs one object spread per element
creation rather than a component. (a) stays as the fallback for anything that
genuinely is not expressible as style.

## 3. Where the sheet lives

`Libraries/DomElements/uaStyles.js` — beside the element registrations it
serves, inside the module that owns DOM *policy*. RN core stays agnostic: it
provides the seam, the DOM module provides the sheet. Same split we already
have for `NodeNameProvider`.

Organised by role, in WebKit's order, because that grouping is the
documentation:

```js
// Block-level containers
div, p, section, article, main, header, footer, nav, blockquote, figure
// Headings
h1…h6
// Lists
ul, ol, li, dl, dt, dd
// Inline presentational
b, strong, i, em, u, s, small, mark, code, kbd, samp, sub, sup
// Forms
button, input, label, select, textarea, fieldset
// Tables
table, thead, tbody, tr, th, td
```

Each entry is a plain RN style object, so it goes through the same validation
and the same logical-property resolution as author styles:

```js
p: {display: 'block', marginBlock: 16},        // browsers: 1em
strong: {fontWeight: 'bold'},
button: {display: 'inline-flex', alignItems: 'center', justifyContent: 'center'},
ul: {display: 'block', paddingInlineStart: 40},
```

## 4. Deliberate divergences

Worth stating up front, because a UA sheet that silently differs from the web
is worse than one that documents where it does not:

- **`em`-relative defaults become points.** Browsers use `1em` for `<p>`'s
  margins and `0.83em` for `<h3>`; we have no font-relative units, so the sheet
  uses points computed from the default font size. Written as a comment beside
  each value.
- **No `quirks.css`.** There is no quirks mode to be compatible with.
- **Form controls are not native widgets.** `<button>`'s UA appearance in a
  browser is platform-drawn; ours will be a styled box. Astryx restyles
  buttons completely, so this costs nothing there.
- **`<a>` gets no colour or underline.** Browsers' `a:-webkit-any-link` depends
  on `:link`/`:visited`, which need history state we do not have. Astryx styles
  links explicitly.

## 5. Staging

1. **Seam** — `uaStyle` on the view config, merged beneath author style at
   `createInstance`, mirroring `recordNodeName`. Prove with one element (`<p>`
   gaining block margins) and a test that an author `marginBlock` overrides it.
2. **Sheet** — add `uaStyles.js` with the inline presentational group, and
   delete the equivalent C++ defaults so there is one source of truth. The
   existing `<b>`/`<i>` tests become the regression net for that move.
3. **Breadth** — headings, lists, forms, tables, as their elements get
   registered.
4. **Cleanup** — once nothing in C++ sets a default, `BTagProps`/`ITagProps`
   collapse into the shared `InlineTagProps`, and new elements need no C++.

Step 2 is the one that pays for the whole thing: it turns "add an element" from
a C++ change into a one-line table entry.

## 6. Note on the renderer seam

`recordNodeName` — the model for this — is currently implemented **only in
`ReactFabric-dev.js`**; the prod and profiling bundles do not have it, so
intrinsic elements silently lose their authored `tagName` in release builds.
Whatever adds `uaStyle` should add both to all three bundles, or the UA sheet
will apply in dev and vanish in prod, which is the worst possible failure mode.

---

# Addendum: `display` on `<span>` (inline-flex's remaining half)

`display:'inline-flex'` and `'inline-block'` now work on Views and `<div>`s.
They do **not** work on `<span>`, which is what Astryx actually needs — its
Badge, and 78 uses across the library, are `<span style={{display:'inline-flex'}}>`.

The obstacle is structural, not a missing value: `<span>` is a
`TextShadowNode`. It is not a Yoga node at all, so it has no box to lay out
flex children in. `display` on it is inert.

Three ways out, with what each costs:

1. **Dispatch in the DOM layer.** Register `<span>` as a composite that renders
   the text-element host normally, and a box-backed host when the flattened
   style carries a box-establishing display. This mirrors CSS — `display`
   determines the box type — and is the only option that needs no new C++.
   Costs a composite per span, and needs a box host that *respects* the
   author's display: `<div>` will not do, since `DivProps` deliberately forces
   block.
2. **Make `<span>` a View with `display:'inline'` by default.** Architecturally
   the cleanest: span-like folding with inherited text props is already exactly
   what a `display:'inline'` View does, and the author's display would then
   just work, as would the full View box model instead of the narrower
   `InlineBoxProps`. The risk is that `<span>`'s backing type changes under a
   large body of existing behaviour, so it wants its own change with the text
   suite as the net.
3. **Let an inline text element promote to a box natively.** Most faithful,
   most work.

Either (1) or (2) must also preserve DOM identity: a box-flavoured `<span>`
still has to report `RN:span`. The mechanism exists — a props class
implementing `NodeNameProvider`, as `InlineTagProps` does for the inline
elements — but View-side props do not carry it yet, and putting `nodeName` on
`ViewProps` itself would add a string to *every* view in the app. A dedicated
props class for the box-flavoured intrinsic avoids that, the same way `DivProps`
is dedicated today.

**Superseded.** See `element-model-design.md`: the choice is not between these
three so much as between splitting the element layer by tag (today) and
splitting box generation by `display` (what CSS and browsers actually do). (2)
is directionally right but, taken literally, would allocate a `yoga::Node` for
every folding `<span>` — the case the current split exists to avoid.
