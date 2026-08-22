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
 * The control a `<select>` draws.
 *
 * Exposed so the metrics probe and the test that checks it build the SAME
 * button this mounts. A test that assembled its own would be asserting about a
 * control that merely resembles the real one, which is how a measured constant
 * goes quietly wrong in the first place.
 */
UIButton *EXPMakeElementSelectButton(void);


/*
 * The component view for `<select>`, backed by a `UIButton` presenting a real
 * `UIMenu` — the pop-up button UIKit uses for choosing one of a short list.
 */
@interface EXPElementSelectComponentView : EXPElementControlComponentView

@end

NS_ASSUME_NONNULL_END
