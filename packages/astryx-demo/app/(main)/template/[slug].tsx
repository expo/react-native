/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

import AstryxHost from '../../../src/AstryxHost';
import {useSidebarItems, useSidebarState} from '../../../src/sizeClass';
import NativePageScroll, {
  usePageViewport,
} from '../../../../expo-intrinsics/src/NativePageScroll';
import {templateComponent, templateInfo} from '../../../src/templates';
import {
  Stack,
  useIsFocused,
  useLocalSearchParams,
  useRouter,
} from 'expo-router';
import * as React from 'react';

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
  const sidebarItems = useSidebarItems();
  const {sidebarShown} = useSidebarState();
  const info = templateInfo(slug);
  const Template = templateComponent(slug);
  // One element for the template, so the screen's own state changes (its
  // viewport measurements) re-render the host but not the page inside it
  const page = React.useMemo(() => <Template />, [Template]);
  const rendersPage = useRendersWhenShown();
  const viewport = useVisibleHeight();
  const [canvasColor, setCanvasColor] = React.useState<string | null>(null);
  // Render the document once its own viewport is known, so CSS does not
  // first lay it out at the unrelated window size or a previous column size.
  const viewportKnown = viewport.height != null;
  // The screen's scroll view, as a page's layout asks for it: a chat holds
  // its newest message in view and returns to it (ScreenScroll.js)
  const scrollRef = React.useRef<any>(null);
  return (
    <>
      <Stack.Screen
        options={{
          title: info?.name ?? slug,
          unstable_headerRightItems: () => [
            ...sidebarItems,
            {
              type: 'button',
              label: 'Web version',
              icon: {type: 'sfSymbol', name: 'safari'},
              onPress: () => router.push(`/web/${slug}`),
            },
          ],
        }}
      />
      <NativePageScroll
        // A template is a page of its own: the router keeps this screen when a
        // link names another template, and the new page starts at its top
        key={slug}
        ref={scrollRef}
        style={canvasColor == null ? null : {backgroundColor: canvasColor}}
        contentContainerStyle={[
          viewport.height == null ? fillStyle : null,
          canvasColor == null ? null : {backgroundColor: canvasColor},
        ]}
        automaticInsets={TOP_AND_SIDES}
        onContentViewportChange={viewport.onContentViewportChange}
        edgeEffects={EDGE_EFFECTS}>
        <AstryxHost
          viewport={viewport.document}
          scrollSafeArea={{
            left: sidebarShown
              ? 0
              : (viewport.document?.hostSafeAreaInsets.left ?? 0),
            right: viewport.document?.hostSafeAreaInsets.right ?? 0,
          }}
          viewportHeight={viewport.height}
          onCanvasColor={setCanvasColor}
          onSurfaceHeight={viewport.onSurfaceHeight}
          // A dock reserves the home indicator in the scroll view already.
          bottomInset={viewport.bottomInset}>
          {rendersPage && viewportKnown ? page : null}
        </AstryxHost>
      </NativePageScroll>
    </>
  );
}

// The fade under the glass bar, and none at the bottom: with no bar there, the
// platform's automatic bottom effect only blurred the content under the home
// indicator
const EDGE_EFFECTS = {top: 'soft', bottom: 'hidden'};

const fillStyle = {flexGrow: 1};
/** The page is a document in the native viewport, rather than the window. */
function useVisibleHeight() {
  const [document, onContentViewportChange] = usePageViewport();
  const [surfaceHeight, setSurfaceHeight] = React.useState<number | null>(null);
  const height = document?.height ?? null;
  const overflows =
    height != null && surfaceHeight != null && surfaceHeight > height + 0.5;
  return {
    document,
    height,
    bottomInset: overflows ? (document?.safeAreaInsets.bottom ?? 0) : 0,
    onContentViewportChange,
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

const TOP_AND_SIDES = {top: true, bottom: false, left: true, right: true};
