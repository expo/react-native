/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 */

import View from '../Components/View/View';
import StyleSheet from '../StyleSheet/StyleSheet';
import * as React from 'react';

type Props = Readonly<{
  children?: React.Node,
}>;

type State = {failed: boolean};

/**
 * Keeps a render error from ending the process, as a browser keeps a page up
 * after a script throws. Without a boundary above it, React Native reports a
 * render error as fatal: a redbox in development, a terminated app in
 * production. Errors above the surface, in native code or whatever mounted
 * it, are unaffected.
 *
 * It does not make errors quieter: React reports the error before a boundary
 * sees it, so LogBox and the global handler still receive it; only the process
 * stays alive. The fallback renders nothing, since the failed tree's state
 * cannot be trusted and a library must not draw its own chrome inside an app;
 * an app that wants a message adds a boundary of its own, which runs first
 * because it is nearer the error.
 */
class SurfaceErrorBoundary extends React.Component<Props, State> {
  state: State = {failed: false};

  static getDerivedStateFromError(): State {
    return {failed: true};
  }

  componentDidCatch() {
    /*
     * Empty but present: React treats an error as handled only if a boundary
     * defines this, and the error has already been reported by the time it
     * runs
     */
  }

  componentDidUpdate(prevProps: Props) {
    /*
     * Lets the surface come back when it is given something new to render,
     * since a latched boundary would leave the app blank. Only when the
     * children change: clearing on every update would re-render the same
     * failing tree and spin.
     */
    if (this.state.failed && prevProps.children !== this.props.children) {
      this.setState({failed: false});
    }
  }

  render(): React.Node {
    if (this.state.failed) {
      return <View style={styles.failed} />;
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  failed: {flex: 1},
});

export default SurfaceErrorBoundary;
