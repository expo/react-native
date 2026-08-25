/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPElementTextAreaComponentView.h"

#import <React/RCTConversions.h>
#import <React/EXPTextInputCaret.h>
#import <React/EXPElementDragOwnership.h>
#import <react/featureflags/ReactNativeFeatureFlags.h>
#import <react/renderer/components/view/ElementTextAreaShadowNode.h>

#import "RCTComponentViewFactory.h"

using namespace facebook::react;

@interface EXPElementTextAreaComponentView () <UITextViewDelegate, EXPElementDragOwnership>
@end

@implementation EXPElementTextAreaComponentView {
  UITextView *_textView;

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

    _textView = [[UITextView alloc] initWithFrame:self.bounds];
    _textView.delegate = self;
    _textView.font = [UIFont systemFontOfSize:17];
    // A textarea in a browser has a visible border. `UITextView` draws none, so
    // an unstyled `<textarea>` would be an invisible box on the page.
    _textView.layer.borderColor = [UIColor separatorColor].CGColor;
    _textView.layer.borderWidth = 1.0;
    _textView.layer.cornerRadius = 6.0;
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

- (void)layoutSubviews
{
  [super layoutSubviews];
  // Positioned against the text container rather than the view's bounds, so the
  // placeholder starts exactly where the first typed character will.
  const UIEdgeInsets insets = _textView.textContainerInset;
  const CGFloat lineFragmentPadding = _textView.textContainer.lineFragmentPadding;
  const CGFloat x = insets.left + lineFragmentPadding;
  const CGFloat width = CGRectGetWidth(_textView.bounds) - x - insets.right - lineFragmentPadding;
  _placeholderLabel.frame = CGRectMake(x, insets.top, MAX(width, 0), 0);
  [_placeholderLabel sizeToFit];
  _placeholderLabel.frame = CGRectMake(x, insets.top, MAX(width, 0), CGRectGetHeight(_placeholderLabel.frame));
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
}

- (void)textViewDidBeginEditing:(UITextView *)textView
{
  _textAtEditingStart = [textView.text copy];
  if (_eventEmitter) {
    std::static_pointer_cast<const ElementTextInputEventEmitter>(_eventEmitter)->onElementFocus();
  }
}

- (void)textViewDidEndEditing:(UITextView *)textView
{
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
    // whole document and restoring a saved range. Saving and restoring was
    // what this did, and it clamps silently when the new text is shorter —
    // which for a textarea means a caret that jumps on every clamped edit.
    EXPWriteTextPreservingCaret(_textView, RCTNSStringFromString(newAreaProps.value));
  } else if (!_isInitialValueSet && !newAreaProps.hasValue) {
    _textView.text = RCTNSStringFromString(newAreaProps.defaultValue);
  }

  [self updatePlaceholderVisibility];
  _isInitialValueSet = YES;

  [super updateProps:props oldProps:oldProps];
}

- (void)didMoveToWindow
{
  [super didMoveToWindow];
  const auto &props = static_cast<const ElementTextAreaProps &>(*_props);
  if (props.autoFocus && self.window != nil && !_textView.isFirstResponder) {
    [_textView becomeFirstResponder];
  }
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
