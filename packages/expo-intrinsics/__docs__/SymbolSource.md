# An icon is not a glyph

A decision to make, with the measurements that force it.

## What we do now

The keyboard demo draws its icons as **text**: a `<span>` containing `＋`, `≡`,
`⌨︎`, `✉︎`, and the reaction picker uses `❤️`, `👍`, `👎`, `😂`, `‼️`, `❓`.

That works until it doesn't:

- **Each glyph's ink sits differently in its em box.** A single centring
  correction cannot centre them all. Measured on the panel's tiles, the keyboard
  glyph sits low and slightly right of its circle while others are centred.
  Reported as "some of the menu icons are not vertically visually centered".
- **They scale with the reader's text size, and the box does not.** Making the
  box scale too fixes the common case and not the accessibility sizes, where the
  glyph is still clipped. Two attempts at explaining that failed
  (`fontSize` squaring, then `lineHeight` squaring); both produced renders
  identical to before, which means the explanation was wrong both times.
- **Colour emoji cannot be tinted.** The native reactions are monochrome.

## What the platform draws

Not text. Six **40×40 vector templates** in the platform's own asset catalogue:
a heart, a thumbs up, a thumbs down, an exclamation, a question mark, and a
laugh that is a **localised word**, with separate artwork for ENG, ESP, CYR, CHN,
JPN, KOR, HIN, THA, ARA, HEB and ITA.

Tinted, exactly: the heart's red is **#FA5E96** — a pink, and notably *not*
`systemRed` — and the others' grey is 50% grey, on a white pill.

A template image has no baseline and no em box. There is nothing to centre
because the artwork is already centred in its own square.

## The options

**1. An SF Symbol source.** `<img systemImage="heart.fill">`, or a `symbol:`
URL scheme on `src`. The precedent exists in this codebase —
`<native:menubutton>` already takes a `systemImage` and calls
`+[UIImage systemImageNamed:]`.

The cost is that it is a NON-STANDARD prop with no HTML analogue. The web has no
system-symbol source, so this is an extension rather than an implementation, and
every extension is a thing that will not port. It is worth saying out loud
before adding one.

**2. Ship the artwork.** Not available: it is Apple's, in Apple's framework.

**3. Keep text glyphs and correct each one.** Measure every glyph's ink offset
and state it beside the glyph. Six constants that are properties of a font at a
size, wrong the moment either changes, and no help at all for the tinting or the
clipping.

## What was built — `src="system:<name>"` (2026-09-04)

Option 1, and as a SOURCE rather than a prop:

```jsx
<img src="system:pencil" tintColor="#fff" style={{width: 18, height: 18}} />
<img src="system:arrow.up?weight=semibold" />
```

`EXPSystemImageLoader` is an `RCTImageURLLoader` that answers the `system`
scheme with `+[UIImage systemImageNamed:withConfiguration:]`, always as a
template so `tintColor` colours it. `system://name` and `system:name` are both accepted.

**`system:` and not `symbol:`.** Two reasons, and the second decided it.
`systemColor()` is already this codebase's word for "the platform's own", so a
source that means the same thing should say it the same way. And SF Symbols are
Apple's brand: `symbol:` reads as an Apple thing being asked for, where what the
author means is "the system's icon called this" — which Android can answer with
a Material symbol without either side lying.

**A prop was the other option and is the worse one.** `<native:menubutton>` has
`systemImage` and has to: its title and image are the button's *configuration*
and never become nodes, so there is no `src` for them to be. An `<img>` has one
already, and a scheme inherits `srcset`, `alt`, sizing and `tintColor` instead of
needing each again.

**Registering the loader is two steps, and the second is not obvious.**
`RCT_EXPORT_MODULE()` is necessary and not sufficient: the class linked, `+load`
ran, and `<img src="system:plus">` still reported *"No suitable image URL loader
found"*. `RCTImageLoader`'s loaders come from a hard-coded list in
`RCTAppSetupUtils.mm` plus whatever the module registry yields, and the registry
only yields modules something asked for BY NAME — nothing asks for an image
loader. The loader has to be listed beside `RCTBundleAssetImageLoader`.

**Android has no loader for the scheme yet**, so `system:` there fails to load
like any unknown source. Recorded rather than faked: the honest Android answer is
a Material symbol, which is a font rather than an image and needs its own
decision.

Measured on the keyboard demo's command tiles after the change: five tiles, five
identical symbol boxes, all centred — against glyphs that had varied in size and
in where their ink sat.

## The original recommendation


Option 1, scoped narrowly: a source, not a component. `<img>` already means "an
image from somewhere"; a symbol is a somewhere. It keeps the element standard
and puts the platform-specific part in the value, which is the same shape
`-apple-visual-effect` uses — a platform capability named in a value rather than
a new element invented for it.
