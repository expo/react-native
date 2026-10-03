/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

'use strict';

import type {RNTesterModule} from '../../types/RNTesterTypes';

import * as React from 'react';
import {useState} from 'react';
import {Button, StyleSheet, Text, View} from 'react-native';

const styles = StyleSheet.create({
  container: {
    width: 280,
    borderWidth: 1,
    borderColor: '#888',
    padding: 6,
    gap: 4,
  },
  styled: {
    color: '#b3261e',
    fontSize: 20,
    fontStyle: 'italic',
  },
  inner: {
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 4,
  },
});

function ToggleColor(): React.Node {
  const [blue, setBlue] = useState(false);
  return (
    <View style={styles.container}>
      <View style={{color: blue ? '#1a5fb4' : '#2e7d32', fontSize: 18}}>
        <View style={styles.inner}>
          This text inherits its color from two Views up.
        </View>
      </View>
      <Button
        title={blue ? 'Make it green' : 'Make it blue'}
        onPress={() => setBlue(value => !value)}
      />
    </View>
  );
}

export default {
  title: 'Text inheritance',
  category: 'UI',
  description:
    'Inheritable text styles set on a View apply to the text inside it, and the CSS `all` property stops or restarts that inheritance.',
  examples: [
    {
      title: 'Text inherits from its Views',
      name: 'inherit',
      description:
        'color, fontSize and fontStyle are set on the outer View; the text two Views down picks them up.',
      render(): React.Node {
        return (
          <View style={[styles.container, styles.styled]}>
            <View style={styles.inner}>Inherited from the outer View.</View>
          </View>
        );
      },
    },
    {
      title: 'A change reaches text that did not change',
      name: 'update',
      description:
        'Changing an ancestor’s color restyles text below it, even though nothing between them re-renders.',
      render(): React.Node {
        return <ToggleColor />;
      },
    },
    {
      title: "`all: 'initial'` stops inheritance",
      name: 'all-initial',
      description:
        "The inner View declares `all: 'initial'`, so its text starts again from the default style.",
      render(): React.Node {
        return (
          <View style={[styles.container, styles.styled]}>
            Inherits the red italic style.
            <View style={[styles.inner, {all: 'initial'}]}>
              Back to the default style.
            </View>
          </View>
        );
      },
    },
    {
      title: '<Text> does not inherit by default',
      name: 'text-boundary',
      description:
        "A root <Text> keeps React Native's isolated styling: its user-agent style is `all: 'initial'`. `all: 'unset'` opts it in.",
      render(): React.Node {
        return (
          <View style={[styles.container, styles.styled]}>
            <Text>A plain {'<Text>'} keeps its own default style.</Text>
            <Text style={{all: 'unset'}}>
              {"<Text style={{all: 'unset'}}>"} inherits the red italic style.
            </Text>
          </View>
        );
      },
    },
  ],
} as RNTesterModule;
