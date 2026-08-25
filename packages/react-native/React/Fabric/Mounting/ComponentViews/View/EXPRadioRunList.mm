/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPRadioRunList.h"

#import <objc/runtime.h>

#import "RCTViewComponentView.h"

#pragma mark - The cell

/*
 * The cell is empty by design: it draws the card, corners, separator and
 * highlight of a grouped list row and holds nothing. The author's row stays
 * where Fabric mounted it, in front; the cell is a backdrop of the same
 * height. Re-parenting the row into `contentView` would break mounting, which
 * addresses children by subview index.
 */
@interface EXPRadioRunCell : UICollectionViewListCell
/** The height Yoga measured for the row this cell stands behind. */
- (void)standBehindRowOfHeight:(CGFloat)height;
@end

/*
 * Nothing here draws an edge around the card. A shadow derived from the
 * layer's alpha costs an offscreen pass on every scroll and press, a border
 * would restate the corner radius the list layout owns
 * (`listGroupedCellConfiguration.cornerRadius` is 0), and
 * `UIBackgroundConfiguration.shadowProperties` does not draw for an empty
 * content view. Contrast is the page's job, as for a grouped card on iOS.
 */
@implementation EXPRadioRunCell {
  NSLayoutConstraint *_height;
}

- (void)standBehindRowOfHeight:(CGFloat)height
{
  if (_height != nil) {
    _height.constant = height;
    return;
  }
  /*
   * Self-sizing measures the content view, and an empty one offers nothing to
   * measure; without this constraint the cell falls back on the appearance's
   * 52pt estimate whatever Yoga measured.
   */
  _height = [self.contentView.heightAnchor constraintEqualToConstant:height];
  _height.active = YES;
}

@end

#pragma mark - One run

@class EXPRadioRunCoordinator;

/** One section: a list over a contiguous group of rows. */
@interface EXPRadioRun : NSObject <UICollectionViewDataSource, UICollectionViewDelegate>
@property (nonatomic, strong) NSArray<UIView *> *rows;
@property (nonatomic, strong, nullable) UICollectionView *listView;
@property (nonatomic, weak, nullable) EXPRadioRunCoordinator *coordinator;
@end

#pragma mark - The coordinator

@interface EXPRadioRunCoordinator : NSObject
@property (nonatomic, weak, nullable) UIView *container;
/** Row -> the radio inside it. Ordered by nothing; adjacency comes from the view tree. */
@property (nonatomic, strong) NSMapTable<UIView *, UIView<EXPRadioRunMember> *> *radioForRow;
/**
 * Row -> the frame Yoga last gave it, captured before a cell takes the row
 * over. A hosted row's frame becomes cell-relative, so a later reading would
 * collapse the run's bounds to one row.
 */
@property (nonatomic, strong) NSMapTable<UIView *, NSValue *> *frameForRow;
@property (nonatomic, strong) NSMutableArray<EXPRadioRun *> *runs;
@property (nonatomic, assign) BOOL regroupScheduled;
- (CGRect)frameOfRow:(UIView *)row;
/** Lets the list standing behind a row take the touches that land on it. */
- (void)adoptRow:(UIView *)row;
/** Gives the row its own touch area back. */
- (void)releaseRow:(UIView *)row;
@end

@implementation EXPRadioRun

- (UICollectionView *)makeListView
{
  UICollectionLayoutListConfiguration *configuration =
      [[UICollectionLayoutListConfiguration alloc] initWithAppearance:UICollectionLayoutListAppearanceInsetGrouped];
  configuration.backgroundColor = [UIColor clearColor];

  /*
   * The section is built here so its insets can be zeroed. An inset-grouped
   * section reserves 35pt above, 20pt below and 16pt either side of its card;
   * all of that is spacing between the card and its surroundings, which in an
   * element tree is the author's layout. Zeroed, the list is exactly as tall
   * and as wide as its rows, so nothing has to reserve room for it.
   */
  UICollectionViewCompositionalLayout *layout =
      [[UICollectionViewCompositionalLayout alloc] initWithSectionProvider:^NSCollectionLayoutSection *(
                                                       NSInteger index, id<NSCollectionLayoutEnvironment> environment) {
        NSCollectionLayoutSection *section = [NSCollectionLayoutSection sectionWithListConfiguration:configuration
                                                                                   layoutEnvironment:environment];
        section.contentInsets = NSDirectionalEdgeInsetsZero;
        return section;
      }];

  UICollectionView *view = [[UICollectionView alloc] initWithFrame:CGRectZero collectionViewLayout:layout];
  view.backgroundColor = [UIColor clearColor];
  /*
   * A radio group shows every option, so the list never scrolls; that keeps
   * UIKit's cell recycling out of contention with Fabric's view recycling.
   */
  view.scrollEnabled = NO;
  view.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;
  /*
   * The list selects: `UICollectionViewListCell` highlights itself,
   * `-collectionView:didSelectItemAtIndexPath:` is the choice, and a drag that
   * began on a row cancels the cell's tracking through the page's scroll view.
   * The touch reaches it because the row in front gives up its own area
   * (`passesTouchesToHostChrome`); the row's children keep theirs, so a link
   * inside a row still works.
   */
  view.userInteractionEnabled = YES;
  view.allowsSelection = YES;
  /*
   * This list does not scroll, and the page's scroll view already delays the
   * same touch; a second delay in series would light the row late.
   */
  view.delaysContentTouches = NO;
  view.delegate = self;
  view.dataSource = self;
  [view registerClass:[EXPRadioRunCell class] forCellWithReuseIdentifier:@"row"];
  return view;
}

