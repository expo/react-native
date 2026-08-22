/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPElementTextInputComponentView.h"

#import <React/RCTConversions.h>
#import <React/RCTUtils.h>
#import <React/EXPElementDragOwnership.h>
#import <react/featureflags/ReactNativeFeatureFlags.h>
#import <react/renderer/components/view/ElementTextInputShadowNode.h>

#import "RCTComponentViewFactory.h"

using namespace facebook::react;

@interface EXPElementTextInputComponentView () <UITextFieldDelegate, EXPElementDragOwnership>
@end

@implementation EXPElementTextInputComponentView {
  UITextField *_textField;

  /*
   * The number of edits this element has sent to JavaScript. Compared against
   * the `mostRecentEventCount` prop coming back the other way to decide whether
   * an incoming `value` is current or stale — see `updateProps:`.
   */
  NSInteger _nativeEventCount;

  /*
   * The text as it was when editing began, for deciding whether `change` is
   * owed on blur. The DOM fires it only if the value actually differs.
   */
  NSString *_textAtEditingStart;

  BOOL _isInitialValueSet;

  /*
   * Guards against starting a synchronous edit report from inside one. The
   * dispatch mounts re-entrantly, and a mount that reached this method again
   * would block the UI thread on the runtime it is already holding.
   */
  BOOL _isReportingEditSynchronously;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = ElementTextInputShadowNode::defaultSharedProps();

    _textField = [[UITextField alloc] initWithFrame:self.bounds];
    _textField.delegate = self;
    // The platform's own field, with the platform's own chrome. A native app's
    // single-line input is a bordered rounded rect, and drawing an unbordered
    // field would make every form look unfinished — authors who want a
    // different look can still restyle the element.
    _textField.borderStyle = UITextBorderStyleRoundedRect;
    _textField.clearButtonMode = UITextFieldViewModeWhileEditing;
    [_textField addTarget:self action:@selector(textDidChange) forControlEvents:UIControlEventEditingChanged];
    self.elementControl = _textField;
  }
  return self;
}

#pragma mark - EXPElementDragOwnership

- (BOOL)elementOwnsDragGesture
{
  // Only while editing, and that is the point. An idle field is content a
  // scroll should carry away under the finger, but a drag inside one that is
  // being edited is a selection drag — the user is moving the caret or
  // extending a selection, and having the list scroll out from under them
  // instead is the kind of thing that makes a form feel foreign.
  return ReactNativeFeatureFlags::enableNativeGestureRecognizers() && _textField.isEditing;
}

#pragma mark - Events

/*
 * Whether a CONTROLLED field reports its edit synchronously.
 *
 * Kept as a named switch because it is a concurrency trade, not a detail: the
 * synchronous path blocks the UI thread until it can take over the JavaScript
 * runtime, and upstream calls the primitive underneath it
 * `executeSynchronouslyOnSameThread_CAN_DEADLOCK` for a reason. If JavaScript
 * is ever blocked waiting on the main thread while this is on the stack, the
 * two wait on each other. Flip this to NO and controlled fields go back to the
 * asynchronous path — correct, one frame late — without touching anything else.
 */
static const BOOL kEXPReportControlledEditSynchronously = YES;

