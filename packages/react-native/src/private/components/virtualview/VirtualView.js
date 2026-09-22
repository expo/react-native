/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import type {ViewStyleProp} from '../../../../Libraries/StyleSheet/StyleSheet';
import type {NativeSyntheticEvent} from '../../../../Libraries/Types/CoreEventTypes';
import type {HostInstance} from '../../types/HostInstance';
import type {NativeModeChangeEvent} from './VirtualViewNativeComponent';

import UIManager from '../../../../Libraries/ReactNative/UIManager';
import StyleSheet from '../../../../Libraries/StyleSheet/StyleSheet';
import {useVirtualViewLogging} from './logger/VirtualViewLogger';
import VirtualViewExperimentalNativeComponent from './VirtualViewExperimentalNativeComponent';
import VirtualViewProperNativeComponent from './VirtualViewNativeComponent';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {startTransition, useState} from 'react';

// @see VirtualViewNativeComponent
export enum VirtualViewMode {
  Visible = 0,
  Prerender = 1,
  Hidden = 2,
}

// @see VirtualViewNativeComponent
export enum VirtualViewRenderState {
  Unknown = 0,
  Rendered = 1,
  None = 2,
}

export type Rect = Readonly<{
  x: number,
  y: number,
  width: number,
  height: number,
}>;

export type ModeChangeEvent = Readonly<{
  ...Omit<NativeModeChangeEvent, 'mode'>,
  renderState: VirtualViewRenderState,
  mode: VirtualViewMode,
  target: HostInstance,
  /**
   * When the native event reached JavaScript, which is not when this callback
   * runs.
   *
   * A `Prerender` or a `Hidden` is applied inside `startTransition`, so both
   * the state update and this callback are deferred work: React runs them when
   * it has room. The difference between `told` and the time a listener actually
   * sees is therefore how long the transition waited — the one number that says
   * whether a list that has gone blank is waiting on React rather than on
   * layout or on the main thread.
   */
  told: number,
}>;

// If `VirtualView` exists and `VirtualViewExperimental` does not, that means
// the new version was renamed to `VirtualView`. Eventually, this can be deleted
// with a single remaining import of `VirtualViewNativeComponent`.
const VirtualViewNativeComponent: typeof VirtualViewExperimentalNativeComponent =
  UIManager.hasViewManagerConfig('VirtualView') &&
  !UIManager.hasViewManagerConfig('VirtualViewExperimental')
    ? VirtualViewProperNativeComponent
    : VirtualViewExperimentalNativeComponent;

type VirtualViewComponent = component(
  children?: React.Node,
  hiddenStyle?: (targetRect: Rect) => ViewStyleProp,
  nativeID?: string,
  ref?: ?React.RefSetter<React.ElementRef<typeof VirtualViewNativeComponent>>,
  style?: ?ViewStyleProp,
  onModeChange?: (event: ModeChangeEvent) => void,
  removeClippedSubviews?: boolean,
);

const NotHidden = null;
type HiddenStyle = Exclude<ViewStyleProp, typeof NotHidden>;

type State = HiddenStyle | typeof NotHidden;

function defaultHiddenStyle(targetRect: Rect): ViewStyleProp {
  return {minHeight: targetRect.height, minWidth: targetRect.width};
}

/**
 * The swept rect, with the height the row actually has if that is more.
 *
 * Measured to the precision the sweep measures — `getBoundingClientRect`, not
 * `offsetHeight`, which rounds to a whole point. Neither is the row's true
 * height: both are the mounted frame, which Yoga has rounded to the pixel
 * grid. For a row that has been rendered the shadow node holds the unrounded
 * height itself (`VirtualViewShadowNode`), and this rect only matters for a
 * row that has never been laid out, where the sweep's estimate is all there is.
 */
function heldRect(swept: Rect, target: HostInstance): Rect {
  const now = target.getBoundingClientRect().height;
  return now > swept.height ? {...swept, height: now} : swept;
}

