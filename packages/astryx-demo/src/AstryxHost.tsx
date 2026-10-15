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
import ScrollSafeAreaContext from '../../rn-tester/js/astryx/native-css/ScrollSafeArea';
import {PageViewportContext} from '../../rn-tester/js/astryx/overlay/TopLayerElement';
import type {PageViewport} from '../../expo-intrinsics/src/NativePageScroll';
import resetCss from '@astryxdesign/core/reset.css';
import {Theme} from '@astryxdesign/core/theme';
import {neutralTheme} from '@astryxdesign/theme-neutral/built';
import themeCss from '@astryxdesign/theme-neutral/theme.css';
import * as React from 'react';
import {useColorScheme, useWindowDimensions} from 'react-native';

/** Provide the Astryx theme, page canvas, document viewport and scoped env() values. */
function AstryxHost({
  children,
  fill = true,
  viewportHeight,
  onSurfaceHeight,
  onCanvasColor,
  bottomInset = 0,
  initialSize,
  viewport,
  scrollSafeArea,
}: {
  children: React.Node;
  /** Minimum page height when no document viewport has been published. */
  viewportHeight?: number | null;
  /** Called with the surface's height whenever its layout changes. */
  onSurfaceHeight?: (height: number) => void;
  /** Resolved page canvas color for the surrounding native scroll view. */
  onCanvasColor?: (color: string | null) => void;
  /** Bottom safe-area padding painted with the page's canvas. */
  bottomInset?: number;
  /** Known preview size, used before the first native layout event. */
  initialSize?: {width: number; height: number} | null;
  /** The document rectangle and environment, declared by its native page. */
  viewport?: PageViewport | null;
  /** Fill the viewport, or end at the content for a gallery or sidebar. */
  fill?: boolean;
  /** Native side controls outside this document; excludes a visible sidebar. */
  scrollSafeArea?: {left: number; right: number};
}): React.Node {
  // Resolve viewport units and responsive queries against this document's column.
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
  // Seed previews and unmeasured hosts until their document size is available.
  const windowSize = useWindowDimensions();
  const declared = viewport ??
    size ?? {
      width: windowSize.width,
      height: windowSize.height,
    };
  const documentHeight = viewport?.height ?? viewportHeight;
  const viewportWidth = declared.width;
  const viewportBlockSize = documentHeight ?? declared.height;
  const style = {
    ...(fill ? pageSurface : surface),
    ...(fill && documentHeight != null
      ? {
          minHeight: documentHeight,
          flex: 0,
          display: 'flex',
          flexDirection: 'column',
        }
      : null),
    [VIEWPORT_INLINE_SIZE]: `${declared.width}px`,
    // Use the declared height to avoid a surface-height/viewport-unit cycle.
    [VIEWPORT_BLOCK_SIZE]: `${viewportBlockSize}px`,
  };
  // Propagate the page root's background through the canvas and native insets
  // (css-backgrounds-3 §2.11.2).
  const surfaceRef = React.useRef<any>(null);
  const scheme = useColorScheme();
  const [canvasColor, setCanvasColor] = React.useState<string | null>(null);
  React.useEffect(() => {
    const color = canvasColorOf(surfaceRef.current);
    setCanvasColor(color);
    // Resolve the theme's surface color when the page has no background.
    onCanvasColor?.(color ?? backgroundColorOf(surfaceRef.current));
  }, [size, scheme, onCanvasColor]);
  const painted = {
    ...style,
    ...(fill && canvasColor != null ? {backgroundColor: canvasColor} : null),
    ...(fill && bottomInset > 0 ? {paddingBottom: bottomInset} : null),
  };
  // Keep fixed layers and CSS viewport units in the same coordinate space.
  const pageViewport = React.useMemo(
    () =>
      viewport == null
        ? {width: viewportWidth, height: viewportBlockSize}
        : {
            x: viewport.x,
            y: viewport.y,
            width: viewport.width,
            height: viewport.height,
          },
    [viewport, viewportWidth, viewportBlockSize],
  );
  return (
    <Theme theme={neutralTheme}>
      <PageViewportContext.Provider value={pageViewport}>
        <ScrollSafeAreaContext value={scrollSafeArea ?? NO_SCROLL_SAFE_AREA}>
          <div
            ref={surfaceRef}
            data-astryx-viewport="true"
            experimental_environmentSafeAreaInsets={viewport?.safeAreaInsets}
            style={painted}
            onLayout={onLayout}>
            {children}
          </div>
        </ScrollSafeAreaContext>
      </PageViewportContext.Provider>
    </Theme>
  );
}

// Keep page children stable while the screen updates its viewport.
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

const NO_SCROLL_SAFE_AREA = {left: 0, right: 0};

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
