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
  ScreenScrollContext,
  useScreenScrollProvider,
} from '../../../../rn-tester/js/astryx/native-chat/ScreenScroll';
import AstryxHost from '../../../src/AstryxHost';
import {templateComponent, templateInfo} from '../../../src/templates';
import {
  Stack,
  useIsFocused,
  useLocalSearchParams,
  useRouter,
} from 'expo-router';
import * as React from 'react';
import {useHorizontalSizeClass} from '../../../src/sizeClass';
import {useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

/**
 * A template under the stack's header, scrolling as a page does; the host
 * fills the viewport so a short template still paints the whole screen. The
 * bar's button opens the template's web version in a sheet, to compare the
 * two. The scroll view keeps the system's own background, so where the page
 * ends, and the room it keeps under the bar and past its end, stay visible.
 */
export default function TemplateScreen(): React.Node {
  const {slug} = useLocalSearchParams<{slug: string}>();
  const router = useRouter();
  const info = templateInfo(slug);
  const Template = templateComponent(slug);
  // One element for the template, so the screen's own state changes (its
  // viewport measurements) re-render the host but not the page inside it
  const page = React.useMemo(() => <Template />, [Template]);
  const rendersPage = useRendersWhenShown();
  const viewport = useVisibleHeight();
  // The page renders once its viewport is known, so it renders once: the
  // viewport's size reaches every element through the CSS runtime's custom
  // properties, and a page drawn at the window's size and corrected a frame
  // later rendered all of itself twice. A screen after the first knows it from
  // its first render.
  const viewportKnown = viewport.height != null;
  // The screen's scroll view, as a page's layout asks for it: a chat holds
  // its newest message in view and returns to it (ScreenScroll.js)
  const scrollRef = React.useRef<any>(null);
  const screenScroll = useScreenScrollProvider(scrollRef);
  return (
    <>
      <Stack.Screen
        options={{
          title: info?.name ?? slug,
          unstable_headerRightItems: () => [
            {
              type: 'button',
              label: 'Web version',
              icon: {type: 'sfSymbol', name: 'safari'},
              onPress: () => router.push(`/web/${slug}`),
            },
          ],
        }}
      />
      <native:scroll
        // A template is a page of its own: the router keeps this screen when a
        // link names another template, and the new page starts at its top
        key={slug}
        ref={scrollRef}
        contentAnchor={screenScroll.contentAnchor}
        onScroll={screenScroll.onScroll}
        contentContainerStyle={viewport.height == null ? fillStyle : null}
        automaticInsets={TOP_AND_SIDES}
        onLayout={viewport.onLayout}
        onInsetChange={viewport.onInsetChange}
        edgeEffects={EDGE_EFFECTS}>
        <ScreenScrollContext value={screenScroll.value}>
          <AstryxHost
            initialSize={viewport.initialSize}
            viewportHeight={viewport.height}
            onSurfaceHeight={viewport.onSurfaceHeight}
            bottomInset={viewport.bottomInset}>
            {rendersPage && viewportKnown ? page : null}
          </AstryxHost>
        </ScreenScrollContext>
      </native:scroll>
    </>
  );
}

// The fade under the glass bar, and none at the bottom: with no bar there, the
// platform's automatic bottom effect only blurred the content under the home
// indicator
const EDGE_EFFECTS = {top: 'soft', bottom: 'hidden'};

const fillStyle = {flexGrow: 1};
type RememberedViewport = {
  windowWidth: number;
  windowHeight: number;
  frameHeight: number | null;
  insetTop: number | null;
};
let lastViewport: RememberedViewport = {
  windowWidth: 0,
  windowHeight: 0,
  frameHeight: null,
  insetTop: null,
};

function remember(
  window: {width: number; height: number},
  measured: {frameHeight?: number; insetTop?: number},
): void {
  const sameWindow =
    lastViewport.windowWidth === window.width &&
    lastViewport.windowHeight === window.height;
  lastViewport = {
    windowWidth: window.width,
    windowHeight: window.height,
    frameHeight:
      measured.frameHeight ?? (sameWindow ? lastViewport.frameHeight : null),
    insetTop: measured.insetTop ?? (sameWindow ? lastViewport.insetTop : null),
  };
}
const TOP_AND_SIDES = {top: true, bottom: false, left: true, right: true};

/**
 * The page's viewport and the room kept for the home indicator.
 *
 * The viewport is the scroll view below the bar, down to the screen's bottom
 * edge, so a page of `min-height: 100%` paints its own background under the
 * home indicator too. A page that fits draws no further and does not scroll;
 * a longer one grows by the indicator's height, painted as the page, so its
 * last line scrolls clear of the indicator over the page's own background. The keyboard's inset is the scroll view's own
 * and does not resize the page, as it does not on the web.
 */
function useVisibleHeight(): {
  height: number | null;
  bottomInset: number;
  initialSize: {width: number; height: number} | null;
  onLayout: (event: any) => void;
  onInsetChange: (event: any) => void;
  onSurfaceHeight: (height: number) => void;
} {
  // Seeded from the last template screen's measurement in this window size:
  // the bar is the same on every one, so a screen after the first renders
  // once with the right viewport instead of twice, which also halves what a
  // peek's prefetch of the screen costs. A rotation or a split view's column
  // changes the window, and a measurement from another window is not reused.
  const windowSize = useWindowDimensions();
  const seed =
    lastViewport.windowWidth === windowSize.width &&
    lastViewport.windowHeight === windowSize.height
      ? lastViewport
      : null;
  const [frameHeight, setFrameHeight] = React.useState<number | null>(
    seed?.frameHeight ?? null,
  );
  const [insetTop, setInsetTop] = React.useState<number | null>(
    seed?.insetTop ?? null,
  );
  const [surfaceHeight, setSurfaceHeight] = React.useState<number | null>(null);
  const {bottom: safeAreaBottom} = useSafeAreaInsets();
  const onLayout = React.useCallback(
    (event: any) => {
      remember(windowSize, {frameHeight: event.nativeEvent.layout.height});
      setFrameHeight(event.nativeEvent.layout.height);
    },
    [windowSize],
  );
  const onInsetChange = React.useCallback(
    (event: any) => {
      remember(windowSize, {insetTop: event.nativeEvent.inset.top});
      setInsetTop(event.nativeEvent.inset.top);
    },
    [windowSize],
  );
  const height =
    frameHeight == null || insetTop == null ? null : frameHeight - insetTop;
  const overflows =
    height != null && surfaceHeight != null && surfaceHeight > height + 0.5;
  // The surface is the window's width in a compact width only; in a split
  // view's column it is measured
  const sizeClass = useHorizontalSizeClass();
  const initialSize = React.useMemo(
    () =>
      height == null || sizeClass !== 'compact'
        ? null
        : {width: windowSize.width, height},
    [windowSize.width, height, sizeClass],
  );
  return {
    height,
    initialSize,
    bottomInset: overflows ? safeAreaBottom : 0,
    onLayout,
    onInsetChange,
    onSurfaceHeight: setSurfaceHeight,
  };
}

/**
 * Whether the screen renders its page yet. A screen the navigator preloads
 * for a peek is not shown: Expo Router mounts it when the finger lands so the
 * zoom into it has a destination, and rendering a page then competes with the
 * preview the reader is waiting for, on both threads. The page renders once the
 * screen is focused, or a moment later while the platter is up, whichever is
 * first, and stays rendered; a screen pushed directly is focused from its
 * first render.
 */
function useRendersWhenShown(): boolean {
  const isFocused = useIsFocused();
  const [shown, setShown] = React.useState(isFocused);
  React.useEffect(() => {
    if (shown) {
      return;
    }
    if (isFocused) {
      setShown(true);
      return;
    }
    const timer = setTimeout(() => setShown(true), PRELOADED_PAGE_DELAY);
    return () => clearTimeout(timer);
  }, [isFocused, shown]);
  return shown || isFocused;
}

// Past the platter's appearance, which the preview's own render decides
const PRELOADED_PAGE_DELAY = 400;
