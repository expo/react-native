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
 * `<menu>`, as a `UIMenu` — one builder, for every element that opens one.
 *
 * HTML's list of commands is the same list whoever presents it: a `<button>`
 * opens it on a TAP and a box or a balloon opens it on a HOLD, and what differs
 * between them is only who opens it. It was two builders for a while and they
 * disagreed in exactly the way two copies do — the peek grew icons, groups and
 * UIKit's compact row, and the button's menu passed `image:nil` and had no idea
 * what a group was, so the same `<menu>` came out with glyphs on a balloon and
 * without them on a button.
 *
 * @param commands `{id, label, icon, section, disabled, destructive}` each, in
 *   the order the author wrote them.
 * @param onChoose called with the chosen command's `id`. Not its index: a list
 *   that reorders while the menu is open would otherwise report the wrong one.
 * @return nil when there are no commands, which is how UIKit is asked for a
 *   peek's preview without a menu under it.
 */
FOUNDATION_EXPORT UIMenu *_Nullable EXPElementMenuFromCommands(
    NSArray<NSDictionary<NSString *, id> *> *commands,
    void (^_Nullable onChoose)(NSString *identifier));

/**
 * A command's glyph, from the same `system:` scheme `<img>` takes.
 *
 * Only that scheme, and deliberately: a menu is built while UIKit is asking for
 * it, so there is no moment to load anything asynchronously, and a symbol is the
 * one source that resolves synchronously. Anything else returns nil and the
 * command draws without a glyph rather than delaying the menu.
 */
FOUNDATION_EXPORT UIImage *_Nullable EXPElementMenuImage(NSString *_Nullable source);

#if defined(__cplusplus)
/**
 * The parsed commands, in the shape the builder above takes.
 *
 * Three component views hold the same `std::vector<ElementMenuCommand>` and
 * hand it to the same builder, so the crossing happens once.
 */
FOUNDATION_EXPORT NSArray<NSDictionary<NSString *, id> *> *EXPElementMenuCommands(
    const std::vector<facebook::react::ElementMenuCommand> &commands);
#endif

NS_ASSUME_NONNULL_END
