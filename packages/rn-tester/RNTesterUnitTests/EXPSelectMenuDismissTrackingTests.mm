/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <XCTest/XCTest.h>
#import <UIKit/UIKit.h>

/*
 * INSTRUMENT, not a pin: reproduces the select-menu dismissal against a
 * scrolling ancestor inside a real window, and reports which UIButton
 * override points UIKit actually consults, plus where the menu platter sits
 * relative to the button during dismissal. The device symptom: pick an
 * option, scroll while the menu closes, and the menu collapses into the
 * button's PRE-scroll position.
 */

@interface EXPProbeSelectButton : UIButton
@property(nonatomic, strong) NSMutableArray<NSString *> *calls;
@end

@implementation EXPProbeSelectButton

- (CGPoint)menuAttachmentPointForConfiguration:(UIContextMenuConfiguration *)configuration
{
  [self.calls addObject:@"menuAttachmentPoint"];
  return [super menuAttachmentPointForConfiguration:configuration];
}

- (UITargetedPreview *)contextMenuInteraction:(UIContextMenuInteraction *)interaction
    previewForDismissingMenuWithConfiguration:(UIContextMenuConfiguration *)configuration
{
  [self.calls addObject:@"previewForDismissing"];
  return [[UITargetedPreview alloc] initWithView:self];
}

- (UITargetedPreview *)contextMenuInteraction:(UIContextMenuInteraction *)interaction
    previewForHighlightingMenuWithConfiguration:(UIContextMenuConfiguration *)configuration
{
  [self.calls addObject:@"previewForHighlighting"];
  return [super contextMenuInteraction:interaction previewForHighlightingMenuWithConfiguration:configuration];
}

@end

@interface EXPSelectMenuDismissTrackingTests : XCTestCase
@end

@implementation EXPSelectMenuDismissTrackingTests

static void Spin(NSTimeInterval seconds)
{
  NSDate *until = [NSDate dateWithTimeIntervalSinceNow:seconds];
  while (until.timeIntervalSinceNow > 0) {
    [[NSRunLoop mainRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];
  }
}

// The menu platter lives in its own window; find any window that is not ours.
static UIWindow *MenuWindow(UIWindow *appWindow)
{
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (![scene isKindOfClass:[UIWindowScene class]]) {
      continue;
    }
    for (UIWindow *window in ((UIWindowScene *)scene).windows) {
      if (window != appWindow && !window.hidden) {
        return window;
      }
    }
  }
  return nil;
}

// The platter view itself, wherever UIKit put it: recursive scan of EVERY
// window for a private class whose name says menu/platter. The window-level
// search above found nothing on current iOS — the container can live in the
// app's own window.
static UIView *FindMenuPlatter(UIView *root)
{
  NSString *name = NSStringFromClass([root class]);
  if ([name containsString:@"Platter"] || [name containsString:@"ContextMenuView"] ||
      [name containsString:@"MorphingPlatter"]) {
    return root;
  }
  for (UIView *subview in root.subviews) {
    UIView *found = FindMenuPlatter(subview);
    if (found != nil) {
      return found;
    }
  }
  return nil;
}

static UIView *MenuPlatterAnywhere(void)
{
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (![scene isKindOfClass:[UIWindowScene class]]) {
      continue;
    }
    for (UIWindow *window in ((UIWindowScene *)scene).windows) {
      UIView *found = FindMenuPlatter(window);
      if (found != nil) {
        return found;
      }
    }
  }
  return nil;
}

