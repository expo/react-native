/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

#if defined(__cplusplus)
#include <react/renderer/components/view/ElementButtonShadowNode.h>
#include <vector>
#endif

NS_ASSUME_NONNULL_BEGIN

/**
 * `<menu>` as a `UIMenu`, one builder for every element that opens one.
 *
 * @param commands `{id, label, icon, section, disabled, destructive}` each, in
 *   the author's order.
 * @param onChoose called with the chosen command's `id`, not its index, since
 *   the list can reorder while the menu is open.
 * @return nil when there are no commands, which asks UIKit for a peek's preview
 *   without a menu.
 */
FOUNDATION_EXPORT UIMenu *_Nullable EXPElementMenuFromCommands(
    NSArray<NSDictionary<NSString *, id> *> *commands,
    void (^_Nullable onChoose)(NSString *identifier));

/**
 * A command's glyph, from the `system:` scheme `<img>` takes and no other: a menu
 * is built while UIKit asks for it, and a symbol is the one source that resolves
 * synchronously. Anything else draws without a glyph.
 */
FOUNDATION_EXPORT UIImage *_Nullable EXPElementMenuImage(NSString *_Nullable source);

#if defined(__cplusplus)
/** The parsed commands, in the shape the builder above takes */
FOUNDATION_EXPORT NSArray<NSDictionary<NSString *, id> *> *EXPElementMenuCommands(
    const std::vector<facebook::react::ElementMenuCommand> &commands);
#endif

NS_ASSUME_NONNULL_END
