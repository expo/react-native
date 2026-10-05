/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

/**
 * The HTML element catalog, as a side-effect import. Lowercase JSX types
 * resolve by name through ReactNativeViewConfigRegistry, so registering a view
 * config under a tag is all a <span>, <p> or <h1> needs.
 *
 * An element is three things: a tag name, which is the registration key and
 * what `nodeName` reports; a user-agent style, merged beneath the author's so
 * an author declaration still wins; and a backing component, `inline-text` for
 * an element that folds into a line of text or `element-box` for one that
 * generates a box, chosen from the computed `display` rather than the tag.
 */

import type {UAStyle} from './uaStyles';

import {registerFrameworkElement} from './ElementRegistry';
import uaStyles, {uaStyleFor} from './uaStyles';
import {createViewConfig} from 'react-native/Libraries/NativeComponent/ViewConfig';
import {type ViewConfig} from 'react-native/Libraries/Renderer/shims/ReactNativeTypes';
import {setFallbackViewConfigResolver} from 'react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry';

const inlineTagViewConfig = {
  validAttributes: {
    isHighlighted: true,
    isPressable: true,
    maxFontSizeMultiplier: true,
  },
} as const;

function registerInlineTag(name: string) {
  registerFrameworkElement(name, () =>
    createViewConfig({
      ...inlineTagViewConfig,
      validAttributes: {...inlineTagViewConfig.validAttributes, nodeName: true},
      recordNodeName: true,
      uiViewClassName: 'inline-text',
      resolveUIViewClassName: resolveInlineElementComponent(
        'inline-text',
        uaStyleFor(name),
      ),
      uaStyle: uaStyleFor(name),
    }),
  );
}

// Bold, italic and underline are user-agent declarations, not components
registerInlineTag('b');
registerInlineTag('i');
registerInlineTag('u');
registerInlineTag('span');

// <img> is an inline replaced element. It is backed by expo-image when the Expo
// runtime is present and by the framework's Image otherwise, resolved at first
// render because the native runtime is up by then.
registerFrameworkElement('img', () => {
  // $FlowFixMe[unclear-type] the Expo runtime global has no static type here.
  // $FlowFixMe[prop-missing] `expo` is installed by expo-modules-core at runtime.
  const expoRuntime: any = globalThis.expo;
  const expoViewConfig = expoRuntime?.getViewConfig?.('ExpoImage');
  if (expoViewConfig != null) {
    return createViewConfig({
      ...expoViewConfig,
      validAttributes: {
        ...expoViewConfig.validAttributes,
        // expo-image's native side takes a list of sources
        source: {
          process: (src: unknown) =>
            src == null || Array.isArray(src) ? src : [src],
        },
        nodeName: true,
      },
      recordNodeName: true,
      uiViewClassName: 'ViewManagerAdapter_ExpoImage',
      uaStyle: uaStyleFor('img'),
    });
  }
  return createViewConfig({
    // Declare the Image machinery's load events or the reconciler rejects them
    directEventTypes: {
      topLoadStart: {registrationName: 'onLoadStart'},
      topProgress: {registrationName: 'onProgress'},
      topError: {registrationName: 'onError'},
      topLoad: {registrationName: 'onLoad'},
      topLoadEnd: {registrationName: 'onLoadEnd'},
    },
    validAttributes: {
      source: true,
      resizeMode: true,
      tintColor: {
        process: require('react-native/Libraries/StyleSheet/processColor')
          .default,
      },
    },
    uiViewClassName: 'img',
  });
});

// An inline element that renders exactly like another points at that
// component; `recordNodeName` keeps the authored tag for DOM APIs
function registerInlineAlias(name: string, uiViewClassName: string) {
  registerFrameworkElement(name, () =>
    createViewConfig({
      ...inlineTagViewConfig,
      validAttributes: {
        ...inlineTagViewConfig.validAttributes,
        nodeName: true,
      },
      recordNodeName: true,
      uiViewClassName,
      resolveUIViewClassName: resolveInlineElementComponent(
        uiViewClassName,
        uaStyleFor(name),
      ),
      uaStyle: uaStyleFor(name),
    }),
  );
}

// <br> takes part in the inline formatting context; the break itself is
// emitted by `BaseTextShadowNode` as a newline that survives white-space
// collapsing
registerInlineAlias('br', 'inline-text');
registerInlineAlias('strong', 'inline-text');
registerInlineAlias('em', 'inline-text');
// Click events already dispatch to inline elements, so <button> and <a> need
// no gesture handler to be interactive
registerInlineAlias('button', 'inline-text');
registerInlineAlias('a', 'inline-text');
registerInlineAlias('label', 'inline-text');

