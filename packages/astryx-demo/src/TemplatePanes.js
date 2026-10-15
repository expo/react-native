/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

import {useWindowLayoutActions} from './sizeClass';
import {requireNativeViewManager} from 'expo-modules-core';
import * as React from 'react';
import {StyleSheet, View} from 'react-native';
import {Split} from 'react-native-screens/experimental';

const SplitPolicy = requireNativeViewManager('TemplateWeb', 'SplitPolicy');

/** UIKit owns both column frames and the animation between device postures. */
export default function TemplatePanes({sidebar, children, backgroundColor}) {
  const {onModeChange, onDisplayModeWillChange, policyRef} =
    useWindowLayoutActions();
  return (
    <Split.Host
      onDisplayModeWillChange={onDisplayModeWillChange}
      preferredDisplayMode="secondaryOnly"
      topColumnForCollapsing="secondary"
      displayModeButtonVisibility="never">
      <Split.Column>
        <View
          testID="template-sidebar"
          style={[styles.fill, {backgroundColor}]}>
          {sidebar}
        </View>
      </Split.Column>
      <Split.Column>
        <View testID="template-detail" style={styles.fill}>
          <SplitPolicy
            ref={policyRef}
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            onModeChange={onModeChange}
          />
          {children}
        </View>
      </Split.Column>
    </Split.Host>
  );
}

const styles = StyleSheet.create({fill: {flex: 1, minWidth: 0, minHeight: 0}});
