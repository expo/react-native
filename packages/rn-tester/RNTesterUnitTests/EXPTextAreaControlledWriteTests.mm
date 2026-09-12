/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>
#import <XCTest/XCTest.h>

#import <React/EXPElementTextAreaComponentView.h>
#import <react/renderer/components/view/ElementTextAreaShadowNode.h>
#import <react/renderer/components/view/ElementTextInputShadowNode.h>

using namespace facebook::react;

/*
 * A controlled write is not an edit. `el.value = 'x'` fires no `input` in a
 * browser, and the view refuses a `value` whose `mostRecentEventCount` is
 * behind its own edit count; a view that counted its own write as an edit would
 * put that count ahead of anything JavaScript can echo back and discard every
 * later value. The test asserts the half visible from outside: two controlled
 * writes in a row with the same count both land. The field is focused because
 * an unfocused one takes the `.text =` path, which UIKit does not report.
 */
@interface EXPTextAreaControlledWriteTests : XCTestCase
@end

@implementation EXPTextAreaControlledWriteTests {
  UIWindow *_window;
}

- (void)setUp
{
  [super setUp];
  _window = [[UIWindow alloc] initWithFrame:CGRectMake(0, 0, 320, 480)];
  _window.hidden = NO;
  [_window makeKeyAndVisible];
}

- (void)tearDown
{
  _window.hidden = YES;
  _window = nil;
  [super tearDown];
}

static Props::Shared textAreaProps(const std::string &value, int count)
{
  auto props = std::make_shared<ElementTextAreaProps>();
  props->nodeName = "textarea";
  props->value = value;
  props->hasValue = true;
  props->mostRecentEventCount = count;
  return props;
}

// The `UITextView` the component view owns privately
static UITextView *textViewIn(UIView *view)
{
  for (UIView *child in view.subviews) {
    if ([child isKindOfClass:UITextView.class]) {
      return (UITextView *)child;
    }
    UITextView *found = textViewIn(child);
    if (found != nil) {
      return found;
    }
  }
  return nil;
}

- (void)testASecondControlledWriteIsNotJudgedStaleByTheFirst
{
  EXPElementTextAreaComponentView *view =
      [[EXPElementTextAreaComponentView alloc] initWithFrame:CGRectMake(0, 0, 300, 80)];
  [_window addSubview:view];
  [view layoutIfNeeded];

  // The count only moves when there is an emitter to report to; this one has no
  // dispatcher and delivers nothing, which is all the counting needs
  EventEmitter::Shared emitter =
      std::make_shared<ElementTextInputEventEmitter>(SharedEventTarget{}, EventDispatcher::Weak{});
  [view updateEventEmitter:emitter];

  UITextView *field = textViewIn(view);
  XCTAssertNotNil(field, "the component view has no text view");
  // Without focus the write takes the unreported `.text =` path and the test
  // could not fail, so it skips out loud instead
  if (![field becomeFirstResponder]) {
    XCTSkip("the simulator refused focus, so there is no controlled write to judge");
  }
  XCTAssertTrue(field.isFirstResponder, "the field is not focused; this test would be vacuous");

  Props::Shared empty = textAreaProps("", 0);
  [view updateProps:empty oldProps:{}];

  // Typed, not assigned: an untouched field takes the unreported write path
  [field insertText:@"Trim me   "];
  XCTAssertEqualObjects(field.text, @"Trim me   ", "the field did not take the typing");

  // What a send does, with the count the typing produced and JavaScript echoed
  Props::Shared first = textAreaProps("Trim me", 1);
  [view updateProps:first oldProps:empty];
  XCTAssertEqualObjects(field.text, @"Trim me", "the first controlled value never reached the field");

  // The same count again, since nothing further has been typed; a view that
  // counted its own write as an edit would throw this one away
  Props::Shared second = textAreaProps("", 1);
  [view updateProps:second oldProps:first];
  XCTAssertEqualObjects(
      field.text, @"", "the field kept \"Trim me\": its own write was counted as an edit and the clear read as stale");

  [field resignFirstResponder];
}

@end