// A block element is a tag whose user-agent style says `display: block`,
// backed by the generic box; adding one is a row in uaStyles.js and a name here
function registerBlockElement(name: string) {
  const uaStyle = uaStyleFor(name);
  if (uaStyle.display == null) {
    uaStyle.display = 'block';
  }
  registerFrameworkElement(name, () =>
    createViewConfig({
      // List markers are generated natively by the list container, so the
      // list style properties and the `start` attribute cross as props
      validAttributes: {
        nodeName: true,
        listStyleType: true,
        listStylePosition: true,
        start: true,
      },
      recordNodeName: true,
      uiViewClassName: 'element-box',
      uaStyle,
    }),
  );
}

for (const name of [
  'div',
  'p',
  'blockquote',
  'figure',
  'figcaption',
  'pre',
  'hr',
  'section',
  'article',
  'header',
  'footer',
  'nav',
  'main',
  'aside',
  'address',
  'hgroup',
  'search',
  'menu',
  'noscript',
  'form',
  'fieldset',
  'legend',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
]) {
  registerBlockElement(name);
}

// Inline elements styled entirely by the user-agent sheet
for (const name of [
  'cite',
  'small',
  'code',
  'kbd',
  'samp',
  's',
  'del',
  'ins',
  'mark',
  'sub',
  'sup',
  'abbr',
  'q',
  'time',
  'var',
  'dfn',
  'data',
  'output',
]) {
  registerInlineAlias(name, 'inline-text');
}

// Displays whose box establishes a formatting context, so the element cannot
// fold into the surrounding inline flow; `inline` is the display that folds
const BOX_DISPLAYS = new Set([
  'flex',
  'inline-flex',
  'block',
  'inline-block',
  'grid',
  'inline-grid',
]);

// Box generation follows computed display, not the tag: a <span> is text-backed
// while it folds into an inline formatting context and box-backed when its
// display establishes one, as a browser's layout tree does
function resolveInlineElementComponent(
  uiViewClassName: string,
  uaStyle?: UAStyle,
): (props: {[string]: unknown}) => string {
  return (props: {[string]: unknown}): string => {
    // The user-agent display counts too: <button>'s inline-block comes from the
    // sheet, and a text-backed button would have nowhere to apply its padding
    const style = props?.style;
    if (style == null) {
      const uaDisplay = uaStyle?.display;
      return typeof uaDisplay === 'string' && BOX_DISPLAYS.has(uaDisplay)
        ? 'element-box'
        : uiViewClassName;
    }
    // Require lazily: a module-scope StyleSheet import forms a require cycle
    // that re-evaluates this module and registers every element twice
    // $FlowFixMe[unclear-type] a lazily-required module has no static type
    const styleSheetModule: any = require('react-native/Libraries/StyleSheet/StyleSheet');
    const flatten =
      styleSheetModule.default?.flatten ?? styleSheetModule.flatten;
    const display = flatten(style)?.display ?? uaStyle?.display;
    return typeof display === 'string' && BOX_DISPLAYS.has(display)
      ? 'element-box'
      : uiViewClassName;
  };
}

/**
 * Adjusts the user-agent default for a tag, as a design system's CSS reset
 * does. The user-agent sheet is the only global layer, so the mutation reaches
 * every screen for the rest of the session: an app-level decision, never a
 * screen-level one. A scoped reset is a style on the elements themselves.
 */
export function overrideUAStyle(tag: string, style: UAStyle) {
  const existing = uaStyles[tag];
  if (existing != null) {
    // Mutate in place: view configs captured this object by reference when the
    // element was registered
    for (const key of Object.keys(style)) {
      existing[key] = style[key];
    }
  } else {
    uaStyles[tag] = {...style};
  }
}

// Any unregistered lowercase tag is an HTMLUnknownElement: inline, unstyled,
// its content renders. The policy lives here; react-native's fallback hook is
// the mechanism. Every unknown tag shares this config, so `recordNodeName`
// keeps the authored tag.
const unknownElementViewConfig: ViewConfig = {
  uiViewClassName: 'inline-text',
  bubblingEventTypes: {},
  directEventTypes: {},
  validAttributes: {nodeName: true},
  recordNodeName: true,
};

setFallbackViewConfigResolver(name =>
  typeof name[0] === 'string' && /^[a-z]/.test(name)
    ? unknownElementViewConfig
    : null,
);

// A library defines namespaced elements through this; ElementRegistry has the
// precedence rules
export {defineReactElement} from './ElementRegistry';
