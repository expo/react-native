/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noformat
 * @nolint
 * @flow strict
 * @generated SignedSource<<92e869744dd405a4d74b1b6f50fa8d52>>
 */

import type {
  // $FlowFixMe[nonstrict-import] TODO(@rubennorte)
  HostInstance as PublicInstance,
  // $FlowFixMe[nonstrict-import] TODO(@rubennorte)
  MeasureOnSuccessCallback,
  // $FlowFixMe[nonstrict-import] TODO(@rubennorte)
  PublicRootInstance,
  // $FlowFixMe[nonstrict-import] TODO(@rubennorte)
  PublicTextInstance,
} from 'react-native';

import * as React from 'react';

export type AttributeType<T, V> =
  | true
  | Readonly<{
      diff?: (arg1: T, arg2: T) => boolean,
      process?: (arg1: V) => T,
    }>;

// We either force that `diff` and `process` always use unknown,
// or we allow them to define specific types and use this hack
export type AnyAttributeType = AttributeType<$FlowFixMe, $FlowFixMe>;

export type AttributeConfiguration = Readonly<{
  [propName: string]: AnyAttributeType | void,
  style?: Readonly<{
    [propName: string]: AnyAttributeType,
    ...
  }>,
  ...
}>;

export type ViewConfig = Readonly<{
  Commands?: Readonly<{[commandName: string]: number, ...}>,
  Constants?: Readonly<{[name: string]: unknown, ...}>,
  Manager?: string,
  NativeProps?: Readonly<{[propName: string]: string, ...}>,
  baseModuleName?: ?string,
  bubblingEventTypes?: Readonly<{
    [eventName: string]: Readonly<{
      phasedRegistrationNames: Readonly<{
        captured: string,
        bubbled: string,
        skipBubbling?: ?boolean,
      }>,
    }>,
    ...
  }>,
  directEventTypes?: Readonly<{
    [eventName: string]: Readonly<{
      registrationName: string,
    }>,
    ...
  }>,
  supportsRawText?: boolean,
  uiViewClassName: string,
  validAttributes: AttributeConfiguration,
  // When set, the reconciler records the authored JSX type onto the instance as
  // a `nodeName` prop. Generic seam for intrinsic components that must preserve
  // their tag name for DOM APIs (e.g. HTMLUnknownElement), so the renderer names
  // no specific component.
  recordNodeName?: boolean,
  /**
   * Resolves the native component to instantiate from the element's props,
   * letting one JSX tag be backed by different native components. Box
   * generation follows computed `display`, not the tag, so an intrinsic
   * element uses a cheap text-backed component while it folds into an inline
   * formatting context and a box-backed one when its display establishes one.
   *
   * Consulted at instance creation only, which is the same point at which a
   * browser picks a layout object class.
   *
   * DOM-CSS-LIMITATION(display-change-needs-remount): an element whose display
   * later crosses the box/no-box boundary keeps its original backing until it
   * remounts. Browsers destroy and recreate the layout object there; matching
   * that needs a remount signal the reconciler does not have. Static display —
   * the overwhelming case — is correct.
   */
  resolveUIViewClassName?: (props: Object) => string,
  /**
   * The element's user-agent style, merged *beneath* the author's `style` so
   * an author declaration always wins — the cascade's user-agent origin, with
   * no per-property special-casing. Applied by the renderer, so author code
   * never sees it, the way a browser consults its own stylesheet.
   */
  uaStyle?: Object,
}>;

export type PartialViewConfig = Readonly<{
  bubblingEventTypes?: ViewConfig['bubblingEventTypes'],
  directEventTypes?: ViewConfig['directEventTypes'],
  supportsRawText?: boolean,
  uiViewClassName: string,
  validAttributes?: AttributeConfiguration,
}>;

type InspectorDataProps = Readonly<{
  [propName: string]: string,
  ...
}>;

type InspectorDataGetter = (
  <TElementType extends React.ElementType>(
    componentOrHandle: React.ElementRef<TElementType> | number,
  ) => ?number,
) => Readonly<{
  measure: (callback: MeasureOnSuccessCallback) => void,
  props: InspectorDataProps,
}>;

