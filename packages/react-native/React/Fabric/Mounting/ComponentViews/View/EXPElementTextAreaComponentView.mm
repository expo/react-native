/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPElementTextAreaComponentView.h"

#import <React/RCTAssert.h>
#import <React/RCTScrollViewComponentView.h>

#import "EXPElementControlMetricsProbe.h"

#import <React/EXPElementDragOwnership.h>
#import <React/EXPTextInputCaret.h>
#import <React/RCTConversions.h>
#import <react/featureflags/ReactNativeFeatureFlags.h>
#import <react/renderer/components/view/ElementTextAreaShadowNode.h>
#import "EXPKeyboardTrace.h"

#import "RCTComponentViewFactory.h"

using namespace facebook::react;

/*
 * The font the element's text is drawn in.
 *
 * Stated once, because the PROBE has to use it too: the line box layout
 * multiplies by `rows` is this font's, so a probe that measured a control in
 * some other font would describe a field that is not the one on screen.
 *
 * A stated size rather than a Dynamic Type style, and that is a real
 * limitation rather than an oversight — see
 * DOM-CSS-LIMITATION(no-font-on-a-control): `font-size` does not reach a
 * control at all, so a field cannot be given a different size by its author
 * and does not follow the reader's text-size setting either. Changing it is a
 * visible change to every textarea and to the chat composer, which derives its
 * own inset from this line box; worth doing, not worth doing quietly here.
 */
static UIFont *EXPElementTextAreaFont(void)
{
  return [UIFont systemFontOfSize:17];
}

@interface EXPElementTextAreaComponentView () <UITextViewDelegate, EXPElementDragOwnership>
@end

/**
 * The text view the element constructs, so that its layout can be corrected in
 * one place. A subclass rather than a category, because a category could only
 * swizzle.
 */
@interface EXPElementTextAreaTextView : UITextView
@end

@implementation EXPElementTextAreaTextView

/**
 * A text view whose content fits has nothing to scroll. A frame that passes
 * through a smaller height mid-transition — the bar between its docked and
 * raised sizes — leaves a stale content offset behind, and text and placeholder
 * then sit that much low and clipped.
 */
- (void)layoutSubviews
{
  EXP_ATTRIBUTE_LAYOUT();
  [super layoutSubviews];
  if (self.contentSize.height <= CGRectGetHeight(self.bounds) + 0.5 && fabs(self.contentOffset.y) > 0.5) {
    self.contentOffset = CGPointZero;
  }
}

@end

