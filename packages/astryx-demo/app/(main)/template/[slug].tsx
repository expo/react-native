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

/** Scroll one template beneath the native header, with its web version in a sheet. */
export default function TemplateScreen(): React.Node {
  const {slug} = useLocalSearchParams<{slug: string}>();
  const router = useRouter();
  const sidebarItems = useSidebarItems();
  const {sidebarShown} = useSidebarState();
  const info = templateInfo(slug);
  const Template = templateComponent(slug);
  // Keep the page element stable while the host updates its viewport.
  const page = React.useMemo(() => <Template />, [Template]);
  const rendersPage = useRendersWhenShown();
  const viewport = useTemplateViewport();
  const [canvasColor, setCanvasColor] = React.useState<string | null>(null);
  // Resolve CSS against the document viewport on the page's first render.
  const viewportKnown = viewport.height != null;
  // Let chat templates anchor the transcript and attach their composer.
  const scrollRef = React.useRef<any>(null);
  const screenScroll = useScreenScrollProvider(
    scrollRef,
    viewport.document?.hostSafeAreaInsets,
  );
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
        // Reset the scroll position when this screen switches templates.
        key={slug}
        ref={scrollRef}
        contentAnchor={screenScroll.contentAnchor}
        onScroll={screenScroll.onScroll}
        style={canvasColor == null ? null : {backgroundColor: canvasColor}}
        automaticInsets={TOP_AND_SIDES}
        onContentViewportChange={viewport.onContentViewportChange}
        edgeEffects={EDGE_EFFECTS}>
        <ScreenScrollContext value={screenScroll.value}>
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
            bottomInset={screenScroll.hasAccessory ? 0 : viewport.bottomInset}>
            {rendersPage && viewportKnown ? page : null}
          </AstryxHost>
        </ScreenScrollContext>
      </NativePageScroll>
      {screenScroll.accessories}
    </>
  );
}

// Fade beneath the navigation bar; leave the bottom content unobscured.
const EDGE_EFFECTS = {top: 'soft', bottom: 'hidden'};

/** Reserve the bottom safe area only when the template scrolls past the viewport. */
function useTemplateViewport() {
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
 * Defer a preloaded page until its preview appears or the screen gains focus.
 * Once rendered, keep it mounted for the transition from preview to detail.
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

// Allow the preview to render before preparing the destination page.
const PRELOADED_PAGE_DELAY = 400;

const TOP_AND_SIDES = {top: true, bottom: false, left: true, right: true};