- (NSInteger)collectionView:(UICollectionView *)collectionView numberOfItemsInSection:(NSInteger)section
{
  return (NSInteger)_rows.count;
}

- (UICollectionViewCell *)collectionView:(UICollectionView *)collectionView
                  cellForItemAtIndexPath:(NSIndexPath *)indexPath
{
  EXPRadioRunCell *cell = [collectionView dequeueReusableCellWithReuseIdentifier:@"row" forIndexPath:indexPath];
  UIView *row = _rows[(NSUInteger)indexPath.item];
  [cell standBehindRowOfHeight:CGRectGetHeight([_coordinator frameOfRow:row])];

  /*
   * The checkmark is UIKit's accessory, so its glyph, tint, placement and side
   * are the platform's; `UICellAccessory` offers no placement for built-in
   * accessories, and Apple's single-choice lists put the mark trailing.
   * Reserved on every row, chosen or not, so the content does not move as the
   * choice moves.
   */
  UIView<EXPRadioRunMember> *radio = [_coordinator.radioForRow objectForKey:row];
  if ([radio exp_isChosen]) {
    UICellAccessoryCheckmark *checkmark = [[UICellAccessoryCheckmark alloc] init];
    checkmark.reservedLayoutWidth = UICellAccessoryStandardDimension;
    cell.accessories = @[ checkmark ];
  } else {
    UICellAccessoryCustomView *empty =
        [[UICellAccessoryCustomView alloc] initWithCustomView:[[UIView alloc] initWithFrame:CGRectZero]
                                                    placement:UICellAccessoryPlacementTrailing];
    empty.reservedLayoutWidth = UICellAccessoryStandardDimension;
    cell.accessories = @[ empty ];
  }
  return cell;
}

#pragma mark - UICollectionViewDelegate

/** The radio a cell stands for, or nil if the run has moved on. */
- (nullable UIView<EXPRadioRunMember> *)radioAtIndexPath:(NSIndexPath *)indexPath
{
  const NSUInteger item = (NSUInteger)indexPath.item;
  return item < _rows.count ? [_coordinator.radioForRow objectForKey:_rows[item]] : nil;
}

/*
 * A disabled row is not offerable: `shouldHighlight` is what a finger sees,
 * `shouldSelect` is what would otherwise still choose.
 */
- (BOOL)collectionView:(UICollectionView *)collectionView shouldHighlightItemAtIndexPath:(NSIndexPath *)indexPath
{
  return [[self radioAtIndexPath:indexPath] exp_isEnabled];
}

- (BOOL)collectionView:(UICollectionView *)collectionView shouldSelectItemAtIndexPath:(NSIndexPath *)indexPath
{
  return [[self radioAtIndexPath:indexPath] exp_isEnabled];
}

- (void)collectionView:(UICollectionView *)collectionView didSelectItemAtIndexPath:(NSIndexPath *)indexPath
{
  /*
   * Deselected at once: the checkmark is the selection, and UIKit's selected
   * state would say it a second way.
   */
  [collectionView deselectItemAtIndexPath:indexPath animated:NO];

  [[self radioAtIndexPath:indexPath] exp_choose];
}

@end

@implementation EXPRadioRunCoordinator

- (instancetype)initWithContainer:(UIView *)container
{
  if (self = [super init]) {
    _container = container;
    _radioForRow = [NSMapTable weakToWeakObjectsMapTable];
    _frameForRow = [NSMapTable weakToStrongObjectsMapTable];
    _runs = [NSMutableArray new];
  }
  return self;
}

- (CGRect)frameOfRow:(UIView *)row
{
  NSValue *frame = [_frameForRow objectForKey:row];
  return frame != nil ? frame.CGRectValue : row.frame;
}

