/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import {MediaQueryList} from '../../../../react-native/Libraries/Utilities/matchMedia';
import {PageViewportContext} from '../overlay/TopLayerElement';
import * as React from 'react';

/** The document's viewport, with the same OS capabilities as Window.matchMedia. */
export function useMediaQuery(
  query: string,
  serverDefault: boolean = false,
): boolean {
  const viewport = React.useContext(PageViewportContext);
  const width = viewport?.width;
  const height = viewport?.height;
  const list = React.useMemo(
    () =>
      new MediaQueryList(
        query,
        width == null || height == null ? null : {width, height},
      ),
    [query, width, height],
  );
  const subscribe = React.useCallback(
    (listener: () => void) => {
      list.addEventListener('change', listener);
      return () => list.removeEventListener('change', listener);
    },
    [list],
  );
  const snapshot = React.useCallback(() => list.matches, [list]);
  const server = React.useCallback(() => serverDefault, [serverDefault]);
  return React.useSyncExternalStore(subscribe, snapshot, server);
}
