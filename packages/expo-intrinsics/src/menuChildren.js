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
 *
 * `<menu>` is HTML's "list of commands", and an element that contains one hands
 * it to the platform — which draws it itself, in a window the app does not own.
 * So the menu's children are DATA here rather than content, exactly as
 * `<option>` is data to `<select>`: they are read out of the tree and passed as
 * a prop, and nothing is left to render.
 *
 * Removing them from `children` is the whole reason this is not optional. A
 * `<menu>` that stayed in the tree would lay out as a list INSIDE the element —
 * every command's label stacked under the content — which is what the element
 * means on the web and is not what a platform menu looks like.
 *
 * Shared by `<button>`, which opens its menu on a TAP, and by any box that has
 * asked for the platform's long press, which opens the same list on a HOLD. One
 * helper because it is one question — what commands did the author write? — and
 * only who opens them differs.
 *
 * ## The icon, and the group that decides the shape
 *
 * A command's `icon` is an image SOURCE, the same `system:<symbol>` scheme
 * `<img>` takes, so a menu and a picture say where a symbol comes from the same
 * way.
 *
 * A `<menu>` nested inside the `<menu>` is a GROUP — which is what nesting
 * already means — and every command in it carries the same `section`. The
 * platform renders each group inline, and a group whose commands ALL carry an
 * icon is drawn at `UIMenuElementSizeSmall`: UIKit's compact row of glyphs,
 * where the native chat puts its reactions.
 *
 * The row is asked for by the GROUP and never inferred from the commands, which
 * was the first rule here and was wrong twice over. `preferredElementSize` is a
 * property of a menu and says nothing about its children's titles — Apple's own
 * compact rows give each action both a title and an image. And inferring the row
 * from icon-only commands would have made an author drop the labels to get it,
 * which is the accessible name gone: a row of six reactions VoiceOver cannot
 * read. Write both, and the glyph is drawn while the word is spoken.
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
    // A command's text is its children, the way HTML writes a button's label.
    const label = React.Children.toArray<$FlowFixMe>(props.children)
      .filter(node => typeof node === 'string' || typeof node === 'number')
      .join('');
    const icon = typeof props.icon === 'string' ? props.icon : '';
    commands.push({
      /*
       * An icon-only command still needs an identity, and a labelled one should
       * not have to repeat itself — so the label stands in, and the icon after
       * it, before an author is asked to write an id.
       */
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
      // `destructive` has no HTML spelling, so it is read from the ARIA-ish
      // hint an author would reach for anyway.
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
        // A nested `<menu>` is a group. Numbered rather than named, because
        // nothing in the markup names it and the platform only needs to know
        // which commands belong together.
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