@implementation EXPElementTextAreaComponentView {
  UITextView *_textView;

  /*
   * Whether this field currently holds the keyboard, kept because
   * `isFirstResponder` is already NO by the time we find out it stopped.
   *
   * A responder whose view leaves the window is resigned IMPLICITLY and posts
   * NO end-editing notification — so the one instrument watching for a resign
   * cannot see the case: a capture of the vanishing keyboard has `editing=1` as
   * the bar leaves the window and no `editing ENDED` line anywhere in the dump.
   */
  BOOL _holdsTheKeyboard;

  /*
   * A write was made while the host was animating and its queued correction has
   * not been dropped yet. Only the DROP is owed now — the input system is told
   * inline by the write itself, because that news is the keyboard's keyplane
   * change and withholding it withheld the autocapitalisation with it.
   */
  BOOL _owesCorrectionDrop;
  /* Which write the pending settle belongs to; a newer one supersedes. */
  NSUInteger _dropGeneration;

  /* The last content size reported, so an unchanged one costs nothing. */
  CGFloat _reportedContentWidth;
  CGFloat _reportedContentHeight;

  /*
   * `UITextView` has no placeholder of its own — unlike `UITextField`, which is
   * why this exists. A label pinned to the text's own origin and hidden as soon
   * as anything is typed is what UIKit apps do, and matching the text container
   * insets is what keeps it from sitting a few points off the caret.
   */
  UILabel *_placeholderLabel;

  NSInteger _nativeEventCount;
  /* Whether the text is being changed by THIS view applying a controlled
     `value`, rather than by the user — see `-textViewDidChange:`. The same flag
     `<input>` keeps, by the same name, for the same reason. */
  BOOL _isApplyingProps;
  NSString *_textAtEditingStart;
  BOOL _isInitialValueSet;
  /*
   * The platform's OWN text spacing, read once before anything overwrites it.
   *
   * Asked rather than hardcoded: these are UIKit's numbers and it is entitled
   * to change them. See `_applyPaddingToTextContainer`.
   */
  UIEdgeInsets _platformTextInset;
  CGFloat _platformLineFragmentPadding;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = ElementTextAreaShadowNode::defaultSharedProps();

    _textView = [[EXPElementTextAreaTextView alloc] initWithFrame:self.bounds];
    /*
     * The platform's own spacing, taken before anything here overwrites it, so
     * a field with no stated padding can be handed back what UIKit gives every
     * other text view. Read from the instance rather than written down: these
     * are UIKit's numbers, not ours.
     */
    _platformTextInset = _textView.textContainerInset;
    _platformLineFragmentPadding = _textView.textContainer.lineFragmentPadding;
    _textView.delegate = self;
    _textView.font = EXPElementTextAreaFont();
    // A textarea in a browser has a visible border. `UITextView` draws none, so
    // an unstyled `<textarea>` would be an invisible box on the page. Applied
    // in `updateProps` rather than here, because whether it applies at all
    // depends on what the author asked for.
    _textView.layer.borderColor = [UIColor separatorColor].CGColor;
    _textView.backgroundColor = [UIColor clearColor];

    _placeholderLabel = [[UILabel alloc] initWithFrame:CGRectZero];
    _placeholderLabel.font = _textView.font;
    _placeholderLabel.textColor = [UIColor placeholderTextColor];
    _placeholderLabel.numberOfLines = 0;
    _placeholderLabel.hidden = YES;
    [_textView addSubview:_placeholderLabel];

    self.elementControl = _textView;
  }
  return self;
}

/**
 * CSS padding, as the TEXT CONTAINER's inset.
 *
 * A `<textarea>`'s padding insets its text — that is what padding means on a
 * control in the DOM — and the text view fills the element's whole box, so the
 * padding has nowhere else to go. Left to UIKit's default the inset is a flat
 * 8 top and bottom whatever the author writes, which in a 40-point pill puts a
 * 21-point line at 8 with 11 below it — the text sitting off-centre in its box.
 *
 * `lineFragmentPadding` is zeroed for the same reason. It is UIKit's own extra
 * five points at each end of every line, invisible in the API and not something
 * CSS has a name for, so an author's horizontal padding would be off by five
 * at both ends.
 */
- (void)_applyPaddingToTextContainer
{
  /*
   * ZERO, because the element's own layout has already applied the padding.
   *
   * The control is laid out in the CONTENT box — inside the padding — so an
   * inset of the same padding applies it twice: in a 40-point pill with 9.5
   * points either side, the text view is 21 tall and a 9.5-point inset pushes
   * a 21-point line most of the way out of it. That is the placeholder sitting
   * half a line low and clipped by the field's bottom edge.
   *
   * UIKit's own default is 8 top and bottom, which is the same mistake with a
   * number nobody chose — so it is not left alone either. CSS padding is the
   * only thing that insets this text, which is what padding means.
   *
   * `lineFragmentPadding` goes for the same reason: five points at each end of
   * every line, invisible in the API and with no name in CSS.
   */
  /*
   * ONLY when the author has stated padding. Otherwise the platform's.
   *
   * The reasoning above holds exactly when there IS padding to apply: the
   * control is laid out in the content box, so insetting by the same padding
   * applies it twice. When nothing states any, zeroing leaves the text flush
   * in the corner of the box — reported from a device as a text field with no
   * inner spacing at all, and visible the moment the border came back for it
   * to sit against.
   *
   * On iOS nothing does state any: `FIELD_SURFACE` carries `paddingInline`
   * only on Android, so an iOS `<textarea>` reaches here with no padding on
   * any edge, and what the sheet reserved for spacing is spent on exactly this
   * inset — `EXPElementTextAreaGeometryTests` pins the two to each other.
   *
   * So the rule is the border's, one control over: no stated padding means the
   * platform's spacing. It is not interchangeable with layout padding —
   * `textContainerInset` lets long text scroll THROUGH the inset, where a
   * smaller content box would clip it — which is the behaviour a native field
   * has and the reason to delegate rather than restate.
   */
  // The same questions layout asks, of the same props — see `elementStatesBlockPadding`.
  // Per axis: the block inset stays the platform's unless the author states
  // block padding, and the inline spacing likewise.
  const auto &props = static_cast<const ViewProps &>(*_props);
  const BOOL blockStated = elementStatesBlockPadding(props);
  const BOOL inlineStated = elementStatesInlinePadding(props);
  UIEdgeInsets inset = _platformTextInset;
  if (blockStated) {
    inset.top = 0;
    inset.bottom = 0;
  }
  if (inlineStated) {
    inset.left = 0;
    inset.right = 0;
  }
  _textView.textContainerInset = inset;
  _textView.textContainer.lineFragmentPadding = inlineStated ? 0 : _platformLineFragmentPadding;
}

