/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 */

'use strict';

import * as React from 'react';
import {useState} from 'react';
import {StyleSheet, Text, View, useColorScheme} from 'react-native';

/**
 * One demo section: a title, a sentence on what it proves, the live example,
 * and the source that produced it — collapsed by default so the screen reads
 * as a gallery, expandable when the question becomes "how".
 *
 * The code is passed in rather than derived: a string that drifts from the
 * markup is worse than no string, so each caller quotes the exact JSX/CSS it
 * renders.
 */
export function DemoSection({
  title,
  description,
  code,
  codeLabel = 'Source',
  children,
}: {
  title: string,
  description?: string,
  code?: string,
  codeLabel?: string,
  children: React.Node,
}): React.Node {
  const dark = useColorScheme() === 'dark';
  const [showCode, setShowCode] = useState(false);
  return (
    <View style={[styles.section, dark ? styles.sectionDark : null]}>
      <Text style={[styles.title, dark ? styles.titleDark : null]}>
        {title}
      </Text>
      {description != null ? (
        <Text
          style={[styles.description, dark ? styles.descriptionDark : null]}>
          {description}
        </Text>
      ) : null}
      <View style={styles.stage}>{children}</View>
      {code != null ? (
        <>
          <Text
            accessibilityRole="button"
            onPress={() => setShowCode(v => !v)}
            style={[styles.toggle, dark ? styles.toggleDark : null]}>
            {showCode ? '▾ ' : '▸ '}
            {codeLabel}
          </Text>
          {showCode ? (
            <View style={[styles.code, dark ? styles.codeDark : null]}>
              <Text style={styles.codeText}>{code}</Text>
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

/**
 * The screen-level header: what the whole demo is, once, at the top.
 */
export function DemoHeader({
  title,
  children,
}: {
  title: string,
  children: React.Node,
}): React.Node {
  const dark = useColorScheme() === 'dark';
  return (
    <View style={styles.header}>
      <Text style={[styles.headerTitle, dark ? styles.titleDark : null]}>
        {title}
      </Text>
      <Text style={[styles.description, dark ? styles.descriptionDark : null]}>
        {children}
      </Text>
    </View>
  );
}

// Every touch target on these screens is at least this tall: the iOS HIG
// minimum, and the reason a demo's own chrome must not be daintier than the
// components it is showing off.
export const MIN_TOUCH_SIZE = 44;

const styles = StyleSheet.create({
  header: {marginBottom: 20},
  headerTitle: {fontSize: 20, fontWeight: '700', color: '#101828'},
  section: {
    marginBottom: 24,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d0d5dd',
  },
  sectionDark: {borderBottomColor: '#3a3a3c'},
  title: {fontSize: 16, fontWeight: '600', color: '#101828', marginBottom: 2},
  titleDark: {color: '#f2f2f7'},
  description: {fontSize: 13, lineHeight: 18, color: '#6b6b70'},
  descriptionDark: {color: '#98989f'},
  stage: {marginTop: 12},
  toggle: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: '600',
    color: '#1570ef',
    // Touch target, not just text: the tap area is the full row height.
    minHeight: MIN_TOUCH_SIZE,
    lineHeight: MIN_TOUCH_SIZE,
  },
  toggleDark: {color: '#549eff'},
  code: {
    backgroundColor: '#0d1117',
    borderRadius: 8,
    padding: 12,
  },
  codeDark: {backgroundColor: '#000000'},
  codeText: {
    color: '#e6edf3',
    fontFamily: 'Menlo',
    fontSize: 11,
    lineHeight: 16,
  },
});
