/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 */

'use strict';

import type {RNTesterModule, RNTesterModuleInfo} from '../types/RNTesterTypes';

import * as RNTesterListFbInternal from './RNTesterListFbInternal';

const Components: Array<RNTesterModuleInfo> = [
  // ---- Fork work: text children / css-display / Astryx ----
  // Pinned to the head of the list (see RNTesterModuleInfo.pinned) while
  // these are the features under active development. Mirrors the iOS list.
  {
    key: 'SharedTextBenchmarkExample',
    module: require('../examples/DeviceBench/SharedTextBenchmarkExample').default,
    category: 'Basic',
  },
  {
    key: 'AstryxExample',
    module: require('../examples/Astryx/AstryxExample').default,
    category: 'UI',
    pinned: true,
  },
  {
    key: 'IconsExample',
    module: require('../examples/Astryx/IconsExample').default,
    category: 'UI',
    pinned: true,
  },
  {
    key: 'TextConformanceExample',
    module: require('../examples/TextConformance/TextConformanceExample').default,
    category: 'Basic',
  },
  {
    key: 'StringChildrenExample',
    module: require('../examples/TextChildren/StringChildrenExample').default,
    category: 'Basic',
    pinned: true,
  },
  {
    key: 'ListsExample',
    module: require('../examples/Lists/ListsExample').default,
  },
  {
    key: 'IntrinsicElementsExample',
    module: require('../examples/TextChildren/IntrinsicElementsExample')
      .default,
    category: 'Basic',
    pinned: true,
  },
  {
    key: 'DisplayBlockExample',
    module: require('../examples/DisplayBlock/DisplayBlockExample').default,
    category: 'UI',
    pinned: true,
  },
  {
    key: 'DisplayInlineExample',
    module: require('../examples/DisplayInline/DisplayInlineExample').default,
    category: 'UI',
    pinned: true,
  },

  {
    key: 'CascadeExample',
    pinned: true,
    module: require('../examples/Cascade/CascadeExample').default,
    category: 'UI',
  },
  {
    key: 'DeviceTextBenchmarkExample',
    pinned: true,
    module: require('../examples/DeviceBench/DeviceTextBenchmarkExample')
      .default,
    category: 'UI',
  }, // ---- Upstream RNTester components ----
  {
    key: 'DrawerLayoutAndroid',
    category: 'UI',
    module: require('../examples/DrawerLayoutAndroid/DrawerLayoutAndroidExample'),
  },
  {
    key: 'PopupMenuAndroidExample',
    category: 'UI',
    module: require('../examples/PopupMenuAndroid/PopupMenuAndroidExample'),
  },
  {
    key: 'ActivityIndicatorExample',
    category: 'UI',
    module: require('../examples/ActivityIndicator/ActivityIndicatorExample'),
  },
  {
    key: 'ButtonExample',
    category: 'UI',
    module: require('../examples/Button/ButtonExample'),
  },
  {
    key: 'FlatListExampleIndex',
    module: require('../examples/FlatList/FlatListExampleIndex').default,
    category: 'ListView',
  },
  {
    key: 'ImageExample',
    category: 'Basic',
    module: require('../examples/Image/ImageExample'),
  },
  {
    key: 'LayoutConformanceExample',
    module: require('../examples/LayoutConformance/LayoutConformanceExample')
      .default,
  },
  {
    key: 'JSResponderHandlerExample',
    module: require('../examples/JSResponderHandlerExample/JSResponderHandlerExample'),
  },
  {
    key: 'KeyboardAvoidingViewExample',
    module: require('../examples/KeyboardAvoidingView/KeyboardAvoidingViewExample'),
  },
  {
    key: 'KeyEvents',
    module: require('../examples/KeyboardEventsExample/KeyboardEventsExample')
      .default,
  },
  {
    key: 'ModalExample',
    category: 'UI',
    module: require('../examples/Modal/ModalExample'),
  },
  {
    key: 'NewAppScreenExample',
    module: require('../examples/NewAppScreen/NewAppScreenExample'),
  },
  {
    key: 'PressableExample',
    category: 'UI',
    module: require('../examples/Pressable/PressableExample'),
  },
  {
    key: 'RefreshControlExample',
    module: require('../examples/RefreshControl/RefreshControlExample'),
  },
  {
    key: 'ScrollViewExample',
    category: 'Basic',
    module: require('../examples/ScrollView/ScrollViewExample'),
  },
  {
    key: 'ScrollViewSimpleExample',
    category: 'Basic',
    module: require('../examples/ScrollView/ScrollViewSimpleExample'),
  },
  {
    key: 'ScrollViewAnimatedExample',
    category: 'Basic',
    module: require('../examples/ScrollView/ScrollViewAnimatedExample'),
  },
  {
    key: 'SectionListExample',
    category: 'ListView',
    module: require('../examples/SectionList/SectionListIndex'),
  },
  {
    key: 'StatusBarExample',
    category: 'UI',
    module: require('../examples/StatusBar/StatusBarExample'),
  },
  {
    key: 'SwipeableCardExample',
    category: 'UI',
    module: require('../examples/SwipeableCardExample/SwipeableCardExample'),
  },
  {
    key: 'SwitchExample',
    category: 'UI',
    module: require('../examples/Switch/SwitchExample'),
  },
  {
    key: 'TextExample',
    category: 'Basic',
    module: require('../examples/Text/TextExample'),
  },
  {
    key: 'TextInputExample',
    category: 'Basic',
    module: require('../examples/TextInput/TextInputExample'),
  },
  {
    key: 'TextInputs with key prop',
    module: require('../examples/TextInput/TextInputKeyProp'),
  },
  {
    key: 'TouchableExample',
    category: 'UI',
    module: require('../examples/Touchable/TouchableExample'),
  },
  {
    key: 'ViewExample',
    category: 'Basic',
    module: require('../examples/View/ViewExample').default,
  },
  {
    key: 'NewArchitectureExample',
    category: 'UI',
    module: require('../examples/NewArchitecture/NewArchitectureExample'),
  },
  {
    key: 'PerformanceComparisonExample',
    category: 'Basic',
    module: require('../examples/Performance/PerformanceComparisonExample'),
  },
  ...RNTesterListFbInternal.Components,
];

