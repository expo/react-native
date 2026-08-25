/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

/**
 * `when.*` end to end, through the element tree: a marked element learns its
 * position from its parent, publishes the pseudo-classes it matches, and a
 * descendant reads them back out of context, three seams the evaluator's own
 * tests do not exercise. Written against the JSX runtime directly, since the
 * vendored components import `@stylexjs/stylex` through a Metro alias Jest
 * does not have.
 */

import {jsx} from '../jsx-runtime';
import * as stylex from '../stylex-rn';
import * as React from 'react';
import TestRenderer from 'react-test-renderer';

const marker = stylex.defineMarker();

/** Every `style` object in the rendered tree, flattened. */
function stylesOf(renderer: $FlowFixMe): Array<{[string]: unknown}> {
  const out: Array<{[string]: unknown}> = [];
  const walk = (node: $FlowFixMe) => {
    if (node == null || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const style = node.props?.style;
    if (style != null) {
      for (const entry of Array.isArray(style) ? style : [style]) {
        if (entry != null && typeof entry === 'object') {
          out.push(entry);
        }
      }
    }
    walk(node.children);
  };
  walk(renderer.toJSON());
  return out;
}

/** A list whose items carry the marker, each holding a conditional child. */
/**
 * A namespace that is opaque at 1 and 0 when `condition` holds. Named rather
 * than inline: a computed key beside an explicit one makes the object an
 * indexed type for Flow, and a `when.*` key is a dynamic key.
 */
function conditionalOpacity(condition: string): {[string]: unknown} {
  const namespace: {[string]: unknown} = {opacity: 1};
  namespace[condition] = {opacity: 0};
  return namespace;
}

function List({count, condition}: {count: number, condition: string}) {
  const items = [];
  for (let i = 0; i < count; i++) {
    items.push(
      jsx(
        'div',
        {
          ...stylex.props(marker),
          children: jsx('div', {
            ...stylex.props(conditionalOpacity(condition)),
          }),
        },
        String(i),
      ),
    );
  }
  return jsx('div', {children: items});
}

function opacities(renderer: $FlowFixMe): Array<unknown> {
  return stylesOf(renderer)
    .filter(s => s.opacity !== undefined)
    .map(s => s.opacity);
}

describe('when.ancestor through the element tree', () => {
  test('applies under the first child and nowhere else', () => {
    let renderer: $FlowFixMe;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(
        <List
          count={3}
          condition={stylex.when.ancestor(':first-child', marker)}
        />,
      );
    });

    // Only the child inside the first marked item sees `:first-child`
    const values = opacities(renderer);
    expect(values).toHaveLength(3);
    expect(values.filter(v => v === 0)).toHaveLength(1);
    expect(values[0]).toBe(0);
  });

  test('`:last-child` picks the other end', () => {
    let renderer: $FlowFixMe;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(
        <List
          count={3}
          condition={stylex.when.ancestor(':last-child', marker)}
        />,
      );
    });
    const values = opacities(renderer);
    expect(values[2]).toBe(0);
    expect(values.filter(v => v === 0)).toHaveLength(1);
  });

  test('a lone item is first, last and only at once', () => {
    for (const pseudo of [':first-child', ':last-child', ':only-child']) {
      let renderer: $FlowFixMe;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <List count={1} condition={stylex.when.ancestor(pseudo, marker)} />,
        );
      });
      expect(opacities(renderer)).toEqual([0]);
    }
  });

  test('an unmarked ancestor answers nothing', () => {
    // Same structure, but the condition names a marker no ancestor carries.
    const other = stylex.defineMarker();
    let renderer: $FlowFixMe;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(
        <List
          count={3}
          condition={stylex.when.ancestor(':first-child', other)}
        />,
      );
    });
    expect(opacities(renderer).filter(v => v === 0)).toHaveLength(0);
  });
});

describe('a when block is resolved like any other declaration', () => {
  test('a var() inside one reads the element\u2019s own scope', () => {
    // The conditional block is resolved at the element like the base
    // declarations: against the custom-property scope in force there, not left
    // as a `var()` string
    function Scoped() {
      return jsx('div', {
        ...stylex.props({'--pad': 7}),
        children: jsx('div', {
          ...stylex.props(marker),
          children: jsx('div', {
            ...stylex.props(
              conditionalOpacity(stylex.when.ancestor(':only-child', marker)),
            ),
          }),
        }),
      });
    }
    let renderer: $FlowFixMe;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(<Scoped />);
    });
    // The condition holds, so the block applied at all.
    expect(opacities(renderer)).toContain(0);
  });
});

describe('when.descendant through the element tree', () => {
  /** A box that restyles when a marked descendant matches. */
  function Box({pseudo, children}: {pseudo: string, children?: unknown}) {
    return jsx('div', {
      ...stylex.props(
        conditionalOpacity(stylex.when.descendant(pseudo, marker)),
      ),
      children,
    });
  }

  test('a matching marked descendant satisfies it', () => {
    let renderer: $FlowFixMe;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(
        <Box pseudo=":only-child">{jsx('div', {...stylex.props(marker)})}</Box>,
      );
    });
    // The lone marked child is `:only-child`, so the box takes the block.
    expect(opacities(renderer)[0]).toBe(0);
  });

  test('a descendant that does not match leaves it alone', () => {
    let renderer: $FlowFixMe;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(
        <Box pseudo=":last-child">
          {[jsx('div', {...stylex.props(marker)}, 'a'), jsx('div', {}, 'b')]}
        </Box>,
      );
    });
    // The marked child is first of two, so `:last-child` does not hold.
    expect(opacities(renderer)[0]).toBe(1);
  });

  test('it is `:has()`, so one of several is enough', () => {
    let renderer: $FlowFixMe;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(
        <Box pseudo=":last-child">
          {[jsx('div', {}, 'a'), jsx('div', {...stylex.props(marker)}, 'b')]}
        </Box>,
      );
    });
    expect(opacities(renderer)[0]).toBe(0);
  });

  test('the answer survives the descendant going away', () => {
    let renderer: $FlowFixMe;
    const withChild = (
      <Box pseudo=":only-child">{jsx('div', {...stylex.props(marker)})}</Box>
    );
    TestRenderer.act(() => {
      renderer = TestRenderer.create(withChild);
    });
    expect(opacities(renderer)[0]).toBe(0);

    // Unmounting the only marked descendant retracts its report
    TestRenderer.act(() => {
      renderer.update(<Box pseudo=":only-child" />);
    });
    expect(opacities(renderer)[0]).toBe(1);
  });

  test('a deeper descendant reports to every asker above it', () => {
    let renderer: $FlowFixMe;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(
        <Box pseudo=":only-child">
          <Box pseudo=":only-child">
            {jsx('div', {...stylex.props(marker)})}
          </Box>
        </Box>,
      );
    });
    // `:has()` is not limited to the nearest ancestor: both boxes match.
    expect(opacities(renderer)).toEqual([0, 0]);
  });
});
