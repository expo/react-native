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
 * A group is a run of consecutive commands sharing a `section`, what a nested
 * `<menu>` produces. Each becomes an inline `UIMenu`, and a group whose commands
 * all carry an icon is presented at `UIMenuElementSizeSmall`, UIKit's compact
 * row of glyphs, which holds four; the author chooses the row's length by
 * grouping. The size is asked for by the group, never inferred from icon-only
 * commands, so labels are never dropped to get it.
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
  // `__block`: the flush below both reads and clears it
  __block BOOL groupIsAllIcons = YES;

  void (^flush)(void) = ^{
    if (group.count == 0) {
      return;
    }
    // One inline menu carrying the size: a menu that is not itself inline is
    // drawn as a submenu row whatever its parent says
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
