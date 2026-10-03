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
import {StyleSheet, View} from 'react-native';

const styles = StyleSheet.create({
  container: {
    width: 260,
    borderWidth: 1,
    borderColor: '#888',
    padding: 6,
  },
  block: {
    display: 'block',
  },
  box: {
    height: 24,
    backgroundColor: '#cfe0ff',
    marginVertical: 4,
  },
  inlineBox: {
    display: 'inline-block',
    width: 24,
    height: 16,
    backgroundColor: '#ffb37f',
  },
  row: {
    flexDirection: 'row',
    marginBottom: -24,
  },
  rowBox: {
    width: 80,
    height: 30,
  },
  raised: {
    zIndex: 1,
  },
  overlap: {
    position: 'absolute',
    top: 4,
    left: 40,
    width: 60,
    height: 30,
    backgroundColor: 'rgba(127, 179, 255, 0.8)',
  },
});

export default {
  title: 'Text runs',
  category: 'UI',
  description:
    'Text written directly inside a View, without a <Text> wrapper: it lays out in line boxes the View paints itself.',
  examples: [
    {
      title: 'Text directly in a View',
      name: 'bare',
      description: 'A string child of a View renders, and wraps at its width.',
      render(): React.Node {
        return (
          <View style={styles.container}>
            Hello from a View. This sentence is long enough to wrap onto a
            second line inside the box.
          </View>
        );
      },
    },
    {
      title: 'Text around block children',
      name: 'interleaved',
      description:
        'Text before, between and after block-level children keeps its place in the flow.',
      render(): React.Node {
        return (
          <View style={styles.container}>
            Before the box.
            <View style={styles.box} />
            Between the boxes.
            <View style={styles.box} />
            After the box.
          </View>
        );
      },
    },
    {
      title: 'Paint order follows document order',
      name: 'paint-order',
      description:
        'Text authored before a positioned box paints under it; the blue box covers part of the first line.',
      render(): React.Node {
        return (
          <View style={styles.container}>
            This text is under the box.
            <View style={styles.overlap} />
          </View>
        );
      },
    },
    {
      title: 'A raised box paints over text after it',
      name: 'paint-order-z-index',
      description:
        'A positioned box with zIndex: 1 paints above the text even though the text is authored after it; the blue box covers part of the line.',
      render(): React.Node {
        return (
          <View style={styles.container}>
            <View style={[styles.overlap, styles.raised]} />
            This text is under the raised box.
          </View>
        );
      },
    },
    {
      title: 'Text paints over the boxes before it',
      name: 'paint-order-flattened',
      description:
        'The boxes sit in a row View that only lays them out, so it mounts no view of its own; the text after the row still paints over both boxes.',
      render(): React.Node {
        return (
          <View style={styles.container}>
            <View style={styles.row}>
              <View
                style={[
                  styles.rowBox,
                  {backgroundColor: 'rgba(127, 179, 255, 0.8)'},
                ]}
              />
              <View
                style={[
                  styles.rowBox,
                  {backgroundColor: 'rgba(255, 127, 127, 0.8)'},
                ]}
              />
            </View>
            This text paints over both boxes.
          </View>
        );
      },
    },
    {
      title: 'White space collapses',
      name: 'white-space',
      description:
        'Runs of spaces and newlines collapse to a single space, as CSS white-space: normal says.',
      render(): React.Node {
        return (
          <View style={styles.container}>
            {'Several     spaces\n\nand two newlines become single spaces.'}
          </View>
        );
      },
    },
    {
      title: 'Text and inline-blocks share lines',
      name: 'mixed',
      description:
        'In a block container, inline-block Views sit in the same lines as the text around them.',
      render(): React.Node {
        return (
          <View style={[styles.container, styles.block]}>
            A box <View style={styles.inlineBox} /> in the middle of a sentence,
            and another <View style={styles.inlineBox} /> near its end.
          </View>
        );
      },
    },
  ],
} as RNTesterModule;
