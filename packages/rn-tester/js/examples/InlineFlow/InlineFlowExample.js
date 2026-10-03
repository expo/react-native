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
import {StyleSheet, Text, View} from 'react-native';

const COLORS = ['#7fb3ff', '#ffb37f', '#9fe39f', '#e3a0e8', '#f5d76e'];

function Box({
  index,
  width = 60,
  height = 40,
}: {
  index: number,
  width?: number,
  height?: number,
}): React.Node {
  return (
    <View
      style={{
        display: 'inline-block',
        width,
        height,
        backgroundColor: COLORS[index % COLORS.length],
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    display: 'block',
    width: 220,
    borderWidth: 1,
    borderColor: '#888',
  },
  wide: {
    width: 300,
  },
  flexContainer: {
    width: 220,
    borderWidth: 1,
    borderColor: '#888',
  },
  textBox: {
    display: 'inline-block',
    width: 70,
    backgroundColor: '#eee',
  },
  unclipped: {
    overflow: 'visible',
  },
  note: {
    fontSize: 12,
    color: '#555',
    marginTop: 6,
  },
});

export default {
  title: 'Inline flow',
  category: 'UI',
  description:
    'Inline-level Views in a block container lay out in line boxes: side by side, wrapping when a line is full, and aligned on a shared baseline (CSS2 §9.4.2, §10.8).',
  examples: [
    {
      title: 'Inline-blocks flow and wrap',
      name: 'flow',
      description:
        'Five 60pt inline-blocks in a 220pt block container: three fit on the first line, two wrap onto the second.',
      render(): React.Node {
        return (
          <View style={styles.container}>
            {[0, 1, 2, 3, 4].map(index => (
              <Box key={index} index={index} />
            ))}
          </View>
        );
      },
    },
    {
      title: 'Boxes align by their bottom edges',
      name: 'bottom-edges',
      description:
        'A box with no line boxes of its own sits on the baseline by its bottom edge, so boxes of different heights line up at the bottom.',
      render(): React.Node {
        return (
          <View style={styles.container}>
            <Box index={0} height={20} />
            <Box index={1} height={50} />
            <Box index={2} height={35} />
          </View>
        );
      },
    },
    {
      title: 'An inline-block aligns by its text',
      name: 'baseline',
      description:
        "An inline-block's baseline is its last line box (CSS2 §10.8.1): the gray box's text sits on the same line as the tall box's bottom edge.",
      render(): React.Node {
        return (
          <View style={[styles.container, styles.wide]}>
            <View style={styles.textBox}>
              <Text style={styles.unclipped}>Text</Text>
            </View>
            <Box index={1} width={50} height={60} />
            <View style={styles.textBox}>
              <Text style={styles.unclipped}>Two{'\n'}lines</Text>
            </View>
          </View>
        );
      },
    },
    {
      title: 'A span-like inline View flows its children',
      name: 'span-like',
      description:
        'An un-sized display: inline View whose children are all inline-level does not make a box of its own: its children join the surrounding line.',
      render(): React.Node {
        return (
          <View style={styles.container}>
            <Box index={0} />
            <View style={{display: 'inline'}}>
              <Box index={1} />
              <Box index={2} />
            </View>
            <Box index={3} />
          </View>
        );
      },
    },
    {
      title: 'Blockified in a flex container',
      name: 'blockified',
      description:
        'In a flex container an inline-level box is blockified into an ordinary flex item (css-display-3 §2.7), so these stack.',
      render(): React.Node {
        return (
          <View style={styles.flexContainer}>
            <Box index={0} />
            <Box index={1} />
          </View>
        );
      },
    },
  ],
} as RNTesterModule;
