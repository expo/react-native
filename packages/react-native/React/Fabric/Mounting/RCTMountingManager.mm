/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "RCTMountingManager.h"

#import <QuartzCore/QuartzCore.h>

#import <React/RCTAssert.h>
#import <os/log.h>

#include <algorithm>
#include <string>
#include <unordered_map>
#include <vector>
#import <React/RCTComponent.h>
#import <React/RCTLog.h>
#import <React/RCTUtils.h>
#import <cxxreact/TraceSection.h>
#import <react/featureflags/ReactNativeFeatureFlags.h>
#import <react/renderer/components/root/RootShadowNode.h>
#import <react/renderer/core/LayoutableShadowNode.h>
#import <react/renderer/core/RawProps.h>
#import <react/renderer/mounting/TelemetryController.h>
#import <react/utils/FollyConvert.h>

#import <React/RCTComponentViewProtocol.h>
#import <React/RCTComponentViewRegistry.h>
#import <React/RCTConversions.h>
#import <React/RCTMountingTransactionObserverCoordinator.h>

using namespace facebook::react;

static SurfaceId RCTSurfaceIdForView(UIView *view)
{
  do {
    if (RCTIsReactRootView(@(view.tag))) {
      return view.tag;
    }
    view = view.superview;
  } while (view != nil);

  return -1;
}

/*
 * What the MOUNT costs, when asked for it.
 *
 * `EXP_MOUNTING_STATS=1` makes each transaction report itself — how many
 * mutations of each kind it carried and how long the main thread spent
 * performing them — as one line a second to `dev.expo.mounting`. A list whose
 * rows all exist pays for a height change with an `Update` for every row below
 * it, and this is what says how many that is and what they cost.
 *
 * Off, which is the default, it is a `dispatch_once`-guarded read.
 */
static BOOL EXPMountingStatsEnabled(void)
{
  static BOOL enabled = NO;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    const char *value = getenv("EXP_MOUNTING_STATS");
    enabled = value != NULL && value[0] == '1';
  });
  return enabled;
}

static os_log_t EXPMountingStatsLog(void)
{
  static os_log_t log;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    log = os_log_create("dev.expo.mounting", "transaction");
  });
  return log;
}

static void EXPFlushMountingStats(bool force);

/*
 * The report is on a CLOCK, not on the next transaction.
 *
 * Reporting when the next event arrives loses the last second of every burst —
 * and an app opening 3000 rows is exactly one burst followed by silence, which
 * is the measurement that matters most.
 */
static void EXPStartMountingStatsTimer(void)
{
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    dispatch_source_t timer =
        dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
    dispatch_source_set_timer(
        timer, dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), NSEC_PER_SEC, NSEC_PER_SEC / 10);
    dispatch_source_set_event_handler(timer, ^{
      EXPFlushMountingStats(false);
    });
    dispatch_resume(timer);
    // Held for the process's life; the switch is a launch-time decision.
    CFRetain((__bridge CFTypeRef)timer);
  });
}

namespace {
/* The tally, reset by each report — see `EXPMountingStatsEnabled`. */
struct EXPMountingStats {
  uint64_t transactions;
  uint64_t creates;
  uint64_t deletes;
  uint64_t inserts;
  uint64_t removes;
  uint64_t updates;
  uint64_t totalNanos;
  uint64_t maxNanos;
  uint64_t nanosByType[5];
  /* Which components the updates were for — an animation that commits per frame shows up here. */
  std::unordered_map<std::string, uint64_t> updatesByComponent;
  size_t biggest;
  CFTimeInterval since;
};
} // namespace

static EXPMountingStats gMountingStats{};

