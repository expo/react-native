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
 * The cell is EMPTY, and that is the design.
 *
 * It draws the card, its corners, the separator and the highlight — everything
 * a grouped list row IS — and it holds nothing. The author's row is not inside
 * it and never moves: it stays exactly where Fabric mounted it and Yoga placed
 * it, and the cell sits behind it as a backdrop of the same height.
 *
 * An earlier version DID host the row, re-parenting it into `contentView`, and
 * it looked right and crashed. Mounting addresses a view's children by index
 * into its subviews, so a child that has moved elsewhere is not merely
 * misplaced, it is unaddressable: `-unmountChildComponentView:index:` maps the
 * mutation index to a subview position, finds the wrong view or runs past the
 * end, and aborts. Leaving the screen killed the app every time, while all four
 * test suites stayed green — none of them mounts and unmounts a real surface.
 *
 * Nothing about the result needed the row to be inside. The card and separators
 * are the cell's own drawing, the checkmark is drawn by the element in its own
 * box, and the height is Yoga's measurement either way.
 */
@interface EXPRadioRunCell : UICollectionViewListCell
/** The height Yoga measured for the row this cell stands behind. */
- (void)standBehindRowOfHeight:(CGFloat)height;
@end

/*
 * The card is the platform's, and nothing here draws an edge around it.
 *
 * A group on a page its own colour has no visible boundary — rows and
 * separators with nothing around them — and for a while this drew one: a
 * shadow on the list's layer, with no `shadowPath`, so Core Animation derived
 * it from the composited alpha and it traced the card's real shape without
 * anyone restating it. It worked, and it cost too much to keep.
 *
 * Deriving a shadow from the alpha means an offscreen pass every frame the
 * layer changes, and this layer changes on every scroll and on every press:
 * reported from the device as scrolling that stutters whenever a group is on
 * screen, and as the edge VANISHING when a row is tapped, because the
 * highlight repaints the card and the shadow is recomputed from it.
 *
 * Both are inherent to an alpha-derived shadow rather than bugs in the
 * arrangement, and the alternatives were worse: a border has to restate the
 * corner radius (`listGroupedCellConfiguration.cornerRadius` is 0 — the
 * rounding comes from the list LAYOUT), and
 * `UIBackgroundConfiguration.shadowProperties` does not draw for a cell whose
 * content view is empty.
 *
 * So the control does what the platform does and no more, and CONTRAST IS THE
 * PAGE'S JOB — which is the same rule iOS itself follows: a grouped card is
 * legible because it sits on a grouped background, not because it carries an
 * edge. See `EXPRadioRunList.h`.
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
   * A required height on the CONTENT VIEW, because self-sizing measures the
   * content and an empty content view offers nothing to measure. Asked, a list
   * cell that gets no answer falls back on the estimate its appearance
   * supplies — a flat 52pt — and every card came out the same height whatever
   * Yoga had measured: rows padded, two-line rows cut off, and every section
   * clipping its last row square while the top corners stayed round.
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
 * Row -> the FRAME Yoga last gave it, captured before a cell takes the row over.
 *
 * The whole frame, not just the height. Once a row is hosted its frame becomes
 * cell-relative — origin near zero — so a later reading collapses the run's
 * bounds to one row's height and only the first row of each section survives.
 * Which is exactly what it did.
 */
@property (nonatomic, strong) NSMapTable<UIView *, NSValue *> *frameForRow;
@property (nonatomic, strong) NSMutableArray<EXPRadioRun *> *runs;
@property (nonatomic, assign) BOOL regroupScheduled;
- (CGRect)frameOfRow:(UIView *)row;
/** Lets the list standing behind a row take the touches that land on it. */
- (void)adoptRow:(UIView *)row;
/** Gives the row its own area back — see the implementation. */
- (void)releaseRow:(UIView *)row;
@end

@implementation EXPRadioRun

