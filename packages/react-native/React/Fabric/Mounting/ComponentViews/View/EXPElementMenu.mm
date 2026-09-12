/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPElementMenu.h"

#import <React/RCTConversions.h>

using namespace facebook::react;

UIImage *_Nullable EXPElementMenuImage(NSString *_Nullable source)
{
  if (source.length == 0 || ![source hasPrefix:@"system:"]) {
    return nil;
  }
  NSString *name = [source substringFromIndex:@"system:".length];
  NSRange query = [name rangeOfString:@"?"];
  if (query.location != NSNotFound) {
    name = [name substringToIndex:query.location];
  }
  return [UIImage systemImageNamed:name];
}

NSArray<NSDictionary<NSString *, id> *> *EXPElementMenuCommands(const std::vector<ElementMenuCommand> &commands)
{
  NSMutableArray<NSDictionary<NSString *, id> *> *result = [NSMutableArray arrayWithCapacity:commands.size()];
  for (const auto &command : commands) {
    [result addObject:@{
      @"id" : RCTNSStringFromString(command.id),
      @"label" : RCTNSStringFromString(command.label),
      @"icon" : RCTNSStringFromString(command.icon),
      @"section" : RCTNSStringFromString(command.section),
      @"disabled" : @(command.disabled),
      @"destructive" : @(command.destructive),
    }];
  }
  return result;
}

/**
 * The menu, built from the commands and nothing else.
 *
 * A GROUP is a run of consecutive commands sharing a `section`, which is what a
 * `<menu>` nested inside a `<menu>` produces. Each becomes an inline `UIMenu` —
 * inline so it is part of this menu rather than a submenu the reader has to
 * open — and a group whose commands all carry an icon is presented at
 * `UIMenuElementSizeSmall`, UIKit's compact row of glyphs.
 *
 * The small size is asked for by the GROUP and never inferred from the
 * commands. `preferredElementSize` is a property of a menu and says nothing
 * about its children's titles; Apple's own compact rows give each action both a
 * title and an image, and the title is what VoiceOver reads. Inferring the row
 * from icon-only commands — which this did first — would have made an author
 * drop the labels to get it, and a row of six reactions nothing can name is not
 * a row worth having.
 *
 * A compact row holds FOUR. Six in one group came out as a row of four with the
 * other two as ordinary rows underneath; two groups of three come out as a tidy
 * three-by-two. So the number per row is the author's, expressed the only way
 * the platform will honour — by grouping.
 */
UIMenu *_Nullable EXPElementMenuFromCommands(
    NSArray<NSDictionary<NSString *, id> *> *commands,
    void (^_Nullable onChoose)(NSString *identifier))
{
  if (commands.count == 0) {
    return nil;
  }
  NSMutableArray<UIMenuElement *> *children = [NSMutableArray array];
  NSMutableArray<UIAction *> *group = [NSMutableArray array];
  __block NSString *groupKey = @"";
  // `__block`, because the flush below both reads and clears it.
  __block BOOL groupIsAllIcons = YES;

  void (^flush)(void) = ^{
    if (group.count == 0) {
      return;
    }
    /*
     * ONE menu, inline, carrying the size — not an inline menu wrapping a
     * plain one.
     *
     * The wrapper was the whole difference between a row of reactions and a
     * submenu: a menu that is not itself inline is drawn as a row with a
     * chevron whatever its parent says, so the six glyphs appeared as "›" and
     * the reader had to open them. `preferredElementSize` belongs on the same
     * menu that carries `UIMenuOptionsDisplayInline`, which is how UIKit's own
     * compact rows are built.
     */
    UIMenu *inner = [UIMenu menuWithTitle:@""
                                    image:nil
                               identifier:nil
                                  options:UIMenuOptionsDisplayInline
                                 children:group];
    if (groupIsAllIcons) {
      inner.preferredElementSize = UIMenuElementSizeSmall;
    }
    [children addObject:inner];
    [group removeAllObjects];
    groupIsAllIcons = YES;
  };

  for (NSDictionary<NSString *, id> *command in commands) {
    NSString *identifier = command[@"id"] ?: @"";
    NSString *label = command[@"label"] ?: @"";
    NSString *section = command[@"section"] ?: @"";
    UIImage *image = EXPElementMenuImage(command[@"icon"]);

    UIAction *action = [UIAction actionWithTitle:label
                                           image:image
                                      identifier:nil
                                         handler:^(__kindof UIAction *_Nonnull) {
                                           if (onChoose != nil) {
                                             onChoose(identifier);
                                           }
                                         }];
    UIMenuElementAttributes attributes = 0;
    if ([command[@"disabled"] boolValue]) {
      attributes |= UIMenuElementAttributesDisabled;
    }
    if ([command[@"destructive"] boolValue]) {
      attributes |= UIMenuElementAttributesDestructive;
    }
    action.attributes = attributes;

    if (section.length == 0) {
      flush();
      groupKey = @"";
      [children addObject:action];
      continue;
    }
    if (![section isEqualToString:groupKey]) {
      flush();
      groupKey = section;
    }
    if (image == nil) {
      groupIsAllIcons = NO;
    }
    [group addObject:action];
  }
  flush();
  return [UIMenu menuWithTitle:@"" children:children];
}