static void EXPFlushMountingStats(bool force)
{
  if (gMountingStats.transactions == 0) {
    return;
  }
  const CFTimeInterval now = CACurrentMediaTime();
  const CFTimeInterval elapsed = now - gMountingStats.since;
  if (!force && elapsed < 1.0) {
    return;
  }
  std::string top;
  {
    std::vector<std::pair<std::string, uint64_t>> byCount(
        gMountingStats.updatesByComponent.begin(), gMountingStats.updatesByComponent.end());
    std::sort(byCount.begin(), byCount.end(), [](const auto &a, const auto &b) {
      return a.second > b.second;
    });
    for (size_t i = 0; i < byCount.size() && i < 3; i++) {
      top += (i > 0 ? " " : "") + byCount[i].first + "=" + std::to_string(byCount[i].second);
    }
  }
  os_log_info(
      EXPMountingStatsLog(),
      "transactions=%llu create=%llu delete=%llu insert=%llu remove=%llu update=%llu "
      "biggest=%zu ms/txn=%.2f max_ms=%.2f total_ms=%.1f "
      "ms[create=%.1f delete=%.1f insert=%.1f remove=%.1f update=%.1f] updated{%s} in %.2fs",
      gMountingStats.transactions,
      gMountingStats.creates,
      gMountingStats.deletes,
      gMountingStats.inserts,
      gMountingStats.removes,
      gMountingStats.updates,
      gMountingStats.biggest,
      (double)gMountingStats.totalNanos / 1e6 / (double)gMountingStats.transactions,
      (double)gMountingStats.maxNanos / 1e6,
      (double)gMountingStats.totalNanos / 1e6,
      (double)gMountingStats.nanosByType[0] / 1e6,
      (double)gMountingStats.nanosByType[1] / 1e6,
      (double)gMountingStats.nanosByType[2] / 1e6,
      (double)gMountingStats.nanosByType[3] / 1e6,
      (double)gMountingStats.nanosByType[4] / 1e6,
      top.c_str(),
      elapsed);
  gMountingStats = EXPMountingStats{};
  gMountingStats.since = now;
}

/** Where a mutation's time went, by kind — `Insert` carries the props, the state and the layout. */
static void EXPRecordMountMutation(ShadowViewMutation::Type type, uint64_t nanos)
{
  switch (type) {
    case ShadowViewMutation::Create:
      gMountingStats.nanosByType[0] += nanos;
      break;
    case ShadowViewMutation::Delete:
      gMountingStats.nanosByType[1] += nanos;
      break;
    case ShadowViewMutation::Insert:
      gMountingStats.nanosByType[2] += nanos;
      break;
    case ShadowViewMutation::Remove:
      gMountingStats.nanosByType[3] += nanos;
      break;
    case ShadowViewMutation::Update:
      gMountingStats.nanosByType[4] += nanos;
      break;
  }
}

static void EXPRecordMountingTransaction(const ShadowViewMutationList &mutations, uint64_t nanos)
{
  EXPStartMountingStatsTimer();
  if (gMountingStats.since == 0) {
    gMountingStats.since = CACurrentMediaTime();
  }
  gMountingStats.transactions++;
  gMountingStats.totalNanos += nanos;
  gMountingStats.maxNanos = std::max(gMountingStats.maxNanos, nanos);
  gMountingStats.biggest = std::max(gMountingStats.biggest, mutations.size());
  for (const auto &mutation : mutations) {
    switch (mutation.type) {
      case ShadowViewMutation::Create:
        gMountingStats.creates++;
        break;
      case ShadowViewMutation::Delete:
        gMountingStats.deletes++;
        break;
      case ShadowViewMutation::Insert:
        gMountingStats.inserts++;
        break;
      case ShadowViewMutation::Remove:
        gMountingStats.removes++;
        break;
      case ShadowViewMutation::Update:
        gMountingStats.updates++;
        gMountingStats.updatesByComponent[mutation.newChildShadowView.componentName]++;
        break;
    }
  }
}