- (UICollectionView *)makeListView
{
  UICollectionLayoutListConfiguration *configuration = [[UICollectionLayoutListConfiguration alloc]
      initWithAppearance:UICollectionLayoutListAppearanceInsetGrouped];
  configuration.backgroundColor = [UIColor clearColor];

  /*
   * The section is built here rather than taken whole, so its VERTICAL space
   * can be removed.
   *
   * Measured from the real control: an inset-grouped section reserves 35pt
   * above and 20pt below itself, and 16pt either side. The vertical pair is
   * space OUTSIDE the card — it separates one section from the next on a
   * Settings screen — and in an element tree that spacing is the author's,
   * written in their own layout. Reserving it made the list taller than the
   * card and cost a whole mechanism to hold room for: measure the excess,
   * report it as state, have Yoga keep space for it.
   *
   * Zeroed, the section is exactly as tall as its rows, so a run's own bounds
   * fit it precisely and nothing needs reserving anywhere. That is what lets
   * the list be tacit: it costs the surrounding layout nothing.
   *
   * The HORIZONTAL insets go too, and for a different reason. A section's side
   * insets hold the card in from the screen's margin — they are the distance
   * between a Settings card and the edge of the display. Here the card is not
   * against the screen, it is inside whatever the author laid out around it,
   * and that spacing is theirs. Keeping UIKit's produced a card indented from a
   * row that was already indented: reported from the device as a list with a
   * left margin that should not have been there.
   *
   * What remains is the cell's own margins, which are not spacing but
   * alignment, and those stay.
   */
  UICollectionViewCompositionalLayout *layout = [[UICollectionViewCompositionalLayout alloc]
      initWithSectionProvider:^NSCollectionLayoutSection *(
          NSInteger index, id<NSCollectionLayoutEnvironment> environment) {
        NSCollectionLayoutSection *section =
            [NSCollectionLayoutSection sectionWithListConfiguration:configuration layoutEnvironment:environment];
        section.contentInsets = NSDirectionalEdgeInsetsZero;
        return section;
      }];

  UICollectionView *view = [[UICollectionView alloc] initWithFrame:CGRectZero collectionViewLayout:layout];
  view.backgroundColor = [UIColor clearColor];
  /*
   * A radio group shows every option by definition, so the list never scrolls.
   * That keeps it a plain box inside whatever scroller the page already has,
   * and takes UIKit's cell recycling out of contention with Fabric's view
   * recycling: with every row realised, neither arises.
   */
  view.scrollEnabled = NO;
  view.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;
  /*
   * The list SELECTS. It is the native selector for a run of radios, and
   * letting it do that is what removes the three mechanisms that used to stand
   * in for it: a tap recognizer on the row, a hand-rolled distance check to
   * tell a drag from a tap, and an outside caller lighting the cell.
   *
   * All three are already the platform's here. `UICollectionViewListCell`
   * highlights itself; `-collectionView:didSelectItemAtIndexPath:` is the
   * choice; and a drag that began on a row cancels the cell's tracking because
   * the page's scroll view cancels touches in its content — which is precisely
   * the behaviour the old recognizer had opted out of with
   * `cancelsTouchesInView = NO` and then reimplemented by measuring how far the
   * finger had moved.
   *
   * The touch reaches it because the row in front gives up its own area:
   * `passesTouchesToHostChrome`. The row's CHILDREN keep theirs, so a link
   * inside a row still works.
   */
  view.userInteractionEnabled = YES;
  view.allowsSelection = YES;
  /*
   * A scroll view delays content touches so a flick does not light up
   * everything it passes over. This one does not scroll, so it has nothing to
   * protect and nothing to decide — and the PAGE's scroll view is still
   * delaying the same touch on the way here. Two delays in series is a row
   * that lights late; the page's is the one that means something.
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
   * The checkmark is UIKit's own accessory: its glyph, its tint, its placement,
   * and its side. Trailing in a left-to-right layout and leading in a
   * right-to-left one is a decision nobody here should be making, and the
   * accessory API already makes it.
   *
   * The side is not open to us either, and deliberately so. `UICellAccessory`
   * has no `placement`: only `UICellAccessoryCustomView` takes one, in its
   * designated initialiser, and every built-in accessory's side is fixed by its
   * class. Moving the checkmark to the leading edge would mean giving up the
   * system glyph and tint for a `UIImageView` of our own — trading the
   * platform's mark for its position. Apple's own single-choice lists (Settings
   * ▸ General ▸ Language & Region, Mail ▸ Swipe Options) put it trailing;
   * leading is where a list's EDITING mode puts its selection circle, which is
   * a different control saying a different thing.
   *
   * Reserved on EVERY row, chosen or not. An accessory narrows the cell's
   * content area, so giving one only to the chosen row would move the row's
   * content as the choice moved.
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
 * A disabled row is not offerable, and both questions have to be answered:
 * `shouldHighlight` is the one a finger sees, `shouldSelect` is the one that
 * would otherwise still choose.
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
   * Deselected at once, because the checkmark IS the selection as far as this
   * list is concerned and UIKit's own selected state would say it a second
   * time in a second way. A Settings row does the same: it lights under the
   * finger and lets go.
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
 * The whole row chooses, not just the control.
 *
 * That is what a list row does, and it is what the checkmark is promising: the
 * row is the choice. The row is also what is DRAWN in front — the list is host
 * chrome behind it — so the only thing needed to make the platform's own
 * selection reachable is for the row to stop answering for its own area.
 *
 * `passesTouchesToHostChrome` is that, and it is `pointerEvents: box-none`
 * under another name: this view declines the point, its children are still
 * offered it. A link inside a radio row keeps working; the label text never
 * took touches in the first place (`RCTAnonymousTextRunView` turns interaction
 * off unless it has a link in it).
 *
 * Everything the row used to do itself is now UIKit's: the highlight is
 * `UICollectionViewListCell`'s, the choice is
 * `-collectionView:didSelectItemAtIndexPath:`, and a drag that began on a row
 * scrolls the page and does not select, because the page's scroll view
 * cancels the cell's tracking.
 *
 * THREE MECHANISMS WENT. A `UILongPressGestureRecognizer` with
 * `minimumPressDuration = 0` standing in for a tap; a 10pt distance check
 * standing in for the cancellation it had opted out of; and a press observer
 * on the row lighting the cell from outside. Each was a reimplementation of
 * something the list already does, and the first was also a bug — a
 * zero-duration recognizer that recognizes on touch-down prevents an enclosing
 * scroll view's pan, which is why rows intermittently would not scroll.
 */
- (void)adoptRow:(UIView *)row
{
  if ([row isKindOfClass:[RCTViewComponentView class]]) {
    ((RCTViewComponentView *)row).passesTouchesToHostChrome = YES;
  }
}

/**
 * The counterpart of `-adoptRow:`, and the reason it exists.
 *
 * A row is a component view: it is recycled, and it comes back as something
 * with no radios in it at all. A view left believing that chrome stands behind
 * it would go on declining touches in its own area for whatever it became —
 * so every announce has a withdraw, and every adopt has a release.
 *
 * `-prepareForRecycle` clears the flag as well. This makes sure the row is
 * right even while it is still the same view, which is the case recycling
 * never reaches.
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
 * Re-groups once, after the layout pass that prompted it has finished.
 *
 * Radios announce and re-measure one at a time, and a run cannot be read from a
 * container until every one of its children has its frame — so the work waits
 * for the end of the turn rather than running per announcement. Coalesced, so
 * four radios arriving together cost one regroup rather than four.
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
   * The mark is the LIST's now, so the list is what has to look again.
   *
   * Found by walking up from the radio rather than by keeping an index from
   * radio to run: the view tree already holds that relation and stays correct
   * across re-parenting, recycling and unmounting, and a second copy of it
   * would be one more thing to keep true.
   */
  UIView *row = radio.superview;
  UIView *container = row.superview;
  if (row == nil || container == nil) {
    return;
  }
  EXPRadioRunCoordinator *coordinator = [self coordinatorFor:container create:NO];
  for (EXPRadioRun *run in coordinator.runs) {
    // The WHOLE run, not just this row: choosing one un-chooses another, and
    // the row that lost the mark has to be redrawn as surely as the one that
    // gained it.
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
  // Symmetry with the adopt in `-containerDidLayout:`. The row is a component
  // view and will be recycled into something with no radios in it, and a view
  // still declining its own touches would take none in its next life either.
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

/**
 * Groups the announced rows into runs of ADJACENT siblings, and gives each run
 * a list.
 *
 * Adjacency is read off the container's subviews, which is where sibling order
 * already lives — the mounting layer put them there in order. A row that is not
 * announced breaks the run, which is what turns "a group interrupted by a
 * paragraph" into two sections without anyone writing that rule.
 */
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
   * `addHostChromeSubview:behindSubview:`, not `insertSubview:belowSubview:`.
   * Mounting counts a view's subviews to address its children by index, so an
   * unregistered extra subview shifts every index after it — children land at
   * the wrong z-position and valid removals abort. Registering it is what keeps
   * that arithmetic right wherever the card sits.
   */
  if ([container isKindOfClass:[RCTViewComponentView class]]) {
    [(RCTViewComponentView *)container addHostChromeSubview:listView behindSubview:firstRow];
  } else {
    [container insertSubview:listView belowSubview:firstRow];
  }
}

+ (void)containerDidLayout:(UIView *)container
{
  EXPRadioRunCoordinator *coordinator = [self coordinatorFor:container create:NO];
  if (coordinator == nil) {
    return;
  }

  /*
   * A container with a single child is not a list, and this is where saying so
   * matters.
   *
   * The row rule — "a radio's row is the element that contains it" — needs that
   * element to exist. Fabric flattens a view that draws nothing, and a row
   * container usually draws nothing, so a row written in the markup may be
   * absent from the view tree. When it is, the walk lands somewhere far too
   * high and the "run" is one row the size of the screen. That is exactly what
   * it did: a full-screen card over the whole example.
   *
   * Requiring siblings does not repair the inference, it declines to guess: a
   * lone child is either not a row or not a list, and either way there is
   * nothing here to group.
   */
  if (container.subviews.count < 2) {
    return;
  }

  /*
   * Heights are captured HERE, before the cells take the rows over.
   *
   * Fabric has just set each row's frame from Yoga. Once a row is hosted its
   * frame is driven by the cell's constraints instead, so reading it later
   * reads back the constraint — the value this function supplied — and the real
   * measurement is gone. Taking it at this moment is what keeps layout Yoga's.
   */
  NSMutableArray<UIView *> *current = [NSMutableArray new];
  NSMutableArray<NSMutableArray<UIView *> *> *groups = [NSMutableArray new];
  for (UIView *subview in container.subviews) {
    UIView<EXPRadioRunMember> *radio = [coordinator.radioForRow objectForKey:subview];
    if (radio != nil) {
      /*
       * Only while the row is still Fabric's. A hosted row's frame is the
       * cell's business, and reading it back would overwrite the measurement
       * with the constraint this function supplied.
       */
      if (subview.superview == container && CGRectGetHeight(subview.frame) > 0) {
        [coordinator.frameForRow setObject:[NSValue valueWithCGRect:subview.frame] forKey:subview];
      }
      [current addObject:subview];
      continue;
    }
    // Any other child ends the run.
    if (current.count > 0) {
      [groups addObject:[current mutableCopy]];
      [current removeAllObjects];
    }
  }
  if (current.count > 0) {
    [groups addObject:[current mutableCopy]];
  }

  // Retire lists for runs that no longer exist.
  while (coordinator.runs.count > groups.count) {
    EXPRadioRun *run = coordinator.runs.lastObject;
    // The rows go back to answering for themselves the moment the chrome that
    // was standing behind them is taken away.
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

    // The run's own bounds: the union of the rows Yoga placed.
    CGRect bounds = CGRectNull;
    for (UIView *row in rows) {
      const CGRect frame = [coordinator frameOfRow:row];
      bounds = CGRectIsNull(bounds) ? frame : CGRectUnion(bounds, frame);
    }
    /*
     * The card is the ROWS' COLUMN — their union — and not the container's
     * width.
     *
     * The container is rarely the page. A row's own wrappers draw nothing and
     * are flattened away, so the view a row actually hangs from is whatever
     * ancestor survived: here, the scroll view's content view, holding every
     * case on the screen and spanning it edge to edge. Taking its width made
     * the card ignore the page's padding and run to both edges of the display,
     * with the surrounding text floating 16pt INSIDE the card that was supposed
     * to be a list among it.
     *
     * The rows' union is the column the author laid out, so the card starts and
     * ends exactly where every sibling on the page does — the paragraph between
     * the two sections, the caption above them, the readout below. The inset
     * from the card's edge to a row's label is then the mark's own box, which
     * is the checkmark column a grouped list has anyway.
     */

    /*
     * The card goes directly behind the run's FIRST ROW, not at the back of the
     * container.
     *
     * Not a refinement — the back is wrong here. Flattening does not remove a
     * `<View>` that paints: Fabric hoists its children into this container and
     * leaves the view itself among them as a childless sibling carrying its
     * background, ordered before the children it used to hold. A card at index 0
     * is then behind that backdrop, and any ancestor with a background colour
     * hides it completely. Reported as a radio group inside a plain coloured
     * `<View>` drawing its rows and no card at all.
     *
     * Behind its own first row, the card lands between that backdrop and the
     * run, which is where a backdrop for those rows belongs however the
     * container is arranged. Re-checked every regroup rather than only on
     * insertion, because rows arrive, leave and re-order, and a card two rows
     * too high is the same bug again.
     */
    [self placeListView:run.listView behindFirstOf:rows in:container];
    /*
     * Adopted HERE, and not when the radio announced itself, because the flag
     * says "chrome stands behind me" and this is the line that puts it there.
     * Announcing is not enough on its own: a container with a single child
     * builds no run at all (see the guard above), and a row made transparent
     * with nothing behind it would take no touches from anyone.
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
