/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

/**
 * What the display can show, for `matchMedia`'s `color-gamut` and
 * `dynamic-range`, and whether this OS provides a named color space, for
 * `CSS.supports`; `displayCapabilitiesDidChange` when the display changes.
 */
@interface RCTDisplayCapabilities : RCTEventEmitter <RCTBridgeModule>

- (instancetype)init;

@end