function createVirtualView(initialState: State): VirtualViewComponent {
  const initialHidden = initialState !== NotHidden;

  component VirtualView(
    children?: React.Node,
    hiddenStyle: (targetRect: Rect) => ViewStyleProp = defaultHiddenStyle,
    nativeID?: string,
    ref?: ?React.RefSetter<React.ElementRef<typeof VirtualViewNativeComponent>>,
    style?: ?ViewStyleProp,
    onModeChange?: (event: ModeChangeEvent) => void,
    removeClippedSubviews?: boolean,
  ) {
    const [state, setState] = useState<State>(initialState);
    if (__DEV__) {
      _logs.states?.push(state);
    }
    const isHidden = state !== NotHidden;
    const loggingCallbacksRef = useVirtualViewLogging(isHidden, nativeID);

    const handleModeChange = (
      event: NativeSyntheticEvent<NativeModeChangeEvent>,
    ) => {
      // Read here, at the top of the handler, because everything below this
      // line may be deferred — see `told`.
      const told = performance.now();
      const mode = nullthrows(VirtualViewMode.cast(event.nativeEvent.mode));
      const modeChangeEvent: ModeChangeEvent = {
        mode,
        told,
        renderState: isHidden
          ? VirtualViewRenderState.None
          : VirtualViewRenderState.Rendered,
        // $FlowFixMe[incompatible-type] - we know this is a HostInstance
        target: event.currentTarget as HostInstance,
        targetRect: event.nativeEvent.targetRect,
        thresholdRect: event.nativeEvent.thresholdRect,
      };
      loggingCallbacksRef.current?.logModeChange(modeChangeEvent);

      const emitModeChange =
        onModeChange == null ? null : onModeChange.bind(null, modeChangeEvent);

      match (mode) {
        VirtualViewMode.Visible => {
          setState(NotHidden);
          emitModeChange?.();
        }
        VirtualViewMode.Prerender => {
          startTransition(() => {
            setState(NotHidden);
            emitModeChange?.();
          });
        }
        VirtualViewMode.Hidden => {
          /*
           * HOLD THE HEIGHT THE ROW HAS NOW, not the one the sweep measured.
           *
           * `targetRect` is the row's frame at the moment the container swept
           * it, and this handler runs later — after a Prerender that was in
           * flight at sweep time may have landed. A row told Prerender while it
           * was a 60-point placeholder renders its children and becomes 93; a
           * Hidden swept in between carries the 60, arrives after the 93 has
           * mounted, and holds the space at 60. The row shrinks by 33 points
           * for no reason a reader can see, and grows back when it is
           * prerendered again.
           *
           * Measured on a device opening a ten-thousand row transcript for the
           * second time: one row, [9929], 60.00 -> 93.00 -> 60.00, and the
           * content size moving by exactly that 33 each way underneath a
           * bottom-anchored reader.
           *
           * The rect is still right for a row that was hidden already — it
           * has not changed — and for one that is realised the row itself is
           * the authority on its own height, synchronously, through the DOM
           * layer. Never smaller than the sweep said: a row measures zero
           * before its first layout, and zero is not a height to hold.
           */
          const swept = event.nativeEvent.targetRect;
          const target = event.currentTarget;
          // A numeric target is the legacy renderer's tag, which has no layer
          // to ask, so the sweep's rect stands
          const held =
            isHidden || typeof target === 'number'
              ? swept
              : heldRect(swept, target);
          startTransition(() => {
            setState(hiddenStyle(held) ?? {});
            emitModeChange?.();
          });
        }
      }
    };

    return (
      <VirtualViewNativeComponent
        /*
         * A hidden cell has nothing to announce, so it is taken out of the
         * accessibility tree.
         *
         * It renders `null` children — the whole point — and what is left is an
         * empty box holding the scroll's place. Announcing it is a stop that
         * reads as nothing, and on a list where most cells are hidden it is
         * most of the list.
         *
         * It does NOT make the tree cheaper to walk, and that was worth
         * measuring rather than assuming: XCUITest's first query against a
         * ten-thousand-row list took 22.7, 29.1 and 23.6 seconds with this on,
         * and 31.1, 22.9 and 28.5 with it off — the same number inside its own
         * noise. What that cost is is the ten thousand placeholder VIEWS, which
         * exist either way; hiding them from assistive technology is a
         * correctness change and not a performance one.
         *
         * Removed the moment the cell renders, because then there IS something
         * to read.
         */
        aria-hidden={isHidden ? true : undefined}
        initialHidden={initialHidden}
        nativeID={nativeID}
        ref={ref}
        removeClippedSubviews={removeClippedSubviews}
        renderState={
          (isHidden
            ? VirtualViewRenderState.None
            : VirtualViewRenderState.Rendered) as number
        }
        style={
          isHidden
            ? StyleSheet.compose(style, nullthrows(state) as HiddenStyle)
            : style
        }
        onModeChange={handleModeChange}>
        {isHidden ? null : children}
      </VirtualViewNativeComponent>
    );
  }
  return VirtualView;
}

export default createVirtualView(NotHidden) as VirtualViewComponent;

export function createHiddenVirtualView(
  style: ViewStyleProp,
): VirtualViewComponent {
  return createVirtualView((style ?? {}) as HiddenStyle);
}

export const _logs: {states?: Array<State>} = {};
