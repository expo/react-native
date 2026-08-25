/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * A text input this rule can write to: `UITextInput` for the document, plus the
 * `text` property both `UITextField` and `UITextView` declare and the protocol
 * does not, so `<input>` and `<textarea>` share the write.
 */
@protocol EXPCaretPreservingTextInput <UITextInput>
@property (nonatomic, copy, nullable) NSString *text;
@end

/*
 * Both classes already implement every member; these declare the conformance
 * without adding behaviour.
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
void EXPWriteTextPreservingCaret(UIView<EXPCaretPreservingTextInput> *field, NSString *next);

NS_ASSUME_NONNULL_END
