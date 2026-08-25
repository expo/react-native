/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>
#import <XCTest/XCTest.h>

#import <React/EXPTextInputCaret.h>

/*
 * A controlled write must not move the insertion point.
 *
 * "Stable" has several meanings and they disagree — keeping the same index,
 * keeping the same distance from the end, putting the caret where this edit
 * would have left it — and the one implemented is CHANGE-ANCHORED: replace
 * only the span that differs and let UIKit adjust the selection as it does for
 * any edit, so a caret outside that span does not move because nothing under
 * it changed.
 *
 * These are written against the real controls rather than a stub, because the
 * whole point of `replaceRange:withText:` is that UIKit does the adjusting.
 * A test against a fake would be asserting this file's own arithmetic.
 *
 * The controls must be first responders for any of it to matter: without an
 * insertion point there is nothing to preserve, and the rule takes its cheap
 * path. Each test therefore puts its field in a window and focuses it, and
 * skips rather than lies if the simulator refuses focus.
 */
@interface EXPTextInputCaretTests : XCTestCase
@end

@implementation EXPTextInputCaretTests {
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

/** A focused field holding `text`, or nil if the simulator refuses focus. */
- (nullable UITextField *)focusedFieldWithText:(NSString *)text
{
  UITextField *field = [[UITextField alloc] initWithFrame:CGRectMake(0, 0, 300, 40)];
  field.text = text;
  [_window addSubview:field];
  if (![field becomeFirstResponder]) {
    return nil;
  }
  return field;
}

/** The caret's offset from the start of the document. */
- (NSInteger)caretOffsetIn:(UITextField *)field
{
  UITextRange *selection = field.selectedTextRange;
  if (selection == nil) {
    return -1;
  }
  return [field offsetFromPosition:field.beginningOfDocument toPosition:selection.start];
}

- (void)setCaretIn:(UITextField *)field to:(NSInteger)offset
{
  UITextPosition *position = [field positionFromPosition:field.beginningOfDocument offset:offset];
  field.selectedTextRange = [field textRangeFromPosition:position toPosition:position];
}

- (void)testWritingTheSameTextLeavesTheCaretAlone
{
  UITextField *field = [self focusedFieldWithText:@"0123456789"];
  if (field == nil) {
    XCTSkip(@"the simulator would not give the field focus");
  }
  [self setCaretIn:field to:4];

  // The common case for a controlled input: the author echoes the value back
  // unchanged on every keystroke. Nothing differs, so nothing is written.
  EXPWriteTextPreservingCaret(field, @"0123456789");

  XCTAssertEqualObjects(field.text, @"0123456789");
  XCTAssertEqual([self caretOffsetIn:field], 4, @"an unchanged write must not move the caret");
}

- (void)testATrailingClampLeavesACaretBeforeItWhereItWas
{
  UITextField *field = [self focusedFieldWithText:@"0123456789X"];
  if (field == nil) {
    XCTSkip(@"the simulator would not give the field focus");
  }
  // The caret sits in the MIDDLE, and the clamp removes the tail. Anchoring to
  // the end — which is what React Native's own text input does, and what the
  // `beforeinput` path computes — would drag the caret backwards here.
  [self setCaretIn:field to:3];

  EXPWriteTextPreservingCaret(field, @"0123456789");

  XCTAssertEqualObjects(field.text, @"0123456789");
  XCTAssertEqual([self caretOffsetIn:field], 3, @"a change after the caret must not move it");
}

- (void)testAnEditBeforeTheCaretCarriesItAlong
{
  UITextField *field = [self focusedFieldWithText:@"abcdef"];
  if (field == nil) {
    XCTSkip(@"the simulator would not give the field focus");
  }
  [self setCaretIn:field to:6];

  // Text inserted BEFORE the caret has to push it, or the caret ends up
  // pointing at different characters than it did.
  EXPWriteTextPreservingCaret(field, @"XXabcdef");

  XCTAssertEqualObjects(field.text, @"XXabcdef");
  XCTAssertEqual([self caretOffsetIn:field], 8, @"an insertion before the caret must carry it");
}

- (void)testAnUnfocusedFieldIsSimplyWritten
{
  UITextField *field = [[UITextField alloc] initWithFrame:CGRectMake(0, 0, 300, 40)];
  field.text = @"before";
  // No insertion point exists, so there is nothing to preserve and the rule
  // takes its cheap path — but it still has to write.
  EXPWriteTextPreservingCaret(field, @"after");
  XCTAssertEqualObjects(field.text, @"after");
}

- (void)testAComposingFieldIsLeftAlone
{
  UITextField *field = [self focusedFieldWithText:@""];
  if (field == nil) {
    XCTSkip(@"the simulator would not give the field focus");
  }

  // Between the first key of a CJK word and its commit the field holds MARKED
  // text owned by the input method. Replacing it cancels the candidate session
  // and the user loses what they were half way through spelling, so a
  // controlled value must wait for the commit.
  [field setMarkedText:@"ni" selectedRange:NSMakeRange(2, 0)];
  if (field.markedTextRange == nil) {
    XCTSkip(@"the simulator would not start a composition");
  }

  EXPWriteTextPreservingCaret(field, @"something else");

  XCTAssertEqualObjects(field.text, @"ni", @"a write must not disturb marked text");
  XCTAssertNotNil(field.markedTextRange, @"the composition must survive");
}

- (void)testAnEmojiIsNotCutInHalf
{
  UITextField *field = [self focusedFieldWithText:@"a👍b"];
  if (field == nil) {
    XCTSkip(@"the simulator would not give the field focus");
  }

  // The differing span is computed in UTF-16 units, and a naive prefix/suffix
  // scan would split the surrogate pair and hand UIKit half of one. Boundaries
  // snap to composed character sequences so the write stays well formed.
  EXPWriteTextPreservingCaret(field, @"a👍c");

  XCTAssertEqualObjects(field.text, @"a👍c");
}

- (void)testTwoCodePointsThatShareASurrogateAreStillWritten
{
  UITextField *field = [self focusedFieldWithText:@"\U0001D44D"];
  if (field == nil) {
    XCTSkip(@"the simulator would not give the field focus");
  }

  // U+1D44D and U+1F44D (👍) are different characters that happen to END in the
  // same UTF-16 low surrogate — one pair in every 1024 does. The naive scan
  // therefore reports a one-unit "common suffix" that is really half of a
  // character neither string shares, and snapping that boundary OUTWARD to the
  // whole sequence claims the differing high surrogate is common too. The span
  // then collapses to nothing and the controlled value is silently dropped.
  //
  // Boundaries may only ever shrink the common run, never extend it: the loops
  // verified equality, the snap did not.
  EXPWriteTextPreservingCaret(field, @"\U0001F44D");

  XCTAssertEqualObjects(field.text, @"\U0001F44D", @"the write must not be dropped");
}

- (void)testASkinToneChangeIsWritten
{
  UITextField *field = [self focusedFieldWithText:@"a\U0001F44D\U0001F3FBb"];
  if (field == nil) {
    XCTSkip(@"the simulator would not give the field focus");
  }
  // An emoji plus a modifier is one composed sequence spanning four UTF-16
  // units, so the differing span is found in the middle of a grapheme.
  EXPWriteTextPreservingCaret(field, @"a\U0001F44D\U0001F3FFb");
  XCTAssertEqualObjects(field.text, @"a\U0001F44D\U0001F3FFb");
}

- (void)testTheWholeDocumentCanStillBeReplaced
{
  UITextField *field = [self focusedFieldWithText:@"entirely different"];
  if (field == nil) {
    XCTSkip(@"the simulator would not give the field focus");
  }
  // No common prefix or suffix: the "span that differs" is everything, which
  // must still be a correct write rather than an edge case that falls through.
  EXPWriteTextPreservingCaret(field, @"nothing alike");
  XCTAssertEqualObjects(field.text, @"nothing alike");
}

@end