/**
 * The wrapped height, reported when it changes.
 *
 * Only sent when it actually differs: a text view recomputes its content size
 * during layout, and an event per pass would be an event per frame while
 * anything at all is moving.
 */
- (void)_reportContentSizeIfChanged
{
  if (_eventEmitter == nullptr) {
    return;
  }
  const CGSize size = _textView.contentSize;
  if (fabs(size.height - _reportedContentHeight) < 0.5 && fabs(size.width - _reportedContentWidth) < 0.5) {
    return;
  }
  _reportedContentHeight = size.height;
  _reportedContentWidth = size.width;
  std::static_pointer_cast<const ElementTextInputEventEmitter>(_eventEmitter)
      ->onElementContentSizeChange(static_cast<Float>(size.width), static_cast<Float>(size.height));
}

- (void)layoutSubviews
{
  EXP_ATTRIBUTE_LAYOUT();
  [super layoutSubviews];
  [self _applyPaddingToTextContainer];
  // Positioned against the text container rather than the view's bounds, so the
  // placeholder starts exactly where the first typed character will.
  const UIEdgeInsets insets = _textView.textContainerInset;
  const CGFloat lineFragmentPadding = _textView.textContainer.lineFragmentPadding;
  const CGFloat x = insets.left + lineFragmentPadding;
  const CGFloat width = CGRectGetWidth(_textView.bounds) - x - insets.right - lineFragmentPadding;
  /*
   * As tall as the placeholder ITSELF, at the container's top.
   *
   * A label draws its text vertically centred in its frame, so a frame the size
   * of the whole container puts a one-line placeholder in the middle of the
   * box. In a field that is one line that is exactly where the first typed
   * character goes — and in one that has GROWN it is the middle of several
   * lines, which is where the placeholder appeared for the frames a composer
   * spends collapsing after a send. Reported from a device as the placeholder
   * jumping to the middle of the text area.
   *
   * Measured rather than assumed a line: `numberOfLines` is 0, so a long
   * placeholder wraps, and a frame of one line would clip it. Clamped to the
   * container for the same reason the container is the width — what does not
   * fit is the field's business, not this label's.
   *
   * The origin stays the container's top inset plus the scroll offset: the
   * frame is in the text view's CONTENT coordinates, so a scrolled field would
   * otherwise carry the placeholder away with it.
   */
  const CGFloat containerHeight = CGRectGetHeight(_textView.bounds) - insets.top - insets.bottom;
  const CGFloat fitted = [_placeholderLabel sizeThatFits:CGSizeMake(MAX(width, 0), CGFLOAT_MAX)].height;
  _placeholderLabel.frame =
      CGRectMake(x, insets.top + _textView.contentOffset.y, MAX(width, 0), MAX(MIN(fitted, containerHeight), 0));
  [self _reportContentSizeIfChanged];
}

#pragma mark - EXPElementDragOwnership

- (BOOL)elementOwnsDragGesture
{
  // A textarea scrolls its own content, so a drag inside one belongs to it
  // whenever there is more text than fits — otherwise the page scrolls and the
  // user can never reach the rest of what they wrote. When the text does fit
  // there is nothing to scroll and the gesture is the page's.
  if (!ReactNativeFeatureFlags::enableNativeGestureRecognizers()) {
    return NO;
  }
  return _textView.isEditable && _textView.contentSize.height > CGRectGetHeight(_textView.bounds);
}

