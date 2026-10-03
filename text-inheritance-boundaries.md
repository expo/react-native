# Text inheritance and `all: initial` boundaries

## The model

With `enableStringChildren`, the inherited CSS text properties (`color`,
`fontSize`, `fontFamily`, `fontWeight`, `fontStyle`, `fontVariant`,
`letterSpacing`, `lineHeight`, `textAlign`, `textTransform`, `whiteSpace`)
cascade down the element tree as on the web: any element may declare them, and
text below inherits through the intervening containers (css-cascade-4 §7.3;
the property set is the css-text/css-fonts "Inherited: yes" properties we
implement). Who consumes the cascade differs by vocabulary — DOM elements and
bare-string runs always do; `<Text>` is a deliberate boundary, next section.

The ROOT `<Text>` of a Text tree is an inheritance boundary by default — old
React Native's isolation semantics, kept deliberately for compatibility, but
expressed in the web's own vocabulary: root Text's user-agent stylesheet
declares `all: 'initial'` (css-cascade-4 §3.2), carried natively as
`ParagraphShadowNode`'s `UACascadeBoundary` trait — the cascade's native UA
origin, which authored `all` values resolve against. Only the root: nested
`<Text>` renders as virtual text inside the paragraph (no ParagraphShadowNode,
so no UA declaration), and Text-in-Text inheritance works exactly as it always
has. Bare text under a
styled View is NOT affected either — string runs are web content and inherit
(that is the feature). Authors opt a root Text into web-style inheritance per
element:

```jsx
<View style={{fontSize: 30, color: 'red'}}>
  <Text>unaffected: 14pt, black — exactly as before this feature</Text>
  <Text style={{all: 'unset'}}>30pt red: opted into the cascade</Text>
</View>
```

`all: 'unset'` is the standard spelling for "as if nothing was declared" —
for inherited properties that means inherit — so it is precisely the switch
that turns the user-agent boundary off. A design system that prefers web
semantics everywhere can flip the default with one rule of its own.

The catalog's DOM elements (`<p>`, `<h1>`, `<span>`, bare-string runs) are NOT
boundaries: they are web elements and keep html.css semantics. This is a
deliberate split between the two vocabularies — React Native components keep
React Native's isolation contract; DOM elements behave like the DOM. Nested
`<Text>` inheritance is unaffected by any of this (it happens inside the
paragraph, below the element cascade).

### Why this default (the compatibility argument, assessed)

Old RN's virtue was locality: no ancestor could restyle a component's text.
But the compatibility case is stronger than "nothing could leak in" — the
opposite is true. Apps commonly carry INERT inheritable keys in View styles
today (`color`, `fontSize` in a style object shared with a Text, or applied to
a wrapper by mistake): old View's validAttributes silently dropped them, so
they render nothing. Turn on web inheritance into `<Text>` and those dormant
keys ACTIVATE — text all over existing screens changes. The root-`<Text>`
boundary is therefore load-bearing for the pixel-identical promise, not a
concession to taste (text-children-plan.md §3.D records this as the original
rationale). Bare-string runs and catalog elements are new surface — nothing
rendered there before — so they inherit with no compatibility exposure.

The cost is one `all: 'unset'` per Text that wants web behavior, and the
boundary mechanism itself is the same standard property available to every
element, at every level:

- block-level elements and root `<Text>`: the element-tree cascade stops and
  restarts from defaults (engine: the `InheritanceBoundary` trait);
- inline elements inside a text run — a `<span style={{all: 'initial'}}>`
  mid-sentence, or a nested `<Text style={{all: 'initial'}}>` — reset the run
  fold the same way (engine: `cascadeResetAll` in the inline fold).

One property, one meaning, every element. The earlier bespoke opt-in
(`inheritViewTextStyles`) is replaced by the standard property.

## Opting out anywhere: `all: 'initial'`

The web's own reset is the `all` property (css-cascade-4 §3.2), and we
implement it scoped to the inherited text set — the only cascading properties
this renderer has:

```jsx
<View style={{color: 'red'}}>
  {'this is red '}
  <View style={{all: 'initial'}}>
    {'this is not: the cascade restarts from the initial values here'}
  </View>
</View>
```

- `all: 'initial'` makes the element an inheritance root, the way old RN's
  outermost `<Text>` was. Its own inheritable props still apply below it —
  `{{all: 'initial', color: 'blue'}}` is "fresh start, then blue".
- `all: 'revert'` rolls the author declaration back to the user-agent origin
  (css-cascade-4 §7.3). The native UA origin holds exactly one declaration —
  root `<Text>`'s `all: 'initial'` — so `revert` keeps root Text's boundary
  and resolves to unset (inherit) on every other element. It is NOT a synonym
  for `initial`: on a plain View the two differ, and CascadeBoundary-itest
  pins both sides. (Catalog UA styles merged into props on the JS side are
  author-level from the native cascade's viewpoint; if the framework wants
  `revert` to see its own UA sheet, it resolves the keyword JS-side before
  props reach native.)
- `all: 'unset'` and `all: 'inherit'` resolve identically for an
  all-inherited property set: erase the cascaded value, inherit — and both
  are author declarations, so both defeat a UA boundary.
- The same stylesheet means the same thing in a browser, which is the point.
  A design system that wants isolated components declares the boundary in its
  own styles; no engine change, no new component, no bespoke prop.

## Why boundaries are also a performance feature

A boundary is a promise the engine exploits: nothing below can observe
anything above. The renderer keeps a `SubtreeHasCascadeDependents` bit
(maintained bottom-up; boundary children contribute nothing to ancestors), and
an inheritable-prop change with no dependents dirties nothing — no re-layout,
no cascade walk. Every boundary an app adds at a natural seam (a screen root,
a list cell, a design-system component) shrinks the region any style change
can touch. `<Text>` needs no boundary for this: it is itself the consumer.

## Where the machinery lives

- `BaseViewProps`: the inherited prop fields, `hasInheritedTextProps`,
  `cascadeReset` (the parsed `all`, kept verbatim) and
  `isInheritanceBoundary(bool uaDeclaresBoundary)` (its resolution against
  the element's `UACascadeBoundary` trait).
- `ParagraphShadowNode::BaseTraits`: the one native UA `all` declaration
  (root `<Text>`'s boundary).
- `YogaLayoutableShadowNode`: the copy-on-write cascade storage and the
  invariants doc block above it; propagation in `configureYogaTree`; the
  dependents bit in `updateYogaChildren`/`appendChild`.
- `ReactNativeStyleAttributes` (JS): every key here, including `all` — a key
  missing from that table is silently dropped before reaching native.
- Tests: `CascadeBoundary-itest`, `StringChildrenBehavior-itest` (M4),
  `InlineCascade-itest`, `CascadeSiblingRerender-itest`,
  `CascadeLayoutClone-itest`. Benchmarks: `StringChildrenOverhead-benchmark`.
