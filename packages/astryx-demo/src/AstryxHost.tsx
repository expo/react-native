/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

import {
  VIEWPORT_BLOCK_SIZE,
  VIEWPORT_INLINE_SIZE,
  installStylesheet,
} from '../../rn-tester/js/astryx/css';
import resetCss from '@astryxdesign/core/reset.css';
import {Theme} from '@astryxdesign/core/theme';
import {neutralTheme} from '@astryxdesign/theme-neutral/built';
import themeCss from '@astryxdesign/theme-neutral/theme.css';
import * as React from 'react';
import {useColorScheme, useWindowDimensions} from 'react-native';

/**
 * What Astryx's own template viewer wraps a template in, minus one thing.
 *
 * The templates render transparent, content only, and the viewer's frame
 * supplies the page: the theme's surface colour behind them, filling the
 * screen (or the preview platter), as `TemplatePreviewSurface` does on the
 * docsite. Without it a template with no painted root, like Blank, shows the
 * stack's grey and peeks as text floating over the dimmed grid.
 *
 * The viewer also mounts `LayerProvider`, whose toast viewport promotes itself
 * to the top layer by moving its own host node (`parent.appendChild(host)`)
 * into the latest open dialog. This platform's elements cannot be re-parented
 * from JavaScript, so the viewport is left out: layers (popovers, menus,
 * dialogs) render as under the default provider, which is what the source
 * does when no provider is mounted, and toasts have no viewport until the
 * fork's top layer hosts one. None of the shipped templates raise a toast.
 */
function AstryxHost({
  children,
  fill = true,
  viewportHeight,
  onSurfaceHeight,
  onCanvasColor,
  bottomInset = 0,
  initialSize,
}: {
  children: React.Node;
  /**
   * The height of the page's viewport, when the container's own height is
   * not it: a scroll view's frame runs under the bar and the home indicator,
   * and a surface of `min-height: 100%` there resolved against the whole
   * frame. Given, the surface is at least that tall, and the page root fills
   * it and grows past it with a longer page.
   */
  viewportHeight?: number | null;
  /** Called with the surface's height whenever its layout changes. */
  onSurfaceHeight?: (height: number) => void;
  /**
   * Called with the page root's background colour, or null when it has none,
   * for whatever paints around the page; see `canvasColorOf`.
   */
  onCanvasColor?: (color: string | null) => void;
  /**
   * Room the page keeps below its content, painted as the page: a scrolling
   * page ends with the home indicator's height of its own background rather
   * than of whatever lies behind it.
   */
  bottomInset?: number;
  /**
   * The surface's size when the caller knows it before layout (a preview of a
   * stated size): declared from the first render, so the measurement that
   * follows changes nothing and the page renders once rather than twice.
   */
  initialSize?: {width: number; height: number} | null;
  /**
   * Whether the surface is at least as tall as its container, as a page is
   * (the default); `false` for a surface that ends where its content does,
   * such as a list the screen scrolls, where a full-height surface would add
   * the header's worth of blank page below the last row.
   */
  fill?: boolean;
}): React.Node {
  // The surface is the template's viewport: its size, once laid out, is what
  // the template's media queries, viewport units and unsized container units
  // read, so a page in a split view's column sizes to the column rather than
  // the window (the CSS engine reads these two custom properties)
  const [size, setSize] = React.useState<{
    width: number;
    height: number;
  } | null>(initialSize ?? null);
  const onLayout = React.useCallback(
    (event: any) => {
      const {width, height} = event.nativeEvent.layout;
      onSurfaceHeight?.(height);
      setSize(previous =>
        previous != null &&
        previous.width === width &&
        previous.height === height
          ? previous
          : {width, height},
      );
    },
    [onSurfaceHeight],
  );
  // Declared from the first render, with the window's size until the surface
  // has one: the CSS runtime opens a custom-property scope only for an
  // element that declares some, so a surface that began declaring them after
  // its first layout wrapped the page in a new provider and remounted all of
  // it, and every picture on it reloaded
  const windowSize = useWindowDimensions();
  const declared = size ?? {
    width: windowSize.width,
    height: windowSize.height,
  };
  const style = {
    ...(fill ? pageSurface : surface),
    ...(fill && viewportHeight != null
      ? {
          minHeight: viewportHeight,
          flex: 0,
          display: 'flex',
          flexDirection: 'column',
        }
      : null),
    [VIEWPORT_INLINE_SIZE]: `${declared.width}px`,
    // The viewport's height where it is known rather than the surface's: a
    // page of `height: 100dvh` sized the surface, whose height then defined
    // `dvh`, so a page that began at the window's height stayed that tall and
    // scrolled its top under the bar
    [VIEWPORT_BLOCK_SIZE]: `${viewportHeight ?? declared.height}px`,
  };
  // The page root's background is the canvas's, as a browser propagates the
  // root element's background to the whole canvas (css-backgrounds-3 §2.11.2):
  // a grey sign-in page stays grey past its content and under the home
  // indicator, instead of ending in a strip of the surface's white
  const surfaceRef = React.useRef<any>(null);
  const scheme = useColorScheme();
  const [canvasColor, setCanvasColor] = React.useState<string | null>(null);
  React.useEffect(() => {
    const color = canvasColorOf(surfaceRef.current);
    setCanvasColor(color);
    // The surface's own colour otherwise, resolved here inside the theme,
    // which a view outside it cannot resolve
    onCanvasColor?.(color ?? backgroundColorOf(surfaceRef.current));
  }, [size, scheme, onCanvasColor]);
  const painted = {
    ...style,
    ...(fill && canvasColor != null ? {backgroundColor: canvasColor} : null),
    ...(fill && bottomInset > 0 ? {paddingBottom: bottomInset} : null),
  };
  return (
    <Theme theme={neutralTheme}>
      <div
        ref={surfaceRef}
        data-astryx-viewport="true"
        style={painted}
        onLayout={onLayout}>
        {children}
      </div>
    </Theme>
  );
}

