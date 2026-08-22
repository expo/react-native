/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

#import <React/RCTViewComponentView.h>

NS_ASSUME_NONNULL_BEGIN

/*
 * Shared base for the DOM elements that are drawn by a real UIKit control —
 * `<input type="range">` as a `UISlider`, `<input type="checkbox">` as a
 * `UISwitch`, and the rest of the form controls as they land.
 *
 * It exists for accessibility. `RCTViewComponentView` places itself *in front*
 * of its `contentView`: with a content view present the container reports
 * itself as the accessibility element (see `-isAccessibilityElement`, which
 * proxies the content view's answer), so the control underneath is never
 * visited by assistive technology. Everything else the container reports —
 * traits, value, the adjust actions — is derived from props instead, which is
 * right for a stock React Native component, where JavaScript holds the truth.
 *
 * For these elements it is wrong: the truth is in the control. A `UISlider`
 * knows it is adjustable and knows it reads "50%"; a `UISwitch` knows it is a
 * toggle that is on. Left alone, the container answers for them with props that
 * describe none of it — observed as an `<input type="checkbox">` announcing as
 * a plain button with no value, and, once the placeholder traits were removed,
 * as an unlabelled piece of static text.
 *
 * So the container forwards its accessibility to the control, and the element
 * ends up announcing exactly as the same control does in an app built without
 * any of this. Anything the author stated explicitly still wins: props are
 * consulted first, and the control answers only where they are silent.
 */
@interface EXPElementControlComponentView : RCTViewComponentView

/*
 * The platform control that draws this element. Setting it also installs it as
 * the `contentView`, which is what lays the control out into the element's box;
 * added as a plain subview it would have no size and would not draw at all.
 */
@property (nonatomic, strong, nullable) UIView *elementControl;

@end

NS_ASSUME_NONNULL_END
