/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

#import <React/RCTViewComponentView.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * The view behind `<native:chatbubble>`: a box masked to a chat balloon.
 *
 * The shape is a mask rather than a drawn background, so whatever the author
 * puts behind the balloon — a flat colour, a gradient, an image — is what the
 * balloon is made of, and the tail is the same pixels as the body rather than a
 * second shape tinted to match. The platform's own balloons are built the same
 * way: one path masking the balloon's gradient.
 */
@interface EXPChatBubbleComponentView : RCTViewComponentView
@end

NS_ASSUME_NONNULL_END
