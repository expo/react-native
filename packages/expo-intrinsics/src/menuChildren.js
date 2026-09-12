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

import * as React from 'react';

/**
 * Pulls a `<menu>` out of an element's children and flattens it into commands.
 * `<menu>` is HTML's "list of commands", and an element that contains one hands
 * it to the platform, which draws it in a window the app does not own, so the
 * menu's children are data here, as `<option>` is to `<select>`. They are
 * removed from `children`, or they would lay out as a list inside the element.
 *
 * A command's `icon` is an image source in the `system:<symbol>` scheme `<img>`
 * takes. A `<menu>` nested inside the `<menu>` is a group: every command in it
 * carries the same `section`, each group renders inline, and a group whose
 * commands all carry an icon is drawn at `UIMenuElementSizeSmall`, UIKit's
 * compact row of glyphs. The row is asked for by the group, never inferred from
 * icon-only commands, so an author never drops the accessible name to get it.
 */
export function splitMenu(children: React.Node): {
  content: Array<$FlowFixMe>,
  commands: Array<$FlowFixMe>,
} {
  const content: Array<$FlowFixMe> = [];
  const commands: Array<$FlowFixMe> = [];

  const read = (item: $FlowFixMe, section: string) => {
    if (item == null || typeof item !== 'object') {
      return;
    }
    const props: {[string]: $FlowFixMe} = item.props ?? {};
    // A command's text is its children, as HTML writes a button's label
    const label = React.Children.toArray<$FlowFixMe>(props.children)
      .filter(node => typeof node === 'string' || typeof node === 'number')
      .join('');
    const icon = typeof props.icon === 'string' ? props.icon : '';
    commands.push({
      // The label stands in for a missing id, and the icon for a missing label
      id:
        typeof props.id === 'string' && props.id !== ''
          ? props.id
          : label !== ''
            ? label
            : icon,
      label,
      icon,
      section,
      disabled: props.disabled === true,
      // `destructive` has no HTML spelling
      destructive: props.destructive === true,
      onClick: props.onClick,
    });
  };

  React.Children.forEach(children, child => {
    const element: $FlowFixMe = child;
    if (
      element == null ||
      typeof element !== 'object' ||
      element.type !== 'menu'
    ) {
      content.push(child);
      return;
    }
    let groups = 0;
    React.Children.forEach(element.props?.children, command => {
      const item: $FlowFixMe = command;
      if (item != null && typeof item === 'object' && item.type === 'menu') {
        // Numbered, since nothing in the markup names a group
        const section = `g${groups++}`;
        React.Children.forEach(item.props?.children, inner =>
          read(inner, section),
        );
        return;
      }
      read(item, '');
    });
  });

  return {content, commands};
}
