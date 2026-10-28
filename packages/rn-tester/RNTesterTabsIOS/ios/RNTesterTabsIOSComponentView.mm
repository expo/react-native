/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "RNTesterTabsIOSComponentView.h"

#import <React/RCTConversions.h>
#import <React/RCTLog.h>
#import <React/UIView+React.h>
#import <react/renderer/components/AppSpecs/ComponentDescriptors.h>
#import <react/renderer/components/AppSpecs/EventEmitters.h>
#import <react/renderer/components/AppSpecs/Props.h>

#if __has_include(<React/RCTFabricComponentsPlugins.h>)
#import <React/RCTFabricComponentsPlugins.h>
#else
#import "RCTFabricComponentsPlugins.h"
#endif

using namespace facebook::react;

// Preserve RNTester's existing example bounds on compact bottom-tab layouts.
static constexpr CGFloat LegacyTopInset = 50;
static constexpr CGFloat LegacyBottomInset = 65;

/**
 * Reports each layout pass, after which the tab bar is where the pass put it:
 * along the bottom, along a side, or replaced by a floating bar.
 */
@interface RNTesterTabBarController : UITabBarController
@property (nonatomic, copy) void (^didLayoutSubviews)(void);
@end

@implementation RNTesterTabBarController

- (void)viewDidLayoutSubviews
{
  [super viewDidLayoutSubviews];
  if (self.didLayoutSubviews != nil) {
    self.didLayoutSubviews();
  }
}

@end

/**
 * A tab's view controller, which reports when the area its content needs to
 * clear changes. Its safe area is updated after the tab bar controller's
 * layout pass, when its own view is laid out.
 */
@interface RNTesterTabViewController : UIViewController
@property (nonatomic, copy) void (^safeAreaInsetsDidChange)(void);
@end

@implementation RNTesterTabViewController

- (void)viewSafeAreaInsetsDidChange
{
  [super viewSafeAreaInsetsDidChange];
  if (self.safeAreaInsetsDidChange != nil) {
    self.safeAreaInsetsDidChange();
  }
}

@end

@interface RNTesterTabsIOSComponentView () <UITabBarControllerDelegate>
@end

@implementation RNTesterTabsIOSComponentView {
  RNTesterTabBarController *_tabBarController;
  // Holds the mounted React children, and moves into the selected tab.
  UIView *_containerView;
  NSArray<NSString *> *_tabKeys;
  UIEdgeInsets _contentInsets;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<RNTesterTabsIOSComponentDescriptor>();
}

// The view owns a view controller, which is not worth resetting for reuse.
+ (BOOL)shouldBeRecycled
{
  return NO;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const RNTesterTabsIOSProps>();
    _props = defaultProps;

    _containerView = [UIView new];
    _containerView.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;

    __weak RNTesterTabsIOSComponentView *weakSelf = self;
    _tabBarController = [RNTesterTabBarController new];
    _tabBarController.delegate = self;
    _tabBarController.didLayoutSubviews = ^{
      [weakSelf updateContentInsets];
    };
  }
  return self;
}

// The tab bar controller's view is in the window only while the controller is a child of the view
// controller above it, so it is laid out, given traits and shown as a contained controller from the
// start. A tab bar laid out in the window before its controller is contained, and again after, can
// lose its items, as the iPhone Duo's side tab bar does.
- (void)didMoveToWindow
{
  [super didMoveToWindow];
  UIViewController *parentViewController = self.window != nil ? self.reactViewController : nil;
  if (_tabBarController.parentViewController == parentViewController) {
    return;
  }

  if (_tabBarController.parentViewController != nil) {
    [_tabBarController willMoveToParentViewController:nil];
    self.contentView = nil;
    [_tabBarController removeFromParentViewController];
  }
  if (parentViewController != nil) {
    [parentViewController addChildViewController:_tabBarController];
    // Sized before it enters the window, which lays it out right away.
    _tabBarController.view.frame = RCTCGRectFromRect(_layoutMetrics.getContentFrame());
    self.contentView = _tabBarController.view;
    [_tabBarController didMoveToParentViewController:parentViewController];
  }
}

#pragma mark - Children

// Children are laid out against this view's bounds, which the tab's view shares, so they keep their
// frames wherever the container moves.
- (void)mountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index
{
  [_containerView insertSubview:childComponentView atIndex:index];
}

- (void)unmountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index
{
  [childComponentView removeFromSuperview];
}

#pragma mark - Props

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &oldTabsProps = static_cast<const RNTesterTabsIOSProps &>(*_props);
  const auto &newTabsProps = static_cast<const RNTesterTabsIOSProps &>(*props);

  // RNTester's tabs are a constant, so they are built once, from the first props.
  bool tabsCreated = _tabKeys == nil;
  if (tabsCreated) {
    [self createTabs:newTabsProps.tabs];
  } else if (![[self keysForTabs:newTabsProps.tabs] isEqualToArray:_tabKeys]) {
    RCTLogError(@"RNTesterTabsIOS builds its tabs once, and does not support changing them after mount.");
  }
  if (tabsCreated || oldTabsProps.selectedTab != newTabsProps.selectedTab) {
    [self selectTab:newTabsProps.selectedTab];
  }
  if (oldTabsProps.tabBarHidden != newTabsProps.tabBarHidden) {
    if (@available(iOS 18.0, tvOS 18.0, *)) {
      [_tabBarController setTabBarHidden:newTabsProps.tabBarHidden animated:NO];
    } else {
      _tabBarController.tabBar.hidden = newTabsProps.tabBarHidden;
    }
  }

  [super updateProps:props oldProps:oldProps];
}

