# What of the CSS and DOM specs the text work implements

Checked against the specification text, not against memory. The documents are
downloaded to `~/Developer/css-specs/` (css-display-3, css-inline-3, css-text-3,
css-flexbox-1, css-box-3, css-sizing-3, css-align-3, css-cascade-4, css-ui-4,
css-position-3, cssom-view-1, CSS2 §9–§10, and the WHATWG DOM standard), and
each row below was read there before it was written here.

**Scope.** Everything needed to put text directly in a view and have it behave
the way the web does: the display property, inline layout, box generation
around text, white-space processing, style inheritance, and the DOM APIs that
report the result. Tables, ruby, floats-in-inline, writing modes and grid are
out of scope and say so.

**Where each row is checked.** `corpus` is `text-conformance/cases.js`, run
against real Safari and then against iOS and Android
(`oracle.js` / `verify.js`, currently 40/40 on both). `events` is
`verify-events.js` (7/7 on both). `fantom` is a headless suite. A row with no
check is a claim nobody is testing, and is marked as such.

---

## css-display-3 — box layout modes

| § | what it says | state | checked |
| --- | --- | --- | --- |
| 2.1 | `block` and `inline` outer roles | done | corpus (block-splits-run, flex-blockifies-an-inline-child) |
| 2.1 | `run-in` | **not implemented** | — (no engine ships it; not planned) |
| 2.2 | `flow`, `flow-root`, `flex` inner models | done | corpus (inline-block-wraps-its-own-text, inline-flex-lays-out-its-children-as-flex-items) |
| 2.2 | `grid` inner model | separate stack (`grid-lanes`) | `grid-lanes-conformance` |
| 2.2 | `table`, `ruby` inner models | **out of scope** | — |
| 2.3 | `list-item` and marker boxes | done (numeric + alphabetic counter styles) | fantom (`DomElementsCatalog`) |
| 2.4 | layout-internal `table-*` / `ruby-*` | **out of scope** | — |
| 2.5 | `none` generates no box | done | corpus (display-none-does-not-split, flex-display-none-does-not-split-a-run) |
| 2.5 | `contents` | done | fantom (`DisplayContents-itest`) |
| 2.6 | `inline-block`, `inline-flex` precomposed values | done | corpus (four cases) |
| 2.7 | blockification in a flex container | done | corpus (flex-blockifies-an-inline-child, flex-blockifies-inline-flex-to-flex) |
| 2.8 | the root element's principal box | n/a — a surface root is not an element | — |
| 3 | the `order` property | **not implemented** | — |
| 4 | `visibility` | pre-existing RN behaviour, untouched | — |

## css-inline-3 — inline layout

| § | what it says | state | checked |
| --- | --- | --- | --- |
| 2.1 | line boxes stack in the block direction | done | corpus (inline-wrapping-across-lines) |
| 2.2 | inline boxes lay out within a line | done | corpus (nested-inlines, three-runs-around-two-atomic-inlines) |
| 2.3 | phantom line boxes — an empty inline still has a box | done | corpus (rect-of-an-empty-inline), fantom |
| 3 | `text-box-trim` / `text-box-edge` | **not implemented** | — |
| 4 | initial letters | **out of scope** | — |
| 5 | baseline alignment of inline-level boxes | done | fantom (`InlineBaseline`, `AtomicInlineBox`), corpus |

## CSS2 — the parts inline layout still lives in

| § | what it says | state | checked |
| --- | --- | --- | --- |
| 9.2.1.1 | anonymous block boxes form around in-flow inline content when a block-level sibling appears | done | corpus (seven cases) |
| 9.2.2.1 | anonymous inline boxes | done | corpus (flex-anonymous-item-baseline and the run cases) |
| 9.5 | floats | partial (Yoga block, later stage) | fantom (`StringChildrenBlockFloats`) |
| 10.6.1 | block-axis padding/border on an inline overflows the line box rather than growing it | done | corpus (inline-block-axis-padding-does-not-grow-the-line) |
| 10.6.1 | inline-axis padding/border occupies advance | done | corpus (four differential cases, one per edge and one at 4× scale) |
| 10.8.1 | an atomic inline's own baseline sits on the line's | done | corpus (inline-block-sized-stays-in-the-line), fantom |
| 8.3.1 | margin collapsing | done | fantom (`StringChildrenBlockMargins`, 15 cases) |

## css-flexbox-1

| § | what it says | state | checked |
| --- | --- | --- | --- |
| 4 | contiguous text in a flex container becomes an anonymous flex item | done | corpus (flex-anonymous-item-baseline, flex-display-none-does-not-split-a-run) |
| 4 | an out-of-flow child ends a text-run sequence | done | corpus (flex-absolute-child-splits-a-run-sequence) |
| 4 | every in-flow child is blockified | done | corpus (flex-blockifies-*) |

## css-text-3 — white space

| § | what it says | state | checked |
| --- | --- | --- | --- |
| 3 | `normal` collapses runs of white space and trims line edges | done | fantom (`StringChildrenBehavior` M3, `WPTDerived`), web mirror |
| 3 | `pre`, `pre-wrap`, `pre-line`, `nowrap` | done | fantom (`WhiteSpaceValues`, `WhiteSpacePre`) |
| 3 | `break-spaces` | **behaves as `pre-wrap`** | recorded in dom-css-limitations.md |
| 4.1 | segment breaks | done | fantom |

## css-cascade-4 — inheritance

| § | what it says | state | checked |
| --- | --- | --- | --- |
| 3.2 | the `all` shorthand | done for the inherited text set | fantom (`InlineCascade`, `Cascade*`) |
| 7.3 | `initial` / `unset` / `revert` against the UA origin | done | fantom (`CascadeBoundary`) |

## cssom-view-1 — reporting the result

| § | what it says | state | checked |
| --- | --- | --- | --- |
| 4 | `getBoundingClientRect()` returns the border box | done | corpus (rect-of-a-padded-inline-is-the-border-box) |
| 4 | …for an element with several boxes, the union | done | corpus (inline-wrapping-across-lines) |
| 4 | …for an element with an empty box | done | corpus (rect-of-an-empty-inline) |
| 4 | client coordinates share an origin with pointer events | **not true on Android** | recorded in dom-css-limitations.md |
| 2.2 | `elementFromPoint` | **not implemented** | — (which is why event targets are checked by tapping) |

## DOM

| § | what it says | state | checked |
| --- | --- | --- | --- |
| 2.9 | dispatch reaches the target first, then bubbles outward | done | events (all seven) |
| 4.4 | character data is a `Text` node | done | fantom (`ReadOnlyText`, `ReactNativeElement`) |
| — | text nodes are never event targets | done | events (bareText), fantom (M6) |

---

## Known gaps, in one place

Each of these is marked at the code with a `DOM-CSS-LIMITATION(...)` token and
described in `dom-css-limitations.md`; this is the index.

- `break-spaces` behaves as `pre-wrap`, and `box-decoration-break: clone` is
  absent — both need to take part in line breaking, which neither platform's
  text engine exposes.
- `user-select: auto` means *not* selectable, and does not resolve against the
  parent.
- Selection copies the whole element rather than a dragged range.
- Android's pointer client coordinates and `getBoundingClientRect()` are in
  different spaces.
- No `elementFromPoint`.
- Counter styles cover the numeric and alphabetic sets only.