#pragma mark - Events

- (void)updatePlaceholderVisibility
{
  _placeholderLabel.hidden = _textView.text.length > 0;
}

- (void)textViewDidChange:(UITextView *)textView
{
  EXP_ATTRIBUTE_LAYOUT();
  /*
   * A CONTROLLED WRITE IS NOT AN EDIT, and this is where that is said.
   *
   * `el.value = 'x'` does not fire `input` in a browser — that event is the
   * user's — and a field that reports the app's own write back to it hands the
   * app its own string as if it had been typed. The chat demo's composer is
   * exactly that shape: it writes the message into the field on a send and
   * clears it a few frames later, and the echo of the FIRST write arrived after
   * the clear and put the message back. Reported from a device as "the text
   * area retains the trimmed text even after sending it", and read off the
   * app's own log: the last input event carried `"Trim me"` — the trimmed
   * message, which nobody typed.
   *
   * `_nativeEventCount` is not bumped either: it exists to tell a value
   * computed before the keystrokes still in flight from a fresh one, and this
   * view's own write is not a keystroke. Bumping it here would make the app's
   * next value look stale and be discarded — which is the other half of the
   * same bug, the one that makes the field keep the text for good.
   *
   * The placeholder and the content size are still updated below: those are
   * facts about the text, and the text did change.
   */
  const BOOL isEcho = _isApplyingProps;
  const auto &props = static_cast<const ElementTextAreaProps &>(*_props);
  if (!isEcho && props.maxLength >= 0 && (NSInteger)textView.text.length > props.maxLength) {
    UITextRange *selection = textView.selectedTextRange;
    textView.text = [textView.text substringToIndex:props.maxLength];
    textView.selectedTextRange = selection;
  }

  [self updatePlaceholderVisibility];

  if (isEcho) {
    [self _reportContentSizeIfChanged];
    return;
  }

  if (!_eventEmitter) {
    return;
  }
  _nativeEventCount++;
  std::static_pointer_cast<const ElementTextInputEventEmitter>(_eventEmitter)
      ->onElementInput(RCTStringFromNSString(textView.text), (int)_nativeEventCount);
  /*
   * The wrapped height, reported HERE as well as from layout.
   *
   * `layoutSubviews` does not run when the text changes and the box does not —
   * which is every keystroke in a field that has not been resized yet. Reported
   * only from there, the one event a growing composer needs never arrives and
   * the field stays at one line however much is typed: measured at 40 points
   * empty, 40 focused, and 40 after a hundred and forty characters.
   */
  [self _reportContentSizeIfChanged];
}

- (void)textViewDidBeginEditing:(UITextView *)textView
{
  _holdsTheKeyboard = YES;
  _textAtEditingStart = [textView.text copy];
  if (_eventEmitter) {
    std::static_pointer_cast<const ElementTextInputEventEmitter>(_eventEmitter)->onElementFocus();
  }
}

- (void)textViewDidEndEditing:(UITextView *)textView
{
  _holdsTheKeyboard = NO;
  // No input system left to tell; the next session starts from the document.
  _owesCorrectionDrop = NO;
  if (!_eventEmitter) {
    return;
  }
  auto emitter = std::static_pointer_cast<const ElementTextInputEventEmitter>(_eventEmitter);
  if (![textView.text isEqualToString:_textAtEditingStart]) {
    emitter->onElementChange(RCTStringFromNSString(textView.text));
  }
  emitter->onElementBlur();
}

- (void)textViewDidChangeSelection:(UITextView *)textView
{
  EXP_ATTRIBUTE_LAYOUT();
  if (!_eventEmitter) {
    return;
  }
  const NSRange range = textView.selectedRange;
  std::static_pointer_cast<const ElementTextInputEventEmitter>(_eventEmitter)
      ->onElementSelectionChange((int)range.location, (int)(range.location + range.length));
}

- (BOOL)textView:(UITextView *)textView shouldChangeTextInRange:(NSRange)range replacementText:(NSString *)text
{
  // An edit is coming: the input system hears about the quiet clear first.
  [self _settleCorrectionDrop];
  const auto &props = static_cast<const ElementTextAreaProps &>(*_props);
  return !props.readOnly;
}

