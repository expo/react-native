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
@interface EXPRadioRun : NSObject <UICollectionViewDataSource>
@property (nonatomic, strong) NSArray<UIView *> *rows;
@property (nonatomic, strong, nullable) UICollectionView *listView;
@property (nonatomic, weak, nullable) EXPRadioRunCoordinator *coordinator;
/** The cell standing behind a row, if this run has one for it. */
- (nullable UICollectionViewCell *)cellForRow:(UIView *)row;
@end

#pragma mark - The coordinator

@interface EXPRadioRunCoordinator : NSObject <UIGestureRecognizerDelegate, RCTViewPressObserver>
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
- (CGFloat)heightOfRow:(UIView *)row;
/** Makes the WHOLE row choose its radio, the way a list row behaves. */
- (void)attachPressRecognizerTo:(UIView *)row;
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
   * It takes no touches at all. It is a backdrop BEHIND the rows, so a touch
   * that reached it would be a touch that had already passed the row it was
   * meant for. The rows are what the finger lands on, and each carries its own
   * press recognizer — see `-attachPressRecognizerTo:` on the coordinator.
   */
  view.userInteractionEnabled = NO;
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

/** The cell standing behind a row, if the run still has one for it. */
- (nullable UICollectionViewCell *)cellForRow:(UIView *)row
{
  const NSUInteger index = [_rows indexOfObject:row];
  if (index == NSNotFound || _listView == nil) {
    return nil;
  }
  return [_listView cellForItemAtIndexPath:[NSIndexPath indexPathForItem:(NSInteger)index inSection:0]];
}

@end

@implementation EXPRadioRunCoordinator {
  // Where a press began, in window space, so a drag can be told from a tap.
  CGPoint _pressOrigin;
}

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

- (CGFloat)heightOfRow:(UIView *)row
{
  return CGRectGetHeight([self frameOfRow:row]);
}

/*
 * The whole row chooses, not just the control.
 *
 * That is what a list row does, and it is what the checkmark is promising: the
 * row is the choice. It lives on the ROW rather than on the list because the
 * list is a backdrop that takes no touches — the row is what the finger
 * actually lands on, and it is the only view that knows its own bounds.
 *
 * Two mechanisms, because they answer two different questions.
 *
 * The CHOICE is a recognizer: `cancelsTouchesInView` stays NO so a drag that
 * starts on a row still scrolls the page, and the distance check is what stops
 * that drag from also choosing when the finger lifts.
 *
 * The HIGHLIGHT is the row's own touches, through `pressObserver`. A scroll
 * view's `delaysContentTouches` holds `touchesBegan:` back for a moment so a
 * flick does not light up every row it passes over — and it does that by
 * delaying delivery to the VIEW. Recognizers are outside it: UIKit hands them
 * the touch at once, whatever the scroll view decides later, which is why the
 * recognizer cannot be asked this. Reported from the device: every row a
 * scrolling finger crossed lit up on the way past.
 *
 * An earlier fix reimplemented the wait here, with UIKit's own 0.15 read out of
 * `-[UIScrollView _touchDelayForScrollDetection]`. It worked and it was still
 * wrong: none of that timing is ours to hold. The platform already decides when
 * a touch is a press, and now it is the platform that says so.
 */
- (void)attachPressRecognizerTo:(UIView *)row
{
  if ([row isKindOfClass:[RCTViewComponentView class]]) {
    ((RCTViewComponentView *)row).pressObserver = self;
  }
  for (UIGestureRecognizer *existing in row.gestureRecognizers) {
    if (existing.delegate == (id<UIGestureRecognizerDelegate>)self) {
      return;
    }
  }
  UILongPressGestureRecognizer *press =
      [[UILongPressGestureRecognizer alloc] initWithTarget:self action:@selector(rowPressed:)];
  press.minimumPressDuration = 0;
  press.cancelsTouchesInView = NO;
  press.delaysTouchesBegan = NO;
  press.delegate = (id<UIGestureRecognizerDelegate>)self;
  [row addGestureRecognizer:press];
}

- (void)rowPressed:(UILongPressGestureRecognizer *)press
{
  UIView *row = press.view;
  if (row == nil) {
    return;
  }
  switch (press.state) {
    case UIGestureRecognizerStateBegan:
      _pressOrigin = [press locationInView:row.window];
      break;
    case UIGestureRecognizerStateEnded: {
      /*
       * Two ways a press is not a choice: the finger left the row, or it
       * dragged. The drag check is the one that matters — the recognizer does
       * not give up its touches to the scroll view, so without it every flick
       * that began on a row would also select it on the way past.
       */
      const CGPoint end = [press locationInView:row.window];
      const CGFloat dx = end.x - _pressOrigin.x;
      const CGFloat dy = end.y - _pressOrigin.y;
      static const CGFloat kSlop = 10;
      if (dx * dx + dy * dy > kSlop * kSlop ||
          !CGRectContainsPoint(row.bounds, [press locationInView:row])) {
        break;
      }
      [[_radioForRow objectForKey:row] exp_choose];
      break;
    }
    default:
      break;
  }
}

#pragma mark - RCTViewPressObserver

- (void)pressedView:(UIView *)view didBecomePressed:(BOOL)pressed
{
  [self setRow:view highlighted:pressed];
}

/** Lights the cell standing behind a row, so the press reads as the platform's. */
- (void)setRow:(UIView *)row highlighted:(BOOL)highlighted
{
  for (EXPRadioRun *run in _runs) {
    UICollectionViewCell *cell = [run cellForRow:row];
    if (cell != nil) {
      cell.highlighted = highlighted;
      return;
    }
  }
}

- (BOOL)gestureRecognizer:(UIGestureRecognizer *)gestureRecognizer
    shouldRecognizeSimultaneouslyWithGestureRecognizer:(UIGestureRecognizer *)other
{
  // The page must still scroll under a finger that started on a row.
  return YES;
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
  [coordinator attachPressRecognizerTo:row];
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
  if (coordinator.radioForRow.count == 0) {
    for (EXPRadioRun *run in coordinator.runs) {
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
    run.listView.frame = bounds;
    if (!sameRows) {
      [run.listView reloadData];
    }

  }
}

@end
