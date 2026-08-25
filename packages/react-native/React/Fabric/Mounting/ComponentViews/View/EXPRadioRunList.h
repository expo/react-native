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
 * The list draws a checkmark and reports a tap; `name`, `value`, exclusivity
 * and submission stay the element's.
 */
@protocol EXPRadioRunMember <NSObject>
/** Whether this radio is the chosen one. */
- (BOOL)exp_isChosen;
/** Chosen by a tap on its row. Moves the control and reports it, in that order. */
- (void)exp_choose;
/**
 * Whether the row may be chosen at all; a row whose radio is disabled must
 * neither highlight nor select, since the row, not the control, is what a
 * finger lands on.
 */
- (BOOL)exp_isEnabled;
@end

/**
 * Presents a run of adjacent `<input type="radio">` rows as the platform's own
 * grouped list. The list is tacit: no element stands for it and the container
 * holding the radios does not become one.
 *
 * iOS has no radio control (`PickerStyle.radioGroup` is macOS-only); what the
 * platform offers for "one of several" is a list whose chosen row carries a
 * checkmark, as Settings does for Wi-Fi networks and text size.
 *
 * The card is `secondarySystemGroupedBackground`, white in light mode like
 * `systemBackground`, and nothing here draws an edge to compensate; a grouped
 * card is legible because it sits on a grouped background.
 * DOM-CSS-LIMITATION(radio-card-needs-a-contrasting-page).
 *
 * Discovery is push, not pull: a radio announces itself as it mounts, so a tree
 * with no radios runs none of this code. Consecutive announcing siblings form a
 * run, and any other child between them ends one and begins the next.
 */
@interface EXPRadioRunList : NSObject

/** A radio mounting: `row` is its ancestor that is a child of `container`. */
+ (void)announceRadio:(UIView<EXPRadioRunMember> *)radio row:(UIView *)row inContainer:(UIView *)container;

/** A radio's `checked` changed: the run redraws the accessory that shows it. */
+ (void)radioDidChange:(UIView<EXPRadioRunMember> *)radio;

/** A radio going away. */
+ (void)withdrawRow:(UIView *)row fromContainer:(UIView *)container;

/** Re-groups and re-frames the runs, once, at the end of the current turn. */
+ (void)scheduleRegroupFor:(UIView *)container;

/** Re-groups and re-frames the runs now. */
+ (void)containerDidLayout:(UIView *)container;

/** Whether any run is being coordinated here. */
+ (BOOL)containerHasRuns:(UIView *)container;

@end

NS_ASSUME_NONNULL_END
