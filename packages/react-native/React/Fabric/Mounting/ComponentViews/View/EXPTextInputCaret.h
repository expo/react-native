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
@property(nonatomic, copy, nullable) NSString *text;
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
void EXPWriteTextPreservingCaret(
    UIView<EXPCaretPreservingTextInput> *field,
    NSString *next);

NS_ASSUME_NONNULL_END
