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

#import <React/RCTAssert.h>

#import "EXPElementControlMetricsProbe.h"
#import "EXPElementControlSizeReporting.h"

#import "RCTComponentViewFactory.h"

using namespace facebook::react;

@interface EXPElementDateInputComponentView () <EXPElementDragOwnership>
@end

@implementation EXPElementDateInputComponentView {
  facebook::react::ElementDateInputShadowNode::ConcreteState::Shared _state;
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

/*
 * The picker the element mounts, and the one the startup probe measures — one
 * factory so the two cannot drift apart.
 */
static UIDatePicker *EXPMakeElementDatePicker(CGRect frame)
{
  UIDatePicker *picker = [[UIDatePicker alloc] initWithFrame:frame];
  // The compact style is the modern one: a small field showing the current
  // value that opens the calendar or clock in a popover when tapped. The
  // wheel would take a whole screen's height for one field, which is why iOS
  // stopped using it inline.
  picker.preferredDatePickerStyle = UIDatePickerStyleCompact;
  return picker;
}

/*
 * What a compact picker needs to show its value.
 *
 * `sizeThatFits:`, not `intrinsicContentSize`: a compact picker has no intrinsic
 * size — it answers -1 by -1 — so asking for one reported nothing, and every
 * date input stayed at the 220 by 48 placeholder the sheet started from.
 */
static CGSize EXPDatePickerSize(UIDatePicker *picker)
{
  return [picker sizeThatFits:CGSizeZero];
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = ElementDateInputShadowNode::defaultSharedProps();

    _picker = EXPMakeElementDatePicker(self.bounds);
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
  // A new value can be wider or narrower, and a stretched box does not change
  // size to say so
  [self placePicker];
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

/*
 * What the control wants to be, told to layout — a compact picker is as wide as the value it shows, in the mode it is in,
 * and neither is anything this file should be deciding. See
 * `EXPReportControlSize`.
 */
- (void)reportIntrinsicSize
{
  [_picker layoutIfNeeded];
  EXPReportControlSize(_state, EXPDatePickerSize(_picker));
}

/*
 * The picker keeps the width its value needs, at the leading edge of the box.
 *
 * A compact picker draws its value at the TRAILING edge of whatever frame it is
 * given, so handed a box wider than its value — a flex item stretched across its
 * container, which is what a browser does to an `<input>` there too — it showed
 * the value at the far end. A browser shows it at the start and leaves the rest
 * of the box empty, so this does the same: the box is layout's, the picker is as
 * wide as what it shows.
 */
- (void)placePicker
{
  const CGRect content = RCTCGRectFromRect(_layoutMetrics.getContentFrame());
  const CGFloat width = MIN(EXPDatePickerSize(_picker).width, content.size.width);
  const CGFloat x = _layoutMetrics.layoutDirection == LayoutDirection::RightToLeft
      ? CGRectGetMaxX(content) - width
      : content.origin.x;
  _picker.frame = CGRectMake(x, content.origin.y, width, content.size.height);
}

- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  [self placePicker];
}

- (void)updateState:(const facebook::react::State::Shared &)state
           oldState:(const facebook::react::State::Shared &)oldState
{
  _state = std::static_pointer_cast<const facebook::react::ElementDateInputShadowNode::ConcreteState>(state);
  [self reportIntrinsicSize];
}

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
  [self reportIntrinsicSize];
  [self placePicker];
}

- (void)prepareForRecycle
{
  _state.reset();
  [super prepareForRecycle];
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

/*
 * `<input type=date|time|datetime-local>`: what each mode's picker measures,
 * for the first frame — the node knows which type it is before anything
 * mounts, so each gets its own. The mounted picker then reports what its
 * value needs.
 */
void EXPProbeDatePickerMetrics(facebook::react::ElementControlMetrics &metrics)
{
  RCTAssertMainQueue();
  UIWindow *window = [[UIWindow alloc] initWithFrame:CGRectMake(0, 0, 400, 200)];
  const auto measure = [window](
                           UIDatePickerMode mode,
                           facebook::react::Float &width,
                           facebook::react::Float &height,
                           facebook::react::Float &baseline) {
    UIDatePicker *picker = EXPMakeElementDatePicker(CGRectMake(0, 0, 220, 60));
    picker.datePickerMode = mode;
    [window addSubview:picker];
    [window layoutIfNeeded];
    const CGSize size = EXPDatePickerSize(picker);
    // The value is drawn by labels inside the pill; the first one is the line
    // the picker's text sits on
    picker.frame = CGRectMake(0, 0, size.width, size.height);
    [picker layoutIfNeeded];
    UILabel *label = EXPFirstLabelIn(picker);
    const CGFloat labelBaseline = label != nil ? EXPTextBaselineInView(label, picker) : 0;
    [picker removeFromSuperview];
    if (size.width > 0 && size.height > 0) {
      width = static_cast<facebook::react::Float>(size.width);
      height = static_cast<facebook::react::Float>(size.height);
      baseline = static_cast<facebook::react::Float>(labelBaseline);
    }
  };
  measure(
      UIDatePickerModeDate,
      metrics.datePickerDefaultWidth,
      metrics.datePickerDefaultHeight,
      metrics.datePickerBaseline);
  measure(
      UIDatePickerModeTime,
      metrics.timePickerDefaultWidth,
      metrics.timePickerDefaultHeight,
      metrics.timePickerBaseline);
  measure(
      UIDatePickerModeDateAndTime,
      metrics.dateTimePickerDefaultWidth,
      metrics.dateTimePickerDefaultHeight,
      metrics.dateTimePickerBaseline);
}