/*
 * Note that news is owed, and arm the backstop that gives it if nobody else
 * does.
 *
 * WHEN rest is, and who knows it. A host that says `quiet` is telling this
 * element it is in the middle of something, and the news waits for it to stop
 * — see the falling edge in `updateProps`. The timer is only for a host that
 * says nothing, and it is deliberately long: half a second was chosen as "past
 * a send's choreography" and measured, on a phone, landing 545, 551 and 553
 * milliseconds into three sends whose throw runs for 769. The cost is 113
 * milliseconds of main thread, so a deadline that lands mid-animation is seven
 * dropped frames.
 *
 * Two seconds is not a better guess; it is a BACKSTOP. Anything that cares
 * gives the element the truth instead, and the next edit settles it earlier in
 * either case. A newer write supersedes an older backstop, so a second send
 * inside the first's window is covered by one telling.
 */
- (void)_oweCorrectionDrop
{
  _owesCorrectionDrop = YES;
  const NSUInteger generation = ++_dropGeneration;
  __weak __typeof(self) weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(2.0 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    __strong __typeof(weakSelf) strongSelf = weakSelf;
    if (strongSelf != nil && strongSelf->_dropGeneration == generation) {
      [strongSelf _settleCorrectionDrop];
    }
  });
}

- (void)_settleCorrectionDrop
{
  if (!_owesCorrectionDrop) {
    return;
  }
  _owesCorrectionDrop = NO;
  if (_textView.isFirstResponder) {
    // Only the drop. The write already told the input system, so telling it
    // again here would buy nothing and cost another keyplane relayout.
    EXPDropPendingCorrection(_textView);
  }
}

