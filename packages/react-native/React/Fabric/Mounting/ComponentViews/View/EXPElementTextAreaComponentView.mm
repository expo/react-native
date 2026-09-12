/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPElementTextAreaComponentView.h"

#import <React/RCTScrollViewComponentView.h>

#import <React/RCTConversions.h>
#import <React/EXPTextInputCaret.h>
#import "EXPKeyboardTrace.h"
#import <React/EXPElementDragOwnership.h>
#import <react/featureflags/ReactNativeFeatureFlags.h>
#import <react/renderer/components/view/ElementTextAreaShadowNode.h>

#import "RCTComponentViewFactory.h"

using namespace facebook::react;

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
  NSString *_textAtEditingStart;
  BOOL _isInitialValueSet;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = ElementTextAreaShadowNode::defaultSharedProps();

    _textView = [[EXPElementTextAreaTextView alloc] initWithFrame:self.bounds];
    _textView.delegate = self;
    _textView.font = [UIFont systemFontOfSize:17];
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
  _textView.textContainer.lineFragmentPadding = 0;
  _textView.textContainerInset = UIEdgeInsetsZero;
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
  [super layoutSubviews];
  [self _applyPaddingToTextContainer];
  // Positioned against the text container rather than the view's bounds, so the
  // placeholder starts exactly where the first typed character will.
  const UIEdgeInsets insets = _textView.textContainerInset;
  const CGFloat lineFragmentPadding = _textView.textContainer.lineFragmentPadding;
  const CGFloat x = insets.left + lineFragmentPadding;
  const CGFloat width = CGRectGetWidth(_textView.bounds) - x - insets.right - lineFragmentPadding;
  /*
   * Given the text container's whole box, and left to centre its own line.
   *
   * NOT placed at the container's top inset and sized with `sizeToFit`, which
   * is two fragile things at once: the fitted height depends on the font being
   * current at that moment, and the origin is in the text view's CONTENT
   * coordinates, so any scroll offset carries the placeholder with it. Between
   * them the placeholder lands half a line low and clipped by the field's
   * bottom edge.
   *
   * A label draws one line vertically centred in its frame, so handing it the
   * container's box puts the placeholder exactly where the first typed line
   * will be, with nothing to keep in step.
   */
  const CGFloat containerHeight = CGRectGetHeight(_textView.bounds) - insets.top - insets.bottom;
  _placeholderLabel.frame =
      CGRectMake(x, insets.top + _textView.contentOffset.y, MAX(width, 0), MAX(containerHeight, 0));
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
  const auto &props = static_cast<const ElementTextAreaProps &>(*_props);
  if (props.maxLength >= 0 && (NSInteger)textView.text.length > props.maxLength) {
    UITextRange *selection = textView.selectedTextRange;
    textView.text = [textView.text substringToIndex:props.maxLength];
    textView.selectedTextRange = selection;
  }

  [self updatePlaceholderVisibility];

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
  if (!_eventEmitter) {
    return;
  }
  const NSRange range = textView.selectedRange;
  std::static_pointer_cast<const ElementTextInputEventEmitter>(_eventEmitter)
      ->onElementSelectionChange((int)range.location, (int)(range.location + range.length));
}

- (BOOL)textView:(UITextView *)textView
    shouldChangeTextInRange:(NSRange)range
            replacementText:(NSString *)text
{
  const auto &props = static_cast<const ElementTextAreaProps &>(*_props);
  return !props.readOnly;
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
   * "Claimed" is any stated border width — including zero, which is how an
   * author says they want none — or a background colour.
   */
  const auto &newViewProps = static_cast<const ViewProps &>(*props);
  const auto &border = newViewProps.yogaStyle.border(facebook::yoga::Edge::All);
  const BOOL authorStatedBorder = !border.isUndefined();
  const BOOL authorStatedBackground = (bool)newViewProps.backgroundColor;
  if (authorStatedBorder || authorStatedBackground) {
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
    EXPWriteTextPreservingCaret(_textView, RCTNSStringFromString(newAreaProps.value));
  } else if (!_isInitialValueSet && !newAreaProps.hasValue) {
    _textView.text = RCTNSStringFromString(newAreaProps.defaultValue);
  }

  [self updatePlaceholderVisibility];
  _isInitialValueSet = YES;

  [super updateProps:props oldProps:oldProps];
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
                                   self, (int)_textView.isFirstResponder, EXPKeyboardTrace.callers];
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
  _props = ElementTextAreaShadowNode::defaultSharedProps();
  _nativeEventCount = 0;
  _isInitialValueSet = NO;
  _textAtEditingStart = nil;
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