static void RCTPerformMountInstructions(
    const ShadowViewMutationList &mutations,
    RCTComponentViewRegistry *registry,
    RCTMountingTransactionObserverCoordinator &observerCoordinator,
    SurfaceId surfaceId)
{
  TraceSection s("RCTPerformMountInstructions");
  const BOOL stats = EXPMountingStatsEnabled();

  for (const auto &mutation : mutations) {
    const uint64_t mutationStartedAt = stats ? clock_gettime_nsec_np(CLOCK_UPTIME_RAW) : 0;
    switch (mutation.type) {
      case ShadowViewMutation::Create: {
        auto &newChildShadowView = mutation.newChildShadowView;
        auto &newChildViewDescriptor =
            [registry dequeueComponentViewWithComponentHandle:newChildShadowView.componentHandle
                                                          tag:newChildShadowView.tag];
        observerCoordinator.registerViewComponentDescriptor(newChildViewDescriptor, surfaceId);
        break;
      }

      case ShadowViewMutation::Delete: {
        auto &oldChildShadowView = mutation.oldChildShadowView;
        auto &oldChildViewDescriptor = [registry componentViewDescriptorWithTag:oldChildShadowView.tag];

        observerCoordinator.unregisterViewComponentDescriptor(oldChildViewDescriptor, surfaceId);

        [registry enqueueComponentViewWithComponentHandle:oldChildShadowView.componentHandle
                                                      tag:oldChildShadowView.tag
                                  componentViewDescriptor:oldChildViewDescriptor];
        break;
      }

      case ShadowViewMutation::Insert: {
        auto &newChildShadowView = mutation.newChildShadowView;
        auto &newChildViewDescriptor = [registry componentViewDescriptorWithTag:newChildShadowView.tag];
        auto &parentViewDescriptor = [registry componentViewDescriptorWithTag:mutation.parentTag];

        UIView<RCTComponentViewProtocol> *newChildComponentView = newChildViewDescriptor.view;

        RCTAssert(newChildShadowView.props, @"`newChildShadowView.props` must not be null.");

        [newChildComponentView updateProps:newChildShadowView.props oldProps:nullptr];
        [newChildComponentView updateEventEmitter:newChildShadowView.eventEmitter];
        [newChildComponentView updateState:newChildShadowView.state oldState:nullptr];
        [newChildComponentView updateLayoutMetrics:newChildShadowView.layoutMetrics
                                  oldLayoutMetrics:EmptyLayoutMetrics];
        [newChildComponentView finalizeUpdates:RNComponentViewUpdateMaskAll];

        [parentViewDescriptor.view mountChildComponentView:newChildComponentView index:mutation.index];
        break;
      }

      case ShadowViewMutation::Remove: {
        auto &oldChildShadowView = mutation.oldChildShadowView;
        auto &oldChildViewDescriptor = [registry componentViewDescriptorWithTag:oldChildShadowView.tag];
        auto &parentViewDescriptor = [registry componentViewDescriptorWithTag:mutation.parentTag];
        [parentViewDescriptor.view unmountChildComponentView:oldChildViewDescriptor.view index:mutation.index];
        break;
      }

      case ShadowViewMutation::Update: {
        auto &oldChildShadowView = mutation.oldChildShadowView;
        auto &newChildShadowView = mutation.newChildShadowView;
        auto &newChildViewDescriptor = [registry componentViewDescriptorWithTag:newChildShadowView.tag];
        UIView<RCTComponentViewProtocol> *newChildComponentView = newChildViewDescriptor.view;

        auto mask = RNComponentViewUpdateMask{};

        RCTAssert(newChildShadowView.props, @"`newChildShadowView.props` must not be null.");

        if (oldChildShadowView.props != newChildShadowView.props) {
          [newChildComponentView updateProps:newChildShadowView.props oldProps:oldChildShadowView.props];
          mask |= RNComponentViewUpdateMaskProps;
        }

        if (oldChildShadowView.eventEmitter != newChildShadowView.eventEmitter) {
          [newChildComponentView updateEventEmitter:newChildShadowView.eventEmitter];
          mask |= RNComponentViewUpdateMaskEventEmitter;
        }

        if (oldChildShadowView.state != newChildShadowView.state) {
          [newChildComponentView updateState:newChildShadowView.state oldState:oldChildShadowView.state];
          mask |= RNComponentViewUpdateMaskState;
        }

        if (oldChildShadowView.layoutMetrics != newChildShadowView.layoutMetrics) {
          [newChildComponentView updateLayoutMetrics:newChildShadowView.layoutMetrics
                                    oldLayoutMetrics:oldChildShadowView.layoutMetrics];
          mask |= RNComponentViewUpdateMaskLayoutMetrics;
        }

        if (mask != RNComponentViewUpdateMaskNone) {
          [newChildComponentView finalizeUpdates:mask];
        }

        break;
      }
    }
    if (stats) {
      EXPRecordMountMutation(mutation.type, clock_gettime_nsec_np(CLOCK_UPTIME_RAW) - mutationStartedAt);
    }
  }
}

@implementation RCTMountingManager {
  RCTMountingTransactionObserverCoordinator _observerCoordinator;
  BOOL _transactionInFlight;
  BOOL _followUpTransactionRequired;
  std::shared_ptr<const ContextContainer> _contextContainer;
}

- (instancetype)init
{
  if (self = [super init]) {
    _componentViewRegistry = [RCTComponentViewRegistry new];
  }

  return self;
}