#pragma mark - RCTComponentViewProtocol

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &oldAreaProps = static_cast<const ElementTextAreaProps &>(*_props);
  const auto &newAreaProps = static_cast<const ElementTextAreaProps &>(*props);

  /*
   * `caret-color`, which on iOS is the control's TINT.
   *
   * UIKit draws the insertion point and the selection handles in `tintColor`,
   * and a view inherits that from its window unless something sets it — so
   * without this a composer's caret is whatever the app's accent happens to be.
   * Measured against the native composer, whose caret is its own #0088FF; the
   * inherited tint here is (66,107,242).
   *
   * Unset leaves the inherited tint alone rather than forcing a colour, which
   * is what CSS's `auto` means here.
   */
  if (newAreaProps.caretColor != oldAreaProps.caretColor) {
    UIColor *const caret = RCTUIColorFromSharedColor(newAreaProps.caretColor);
    _textView.tintColor = caret;
  }

  /*
   * The default outline, unless the author has claimed the surface.
   *
   * `<button>` already works this way — an author background or border means
   * the platform stops drawing its own, because two chromes on one box is
   * neither the author's design nor the platform's. Drawing the border
   * unconditionally from `init` leaves NO WAY to turn it off: `borderWidth: 0`
   * changes nothing, and a composer that wants the field's shape to come from a
   * material behind it gets the material AND a second rounded outline inside it.
   *
   * "Claimed" is any stated BORDER width — including zero, which is how an
   * author says they want none.
   *
   * A background does NOT claim it, and reading one as a claim is what made
   * every `<textarea>` lose its outline. The props this sees are MERGED, so
   * the background it found was the user-agent sheet's own: a textarea takes
   * `FIELD_SURFACE`, which sets `systemColor('Field')` on iOS because the
   * control draws an outline and no fill, and without it the field is
   * transparent. So the sheet supplied the fill, this code read the fill as
   * the author claiming the surface, and the outline was dropped — on every
   * textarea, never on `<button>`, which never takes that surface.
   *
   * There is no author layer visible from here to ask instead, so the rule is
   * the one the border itself states: no stated border means the platform's,
   * and `borderWidth: 0` is how a composer that draws its own shape — a
   * material behind the field — turns it off.
   */
  /*
   * EVERY EDGE, not just `All`.
   *
   * The sheet states a textarea's sides individually and Yoga breaks a tie
   * between style layers by EDGE SPECIFICITY rather than by which layer wrote
   * it, so anyone turning this border off has to say it per edge —
   * `borderTopWidth: 0` and its three siblings, which is exactly what the
   * chat composer does. Asking only `Edge::All` misses all four and hands the
   * outline back to a field that spent four declarations refusing it.
   */
  const auto &newViewProps = static_cast<const ViewProps &>(*props);
  const auto &yogaStyle = newViewProps.yogaStyle;
  BOOL authorStatedBorder = NO;
  for (const auto edge :
       {facebook::yoga::Edge::All,
        facebook::yoga::Edge::Horizontal,
        facebook::yoga::Edge::Vertical,
        facebook::yoga::Edge::Top,
        facebook::yoga::Edge::Bottom,
        facebook::yoga::Edge::Left,
        facebook::yoga::Edge::Right,
        facebook::yoga::Edge::Start,
        facebook::yoga::Edge::End}) {
    if (!yogaStyle.border(edge).isUndefined()) {
      authorStatedBorder = YES;
      break;
    }
  }
  if (authorStatedBorder) {
    _textView.layer.borderWidth = 0;
    _textView.layer.cornerRadius = 0;
  } else {
    _textView.layer.borderWidth = 1.0;
    _textView.layer.cornerRadius = 6.0;
  }

  if (!_isInitialValueSet || oldAreaProps.placeholder != newAreaProps.placeholder) {
    _placeholderLabel.text = RCTNSStringFromStringNilIfEmpty(newAreaProps.placeholder);
    [self setNeedsLayout];
  }

  if (!_isInitialValueSet || oldAreaProps.disabled != newAreaProps.disabled ||
      oldAreaProps.readOnly != newAreaProps.readOnly) {
    // Read-only keeps selection and copying alive and only refuses edits, which
    // is handled in the delegate above; disabled takes the control out of use
    // entirely.
    _textView.editable = !newAreaProps.disabled;
    _textView.selectable = !newAreaProps.disabled;
    self.userInteractionEnabled = !newAreaProps.disabled;
    if (newAreaProps.disabled && _textView.isFirstResponder) {
      [_textView resignFirstResponder];
    }
  }

  if (!_isInitialValueSet || oldAreaProps.spellCheck != newAreaProps.spellCheck) {
    _textView.spellCheckingType = newAreaProps.spellCheck ? UITextSpellCheckingTypeYes : UITextSpellCheckingTypeNo;
  }

  // Its own attribute, not a consequence of the one above (§6.8.5 vs §6.8.8).
  if (!_isInitialValueSet || oldAreaProps.autoCorrect != newAreaProps.autoCorrect) {
    _textView.autocorrectionType = newAreaProps.autoCorrect ? UITextAutocorrectionTypeYes : UITextAutocorrectionTypeNo;
  }

  // The controlled write, with the same staleness rule as `<input>`: while
  // JavaScript's echo trails the count of edits sent, the value in these props
  // was computed without the keystrokes still in flight, and writing it would
  // rewind the field under the user's fingers.
  const BOOL isValueCurrent = newAreaProps.mostRecentEventCount >= _nativeEventCount;
  if (newAreaProps.hasValue && isValueCurrent) {
    // The same change-anchored write `<input>` uses: replace only the span
    // that differs and let UIKit move the caret, rather than assigning the
    // whole document and restoring a saved range. A saved range clamps
    // silently when the new text is shorter, which for a textarea means a
    // caret that jumps on every clamped edit.
    /*
     * Flagged for the delegate — see `-textViewDidChange:`. A scope guard
     * rather than a pair of assignments, as `<input>` does: the write can run
     * arbitrary code on the way out.
     */
    struct ApplyingGuard {
      BOOL *flag;
      explicit ApplyingGuard(BOOL *f) : flag(f)
      {
        *flag = YES;
      }
      ~ApplyingGuard()
      {
        *flag = NO;
      }
    } guard{&_isApplyingProps};
    // Any news still owed goes first, so the input system hears the changes
    // in the order they were made — unless the host has said it is busy, in
    // which case the news is what we are holding and this is not the moment.
    if (!newAreaProps.quiet) {
      [self _settleCorrectionDrop];
    }
    /*
     * A whole-document write while the host is animating owes its correction
     * drop rather than paying it: the drop rebuilds the keyboard, and a send
     * that trims its draft makes exactly such a write with the balloon in the
     * air — measured at forty milliseconds inside the flight.
     *
     * The CLEAR a send makes is no longer a case of its own. It used to be
     * made with `inputDelegate` detached, to keep the keyboard's ~19ms off the
     * balloon's first frame, and the news was handed over when the flight
     * ended. Sampling showed that cost is a KEYPLANE CHANGE — the keyboard
     * flipping to shifted because the document is now at a sentence start —
     * so deferring it deferred the shift, and the uppercase did not come back
     * until the bubble landed. Same event, one cost. Paid inline now, where
     * Messages and every other app pays it.
     */
    const CFTimeInterval writeBegan = CACurrentMediaTime();
    [EXPKeyboardTrace beginAttributing];
    if (EXPWriteTextPreservingCaret(_textView, RCTNSStringFromString(newAreaProps.value), newAreaProps.quiet)) {
      [self _oweCorrectionDrop];
    }
    double ourMs = 0.0;
    NSUInteger ourPasses = 0;
    NSString *ourDetail = nil;
    [EXPKeyboardTrace endAttributing:&ourMs passes:&ourPasses detail:&ourDetail];
    const double writeMs = (CACurrentMediaTime() - writeBegan) * 1000.0;
    if (writeMs > 2.0) {
      /*
       * Attributed, so a slow write is never read as OUR slowness. Almost all
       * of it is the keyboard relaying its input window out after a keyplane
       * change, and `ours` says so in the line rather than leaving the next
       * reader to assume the worst about this code.
       */
      [EXPKeyboardTrace record:
                            @"textarea write %.0fms len=%lu (ours=%.1fms/%lu passes [%@]; the rest is "
                            @"UIKit's keyplane relayout)",
                            writeMs,
                            (unsigned long)newAreaProps.value.size(),
                            ourMs,
                            (unsigned long)ourPasses,
                            ourDetail];
    }
  } else if (!_isInitialValueSet && !newAreaProps.hasValue) {
    _textView.text = RCTNSStringFromString(newAreaProps.defaultValue);
  }

  [self updatePlaceholderVisibility];
  _isInitialValueSet = YES;

  [super updateProps:props oldProps:oldProps];

  /*
   * The host has stopped moving, so the news owed from a quiet clear is given
   * now. This is the whole point of `quiet`: the cost is a keyboard rebuild,
   * and there is no moment during an animation when 113 milliseconds of main
   * thread is free. The host knows when its animation ends; a timer only ever
   * knew when half a second had passed.
   */
  if (oldAreaProps.quiet && !newAreaProps.quiet) {
    [self _settleCorrectionDrop];
  }
}

