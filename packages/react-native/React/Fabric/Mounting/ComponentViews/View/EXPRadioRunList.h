/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * What the coordinator needs from a radio: its state, and a way to change it.
 *
 * Small on purpose. The list draws a checkmark and reports a tap; everything
 * about what a radio MEANS — `name`, `value`, exclusivity, what a form submits
 * — stays where it already lives.
 */
@protocol EXPRadioRunMember <NSObject>
/** Whether this radio is the chosen one. */
- (BOOL)exp_isChosen;
/** Chosen by a tap on its row. Moves the control and reports it, in that order. */
- (void)exp_choose;
@end

/**
 * Presents a run of adjacent `<input type="radio">` rows as the platform's own
 * grouped list.
 *
 * The list is TACIT: no element stands for it, the author never asks for one,
 * and the container holding the radios does not become one. A container may
 * hold a heading, three radios and a paragraph — and what it holds is a
 * heading, a list of three, and a paragraph.
 *
 * iOS has no radio control. `PickerStyle.radioGroup` is macOS-only and UIKit
 * has no equivalent, so what the platform offers for "one of several" is a list
 * whose chosen row carries a checkmark; Settings does it for Wi-Fi networks and
 * for text size. A drawn ring is a web affordance an iOS user has no model for.
 *
 * CONTRAST IS THE PAGE'S JOB. The card is `secondarySystemGroupedBackground`,
 * which is white in light mode — and so is `systemBackground`. A group on a
 * page its own colour therefore shows its rows and its separators with nothing
 * around them. Nothing here draws an edge to compensate: that is the same rule
 * iOS follows, where a grouped card is legible because it sits on a grouped
 * background. Put the group on a background it contrasts with — the demos do.
 * DOM-CSS-LIMITATION(radio-card-needs-a-contrasting-page).
 *
 * DISCOVERY IS PUSH, NOT PULL, and that is the whole performance story. No
 * container ever asks whether its children contain radios — a radio announces
 * itself as it mounts. A tree with no radios runs none of this code: not a
 * scan, not a check, not a branch per node.
 *
 * Adjacency comes free with the announcement. The mounting layer hands a parent
 * its children in order, so consecutive announcing siblings are a run, and
 * anything between them ends one and begins the next. A group interrupted by a
 * paragraph becomes two sections — which is what Wi-Fi shows with "My Networks"
 * and "Other Networks", rather than a special case anyone had to write.
 */
@interface EXPRadioRunList : NSObject

/** A radio mounting: `row` is its ancestor that is a child of `container`. */
+ (void)announceRadio:(UIView<EXPRadioRunMember> *)radio
                  row:(UIView *)row
          inContainer:(UIView *)container;

/** A radio's `checked` changed: the run redraws the accessory that shows it. */
+ (void)radioDidChange:(UIView<EXPRadioRunMember> *)radio;

/** A radio going away. */
+ (void)withdrawRow:(UIView *)row fromContainer:(UIView *)container;

/** Re-groups and re-frames the runs, once, at the end of the current turn. */
+ (void)scheduleRegroupFor:(UIView *)container;

/** Re-groups and re-frames the runs now. */
+ (void)containerDidLayout:(UIView *)container;

/** Whether any run is being coordinated here — cheap enough to ask per layout. */
+ (BOOL)containerHasRuns:(UIView *)container;

@end

NS_ASSUME_NONNULL_END
