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
 * Keeps a render error from ending the process.
 *
 * A browser does not stop because a script threw. It reports the exception and
 * carries on, and the page a user was looking at is still there. React has no
 * such floor: an error thrown while rendering unmounts the tree, and with
 * nothing above it to catch, React Native reports it as fatal — a redbox in
 * development and a terminated app in production. So a single mistake in one
 * component, of the ordinary kind that happens while writing a screen, closes
 * the app.
 *
 * That is the gap this closes, at the root of every surface. Errors above the
 * surface — in native code, or in whatever mounted it — are not ours to catch,
 * and are unaffected.
 *
 * **It does not make errors quieter.** React reports an error to the console
 * before a boundary sees it, so LogBox still shows it in development and the
 * global handler still receives it in production. The change is only that the
 * process stays alive to show it. A caught error is not a handled one, and a
 * surface rendering the fallback below is broken and should be treated that
 * way; what it must not do is take the app down with it.
 *
 * **What a user sees.** Deliberately nothing. Once the tree has failed, its
 * state cannot be trusted, and anything drawn here would be this library's
 * chrome appearing unbidden inside somebody's product. An empty surface is
 * honest and lets the app decide what to show — a boundary of its own, above
 * whatever it renders, is what an app that wants a message should use, and it
 * will run first because it is nearer the error.
 */
class SurfaceErrorBoundary extends React.Component<Props, State> {
  state: State = {failed: false};

  static getDerivedStateFromError(): State {
    return {failed: true};
  }

  componentDidCatch() {
    /*
     * Deliberately empty, and deliberately present.
     *
     * React only treats an error as handled if a boundary defines this — with
     * `getDerivedStateFromError` alone the error is re-reported as uncaught and
     * the app still dies, which is the whole thing being prevented. The report
     * itself has already happened by the time this runs, so there is nothing to
     * add here; logging again would just print every failure twice.
     */
  }

  componentDidUpdate(prevProps: Props) {
    /*
     * Lets the surface come back when it is given something new to render.
     *
     * A boundary latches by design, and left latched it would turn every error
     * into a permanently blank app — not a crash, but no better than one, and
     * harder to explain. A failure is often in one screen's props or state, so
     * the next navigation or the next store update is a genuine chance to
     * recover.
     *
     * Recovery is offered only when the children actually change, which is the
     * signal that something outside has moved on. Clearing on every update
     * would re-render the same failing tree immediately and spin: throw, catch,
     * clear, throw.
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