/**
 * `focus()` and `blur()`, the same pair `<input>` has and for the same reason:
 * `autoFocus` covers only the element that knows at mount that it wants the
 * keyboard, and nothing else could focus one at all.
 */
- (void)handleCommand:(const NSString *)commandName args:(const NSArray *)args
{
  if ([commandName isEqualToString:@"focus"]) {
    [_textView becomeFirstResponder];
    return;
  }
  if ([commandName isEqualToString:@"blur"]) {
    [_textView resignFirstResponder];
    return;
  }
  [super handleCommand:commandName args:args];
}

/**
 * Tell the scroll view where the caret is, so focusing this element brings it
 * into view rather than leaving it behind the keyboard.
 *
 * `RCTTextInputComponentView` does the same. Without it a scroll view
 * containing this element has no idea where the focus is: it reserves room for
 * the keyboard correctly and then leaves the focused control under it. Reported
 * as the caret's rect rather than the whole control, because
 * a tall text area scrolled to show its top is still a text area you cannot see
 * yourself typing in.
 */
- (void)reactUpdateResponderOffsetForScrollView:(RCTScrollViewComponentView *)scrollView
{
  if (![self isDescendantOfView:scrollView.scrollView] || !_textView.isFirstResponder) {
    scrollView.firstResponderViewOutsideScrollView = _textView;
    return;
  }

  UITextRange *selectedTextRange = _textView.selectedTextRange;
  UITextSelectionRect *selection = [_textView selectionRectsForRange:selectedTextRange].firstObject;
  CGRect focusRect = selection == nil ? self.bounds : selection.rect;
  scrollView.firstResponderFocus = [self convertRect:focusRect toView:nil];
}

