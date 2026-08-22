/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPElementDateInputComponentView.h"

#import <React/RCTConversions.h>
#import <React/EXPElementDragOwnership.h>
#import <react/featureflags/ReactNativeFeatureFlags.h>
#import <react/renderer/components/view/ElementDateInputShadowNode.h>

#import "RCTComponentViewFactory.h"

using namespace facebook::react;

@interface EXPElementDateInputComponentView () <EXPElementDragOwnership>
@end

@implementation EXPElementDateInputComponentView {
  UIDatePicker *_picker;
  BOOL _isInitialValueSet;
}

/*
 * The DOM's formats, which are also what the value crosses as. Fixed to the
 * POSIX locale on purpose: these are wire formats, not display formats, and a
 * device set to a non-Gregorian calendar or Arabic-Indic digits would otherwise
 * produce a `value` no web code could read.
 */
static NSDateFormatter *EXPElementDateFormatter(const ElementDateInputProps &props)
{
  static NSMutableDictionary<NSString *, NSDateFormatter *> *formatters;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    formatters = [NSMutableDictionary new];
  });

  NSString *format;
  if (props.showsDate() && props.showsTime()) {
    format = @"yyyy-MM-dd'T'HH:mm";
  } else if (props.showsTime()) {
    format = @"HH:mm";
  } else {
    format = @"yyyy-MM-dd";
  }

  NSDateFormatter *formatter = formatters[format];
  if (formatter == nil) {
    formatter = [NSDateFormatter new];
    formatter.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
    formatter.calendar = [NSCalendar calendarWithIdentifier:NSCalendarIdentifierGregorian];
    // No timezone conversion: these three input types are local times with no
    // zone, so the picker's wall-clock reading is the value.
    formatter.timeZone = [NSTimeZone localTimeZone];
    formatter.dateFormat = format;
    formatters[format] = formatter;
  }
  return formatter;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = ElementDateInputShadowNode::defaultSharedProps();

    _picker = [[UIDatePicker alloc] initWithFrame:self.bounds];
    // The compact style is the modern one: a small field showing the current
    // value that opens the calendar or clock in a popover when tapped. The
    // wheel would take a whole screen's height for one field, which is why iOS
    // stopped using it inline.
    _picker.preferredDatePickerStyle = UIDatePickerStyleCompact;
    [_picker addTarget:self action:@selector(pickerChanged) forControlEvents:UIControlEventValueChanged];
    self.elementControl = _picker;
  }
  return self;
}

#pragma mark - EXPElementDragOwnership

- (BOOL)elementOwnsDragGesture
{
  // The compact picker opens a popover with its own gestures; while it is up,
  // a scroll must not pull the page out from under it.
  return ReactNativeFeatureFlags::enableNativeGestureRecognizers() && _picker.isEnabled;
}

#pragma mark - Events

- (void)pickerChanged
{
  if (!_eventEmitter) {
    return;
  }
  const auto &props = static_cast<const ElementDateInputProps &>(*_props);
  NSString *formatted = [EXPElementDateFormatter(props) stringFromDate:_picker.date];
  const std::string value = RCTStringFromNSString(formatted);

  auto emitter = std::static_pointer_cast<const ElementDateInputEventEmitter>(_eventEmitter);
  // A picker has no separate commit step — every adjustment both is the edit
  // and settles it — so the two DOM events fire together. Reporting only
  // `change` would break code listening for `input`, and only `input` would
  // break the more common case.
  emitter->onElementInput(value);
  emitter->onElementChange(value);
}

#pragma mark - RCTComponentViewProtocol

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &oldDateProps = static_cast<const ElementDateInputProps &>(*_props);
  const auto &newDateProps = static_cast<const ElementDateInputProps &>(*props);

  if (!_isInitialValueSet || oldDateProps.type != newDateProps.type) {
    if (newDateProps.showsDate() && newDateProps.showsTime()) {
      _picker.datePickerMode = UIDatePickerModeDateAndTime;
    } else if (newDateProps.showsTime()) {
      _picker.datePickerMode = UIDatePickerModeTime;
    } else {
      _picker.datePickerMode = UIDatePickerModeDate;
    }
  }

  NSDateFormatter *formatter = EXPElementDateFormatter(newDateProps);

  if (!_isInitialValueSet || oldDateProps.minimum != newDateProps.minimum) {
    _picker.minimumDate = newDateProps.minimum.empty()
        ? nil
        : [formatter dateFromString:RCTNSStringFromString(newDateProps.minimum)];
  }
  if (!_isInitialValueSet || oldDateProps.maximum != newDateProps.maximum) {
    _picker.maximumDate = newDateProps.maximum.empty()
        ? nil
        : [formatter dateFromString:RCTNSStringFromString(newDateProps.maximum)];
  }

  if (!_isInitialValueSet || oldDateProps.value != newDateProps.value) {
    // An unparseable or absent value leaves the picker where it is, which for a
    // fresh one is now — the same thing a browser shows for a `<input
    // type="date">` with no value: an empty field the user opens onto today.
    NSDate *date = newDateProps.value.empty()
        ? nil
        : [formatter dateFromString:RCTNSStringFromString(newDateProps.value)];
    if (date != nil) {
      [_picker setDate:date animated:_isInitialValueSet];
    }
  }

  if (!_isInitialValueSet || oldDateProps.disabled != newDateProps.disabled) {
    _picker.enabled = !newDateProps.disabled;
    self.userInteractionEnabled = !newDateProps.disabled;
  }

  _isInitialValueSet = YES;

  [super updateProps:props oldProps:oldProps];
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  _props = ElementDateInputShadowNode::defaultSharedProps();
  _isInitialValueSet = NO;
  _picker.enabled = YES;
  _picker.minimumDate = nil;
  _picker.maximumDate = nil;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<ElementDateInputComponentDescriptor>();
}

+ (void)load
{
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

@end
