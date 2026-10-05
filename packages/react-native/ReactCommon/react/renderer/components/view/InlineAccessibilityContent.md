# Inline accessibility content

Anonymous text runs are layout and paint objects. They are not accessibility
objects. `InlineAccessibilityContent` is the authored semantic value carried
beside a run so iOS and Android can expose native accessibility leaves without
inventing a public “text run” concept.

## Contract

- Preserve authored order across static text, semantic inline elements, and
  attachments.
- Flatten formatting-only elements into adjacent static text.
- Give an authored semantic boundary one stable identity, label, role, state,
  value, actions, language, event emitter, and the fragment indices needed for
  geometry.
- Record an inline attachment as an `Attachment` leaf for order, but let its
  mounted view be the platform leaf: the view already carries its own
  semantics, so a synthesized element would announce it twice. An authored
  element that wraps an attachment (`<a href><img></a>`) stays an `Element`
  and presents the wrapped view right after itself. Each leaf lists the views
  it presents (`attachmentTags`), and the content lists every attachment the
  run lays out, so a view no leaf presents (inside a hidden subtree) is not
  presented anywhere. Never pronounce the object-replacement character.
- Treat any element with semantics of its own — role, label, hint, state,
  value, actions, language, live region — as a boundary: its own leaf. The
  inline view configs declare these props on both platforms, so both see the
  same element.
- Be the only reading order. A platform exposes every leaf, in order, and
  re-decides none of it. The run's owner reads block children before a run
  (its `documentOrder`), then the run's leaves with each attachment's mounted
  view where its leaf stands, then the block children after it. iOS does this
  in `RCTViewComponentView`'s `accessibilityElements`; Android with one private
  host per segment between attachments, ordered in
  `ReactViewGroup.addChildrenForAccessibility`.
- Omit hidden semantic subtrees.
- Use text-engine fragment rectangles as the sole geometry source, including
  wrapping, RTL, font scaling, and relayout.
- Keep platform objects private: `UIAccessibilityElement`s presented by the iOS
  run's owner, and virtual descendants of childless Android hosts. Android
  places them on the painted run's own `Layout` over the leaf's fragment
  character ranges.

## Rejected behavior

- No duplicate whole-run element in addition to its semantic leaves.
- No accessibility stop for `<b>`, `<i>`, `<u>`, or an unsemantic `<span>`.
- No semantic inference from paint runs or visual styling.
- No Android virtual descendants on a host that also owns real children.
- No physical Android accessibility host in React child indices.
- No stale element cache after content, state, geometry, or language changes.

## Platform quality gates

Shared model tests assert flattening, ordered boundaries, explicit labels, and
hidden-subtree removal. iOS tests assert one native static-text leaf for one
bare-text run (not a container duplicate). Android tests assert that the
private host appears only when semantics exist, remains outside React child
management, and does not disturb paint order. RNTester’s “Platform Quality”
demos provide manual VoiceOver and TalkBack coverage for mixed static text,
links, buttons, disabled state, attachments, updates/live regions, language,
wrapping, and RTL.

Before release, run those demos with VoiceOver and TalkBack and verify swipe
order, spoken role/state/value, activation, focus rectangles, dynamic updates,
large text, and RTL. Automated snapshots are necessary but cannot validate the
screen reader’s spoken output or focus behavior.