- (void)didMoveToWindow
{
  [super didMoveToWindow];
  /*
   * THE FIELD LEFT THE WINDOW WHILE IT HELD THE KEYBOARD.
   *
   * This is the resign nothing else can see. UIKit dismisses a first responder
   * whose view leaves the window without asking and without posting
   * end-editing, so `editing ENDED` — the only line watching for a resign — is
   * absent for exactly the case that drops the keyboard on a device.
   * Recorded here, at the field itself, rather than at the bar: the bar is one
   * of several ancestors that could be the one removed, and which of them it was
   * is the whole question.
   *
   * The frames matter more than the fact. Depth chosen to clear UIKit's own
   * removal and constraint teardown, which is about eight frames of nothing
   * before the first caller that could be ours.
   */
  if (self.window == nil && _holdsTheKeyboard && [EXPKeyboardTrace isRecording]) {
    [EXPKeyboardTrace recordPinned:@"FIELD LEFT THE WINDOW HOLDING THE KEYBOARD %p fr=%d <- %@",
                                   self,
                                   (int)_textView.isFirstResponder,
                                   EXPKeyboardTrace.callers];
  }
  const auto &props = static_cast<const ElementTextAreaProps &>(*_props);
  if (props.autoFocus && self.window != nil && !_textView.isFirstResponder) {
    [_textView becomeFirstResponder];
  }
}

- (BOOL)asksForKeyboardOnArrival
{
  return static_cast<const ElementTextAreaProps &>(*_props).autoFocus;
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  _nativeEventCount = 0;
  _isInitialValueSet = NO;
  _textAtEditingStart = nil;
  _owesCorrectionDrop = NO;
  _textView.text = @"";
  _textView.editable = YES;
  _placeholderLabel.text = nil;
  [self updatePlaceholderVisibility];
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<ElementTextAreaComponentDescriptor>();
}

+ (void)load
{
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

@end

/*
 * `<textarea>`: what a real text view insets its text by, and the line box
 * that text lays out in.
 *
 * Measured at ONE line and at TWO, and the two terms taken from the
 * difference: the line box is what a second line cost, and the inset is what
 * was left over. Neither is assumed — a probe that measured one height and
 * subtracted a remembered inset would be writing the number down again, one
 * level further in.
 */
void EXPProbeTextAreaMetrics(facebook::react::ElementControlMetrics &metrics)
{
  RCTAssertMainQueue();
  // In a window, so anything the control resolves from its trait environment
  // resolves the way it will on screen. A detached view keeps whatever traits
  // it was born with.
  UIWindow *window = [[UIWindow alloc] initWithFrame:CGRectMake(0, 0, 320, 400)];
  /*
   * A PLAIN text view, deliberately, where the other probes build the control
   * their element mounts.
   *
   * What is being asked for here is the platform's text metrics — the inset it
   * keeps around its text and the box its lines lay out in — and those belong
   * to `UITextView`. The element's own subclass overrides `layoutSubviews` to
   * correct a stale content offset and changes no metric, so measuring one
   * would be measuring the same numbers through a subclass that has no opinion
   * about them.
   *
   * The FONT is shared, because that one does decide the line box.
   */
  UITextView *textView = [[UITextView alloc] initWithFrame:CGRectMake(0, 0, 240, 400)];
  textView.font = EXPElementTextAreaFont();
  [window addSubview:textView];
  [window layoutIfNeeded];

  textView.text = @"Xg";
  const CGFloat oneLine = [textView sizeThatFits:CGSizeMake(240, CGFLOAT_MAX)].height;
  textView.text = @"Xg\nXg";
  const CGFloat twoLines = [textView sizeThatFits:CGSizeMake(240, CGFLOAT_MAX)].height;
  [textView removeFromSuperview];

  const CGFloat lineBox = twoLines - oneLine;
  // A control that answered nonsense leaves the defaults alone rather than
  // publishing a field nobody can type in.
  if (lineBox > 0 && oneLine - lineBox >= 0) {
    metrics.textAreaLineBox = static_cast<facebook::react::Float>(lineBox);
    metrics.textAreaInsetBlock = static_cast<facebook::react::Float>(oneLine - lineBox);
  }
}