- (void)textDidChange
{
  /*
   * Everything needed from the props is copied out HERE, before any dispatch.
   *
   * `_props` is a shared_ptr that the mounting layer REPLACES in `updateProps:`,
   * and the synchronous dispatch below can reach that code re-entrantly: it
   * runs JavaScript on this thread, React commits, and `scheduleTransaction`
   * mounts inline because it is already on the main queue. A reference into the
   * old props object is dangling from that moment on. Nothing below reads one —
   * and it stays that way by there being nothing to read.
   */
  const auto &props = static_cast<const ElementTextInputProps &>(*_props);
  const NSInteger maxLength = props.maxLength;
  const BOOL isControlled = props.hasValue;

  // Enforced here rather than left to `shouldChangeCharactersInRange:`, because
  // that method never sees a paste that the system autofills, nor a dictation
  // insertion. Trimming after the fact covers every way text can arrive.
  if (maxLength >= 0 && (NSInteger)_textField.text.length > maxLength) {
    UITextRange *selection = _textField.selectedTextRange;
    _textField.text = [_textField.text substringToIndex:maxLength];
    _textField.selectedTextRange = selection;
  }

  if (!_eventEmitter) {
    return;
  }
  _nativeEventCount++;
  // A copy, not the ivar: the emitter has to outlive a dispatch that can run
  // arbitrary JavaScript and unmount this view.
  auto emitter = std::static_pointer_cast<const ElementTextInputEventEmitter>(_eventEmitter);
  const auto text = RCTStringFromNSString(_textField.text);
  const auto count = (int)_nativeEventCount;

  /*
   * A CONTROLLED field reports its edit synchronously; an uncontrolled one does
   * not. The difference is a frame.
   *
   * This runs inside UIKit's own editing-changed handling, so the run loop has
   * not committed the frame yet. Dispatched the ordinary way the event is
   * queued and JavaScript answers on a later tick: React re-renders, the
   * clamped `value` comes back down and the view corrects itself — but the
   * frame carrying the UNCLAMPED text has already been drawn. That is the flash
   * of a character that should never have appeared, and no amount of speed on
   * the JavaScript side removes it, because the race is against a frame that is
   * already scheduled.
   *
   * Dispatching synchronously closes it: the handler, React's render, the
   * commit and the write-back all happen while this call is still on the stack.
   * It is the shape the web has — a browser lets the character reach the DOM
   * and restores it before paint, in one turn.
   *
   * THE COSTS, since they are real. The UI thread blocks until it can take over
   * the runtime, so a long JavaScript task is felt as a stalled keystroke, and
   * if JavaScript is itself waiting on the main thread the two deadlock. The
   * mount that follows runs re-entrantly, inside a UITextField delegate call —
   * which is why nothing here holds a props reference across it, and why the
   * guard below refuses to start a second one from inside the first.
   *
   * Only when controlled. An uncontrolled field has no value to write back, so
   * there is nothing to be late for, and it keeps the asynchronous path rather
   * than paying a blocked thread per keystroke for nothing.
   */
  if (isControlled && kEXPReportControlledEditSynchronously && !_isReportingEditSynchronously &&
      RCTIsMainQueue()) {
    // RAII rather than a pair of assignments: the dispatch runs arbitrary
    // JavaScript, and a C++ exception unwinding through it must not leave the
    // guard latched — every later edit on this field would silently take the
    // asynchronous path and the flicker would come back with no way to see why.
    struct ReentryGuard {
      BOOL *flag;
      explicit ReentryGuard(BOOL *f) : flag(f)
      {
        *flag = YES;
      }
      ~ReentryGuard()
      {
        *flag = NO;
      }
    } guard{&_isReportingEditSynchronously};

    if (emitter->experimental_dispatchSyncNow([&emitter, &text, count]() {
          emitter->onElementInput(text, count);
        })) {
      return;
    }
    // No dispatcher: report it the ordinary way rather than dropping the edit.
  }
  emitter->onElementInput(text, count);
}

#pragma mark - UITextFieldDelegate

- (void)textFieldDidBeginEditing:(UITextField *)textField
{
  _textAtEditingStart = [textField.text copy];
  if (_eventEmitter) {
    std::static_pointer_cast<const ElementTextInputEventEmitter>(_eventEmitter)->onElementFocus();
  }
}

- (void)textFieldDidEndEditing:(UITextField *)textField
{
  if (!_eventEmitter) {
    return;
  }
  auto emitter = std::static_pointer_cast<const ElementTextInputEventEmitter>(_eventEmitter);
  // `change` on commit, and only on a real change — the DOM's rule, not
  // `input`'s. A field the user focused and left untouched owes nothing.
  if (![textField.text isEqualToString:_textAtEditingStart]) {
    emitter->onElementChange(RCTStringFromNSString(textField.text));
  }
  emitter->onElementBlur();
}