// Memoized: a screen's own state changes (its viewport measurements) would
// otherwise re-render the host, and a host element's re-render re-renders
// every element inside it through the CSS runtime, which re-marks its
// children; the props are primitives, stable callbacks and a memoized element
export default React.memo(AstryxHost);

// The resolved background colour of the surface's first element, when it
// paints one
function canvasColorOf(surfaceElement: any): string | null {
  return backgroundColorOf(surfaceElement?.childNodes?.[0]);
}

// An element's resolved background colour, when it paints one
function backgroundColorOf(element: any): string | null {
  if (element == null || typeof globalThis.getComputedStyle !== 'function') {
    return null;
  }
  const color = globalThis.getComputedStyle(element).backgroundColor;
  return typeof color === 'string' &&
    color !== '' &&
    color !== 'transparent' &&
    !/^rgba\(.*,\s*0\)$/.test(color)
    ? color
    : null;
}

const surface = {
  backgroundColor: 'var(--color-background-surface)',
  color: 'var(--color-text)',
};

// A page: at least the container's height, so a short template still paints
// the whole screen (and `flex: 1` so it fills a flex column too)
const pageSurface = {
  ...surface,
  flex: 1,
  minHeight: '100%',
};

// Astryx's reset, which the docsite imports globally: among its rules, an
// `<img>` is block-level, so an image inside a block is laid out as a box
// rather than as a text attachment; AspectRatio's child sizing lives here too
installStylesheet(resetCss);
// The built theme's stylesheet, which a built theme (`__built`) expects its
// consumer to import rather than injecting at runtime
installStylesheet(themeCss);

// The docsite's `.viewport > :first-child` rule: a page's root is the
// viewport's height, so a `Layout` of height "fill" can be the viewport. Where
// the surface is a flex column of the viewport's minimum height (a template
// screen), the root grows to fill it and never shrinks below its content: a
// longer page grows past the viewport into the screen's scroll view, as the
// docsite's frame scrolls it, rather than squeezing its flex items over each
// other, which a fixed height let Yoga do (its flex items have no
// `min-height: auto`)
installStylesheet(`
[data-astryx-viewport] > :first-child {
  height: 100%;
  min-height: 100%;
  flex-grow: 1;
  flex-shrink: 0;
}
`);