- (void)setContextContainer:(std::shared_ptr<const ContextContainer>)contextContainer
{
  _contextContainer = contextContainer;
}

- (void)attachSurfaceToView:(UIView *)view surfaceId:(SurfaceId)surfaceId
{
  RCTAssertMainQueue();

  RCTAssert(view.subviews.count == 0, @"The view must not have any subviews.");

  RCTComponentViewDescriptor rootViewDescriptor =
      [_componentViewRegistry dequeueComponentViewWithComponentHandle:RootShadowNode::Handle() tag:surfaceId];
  [view addSubview:rootViewDescriptor.view];
}

- (void)detachSurfaceFromView:(UIView *)view surfaceId:(SurfaceId)surfaceId
{
  RCTAssertMainQueue();
  RCTComponentViewDescriptor rootViewDescriptor = [_componentViewRegistry componentViewDescriptorWithTag:surfaceId];

  [rootViewDescriptor.view removeFromSuperview];

  [_componentViewRegistry enqueueComponentViewWithComponentHandle:RootShadowNode::Handle()
                                                              tag:surfaceId
                                          componentViewDescriptor:rootViewDescriptor];
}

- (void)scheduleTransaction:(std::shared_ptr<const MountingCoordinator>)mountingCoordinator
{
  if (RCTIsMainQueue()) {
    // Already on the proper thread, so:
    // * No need to do a thread jump;
    // * No need to do expensive copy of all mutations;
    // * No need to allocate a block.
    [self initiateTransaction:*mountingCoordinator];
    return;
  }

  RCTExecuteOnMainQueue(^{
    RCTAssertMainQueue();
    [self initiateTransaction:*mountingCoordinator];
  });
}

- (void)dispatchCommand:(ReactTag)reactTag commandName:(NSString *)commandName args:(NSArray *)args
{
  if (RCTIsMainQueue()) {
    // Already on the proper thread, so:
    // * No need to do a thread jump;
    // * No need to allocate a block.
    [self synchronouslyDispatchCommandOnUIThread:reactTag commandName:commandName args:args];
    return;
  }

  RCTExecuteOnMainQueue(^{
    [self synchronouslyDispatchCommandOnUIThread:reactTag commandName:commandName args:args];
  });
}

- (void)sendAccessibilityEvent:(ReactTag)reactTag eventType:(NSString *)eventType
{
  if (RCTIsMainQueue()) {
    // Already on the proper thread, so:
    // * No need to do a thread jump;
    // * No need to allocate a block.
    [self synchronouslyDispatchAccessbilityEventOnUIThread:reactTag eventType:eventType];
    return;
  }

  RCTExecuteOnMainQueue(^{
    [self synchronouslyDispatchAccessbilityEventOnUIThread:reactTag eventType:eventType];
  });
}

- (void)initiateTransaction:(const MountingCoordinator &)mountingCoordinator
{
  TraceSection s("-[RCTMountingManager initiateTransaction:]");
  RCTAssertMainQueue();

  if (_transactionInFlight) {
    _followUpTransactionRequired = YES;
    return;
  }

  do {
    _followUpTransactionRequired = NO;
    _transactionInFlight = YES;
    [self performTransaction:mountingCoordinator];
    _transactionInFlight = NO;
  } while (_followUpTransactionRequired);
}

- (void)performTransaction:(const MountingCoordinator &)mountingCoordinator
{
  TraceSection s("-[RCTMountingManager performTransaction:]");
  RCTAssertMainQueue();

  auto surfaceId = mountingCoordinator.getSurfaceId();

  mountingCoordinator.getTelemetryController().pullTransaction(
      [&](const MountingTransaction &transaction, const SurfaceTelemetry &surfaceTelemetry) {
        [self.delegate mountingManager:self willMountComponentsWithRootTag:surfaceId];
        _observerCoordinator.notifyObserversMountingTransactionWillMount(transaction, surfaceTelemetry);
      },
      [&](const MountingTransaction &transaction, const SurfaceTelemetry &surfaceTelemetry) {
        const BOOL stats = EXPMountingStatsEnabled();
        const uint64_t startedAt = stats ? clock_gettime_nsec_np(CLOCK_UPTIME_RAW) : 0;
        RCTPerformMountInstructions(
            transaction.getMutations(), _componentViewRegistry, _observerCoordinator, surfaceId);
        if (stats) {
          EXPRecordMountingTransaction(
              transaction.getMutations(), clock_gettime_nsec_np(CLOCK_UPTIME_RAW) - startedAt);
        }
      },
      [&](const MountingTransaction &transaction, const SurfaceTelemetry &surfaceTelemetry) {
        _observerCoordinator.notifyObserversMountingTransactionDidMount(transaction, surfaceTelemetry);
        [self.delegate mountingManager:self didMountComponentsWithRootTag:surfaceId];
      });
}

