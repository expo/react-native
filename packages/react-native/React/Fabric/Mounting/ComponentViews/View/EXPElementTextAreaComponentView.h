/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

#import <React/EXPElementControlComponentView.h>

NS_ASSUME_NONNULL_BEGIN

/*
 * The component view for `<textarea>`, backed by a real `UITextView`.
 */
@interface EXPElementTextAreaComponentView : EXPElementControlComponentView

/**
 * Whether this field will take the keyboard as it enters the window
 * (`autoFocus`). A screen being covered asks this of the arriving screen's
 * field to decide whether to hand the keyboard over rather than dismiss it.
 */
@property (nonatomic, readonly) BOOL asksForKeyboardOnArrival;

@end

NS_ASSUME_NONNULL_END