- (void)testDismissalTracksTheScrolledButton
{
  UIWindow *window = [[UIWindow alloc] initWithFrame:CGRectMake(0, 0, 390, 844)];
  UIViewController *controller = [UIViewController new];
  window.rootViewController = controller;
  [window makeKeyAndVisible];

  UIScrollView *scrollView = [[UIScrollView alloc] initWithFrame:window.bounds];
  scrollView.contentSize = CGSizeMake(390, 2000);
  [controller.view addSubview:scrollView];

  EXPProbeSelectButton *button = [EXPProbeSelectButton buttonWithType:UIButtonTypeSystem];
  button.calls = [NSMutableArray new];
  button.frame = CGRectMake(40, 400, 200, 44);
  [button setTitle:@"Choose" forState:UIControlStateNormal];
  button.showsMenuAsPrimaryAction = YES;
  button.changesSelectionAsPrimaryAction = YES;
  button.menu = [UIMenu menuWithTitle:@""
                             children:@[
                               [UIAction actionWithTitle:@"Free" image:nil identifier:nil handler:^(UIAction *a){}],
                               [UIAction actionWithTitle:@"Pro" image:nil identifier:nil handler:^(UIAction *a){}],
                             ]];
  [scrollView addSubview:button];
  Spin(0.2);

  // Open the menu the way a tap would.
  if ([button respondsToSelector:@selector(performPrimaryAction)]) {
    [button performPrimaryAction];
  }
  Spin(0.6);

  UIWindow *menuWindow = MenuWindow(window);
  UIView *platterOpen = MenuPlatterAnywhere();
  CGRect platterOpenFrame = CGRectZero;
  if (platterOpen != nil) {
    platterOpenFrame = [platterOpen convertRect:platterOpen.bounds
                              toCoordinateSpace:window.screen.coordinateSpace];
  }
  NSLog(@"@@SELECT open calls=%@ menuWindow=%@ platter=%@ platterY=%.0f",
        [button.calls componentsJoinedByString:@","],
        menuWindow != nil ? @"YES" : @"NO",
        platterOpen != nil ? NSStringFromClass([platterOpen class]) : @"NONE",
        platterOpenFrame.origin.y);

  // Scroll while the menu is up: the button moves 150pt up on screen.
  scrollView.contentOffset = CGPointMake(0, 150);
  Spin(0.1);

  CGRect buttonInScreen = [button convertRect:button.bounds toCoordinateSpace:window.screen.coordinateSpace];
  UIView *platterScrolled = MenuPlatterAnywhere();
  CGRect scrolledFrame = CGRectZero;
  if (platterScrolled != nil) {
    scrolledFrame = [platterScrolled convertRect:platterScrolled.bounds
                               toCoordinateSpace:window.screen.coordinateSpace];
  }
  NSLog(@"@@SELECT after-scroll buttonY=%.0f platterY=%.0f (open-platter tracked scroll: %@)",
        buttonInScreen.origin.y, scrolledFrame.origin.y,
        platterScrolled != nil && platterOpen != nil &&
                fabs(scrolledFrame.origin.y - platterOpenFrame.origin.y) > 50
            ? @"YES"
            : @"NO");

  // Dismiss and sample the platter mid-animation and at the end.
  UIContextMenuInteraction *interaction = nil;
  for (id<UIInteraction> candidate in button.interactions) {
    if ([candidate isKindOfClass:[UIContextMenuInteraction class]]) {
      interaction = (UIContextMenuInteraction *)candidate;
    }
  }
  NSLog(@"@@SELECT interaction=%@", interaction != nil ? @"YES" : @"NO");
  [interaction dismissMenu];

  // ALSO scroll DURING the dismissal — the user's exact gesture.
  for (int sample = 0; sample < 6; sample++) {
    Spin(0.08);
    if (sample == 1) {
      scrollView.contentOffset = CGPointMake(0, 250);
    }
    UIView *platter = MenuPlatterAnywhere();
    if (platter == nil) {
      NSLog(@"@@SELECT sample=%d platter-gone", sample);
      continue;
    }
    CGRect frame = [platter convertRect:platter.bounds toCoordinateSpace:window.screen.coordinateSpace];
    NSLog(@"@@SELECT sample=%d platter=%@ y=%.0f h=%.0f", sample,
          NSStringFromClass([platter class]), frame.origin.y, frame.size.height);
  }

  CGRect buttonFinal = [button convertRect:button.bounds toCoordinateSpace:window.screen.coordinateSpace];
  NSLog(@"@@SELECT final buttonY=%.0f calls=%@", buttonFinal.origin.y,
        [button.calls componentsJoinedByString:@","]);
  XCTAssertTrue(YES);
}

@end