- (void)setIsJSResponder:(BOOL)isJSResponder
    blockNativeResponder:(BOOL)blockNativeResponder
           forShadowView:(const facebook::react::ShadowView &)shadowView
{
  ReactTag reactTag = shadowView.tag;
  RCTExecuteOnMainQueue(^{
    UIView<RCTComponentViewProtocol> *componentView = [self->_componentViewRegistry findComponentViewWithTag:reactTag];
    [componentView setIsJSResponder:isJSResponder];
  });
}

- (void)synchronouslyUpdateViewOnUIThread:(ReactTag)reactTag
                             changedProps:(folly::dynamic)props
                      componentDescriptor:(const ComponentDescriptor &)componentDescriptor
{
  RCTAssertMainQueue();
  bool updatesTransform = props.find("transform") != props.items().end();
  bool updatesOpacity = props.find("opacity") != props.items().end();

  UIView<RCTComponentViewProtocol> *componentView = [_componentViewRegistry findComponentViewWithTag:reactTag];
  if (!componentView) {
    RCTLogWarn(@"Attempted to update view with tag %ld, but it no longer exists", (long)reactTag);
    return;
  }

  NSSet<NSString *> *propKeys = componentView.propKeysManagedByAnimated_DO_NOT_USE_THIS_IS_BROKEN ?: [NSSet new];

  if (!ReactNativeFeatureFlags::useSharedAnimatedBackend()) {
    NSArray<NSString *> *propsKeysToBeUpdated = extractKeysFromFollyDynamic(props);
    propKeys = [propKeys setByAddingObjectsFromArray:propsKeysToBeUpdated];
  }

  SurfaceId surfaceId = RCTSurfaceIdForView(componentView);
  Props::Shared oldProps = [componentView props];
  Props::Shared newProps = componentDescriptor.cloneProps(
      PropsParserContext{surfaceId, *_contextContainer}, oldProps, RawProps(std::move(props)));

  componentView.propKeysManagedByAnimated_DO_NOT_USE_THIS_IS_BROKEN = nil;
  [componentView updateProps:newProps oldProps:oldProps];
  componentView.propKeysManagedByAnimated_DO_NOT_USE_THIS_IS_BROKEN = propKeys;

  const auto &newViewProps = static_cast<const ViewProps &>(*newProps);

  if (updatesTransform) {
    auto layoutMetrics = LayoutMetrics();
    layoutMetrics.frame.size.width = componentView.layer.bounds.size.width;
    layoutMetrics.frame.size.height = componentView.layer.bounds.size.height;
    CATransform3D newTransform = RCTCATransform3DFromTransformMatrix(newViewProps.resolveTransform(layoutMetrics));
    if (!CATransform3DEqualToTransform(newTransform, componentView.layer.transform)) {
      componentView.layer.transform = newTransform;
    }
  }
  if (updatesOpacity && componentView.layer.opacity != (float)newViewProps.opacity) {
    componentView.layer.opacity = newViewProps.opacity;
  }

  [componentView finalizeUpdates:RNComponentViewUpdateMaskProps];
}

- (void)synchronouslyDispatchCommandOnUIThread:(ReactTag)reactTag
                                   commandName:(NSString *)commandName
                                          args:(NSArray *)args
{
  RCTAssertMainQueue();
  UIView<RCTComponentViewProtocol> *componentView = [_componentViewRegistry findComponentViewWithTag:reactTag];
  [componentView handleCommand:commandName args:args];
}

- (void)synchronouslyDispatchAccessbilityEventOnUIThread:(ReactTag)reactTag eventType:(NSString *)eventType
{
  if ([@"focus" isEqualToString:eventType]) {
    UIView<RCTComponentViewProtocol> *componentView = [_componentViewRegistry findComponentViewWithTag:reactTag];
    UIAccessibilityPostNotification(UIAccessibilityLayoutChangedNotification, componentView);
  }
}

@end
