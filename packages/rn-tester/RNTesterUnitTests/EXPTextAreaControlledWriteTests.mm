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
 * A controlled write is not an EDIT, and a `<textarea>` has to say so twice.
 *
 * `el.value = 'x'` fires no `input` in a browser: that event is the user's. A
 * field that reports the app's own write back to it hands the app its own
 * string as if it had been typed — and a composer driven from its own state
 * then puts a sent message back in the draft.
 *
 * The second half is the staleness rule. The view refuses a `value` whose
 * `mostRecentEventCount` is behind its own edit count, so that a value computed
 * without the keystrokes still in flight cannot rewind the field under the
 * user's fingers. Counting its OWN write as an edit puts that count ahead of
 * anything JavaScript can echo back, and every later value is discarded: the
 * field keeps what it was given once, for good.
 *
 * That is what this asserts, because it is the half a test can see from
 * outside: two controlled writes in a row, with the same count, both land.
 *
 * FOCUSED, and that is the whole reason the test bothers with a window. An
 * unfocused field takes the cheap path — `.text =`, which UIKit does not report
 * at all — so the bug cannot happen there and neither can the test.
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

/** The `UITextView` inside a component view, which owns it privately. */
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

  /*
   * An event emitter, because the count only moves when there is somebody to
   * report to: `-textViewDidChange:` returns before it when `_eventEmitter` is
   * null, so a view with none cannot show this bug and a test against one would
   * pass whatever the code did. It has no dispatcher and therefore delivers
   * nothing, which is all this needs — what is under test is the COUNTING.
   */
  EventEmitter::Shared emitter = std::make_shared<ElementTextInputEventEmitter>(
      SharedEventTarget{}, EventDispatcher::Weak{});
  [view updateEventEmitter:emitter];

  UITextView *field = textViewIn(view);
  XCTAssertNotNil(field, "the component view has no text view");
  /*
   * A simulator that will not give focus cannot answer this question, and a
   * test that returns quietly there would pass on the cheap path — which cannot
   * fail, because `.text =` is not reported at all. Skipped out loud instead.
   */
  if (![field becomeFirstResponder]) {
    XCTSkip("the simulator refused focus, so there is no controlled write to judge");
  }
  XCTAssertTrue(field.isFirstResponder, "the field is not focused; this test would be vacuous");

  Props::Shared empty = textAreaProps("", 0);
  [view updateProps:empty oldProps:{}];

  /*
   * TYPED, not assigned, and that is what makes this test the bug's shape: an
   * untouched field takes the cheap write path — `.text =`, which UIKit reports
   * to nobody — and the question does not arise. What a composer has when a
   * send happens is a field somebody has been editing.
   */
  [field insertText:@"Trim me   "];
  XCTAssertEqualObjects(field.text, @"Trim me   ", "the field did not take the typing");

  /*
   * What a send does: hand the field the trimmed message. The count is the one
   * the TYPING produced and JavaScript echoed back — one edit, so one — and it
   * is what makes this write current.
   */
  Props::Shared first = textAreaProps("Trim me", 1);
  [view updateProps:first oldProps:empty];
  XCTAssertEqualObjects(field.text, @"Trim me", "the first controlled value never reached the field");

  /*
   * And the SAME count again, because nothing further has been typed: the app
   * has had no new edit to echo, so the value it sends next carries the count
   * it already had. A view that counted its own write as an edit is now ahead
   * of that, and this write — the composer clearing itself — is thrown away.
   */
  Props::Shared second = textAreaProps("", 1);
  [view updateProps:second oldProps:first];
  XCTAssertEqualObjects(
      field.text, @"", "the field kept \"Trim me\": its own write was counted as an edit and the clear read as stale");

  [field resignFirstResponder];
}

@end