export type InspectorData = Readonly<{
  closestInstance?: unknown,
  hierarchy: Array<{
    name: ?string,
    getInspectorData: InspectorDataGetter,
  }>,
  selectedIndex: ?number,
  props: InspectorDataProps,
  componentStack: string,
}>;

export type TouchedViewDataAtPoint = Readonly<
  {
    pointerY: number,
    touchedViewTag?: number,
    frame: Readonly<{
      top: number,
      left: number,
      width: number,
      height: number,
    }>,
    closestPublicInstance?: PublicInstance,
  } & InspectorData,
>;

export type RenderRootOptions = {
  onUncaughtError?: (
    error: unknown,
    errorInfo: {readonly componentStack?: ?string},
  ) => void,
  onCaughtError?: (
    error: unknown,
    errorInfo: {
      readonly componentStack?: ?string,
      // $FlowFixMe[unclear-type] unknown props and state.
      // $FlowFixMe[value-as-type] Component in react repo is any-typed, but it will be well typed externally.
      readonly errorBoundary?: ?React.Component<any, any>,
    },
  ) => void,
  onRecoverableError?: (
    error: unknown,
    errorInfo: {readonly componentStack?: ?string},
  ) => void,
  onDefaultTransitionIndicator?: () => void | (() => void),
};

export opaque type Node = unknown;
export opaque type InternalInstanceHandle = unknown;

export type ReactFabricType = {
  findHostInstance_DEPRECATED<TElementType extends React.ElementType>(
    componentOrHandle: ?(React.ElementRef<TElementType> | number),
  ): ?PublicInstance,
  findNodeHandle<TElementType extends React.ElementType>(
    componentOrHandle: ?(React.ElementRef<TElementType> | number),
  ): ?number,
  dispatchCommand(
    handle: PublicInstance,
    command: string,
    args: Array<unknown>,
  ): void,
  isChildPublicInstance(parent: PublicInstance, child: PublicInstance): boolean,
  sendAccessibilityEvent(handle: PublicInstance, eventType: string): void,
  render(
    element: React.MixedElement,
    containerTag: number,
    callback: ?() => void,
    concurrentRoot: ?boolean,
    options: ?RenderRootOptions,
  ): ?React.ElementRef<React.ElementType>,
  unmountComponentAtNode(containerTag: number): void,
  getNodeFromInternalInstanceHandle(
    internalInstanceHandle: InternalInstanceHandle,
  ): ?Node,
  getPublicInstanceFromInternalInstanceHandle(
    internalInstanceHandle: InternalInstanceHandle,
  ): PublicInstance | PublicTextInstance | null,
  getPublicInstanceFromRootTag(rootTag: number): PublicRootInstance | null,
  ...
};

export type ReactFabricEventTouch = {
  identifier: number,
  locationX: number,
  locationY: number,
  pageX: number,
  pageY: number,
  screenX: number,
  screenY: number,
  target: number,
  timestamp: number,
  force: number,
  ...
};

export type ReactFabricEvent = {
  touches: Array<ReactFabricEventTouch>,
  changedTouches: Array<ReactFabricEventTouch>,
  targetTouches: Array<ReactFabricEventTouch>,
  target: number,
  ...
};

// Imperative LayoutAnimation API types
//
export type LayoutAnimationType =
  | 'spring'
  | 'linear'
  | 'easeInEaseOut'
  | 'easeIn'
  | 'easeOut'
  | 'keyboard';

export type LayoutAnimationProperty =
  | 'opacity'
  | 'scaleX'
  | 'scaleY'
  | 'scaleXY';

export type LayoutAnimationAnimationConfig = Readonly<{
  duration?: number,
  delay?: number,
  springDamping?: number,
  initialVelocity?: number,
  type?: LayoutAnimationType,
  property?: LayoutAnimationProperty,
}>;

export type LayoutAnimationConfig = Readonly<{
  duration: number,
  create?: LayoutAnimationAnimationConfig,
  update?: LayoutAnimationAnimationConfig,
  delete?: LayoutAnimationAnimationConfig,
}>;
