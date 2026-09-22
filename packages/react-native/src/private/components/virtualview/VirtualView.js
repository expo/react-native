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
   * When the native event reached JavaScript. A `Prerender` or `Hidden` is
   * applied inside `startTransition`, so this callback is deferred work, and
   * the difference from the time a listener sees is how long the transition
   * waited on React.
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

// The swept rect, with the height the row has now if that is more, from
// `getBoundingClientRect` rather than the whole-point `offsetHeight`. A
// rendered row's unrounded height lives in `VirtualViewShadowNode`; this rect
// matters for a row never laid out.
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
      // Read at the top of the handler, since everything below may be deferred, see `told`
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
          // Hold the height the row has now, not the one the sweep measured:
          // this handler runs after a Prerender in flight at sweep time may
          // have landed, and a placeholder's height would shrink the rendered
          // row. Never smaller than the sweep said, since a row measures zero
          // before its first layout.
          const swept = event.nativeEvent.targetRect;
          const target = event.currentTarget;
          // A numeric target is the legacy renderer's tag, which has no layer to ask
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
        // A hidden cell is an empty box holding the scroll's place and has
        // nothing to announce; a correctness change, not a performance one,
        // since the placeholder views exist either way
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
