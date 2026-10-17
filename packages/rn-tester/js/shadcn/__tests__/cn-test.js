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

import {cn} from '../lib/utils';

describe('cn', () => {
  it('keeps utilities that merely share a prefix but not an axis', () => {
    // `flex` is display, `flex-row` is flex-direction: prefix-based grouping
    // would drop display:flex whenever a component's own classes met a
    // consumer className.
    expect(cn('flex flex-row gap-2').split(' ').sort()).toEqual([
      'flex',
      'flex-row',
      'gap-2',
    ]);
    expect(cn('p-6 pt-0').split(' ').sort()).toEqual(['p-6', 'pt-0']);
    expect(cn('text-sm text-muted-foreground').split(' ').sort()).toEqual([
      'text-muted-foreground',
      'text-sm',
    ]);
    expect(cn('border border-input').split(' ').sort()).toEqual([
      'border',
      'border-input',
    ]);
  });

  it('collapses utilities that DO share an axis', () => {
    expect(cn('flex grid')).toBe('grid');
    expect(cn('flex-row flex-col')).toBe('flex-col');
    expect(cn('absolute relative')).toBe('relative');
    expect(cn('text-sm text-lg')).toBe('text-lg');
  });

  it('keeps a ring width next to a ring colour', () => {
    // ring-2 is a width, ring-ring is a colour: one prefix, two axes, the
    // flex/flex-row shape again. ring-offset has the same two axes.
    expect(
      cn('focus-visible:ring-2 focus-visible:ring-ring').split(' ').sort(),
    ).toEqual(['focus-visible:ring-2', 'focus-visible:ring-ring']);
    expect(
      cn('focus-visible:ring-offset-2 focus-visible:ring-offset-background')
        .split(' ')
        .sort(),
    ).toEqual([
      'focus-visible:ring-offset-2',
      'focus-visible:ring-offset-background',
    ]);
    // Same axis still collapses: widths against widths, colours against
    // colours, and the bare `ring` (the 3px default) IS a width.
    expect(cn('ring-2 ring-4')).toBe('ring-4');
    expect(cn('ring ring-0')).toBe('ring-0');
    expect(cn('ring-ring ring-blue-500')).toBe('ring-blue-500');
  });

  it('merges conflicting utilities, later wins', () => {
    expect(cn('px-4 py-2', 'px-8').split(' ').sort()).toEqual(['px-8', 'py-2']);
    expect(cn('bg-primary', false, 'bg-secondary')).toBe('bg-secondary');
    expect(cn('hover:bg-primary/90', 'hover:bg-accent')).toBe(
      'hover:bg-accent',
    );
  });
});
