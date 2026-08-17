# Should `<span>` be a Yoga node?

> **Which benchmark these numbers are.** Performance figures in this directory
> come from five different measurements on different scales — see [text-vs-upstream-benchmarks.md](text-vs-upstream-benchmarks.md) for the
> tags and what each can and cannot tell you. [sizeof].

Short answer: **not in its common case — and "is `<span>` a Yoga node" is the
wrong axis.** In CSS, box generation is driven by computed `display`, not by
the tag. The same `<span>` is a Yoga box or isn't, depending on how it is
styled. Any model that answers this per-tag will keep producing special cases.

This note works out what that means for the fork, because it changes the
recommendation I made in `ua-styles-plan.md`.

---

## 1. Why an inline box genuinely cannot be a Yoga node

Not a limitation of our implementation — a shape mismatch.

A `<span>` that wraps across three lines generates **three boxes** (CSS2
§9.2.2: an inline box is split into fragments, one per line it occupies). Yoga
models one node as one box with one rect. There is no representation of a node
with three disjoint rects, and there is no way to give it one without teaching
Yoga line breaking.

And line breaking is not ours to do: it belongs to the text engine (CoreText,
Android `Layout`), which is exactly why our anonymous IFC box
(`InlineContentShadowNode`) is a Yoga **leaf** with a measure function. Yoga
sizes the black box; the text engine lays out inside it.

So a span-like inline box must generate **no Yoga box at all** — its contents
join the surrounding inline formatting context and its geometry comes back as
fragment rects. That is what our folding path already does.

The converse is equally true: `inline-block`, `inline-flex`, and a sized inline
element each establish a formatting context and are a single unbreakable box.
Those *are* Yoga boxes, participating in the IFC as an attachment, much like a
replaced element.

One element, two outcomes, chosen by `display` and content.

## 2. How browsers organise exactly this

Browsers separate the two layers we currently conflate:

| Layer | Blink | What it is |
|---|---|---|
| DOM | `Element` / `HTMLSpanElement` | identity, attributes, events, tree |
| Layout | `LayoutObject` — `LayoutInline`, `LayoutBlockFlow`, … | the generated box |

The DOM layer is uniform: `HTMLSpanElement` is a thin subclass that adds
essentially nothing — no layout behaviour. The **layout object is created from
computed style**: `display:none` creates none at all, `display:inline` creates
a `LayoutInline` (which itself holds a list of line-box fragments, not one
rect), `inline-block`/`inline-flex` create a block-level layout object with an
inline outer role.

Two consequences worth copying:

1. **Element classes carry no layout behaviour.** They exist for identity and
   parsing. All default appearance comes from the UA stylesheet.
2. **Box generation is a separate, display-driven step**, and elements that
   generate no box cost nothing in the layout tree.

Our split is currently at the *element* layer — `TextShadowNode`-based inline
elements vs `ViewProps`-based block elements — which is why `<span>` and
`<div>` feel like different kinds of thing and why `display` on a `<span>` is
structurally inert. Browsers put the split one layer lower.

## 3. So: extend a base View class?

The instinct is right at the **element/props** layer and dangerous if it is
read as "always allocate a Yoga box".

`YogaLayoutableShadowNode` holds `mutable yoga::Node yogaNode_` **by value** —
a `yoga::Node` carries a full `Style` (four 9-entry edge arrays for
margin/padding/border/position, plus dimensions, flex fields), `LayoutResults`,
a child vector and a config pointer. It is the single largest component of a
shadow node. `TextShadowNode` deliberately avoids all of it by deriving from
the non-Yoga `LayoutableShadowNode` — it exists only to carry stamped metrics.

Making every inline element a View subclass would allocate a Yoga node per
`<b>`, `<span>`, `<strong>` in exactly the tree shape we most care about: long
text runs with many inline elements. That is a real regression, and it is the
honest argument for today's split.

So the answer is not "one base class" and not "a class per tag". It is:
**uniform element layer, and let `display` pick which box implementation backs
it** — cheap text node when the element folds, box-backed node when it
establishes a formatting context. §4 measures why that split has to stay, and
§5 shows it is what browsers do.

## 4. Measured: what an inline element costs

The design turned on a cost I had asserted but not measured. Measured now
(arm64, Debug, via template-instantiation of `sizeof`):

| | node | props | per element |
|---|---|---|---|
| `TextShadowNode` (inline element today) | 216 B | 344 B | **560 B** |
| `ViewShadowNode` | 1536 B | 1512 B | **3048 B** |

`yoga::Node` alone is 744 B, of which `yoga::Style` is 280 B.

