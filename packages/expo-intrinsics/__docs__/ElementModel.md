# The element model: display picks the backing, not the tag

In CSS, box generation is driven by computed `display`, not by the tag. The same
`<span>` generates a box or does not depending on how it is styled, so any model
that answers "is this element a Yoga node" per tag keeps producing special
cases. This note sets out why the catalog has two backings and lets `display`
choose between them.

## 1. An inline box cannot be a Yoga node

This is a shape mismatch, not an implementation gap. A `<span>` that wraps
across three lines generates three boxes (CSS2 §9.2.2 splits an inline box into
one fragment per line). Yoga models one node as one box with one rect, and
giving it three disjoint rects would mean teaching Yoga line breaking, which
belongs to the text engine (CoreText, Android `Layout`). That is why the
anonymous inline formatting context box (`InlineContentShadowNode`) is a Yoga
leaf with a measure function: Yoga sizes the box and the text engine lays out
inside it.

So a folding inline element generates no Yoga box at all. Its contents join the
surrounding inline formatting context and its geometry comes back as fragment
rects. The converse holds too: `inline-block`, `inline-flex` and a sized inline
element each establish a formatting context and are a single unbreakable box,
which is a Yoga box participating in the line as an attachment, like a replaced
element. One element, two outcomes, chosen by `display` and content.

## 2. How browsers organise this

Browsers separate two layers:

| Layer  | Blink                                                | What it is                         |
| ------ | ---------------------------------------------------- | ---------------------------------- |
| DOM    | `Element`, `HTMLSpanElement`                         | identity, attributes, events, tree |
| Layout | `LayoutObject`: `LayoutInline`, `LayoutBlockFlow`, … | the generated box                  |

The DOM layer is uniform; `HTMLSpanElement` adds no layout behaviour, and all
default appearance comes from the user-agent stylesheet. The layout object is
created from computed style by `LayoutObject::CreateObject`, a factory that
switches on display and constructs a different class, destroying and recreating
it when display changes. `display: none` creates none, `display: inline` creates
a `LayoutInline` holding a list of line-box fragments, and `inline-block` or
`inline-flex` create a block-level layout object with an inline outer role.

## 3. Why one base class is not the answer

`YogaLayoutableShadowNode` holds its `yoga::Node` by value, and the node carries
a full `Style` (four 9-entry edge arrays, dimensions, flex fields), the layout
results, a child vector and a config pointer. `TextShadowNode` avoids all of it
by deriving from the non-Yoga `LayoutableShadowNode`. Measured on arm64 Debug
with `sizeof`:

|                  | node   | props  | per element |
| ---------------- | ------ | ------ | ----------- |
| `TextShadowNode` | 216 B  | 344 B  | **560 B**   |
| `ViewShadowNode` | 1536 B | 1512 B | **3048 B**  |

`yoga::Node` alone is 744 B, of which `yoga::Style` is 280 B. Backing every
inline element with a View is a 5.4× increase per element, megabytes on a screen
with a few thousand inline elements, in exactly the tree shape that matters
most: long text runs with many inline elements. The light text node has to stay
for the folding case.

## 4. The model

The element layer is uniform: identity, attributes, events, defaults from the
user-agent sheet, and no layout behaviour. The box layer is selected by display,
and the cheap implementation serves the cheap case. react-native offers two
backings, `inline-text` for an element that folds and `element-box` for one that
generates a box. A `<span>` is text-backed while it folds into an inline
formatting context and box-backed when its display establishes one, and a
`<div>` is box-backed because its user-agent display is `block`, not because it
is spelled "div".

The two backings are separate components rather than one component with two node
types, because a `ConcreteComponentDescriptor` has exactly one props type and
props are built before the node; a shared descriptor would put `ViewProps` on
every folding `<span>`. Instead a view config carries
`resolveUIViewClassName(props)`, consulted where the renderer creates a node, so
one JSX tag resolves to a different native component per instance. The authored
tag travels as `nodeName`, so a box-flavoured `<span>` still reports `span`.

The resolve runs at instance creation only. An element whose display later
crosses the box boundary keeps its original backing until it remounts, where a
browser recreates the layout object; matching that needs a remount signal the
reconciler does not provide. Static display is the overwhelming case.

## 5. What this rests on

`display` already decides folding versus atomic (`isInlineFlowContent`), and
`displayInlineAtomic` encodes "establishes a formatting context". The anonymous
inline formatting context box as a Yoga leaf with a measure function is the
boundary between flex layout and text layout. Inline elements report real
geometry through per-fragment rects, the shape `LayoutInline` has. The layout
model is the spec's; the element model above keeps the element layer uniform so
that `display` on a `<span>` means something and no element needs a C++ class of
its own.