- (NSArray<NSString *> *)keysForTabs:(const std::vector<RNTesterTabsIOSTabsStruct> &)tabs
{
  NSMutableArray<NSString *> *keys = [NSMutableArray arrayWithCapacity:tabs.size()];
  for (const auto &tab : tabs) {
    [keys addObject:RCTNSStringFromString(tab.key)];
  }
  return keys;
}

- (void)createTabs:(const std::vector<RNTesterTabsIOSTabsStruct> &)tabs
{
  __weak RNTesterTabsIOSComponentView *weakSelf = self;
  NSMutableArray<UIViewController *> *viewControllers = [NSMutableArray arrayWithCapacity:tabs.size()];

  for (const auto &tab : tabs) {
    auto *viewController = [RNTesterTabViewController new];
    viewController.tabBarItem =
        [[UITabBarItem alloc] initWithTitle:RCTNSStringFromString(tab.title)
                                      image:[UIImage systemImageNamed:RCTNSStringFromString(tab.systemImage)]
                                        tag:0];
    viewController.tabBarItem.accessibilityIdentifier = RCTNSStringFromString(tab.testID);
    viewController.safeAreaInsetsDidChange = ^{
      [weakSelf updateContentInsets];
    };
    [viewControllers addObject:viewController];
  }

  _tabKeys = [self keysForTabs:tabs];
  _tabBarController.viewControllers = viewControllers;
}

- (void)selectTab:(const std::string &)key
{
  NSUInteger index = [_tabKeys indexOfObject:RCTNSStringFromString(key)];
  if (index == NSNotFound) {
    return;
  }
  _tabBarController.selectedIndex = index;

  UIView *tabView = _tabBarController.selectedViewController.view;
  _containerView.frame = tabView.bounds;
  [tabView addSubview:_containerView];
}

#pragma mark - UITabBarControllerDelegate

- (BOOL)tabBarController:(UITabBarController *)tabBarController
    shouldSelectViewController:(UIViewController *)viewController
{
  NSUInteger index = [tabBarController.viewControllers indexOfObject:viewController];
  if (index != NSNotFound && _eventEmitter != nullptr) {
    static_cast<const RNTesterTabsIOSEventEmitter &>(*_eventEmitter)
        .onTabPress({.key = RCTStringFromNSString(_tabKeys[index])});
  }
  // JS selects the tab by updating `selectedTab`.
  return NO;
}

#pragma mark - Insets

// Runs after each layout pass of the tab bar controller and after the change of the selected tab's
// safe area that follows it, so it reads the tab bar and the safe area where the pass left them.
- (void)updateContentInsets
{
  UIViewController *selectedViewController = _tabBarController.selectedViewController;
  if (_eventEmitter == nullptr || !selectedViewController.isViewLoaded || selectedViewController.view.window == nil) {
    return;
  }
  UIEdgeInsets insets = selectedViewController.view.safeAreaInsets;
  UITabBar *tabBar = _tabBarController.tabBar;
  CGRect tabBarFrame = tabBar.frame;
  CGRect bounds = _tabBarController.view.bounds;
  // Where a floating tab bar along the top replaces it, as on iPad, the tab bar has no window.
  BOOL hasBottomTabBar = tabBar.window != nil && !tabBar.hidden &&
      CGRectGetWidth(tabBarFrame) >= CGRectGetWidth(bounds) && CGRectGetMaxY(tabBarFrame) >= CGRectGetMaxY(bounds);
  // Never less at the top than the window's own inset (the status bar, a
  // notch): the tab's view reports its safe area once with no top inset while
  // the window is coming up, and RNTester's first frame drew its list 12
  // points high before the real inset moved it down
  insets.top = MAX(insets.top, self.window.safeAreaInsets.top);
  if (hasBottomTabBar) {
    insets.top = MAX(insets.top, LegacyTopInset);
    // Never go below the system inset: anything less leaves content under the tab bar, where taps switch tabs.
    insets.bottom = MAX(insets.bottom, LegacyBottomInset);
  } else {
    insets.bottom = 0;
    // A window with no status bar along the top, such as the iPhone Duo's, reports no top inset. Keep
    // content a small distance from the display's rounded top edge.
    if (insets.top == 0) {
      insets.top = 16;
    }
  }
  if (UIEdgeInsetsEqualToEdgeInsets(insets, _contentInsets)) {
    return;
  }
  _contentInsets = insets;
  [self sendContentInsets:insets];
}

// Until the first report arrives, RNTester pads its content by the window's safe area, which the tab bar
// and the rules above can move by tens of points. Reported synchronously, JavaScript handles the event
// and React commits and mounts the new padding before this returns, so the frame UIKit is preparing,
// the first one at launch, draws the content where these insets put it.
- (void)sendContentInsets:(UIEdgeInsets)insets
{
  const auto &eventEmitter = *_eventEmitter;
  auto dispatch = [&]() {
    // Discrete, so React commits the update inside the synchronous beat. The generated
    // onContentInsetsChange leaves the category unspecified, which is not discrete in every configuration.
    eventEmitter.dispatchEvent(
        "contentInsetsChange",
        [insets](facebook::jsi::Runtime &runtime) {
          auto payload = facebook::jsi::Object(runtime);
          payload.setProperty(runtime, "top", insets.top);
          payload.setProperty(runtime, "left", insets.left);
          payload.setProperty(runtime, "bottom", insets.bottom);
          payload.setProperty(runtime, "right", insets.right);
          return payload;
        },
        RawEvent::Category::Discrete);
  };
  // With no event dispatcher to run yet, it dispatches nothing; the event then goes as usual.
  if (!eventEmitter.experimental_dispatchSyncNow(dispatch)) {
    dispatch();
  }
}

@end

Class<RCTComponentViewProtocol> RNTesterTabsIOSCls(void)
{
  return RNTesterTabsIOSComponentView.class;
}