So backing every inline element with a View is a **5.4× memory increase per
element** — on a screen with a few thousand inline elements, megabytes. That
settles it: "make `<span>` a View with `display:'inline'` by default" is not
affordable, and the light text node has to stay for the folding case.

## 5. Which turns out to be the browser's answer too

Blink does not have one layout object that morphs with `display`. It has
`LayoutObject::CreateObject`, a factory that switches on computed display and
constructs a *different class* — `LayoutInline`, `LayoutBlockFlow`,
`LayoutFlexibleBox` — and destroys and recreates it when display changes.

So the shape is:

- **element layer: uniform** — identity, attributes, events; no layout
  behaviour; defaults from the UA sheet.
- **box layer: display selects the implementation**, and the cheap
  implementation is used for the cheap case.

Which is exactly what "two node types, chosen by display" is. Our two types are
not the problem; choosing between them *by tag* is. `<span>` should be the
light text node when it folds and a box-backed node when its display
establishes a formatting context — and `<div>` should be a box-backed node
because its UA display is `block`, not because it is spelled "div".

## 6. Where the choice has to be made — tried and narrowed

If `display` picks the backing implementation, *something* has to make that
choice per element instance. Three seams, and the first two are ruled out:

- **A composite component that renders one flavor or the other.** Cannot be
  reached: lowercase JSX resolves to a **host component looked up by name**, so
  `<span>` never reaches a composite unless every consumer goes through a
  custom JSX runtime. Attempted and reverted.
- **The view config.** `createReactNativeComponentClass(name, factory)`
  evaluates its factory once per name and caches it. It is per *component*, not
  per instance, so it cannot vary with a style prop.
- **The component descriptor.** `ComponentDescriptor::createShadowNode` is
  handed the props, so it is the first place where an element's `display` and
  its identity are both known. This is precisely where Blink makes the same
  choice, in `LayoutObject::CreateObject`.

**So the descriptor is the seam.** The work is a descriptor for the inline
elements that constructs the light text node or a box-backed node from
`props.display`, which also has to hold for `cloneShadowNode` — a display
change between revisions must be able to change the backing type, exactly as
Blink destroys and recreates the layout object.

…except it is not self-contained, and checking that is what actually settles
the design. `ConcreteComponentDescriptor` derives its props type from a single
shadow node — `using ConcreteProps = typename ShadowNodeT::ConcreteProps` — and
props are constructed *before* the node. So a descriptor that can build either
flavor still has exactly one props type, and that type has to carry the box
styling for the flavor that needs it.

Which puts `yogaStyle` (280 B) and the rest of `ViewProps` (1512 B against
`TextProps`' 344 B) on every `<span>`, box or not — the regression the split
exists to avoid.

**Resolved — and the premise was wrong.** The shared-props-type problem only
arises if it is *one component* with two node types. Two separate components,
chosen at instance creation, each keep their own descriptor and their own props
type: a folding `<span>` stays `TextProps` (344 B) and a box-flavoured one gets
`ElementBoxProps` (`ViewProps` + `nodeName`). Which is, again, exactly Blink —
`LayoutObject::CreateObject` constructs a *different class*, it does not morph
one.

The seam is the renderer: a view config may now carry
`resolveUIViewClassName(props)`, consulted where `createNode` is called, so one
JSX tag can be backed by different native components per instance. `<span>`
resolves to `element-box` when its display establishes a formatting context and
stays text-backed otherwise. Identity comes along for free: `recordNodeName`
already stamps the authored JSX type, so a box-flavoured `<span>` still reports
`RN:span`.

**Known limitation**: the resolve runs at instance creation only, so an element
whose display later crosses the box/no-box boundary keeps its original backing
until it remounts. Browsers recreate the layout object at that point; matching
that needs a remount signal the reconciler does not have today. Static display
— the overwhelming case, and all of Astryx — is correct.

The lazy-allocation work below is therefore no longer a prerequisite. It stands
on its own merits: today an element that generates *no* box still pays for its
`yoga::Node`. Putting it behind a pointer would make folding elements cheaper
than they are now, which is worth doing on its own — but it wants measuring
against a real screen first, since it changes memory layout for every view.

## 7. What is already right

Worth stating, so the migration does not throw it away:

- `display` already decides folding vs atomic (`isInlineFlowContent`), and
  `displayInlineAtomic` already encodes "establishes a formatting context".
  That is the spec's rule, in the right place.
- The anonymous IFC box being a Yoga leaf with a measure function is the
  correct boundary between flex layout and text layout.
- Inline elements already report real geometry through per-fragment rects,
  which is the `LayoutInline`-holds-fragments shape.

The gap is not the layout model. It is that the *element* layer is split by tag
instead of being uniform, which is what makes `display` on a `<span>` inert and
forces a C++ class per element.
