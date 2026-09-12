/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * A text input this rule can write to: `UITextInput` for the document, plus
 * the `text` property both `UITextField` and `UITextView` declare and the
 * protocol itself does not.
 *
 * Declared rather than assumed because `<input>` and `<textarea>` are backed by
 * different UIKit classes with the same problem, and a controlled write that
 * moves the caret is as wrong in one as the other.
 */
@protocol EXPCaretPreservingTextInput <UITextInput>
@property (nonatomic, copy, nullable) NSString *text;
@end

/*
 * Both backing classes already implement every member of the protocol —
 * `UITextInput` for the document and `text` of their own — they simply never
 * declared the conformance, because until now nothing asked them to have one
 * in common. These say so without adding behaviour.
 */
@interface UITextField (EXPCaretPreservingTextInput) <EXPCaretPreservingTextInput>
@end

@interface UITextView (EXPCaretPreservingTextInput) <EXPCaretPreservingTextInput>
@end

/**
 * Write `next` into `field`, leaving the insertion point where the user would
 * expect it.
 *
 * See the implementation for which of the several meanings of "stable" this
 * is, and why it replaces only the span that differs rather than assigning the
 * whole document.
 */
/**
 * @param quiet the HOST is mid-animation, so the write must not pay for a
 *   keyboard rebuild. The write itself still happens — the reader sees the
 *   text — but the correction queued against what it replaced is NOT dropped,
 *   and the caller owes that drop when the host stops. Returns YES when a drop
 *   is owed.
 *
 *   Without it a controlled write costs forty milliseconds in the middle of a
 *   send: measured on `DraftCheck.testASendWithTrimmableTextLeavesTheFieldEmpty`,
 *   where trimming the draft writes seven characters while the balloon is in
 *   the air.
 */
BOOL EXPWriteTextPreservingCaret(UIView<EXPCaretPreservingTextInput> *field, NSString *next, BOOL quiet);

/**
 * Drop the autocorrection UIKit has queued against the field's current text.
 *
 * Costs a keyboard rebuild — two, in fact — so it belongs in a turn where
 * nothing is moving: a send's tap, not the animation frame on which the field
 * later lets go of the text. A drop within the last second makes the next
 * empty write skip its own.
 */
void EXPDropPendingCorrection(UIView<UITextInput> *field);

/*
 * THE SEND'S CLEAR IS AN ORDINARY WRITE, and the news is given inline.
 *
 * There used to be an `EXPClearTextQuietly`/`EXPTellInputSystem` pair here that
 * emptied the field with `inputDelegate` detached and handed the news over when
 * the flight finished, to keep ~19ms off the balloon's first frame. Sampling
 * retired it. That cost is `UIKeyboardTaskQueue
 * performTaskOnMainThread:waitUntilDone:` running a KEYPLANE CHANGE — emptying
 * the document puts the caret at a sentence start, the keyboard flips from
 * lowercase to shifted, and that relayouts the input window through Auto
 * Layout. It is not prediction, and none of it is our code.
 *
 * Which means the cost and the autocapitalisation are the SAME EVENT. Deferring
 * the one defers the other, and the bug it produced was visible: "the automatic
 * uppercasing of the keyboard doesn't reset until the bubble reaches its end
 * state", where Messages resets at once.
 *
 * So it is paid where every other app pays it — inline, at the write.
 */

NS_ASSUME_NONNULL_END