- (BOOL)textField:(UITextField *)textField
    shouldChangeCharactersInRange:(NSRange)range
                replacementString:(NSString *)string
{
  // What `readonly` means, as distinct from `disabled`: the field can be
  // focused, its text selected and copied, and the caret moved — it just
  // cannot be edited. Refusing the edit here is the only way to get that on
  // iOS; clearing `enabled` would take the whole field out of use.
  const auto &props = static_cast<const ElementTextInputProps &>(*_props);
  if (props.readOnly) {
    return NO;
  }

  /*
   * `beforeinput`, asked and answered before the character lands.
   *
   * This callback is UIKit's own "should this change be applied?", which is why
   * the answer can be exact: refuse and nothing appears, substitute and only the
   * substitution appears. A controlled input that transforms or rejects a
   * keystroke therefore shows nothing in between — no character that flashes
   * and is corrected a frame later.
   *
   * Synchronous by construction: the handler runs while this call is still on
   * the stack, blocking the JavaScript thread for its duration. That is the
   * price of an answer before the platform commits, and it is the same trade a
   * browser makes.
   */
  if (!_eventEmitter || !props.hasBeforeInput) {
    return YES;
  }

  NSString *current = textField.text ?: @"";
  if (range.location + range.length > current.length) {
    return YES;
  }
  NSString *proposed = [current stringByReplacingCharactersInRange:range withString:string];

  auto decision = std::make_shared<CancelableEventDecision>();
  auto emitter = std::static_pointer_cast<const ElementTextInputEventEmitter>(_eventEmitter);
  // Dispatched and answered before this returns; see
  // `EventEmitter::experimental_dispatchSyncNow`. If there is no dispatcher the
  // edit is allowed through, which is the same thing that happens with no
  // handler at all.
  if (!emitter->experimental_dispatchSyncNow([&emitter, &proposed, &decision]() {
        emitter->onElementBeforeInput(RCTStringFromNSString(proposed), decision);
      })) {
    return YES;
  }

  if (decision->hasReplacement) {
    NSString *replacement = RCTNSStringFromString(decision->replacement);
    if (![replacement isEqualToString:current]) {
      textField.text = replacement;
      // The caret goes where the edit would have left it, measured from the end
      // so it survives a replacement of a different length — otherwise typing
      // into the middle of a transformed field jumps to the end on every key.
      const NSInteger tailAfterEdit = (NSInteger)current.length - (NSInteger)(range.location + range.length);
      const NSInteger caret = MAX(0, (NSInteger)replacement.length - tailAfterEdit);
      UITextPosition *position = [textField positionFromPosition:textField.beginningOfDocument offset:caret];
      if (position != nil) {
        textField.selectedTextRange = [textField textRangeFromPosition:position toPosition:position];
      }
    }
    // The control was updated here, so `editingChanged` will not fire for it;
    // report the edit so `input` still reaches JavaScript exactly once.
    [self textDidChange];
    return NO;
  }

  return decision->defaultPrevented ? NO : YES;
}

- (void)textFieldDidChangeSelection:(UITextField *)textField
{
  if (!_eventEmitter) {
    return;
  }
  UITextRange *range = textField.selectedTextRange;
  if (range == nil) {
    return;
  }
  NSInteger start = [textField offsetFromPosition:textField.beginningOfDocument toPosition:range.start];
  NSInteger end = [textField offsetFromPosition:textField.beginningOfDocument toPosition:range.end];
  std::static_pointer_cast<const ElementTextInputEventEmitter>(_eventEmitter)
      ->onElementSelectionChange((int)start, (int)end);
}

- (BOOL)textFieldShouldReturn:(UITextField *)textField
{
  if (_eventEmitter) {
    std::static_pointer_cast<const ElementTextInputEventEmitter>(_eventEmitter)
        ->onElementSubmit(RCTStringFromNSString(textField.text));
  }
  // Resigning here is what the return key does on a single-line field in a
  // native app; a field that stays first responder after Return leaves the
  // keyboard up over the form the user was trying to finish.
  [textField resignFirstResponder];
  return NO;
}

#pragma mark - Prop application