/*
 * The whole row chooses, as a list row does. `passesTouchesToHostChrome` is
 * `pointerEvents: box-none` under another name: the row declines the point and
 * its children are still offered it, so a link inside a radio row keeps
 * working. The highlight, the choice and the drag cancellation are then all
 * the list's.
 */
- (void)adoptRow:(UIView *)row
{
  if ([row isKindOfClass:[RCTViewComponentView class]]) {
    ((RCTViewComponentView *)row).passesTouchesToHostChrome = YES;
  }
}

/**
 * A row is a component view and is recycled into something with no radios in
 * it, so every adopt has a release; `-prepareForRecycle` clears the flag too.
 */
- (void)releaseRow:(UIView *)row
{
  if ([row isKindOfClass:[RCTViewComponentView class]]) {
    ((RCTViewComponentView *)row).passesTouchesToHostChrome = NO;
  }
}

@end

#pragma mark - Discovery

static const void *kCoordinatorKey = &kCoordinatorKey;

@implementation EXPRadioRunList

+ (EXPRadioRunCoordinator *)coordinatorFor:(UIView *)container create:(BOOL)create
{
  EXPRadioRunCoordinator *coordinator = objc_getAssociatedObject(container, kCoordinatorKey);
  if (coordinator == nil && create) {
    coordinator = [[EXPRadioRunCoordinator alloc] initWithContainer:container];
    objc_setAssociatedObject(container, kCoordinatorKey, coordinator, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
  return coordinator;
}

+ (BOOL)containerHasRuns:(UIView *)container
{
  return objc_getAssociatedObject(container, kCoordinatorKey) != nil;
}

+ (void)announceRadio:(UIView<EXPRadioRunMember> *)radio row:(UIView *)row inContainer:(UIView *)container
{
  EXPRadioRunCoordinator *coordinator = [self coordinatorFor:container create:YES];
  [coordinator.radioForRow setObject:radio forKey:row];
  [self scheduleRegroupFor:container];
}

/**
 * Re-groups once, after the layout pass that prompted it, since a run cannot be
 * read until every child has its frame; coalesced across announcements.
 */
+ (void)scheduleRegroupFor:(UIView *)container
{
  EXPRadioRunCoordinator *coordinator = [self coordinatorFor:container create:NO];
  if (coordinator == nil || coordinator.regroupScheduled) {
    return;
  }
  coordinator.regroupScheduled = YES;
  __weak UIView *weakContainer = container;
  dispatch_async(dispatch_get_main_queue(), ^{
    UIView *strongContainer = weakContainer;
    if (strongContainer == nil) {
      return;
    }
    EXPRadioRunCoordinator *current = [self coordinatorFor:strongContainer create:NO];
    current.regroupScheduled = NO;
    [self containerDidLayout:strongContainer];
  });
}

/** Takes a run's list back out, unregistering it as chrome if it was one. */
+ (void)detachListView:(nullable UIView *)listView from:(UIView *)container
{
  if (listView == nil) {
    return;
  }
  if ([container isKindOfClass:[RCTViewComponentView class]]) {
    [(RCTViewComponentView *)container removeHostChromeSubview:listView];
  } else {
    [listView removeFromSuperview];
  }
}

+ (void)radioDidChange:(UIView<EXPRadioRunMember> *)radio
{
  /*
   * The list draws the mark, so the list has to look again. Found by walking up
   * from the radio: the view tree already holds that relation across
   * re-parenting, recycling and unmounting.
   */
  UIView *row = radio.superview;
  UIView *container = row.superview;
  if (row == nil || container == nil) {
    return;
  }
  EXPRadioRunCoordinator *coordinator = [self coordinatorFor:container create:NO];
  for (EXPRadioRun *run in coordinator.runs) {
    // The whole run: choosing one row un-chooses another
    if ([run.rows containsObject:row]) {
      [run.listView reloadData];
      return;
    }
  }
}

+ (void)withdrawRow:(UIView *)row fromContainer:(UIView *)container
{
  EXPRadioRunCoordinator *coordinator = [self coordinatorFor:container create:NO];
  if (coordinator == nil) {
    return;
  }
  [coordinator.radioForRow removeObjectForKey:row];
  [coordinator.frameForRow removeObjectForKey:row];
  // Release before recycling, or the view keeps declining its own touches
  [coordinator releaseRow:row];
  if (coordinator.radioForRow.count == 0) {
    for (EXPRadioRun *run in coordinator.runs) {
      for (UIView *other in run.rows) {
        [coordinator releaseRow:other];
      }
      [self detachListView:run.listView from:container];
    }
    objc_setAssociatedObject(container, kCoordinatorKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
}

/** Puts `listView` immediately behind the first of `rows`, if it is not already. */
+ (void)placeListView:(UIView *)listView behindFirstOf:(NSArray<UIView *> *)rows in:(UIView *)container
{
  UIView *firstRow = rows.firstObject;
  if (firstRow == nil) {
    return;
  }
  const NSUInteger listPosition = [container.subviews indexOfObject:listView];
  const NSUInteger rowPosition = [container.subviews indexOfObject:firstRow];
  if (listPosition != NSNotFound && rowPosition != NSNotFound && listPosition + 1 == rowPosition) {
    return;
  }
  /*
   * Registered as host chrome rather than inserted directly: mounting addresses
   * children by subview index, and an unregistered subview would shift every
   * index after it.
   */
  if ([container isKindOfClass:[RCTViewComponentView class]]) {
    [(RCTViewComponentView *)container addHostChromeSubview:listView behindSubview:firstRow];
  } else {
    [container insertSubview:listView belowSubview:firstRow];
  }
}

/**
 * Groups the announced rows into runs of adjacent siblings, read off the
 * container's subview order, and gives each run a list; any other child ends
 * a run.
 */
+ (void)containerDidLayout:(UIView *)container
{
  EXPRadioRunCoordinator *coordinator = [self coordinatorFor:container create:NO];
  if (coordinator == nil) {
    return;
  }

  /*
   * A lone child is not a list. Fabric flattens a row container that draws
   * nothing, so the walk from a radio can land on an ancestor far too high;
   * requiring siblings declines to guess rather than card the whole screen.
   */
  if (container.subviews.count < 2) {
    return;
  }

  /*
   * Frames are captured here, before the cells take the rows over; once a row
   * is hosted its frame is the cell's constraint, not Yoga's measurement.
   */
  NSMutableArray<UIView *> *current = [NSMutableArray new];
  NSMutableArray<NSMutableArray<UIView *> *> *groups = [NSMutableArray new];
  for (UIView *subview in container.subviews) {
    UIView<EXPRadioRunMember> *radio = [coordinator.radioForRow objectForKey:subview];
    if (radio != nil) {
      // Only while the row is still Fabric's; a hosted row's frame is the cell's
      if (subview.superview == container && CGRectGetHeight(subview.frame) > 0) {
        [coordinator.frameForRow setObject:[NSValue valueWithCGRect:subview.frame] forKey:subview];
      }
      [current addObject:subview];
      continue;
    }
    // Any other child ends the run
    if (current.count > 0) {
      [groups addObject:[current mutableCopy]];
      [current removeAllObjects];
    }
  }
  if (current.count > 0) {
    [groups addObject:[current mutableCopy]];
  }

  // Retire lists for runs that no longer exist
  while (coordinator.runs.count > groups.count) {
    EXPRadioRun *run = coordinator.runs.lastObject;
    // The rows answer for themselves again once the chrome behind them goes
    for (UIView *row in run.rows) {
      [coordinator releaseRow:row];
    }
    [self detachListView:run.listView from:container];
    [coordinator.runs removeLastObject];
  }

  for (NSUInteger i = 0; i < groups.count; i++) {
    EXPRadioRun *run;
    if (i < coordinator.runs.count) {
      run = coordinator.runs[i];
    } else {
      run = [EXPRadioRun new];
      run.coordinator = coordinator;
      run.listView = [run makeListView];
      [coordinator.runs addObject:run];
    }
    NSArray<UIView *> *rows = groups[i];
    const BOOL sameRows = [run.rows isEqualToArray:rows];
    run.rows = rows;

    // The run's bounds: the union of the rows Yoga placed
    CGRect bounds = CGRectNull;
    for (UIView *row in rows) {
      const CGRect frame = [coordinator frameOfRow:row];
      bounds = CGRectIsNull(bounds) ? frame : CGRectUnion(bounds, frame);
    }
    /*
     * The card spans the rows' union, not the container: the container is
     * usually a flattened ancestor as wide as the screen, while the union is
     * the column the author laid out.
     */

    /*
     * The card goes directly behind the run's first row, not at the back of the
     * container: a flattened `<View>` that paints stays among the children as a
     * childless sibling carrying its background, and a card behind it would be
     * hidden. Re-checked every regroup, since rows arrive, leave and re-order.
     */
    [self placeListView:run.listView behindFirstOf:rows in:container];
    /*
     * Adopted here, where the chrome is put behind the rows; a container with a
     * single child builds no run, and a row made transparent with nothing behind
     * it would take no touches from anyone.
     */
    for (UIView *row in rows) {
      [coordinator adoptRow:row];
    }
    run.listView.frame = bounds;
    if (!sameRows) {
      [run.listView reloadData];
    }
  }
}

@end
