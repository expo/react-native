/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

import AstryxHost from './AstryxHost';
import NativePageScroll, {
  usePageViewport,
} from '../../expo-intrinsics/src/NativePageScroll';
import * as React from 'react';

/**
 * Scroll the gallery and Modifications beneath the native navigation bar.
 * The page paints the full canvas and reserves its own bottom safe area.
 */
export default function AppPage({
  children,
  fill = false,
}: {
  children: React.Node;
  fill?: boolean;
}): React.Node {
  const [viewport, onViewport] = usePageViewport();
  const [canvasColor, setCanvasColor] = React.useState<string | null>(null);
  return (
    <NativePageScroll
      edgeEffects={EDGE_EFFECTS}
      automaticInsets={PAGE_INSETS}
      onContentViewportChange={onViewport}
      style={canvasColor == null ? null : {backgroundColor: canvasColor}}>
      <AstryxHost
        fill={fill}
        viewport={viewport}
        onCanvasColor={setCanvasColor}>
        <div style={fill ? {...pageStyle, flex: 1} : pageStyle}>{children}</div>
      </AstryxHost>
    </NativePageScroll>
  );
}

const pageStyle = {
  padding: 16,
  marginBottom: 'env(safe-area-inset-bottom)',
};

const PAGE_INSETS = {bottom: false};

// Fade beneath the navigation bar; leave the bottom content unobscured.
const EDGE_EFFECTS = {top: 'soft', bottom: 'hidden'};