- (void)applyKeyboardTraitsForType:(const std::string &)type inputMode:(const std::string &)inputMode
{
  // `inputmode` wins where it is stated: HTML defines it as the more specific
  // instruction about which keyboard to show, and `type` as the semantic.
  const std::string &key = inputMode.empty() ? type : inputMode;

  UIKeyboardType keyboardType = UIKeyboardTypeDefault;
  UITextContentType contentType = nil;
  if (key == "email") {
    keyboardType = UIKeyboardTypeEmailAddress;
    contentType = UITextContentTypeEmailAddress;
  } else if (key == "url") {
    keyboardType = UIKeyboardTypeURL;
    contentType = UITextContentTypeURL;
  } else if (key == "tel") {
    keyboardType = UIKeyboardTypePhonePad;
    contentType = UITextContentTypeTelephoneNumber;
  } else if (key == "number" || key == "numeric") {
    // Not `UIKeyboardTypeNumberPad`: HTML's numeric input admits a decimal
    // point and a sign, and a keypad with neither cannot type "1.5".
    keyboardType = UIKeyboardTypeDecimalPad;
  } else if (key == "decimal") {
    keyboardType = UIKeyboardTypeDecimalPad;
  } else if (key == "search") {
    keyboardType = UIKeyboardTypeDefault;
  }
  _textField.keyboardType = keyboardType;
  _textField.textContentType = contentType;

  // An email or URL field that autocapitalises its first letter is a small
  // thing that reads as broken, and the platform's own fields do not.
  const BOOL isCaseSensitiveField = (key == "email" || key == "url" || key == "password");
  _textField.autocapitalizationType =
      isCaseSensitiveField ? UITextAutocapitalizationTypeNone : UITextAutocapitalizationTypeSentences;
  // `autocorrectionType` is NOT set here. It belongs to the `autocorrect`
  // attribute, and the rule this used to encode — never on url, email or
  // password — is the first step of that attribute's own resolution (§6.8.8),
  // applied in JavaScript for both platforms rather than twice in two places.
  // Setting it from `type` as well would silently win or lose depending on
  // which guarded block ran last.
}

