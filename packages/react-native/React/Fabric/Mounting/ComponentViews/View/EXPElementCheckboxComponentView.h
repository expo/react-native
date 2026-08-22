/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <React/EXPElementControlComponentView.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/*
 * `<input type="checkbox">` on iOS, backed by a real `UISwitch`.
 *
 * A switch rather than a drawn tick box, because iOS has no checkbox: a boolean
 * in an iOS form is a `UISwitch`, and that is what an iOS user expects to find.
 * Android uses its own `CheckBox` for the same element. The element is the
 * semantic; the control is each platform's answer to it.
 */
@interface EXPElementCheckboxComponentView : EXPElementControlComponentView
@end

NS_ASSUME_NONNULL_END