const APIs: Array<RNTesterModuleInfo> = (
  [
    // ---- Fork work, pinned for quick access (same pattern as Components):
    // the renderer's CSS transitions and display: contents coverage.
    {
      key: 'ShadcnExample',
      pinned: true,
      module: require('../examples/Astryx/ShadcnExample').default,
      category: 'UI',
    },
    {
      key: 'RadixExample',
      pinned: true,
      module: require('../examples/Astryx/RadixExample').default,
      category: 'UI',
    },
    {
      key: 'CSSStylesheetsExample',
      pinned: true,
      module: require('../examples/Astryx/CSSStylesheetsExample').default,
      category: 'UI',
    },
    {
      key: 'GridLanesExample',
      pinned: true,
      module: require('../examples/Grid/GridLanesExample').default,
      category: 'UI',
    },
    {
      key: 'GridExample',
      pinned: true,
      module: require('../examples/Grid/GridExample').default,
      category: 'UI',
    },
    {
      // A harness, not a demo: it renders the whole conformance corpus so the
      // rects can be read back over CDP. Deliberately not pinned.
      key: 'GridConformanceExample',
      module: require('../examples/Grid/GridConformanceExample').default,
      category: 'UI',
    },
    {
      key: 'CSSAnimationsExample',
      pinned: true,
      module: require('../examples/CSSAnimations/CSSAnimationsExample').default,
      category: 'UI',
    },
    {
      key: 'CSSTransitionsExample',
      pinned: true,
      module: require('../examples/CSSTransitions/CSSTransitionsExample')
        .default,
      category: 'UI',
    },
    {
      key: 'DisplayContentsExample',
      pinned: true,
      category: 'UI',
      module: require('../examples/DisplayContents/DisplayContentsExample')
        .default,
    },
    {
      key: 'AccessibilityExample',
      category: 'Basic',
      module: require('../examples/Accessibility/AccessibilityExample'),
    },
    {
      key: 'AccessibilityAndroidExample',
      category: 'Android',
      module: require('../examples/Accessibility/AccessibilityAndroidExample'),
    },
    {
      key: 'AlertExample',
      category: 'UI',
      module: require('../examples/Alert/AlertExample').default,
    },
    {
      key: 'AnimatedIndex',
      category: 'UI',
      module: require('../examples/Animated/AnimatedIndex').default,
    },
    {
      key: 'AnimationBackendIndex',
      category: 'UI',
      module: require('../examples/AnimationBackend/AnimationBackendIndex')
        .default,
    },
    {
      key: 'Animation - GratuitousAnimation',
      category: 'UI',
      module: require('../examples/AnimatedGratuitousApp/AnExApp'),
    },
    {
      key: 'AppearanceExample',
      category: 'UI',
      module: require('../examples/Appearance/AppearanceExample'),
    },
    {
      key: 'AppStateExample',
      category: 'Basic',
      module: require('../examples/AppState/AppStateExample'),
    },
    {
      key: 'ContentURLAndroid',
      category: 'Android',
      module: require('../examples/ContentURLAndroid/ContentURLAndroid'),
    },
    {
      key: 'URLExample',
      category: 'Basic',
      module: require('../examples/Urls/UrlExample'),
    },
    {
      key: 'BorderExample',
      category: 'UI',
      module: require('../examples/Border/BorderExample').default,
    },
    {
      key: 'CrashExample',
      category: 'Basic',
      module: require('../examples/Crash/CrashExample'),
    },
    {
      key: 'DevSettings',
      category: 'Basic',
      module: require('../examples/DevSettings/DevSettingsExample'),
    },
    {
      key: 'Dimensions',
      category: 'UI',
      module: require('../examples/Dimensions/DimensionsExample'),
    },
    {
      key: 'FocusEventsExample',
      module: require('../examples/FocusEventsExample/FocusEventsExample')
        .default,
    },
    {
      key: 'InvalidPropsExample',
      module: require('../examples/InvalidProps/InvalidPropsExample'),
    },
    {
      key: 'Keyboard',
      category: 'Basic',
      module: require('../examples/Keyboard/KeyboardExample').default,
    },
    {
      key: 'LayoutEventsExample',
      category: 'UI',
      module: require('../examples/Layout/LayoutEventsExample'),
    },
    {
      key: 'LinkingExample',
      category: 'Basic',
      module: require('../examples/Linking/LinkingExample'),
    },
    {
      key: 'LayoutAnimationExample',
      category: 'UI',
      module: require('../examples/Layout/LayoutAnimationExample'),
    },
    {
      key: 'LayoutExample',
      category: 'UI',
      module: require('../examples/Layout/LayoutExample'),
    },
    {
      key: 'NativeAnimationsExample',
      category: 'UI',
      module: require('../examples/NativeAnimation/NativeAnimationsExample'),
    },
    {
      key: 'OrientationChangeExample',
      category: 'UI',
      module: require('../examples/OrientationChange/OrientationChangeExample'),
    },
    {
      key: 'PanResponderExample',
      category: 'Basic',
      module: require('../examples/PanResponder/PanResponderExample'),
    },
    {
      key: 'PixelRatio',
      category: 'UI',
      module: require('../examples/PixelRatio/PixelRatioExample'),
    },
    {
      key: 'PermissionsExampleAndroid',
      category: 'Android',
      module: require('../examples/PermissionsAndroid/PermissionsExample'),
    },
    {
      key: 'PlatformColorExample',
      category: 'UI',
      module: require('../examples/PlatformColor/PlatformColorExample'),
    },
    {
      key: 'PointerEventsExample',
      category: 'Basic',
      module: require('../examples/PointerEvents/PointerEventsExample'),
    },
    {
      key: 'RTLExample',
      category: 'Basic',
      module: require('../examples/RTL/RTLExample'),
    },
    {
      key: 'ShareExample',
      category: 'Basic',
      module: require('../examples/Share/ShareExample'),
    },
    {
      key: 'TimerExample',
      category: 'UI',
      module: require('../examples/Timer/TimerExample'),
    },
    {
      key: 'ToastAndroidExample',
      category: 'Android',
      module: require('../examples/ToastAndroid/ToastAndroidExample'),
    },
    {
      key: 'TransformExample',
      category: 'UI',
      module: require('../examples/Transform/TransformExample'),
    },
    {
      key: 'FilterExample',
      category: 'UI',
      module: require('../examples/Filter/FilterExample'),
    },
    {
      key: 'LinearGradientExample',
      category: 'UI',
      module: require('../examples/LinearGradient/LinearGradientExample'),
    },
    {
      key: 'RadialGradientExample',
      category: 'UI',
      module: require('../examples/RadialGradient/RadialGradientExample'),
    },
    {
      key: 'BackgroundImageExample',
      category: 'UI',
      module: require('../examples/BackgroundImage/BackgroundImageExample'),
    },
    {
      key: 'MixBlendModeExample',
      category: 'UI',
      module: require('../examples/MixBlendMode/MixBlendModeExample'),
    },
    {
      key: 'VibrationExample',
      category: 'Basic',
      module: require('../examples/Vibration/VibrationExample'),
    },
    {
      key: 'WebSocketExample',
      category: 'Basic',
      module: require('../examples/WebSocket/WebSocketExample'),
    },
    {
      key: 'XHRExample',
      category: 'Basic',
      module: require('../examples/XHR/XHRExample'),
    },
    {
      key: 'TurboModuleExample',
      category: 'Basic',
      module: require('../examples/TurboModule/TurboModuleExample'),
    },
    {
      key: 'LegacyModuleExample',
      module: require('../examples/TurboModule/LegacyModuleExample'),
    },
    {
      key: 'TurboCxxModuleExample',
      category: 'Basic',
      module: require('../examples/TurboModule/TurboCxxModuleExample'),
    },
    // Basic check to detect the availability of the IntersectionObserver API.
    // $FlowExpectedError[cannot-resolve-name]
    ...(typeof IntersectionObserver === 'function'
      ? [
          {
            key: 'IntersectionObserver',
            category: 'UI',
            module: require('../examples/IntersectionObserver/IntersectionObserverIndex'),
          },
        ]
      : []),
    // Basic check to detect the availability of the MutationObserver API.
    // $FlowExpectedError[cannot-resolve-name]
    ...(typeof MutationObserver === 'function'
      ? [
          {
            key: 'MutationObserver',
            category: 'UI',
            module: require('../examples/MutationObserver/MutationObserverIndex'),
          },
        ]
      : []),
    // Basic check to detect the availability of the modern Performance API.
    ...(typeof performance.getEntries === 'function'
      ? [
          {
            key: 'PerformanceApiExample',
            category: 'Basic',
            module: require('../examples/Performance/PerformanceApiExample'),
          },
        ]
      : []),
    ...RNTesterListFbInternal.APIs,
  ] as Array<?RNTesterModuleInfo>
).filter(Boolean);

const Playgrounds: Array<RNTesterModuleInfo> = [
  {
    key: 'PlaygroundExample',
    module: require('../examples/Playground/PlaygroundExample'),
  },
];

const Modules: {[key: string]: RNTesterModule} = {};

[...APIs, ...Components, ...Playgrounds].forEach(Example => {
  Modules[Example.key] = Example.module;
});

const RNTesterList = {
  APIs,
  Components,
  Modules,
};

module.exports = RNTesterList;