- (UIReturnKeyType)returnKeyTypeForHint:(const std::string &)hint type:(const std::string &)type
{
  if (hint == "done") {
    return UIReturnKeyDone;
  } else if (hint == "go") {
    return UIReturnKeyGo;
  } else if (hint == "next") {
    return UIReturnKeyNext;
  } else if (hint == "search") {
    return UIReturnKeySearch;
  } else if (hint == "send") {
    return UIReturnKeySend;
  } else if (hint == "enter") {
    return UIReturnKeyDefault;
  }
  // `<input type="search">` gets a Search key without being asked, which is
  // what the type means and what a native search field does.
  return type == "search" ? UIReturnKeySearch : UIReturnKeyDefault;
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &oldInputProps = static_cast<const ElementTextInputProps &>(*_props);
  const auto &newInputProps = static_cast<const ElementTextInputProps &>(*props);

  if (!_isInitialValueSet || oldInputProps.type != newInputProps.type ||
      oldInputProps.inputMode != newInputProps.inputMode) {
    [self applyKeyboardTraitsForType:newInputProps.type inputMode:newInputProps.inputMode];
    _textField.secureTextEntry = newInputProps.isSecure();
  }

  if (!_isInitialValueSet || oldInputProps.enterKeyHint != newInputProps.enterKeyHint) {
    _textField.returnKeyType = [self returnKeyTypeForHint:newInputProps.enterKeyHint type:newInputProps.type];
  }

  if (!_isInitialValueSet || oldInputProps.placeholder != newInputProps.placeholder) {
    _textField.placeholder = RCTNSStringFromStringNilIfEmpty(newInputProps.placeholder);
  }

  if (!_isInitialValueSet || oldInputProps.disabled != newInputProps.disabled ||
      oldInputProps.readOnly != newInputProps.readOnly) {
    // Both prevent typing, and the difference is whether the field is dead. A
    // read-only field is still focusable and its text still selectable and
    // copyable, which is what read-only means in HTML; a disabled one is not
    // interactive at all.
    _textField.enabled = !newInputProps.disabled;
    self.userInteractionEnabled = !newInputProps.disabled;
    if (newInputProps.disabled && _textField.isFirstResponder) {
      [_textField resignFirstResponder];
    }
    /*
     * And it has to LOOK disabled. A browser greys a disabled field, and a
     * control that looks usable and is not is worse than either state on its
     * own — the user's first idea is that the app is broken.
     *
     * `UITextField` does not do this for us: unlike `UISlider` and the pop-up
     * button, which grey themselves from `isEnabled`, setting `enabled = NO`
     * on a text field changes only whether it accepts input. So the colour is
     * applied here, in the component view that owns the control, rather than
     * as a blanket `opacity` in the user-agent stylesheet — which would
     * double-dim the controls that already handle it.
     *
     * `tertiaryLabelColor` is the platform's own "present but inert" label
     * colour, so the field follows light and dark and matches every other
     * disabled control on the screen. Enabled restores `labelColor`, the
     * default this field would have had anyway.
     */
    _textField.textColor = newInputProps.disabled ? [UIColor tertiaryLabelColor] : [UIColor labelColor];
  }

  if (!_isInitialValueSet || oldInputProps.spellCheck != newInputProps.spellCheck) {
    _textField.spellCheckingType = newInputProps.spellCheck ? UITextSpellCheckingTypeYes : UITextSpellCheckingTypeNo;
  }

  // The other half of the pair, and the reason iOS can be exactly right here:
  // UIKit has a trait for each, so "underline my mistakes but do not rewrite
  // them" is expressible. Android has one flag for both — see
  // DOM-CSS-LIMITATION(android-spellcheck-implies-autocorrect).
  if (!_isInitialValueSet || oldInputProps.autoCorrect != newInputProps.autoCorrect) {
    _textField.autocorrectionType = newInputProps.autoCorrect ? UITextAutocorrectionTypeYes : UITextAutocorrectionTypeNo;
  }

  /*
   * The controlled-value write, and the one place this component has to be
   * careful.
   *
   * `mostRecentEventCount` is how many of this element's edits JavaScript has
   * processed. While it trails `_nativeEventCount` there are keystrokes in
   * flight, and the `value` in these props was computed without them — writing
   * it would rewind the field under the user's fingers, which is how a
   * controlled input ends up dropping and transposing characters when someone
   * types quickly. So a stale value is skipped, not applied late: another props
   * update carrying the current count is already on its way.
   */
  const BOOL isValueCurrent = newInputProps.mostRecentEventCount >= _nativeEventCount;
  if (newInputProps.hasValue && isValueCurrent) {
    NSString *value = RCTNSStringFromString(newInputProps.value);
    if (![_textField.text isEqualToString:value]) {
      // Preserved across the write so that a controlled field which echoes the
      // value back unchanged does not throw the caret to the end on every
      // keystroke — the classic tell of a re-rendered input.
      UITextRange *selection = _textField.selectedTextRange;
      _textField.text = value;
      if (selection != nil && _textField.isEditing) {
        _textField.selectedTextRange = selection;
      }
    }
  } else if (!_isInitialValueSet && !newInputProps.hasValue) {
    // Uncontrolled: `defaultValue` seeds the field once and is never written
    // again, exactly as in HTML.
    _textField.text = RCTNSStringFromString(newInputProps.defaultValue);
  }

  _isInitialValueSet = YES;

  [super updateProps:props oldProps:oldProps];

  if (newInputProps.readOnly) {
    self.accessibilityTraits |= UIAccessibilityTraitNotEnabled;
  }
}

- (void)didMoveToWindow
{
  [super didMoveToWindow];
  const auto &props = static_cast<const ElementTextInputProps &>(*_props);
  // Deferred to the point the field is actually in a window: asking a view that
  // is not yet on screen to become first responder simply fails, so autofocus
  // applied during prop update would silently do nothing.
  if (props.autoFocus && self.window != nil && !_textField.isFirstResponder) {
    [_textField becomeFirstResponder];
  }
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  _props = ElementTextInputShadowNode::defaultSharedProps();
  // Reset together with the text: a recycled view that kept its count would
  // compare it against a fresh element's `mostRecentEventCount` of zero and
  // refuse every value written to it.
  _nativeEventCount = 0;
  _isInitialValueSet = NO;
  _textAtEditingStart = nil;
  _textField.text = @"";
  _textField.placeholder = nil;
  _textField.enabled = YES;
  _textField.secureTextEntry = NO;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<ElementTextInputComponentDescriptor>();
}

+ (void)load
{
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

@end
