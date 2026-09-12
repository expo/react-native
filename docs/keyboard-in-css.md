# Does the keyboard belong in CSS?

Short answer: **yes, and it is already specified.** The web has been round this loop and the
result is three separate mechanisms, each answering a different question. Adopting their
spelling costs nothing and buys authors a model they already know.

This note is the research behind that answer, and a recommendation about which parts are
worth implementing here and which are not.

## What the web actually has

### 1. `env(safe-area-inset-*)` — the static obstruction

CSS Environment Variables, shipped everywhere for years:

```css
padding-bottom: env(safe-area-inset-bottom);
```

Four values, set by the user agent, usable anywhere a length is. This fork supports **none**
of `env()` today; safe areas are reached through a `SafeAreaView` component instead, which is
a component standing in for what should be a value.

### 2. `env(keyboard-inset-*)` — the moving one

From the [VirtualKeyboard API](https://www.w3.org/TR/virtual-keyboard/). Six values —
`keyboard-inset-top`, `-right`, `-bottom`, `-left`, `-width`, `-height` — plus an opt-in,
because by default the browser resizes the viewport rather than reporting a keyboard:

```js
navigator.virtualKeyboard.overlaysContent = true;
navigator.virtualKeyboard.addEventListener('geometrychange', …);
```

```css
.composer { bottom: env(keyboard-inset-height); }
```

The opt-in matters. It says: *I will handle the keyboard myself; stop resizing things for
me.* That is exactly the choice a native app makes when it turns off `adjustResize`.

### 3. `interactive-widget` — who moves when the keyboard appears

A viewport-meta parameter with three values:

| value | meaning |
|---|---|
| `resizes-visual` | the visual viewport shrinks; layout is untouched (the old iOS behaviour) |
| `resizes-content` | the layout viewport shrinks, so everything reflows |
| `overlays-content` | nothing resizes; the keyboard covers the page and you get insets |

This is the same decision `KeyboardAvoidingView.behavior` asks authors to make with
`'height' | 'position' | 'padding'` — but declared once for the document rather than
per-subtree, and named after the outcome rather than the mechanism. It is a better spelling
of a choice this codebase already forces people to make.

## Why this fits here unusually well

The renderer already runs CSS transitions and animations off the main JS thread on a shared
animation backend. A value that changes every frame is therefore not a novelty in this
codebase — it is the thing that backend exists for.

And the keyboard producers added on this branch already deliver exactly what `env()` needs: a
single scalar per frame, sampled from the platform's own clock, on both platforms.

## What I would and would not implement

**Worth doing, in this order:**

1. **`env(safe-area-inset-*)`.** Static, uncontroversial, and it retires a component that
   should never have been one. No per-frame concerns at all.
2. **`env(keyboard-inset-*)` resolved at layout.** Correct for the cases where the keyboard's
   arrival should change *layout* — a list that gets shorter, a form that reflows. Updated
   when the geometry settles, not per frame.
3. **An `overlays-content` equivalent.** The document-level declaration of who moves. Without
   it, authors are still making the per-subtree choice `KeyboardAvoidingView` forces.

**Not worth doing:**

4. **`env(keyboard-inset-*)` re-resolved every frame.** This is the tempting one and it is a
   trap. Each frame would mean a style resolution, a Yoga pass, and a mount transaction, for
   every element that mentions the variable — sixty to a hundred and twenty times a second,
   to move one bar. The native producers already position that bar per frame without any of
   it. The right division is:

   * per-frame, native, no layout: **anything that only moves** — a composer bar, a scroll
     view's content inset;
   * on settle, through layout: **anything that changes size or reflows**.

   A per-frame `env()` would be a worse implementation of the first, wearing the clothes of
   the second.

## What actually makes this hard here

Not the parsing. `fromRawValue` for `yoga::Style::Length` already accepts a string and hands
it to `parseCSSProperty`, so `env(safe-area-inset-bottom)` has an obvious home, and
`PropsParserContext` already carries a `surfaceId` and a `ContextContainer` to look the value
up in. That part is an afternoon.

The hard part is **invalidation**. Props are parsed once, at commit, from the raw props React
sends. Nothing re-parses them afterwards, so a length resolved from an environment value is
frozen at the commit that produced it. When the safe area changes — a rotation, a call banner,
the keyboard arriving — every already-committed `env()` length keeps the old number until
something unrelated makes React re-render that subtree.

That is not a small gap to paper over. It is the difference between a feature and a trap: an
`env()` that silently goes stale is worse than no `env()` at all, because the failure is
invisible until a device rotates.

Two ways out, neither cheap:

1. **Re-render from the environment.** Push the values into JS and let React re-render
   subtrees that use them. Honest and simple, but it puts a JS round trip in the path of a
   rotation, and it means `env()` is only as fresh as the last commit.
2. **Resolve after parsing.** Keep the unresolved `env()` in the shadow node and resolve it
   during layout, where the environment can be read fresh every pass. Correct, and it is what
   a browser does — but it means `yoga::Style::Length` can no longer be a plain number, which
   reaches much further than this feature.

   This is the same conclusion a separate investigation reached from the other end: that Yoga
   itself likely needs to know about the keyboard and the OS safe areas. Two roads to the same
   place is worth something — the reason `env()` is hard here is not the parsing and not the
   plumbing, it is that the layout engine has no notion of an environment that changes under
   it, and the fix is to give it one rather than to keep patching the layer above.

`SafeAreaView` exists precisely because of this. It is a component rather than a value because
a component *can* be told its insets have changed — it has state, and state re-lays-out. That
is the shape the problem forces on you if you do not solve invalidation, and it is why the
component is not simply a mistake to be replaced by `env()`.

## The honest caveat

`env(keyboard-inset-*)` on the web is defined against a *visual viewport* that a native app
does not have, and its values are documented as being the keyboard's rect within that
viewport. Mapping that onto a native surface is a judgement call, not a translation, and the
place it shows is the split keyboard and the floating iPad keyboard, where the keyboard is
not a bottom inset at all and `keyboard-inset-bottom` stops being meaningful.

The mapping this branch uses — obstruction measured from the bottom edge of the window,
folding in the safe area because the platform's own keyboard layout guide does — is right for
the docked keyboard, which is every phone and most tablet use.

For the floating and split cases it reports the safe area alone, which is also right: a
keyboard that is not against the bottom edge obstructs nothing there, and content below it is
genuinely fine. That falls out of `keyboardLayoutGuide` ignoring an undocked keyboard, which
this branch now sets explicitly rather than inherits. It has not been verified on an iPad —
the reasoning is from UIKit's documented behaviour, not from a run — and `keyboard-inset-left`
and `-right` would still have no honest answer for a split keyboard if they were implemented.
