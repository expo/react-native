/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 * @format
 */

// flowlint unsafe-getters-setters:off

import type {EventInit} from './Event';

import Event from './Event';

export interface UIEventInit extends EventInit {
  // The window the event was generated from. React Native has one, so the
  // member is kept for compatibility with code written for the web and holds
  // whatever the caller passes.
  readonly view?: unknown;
  readonly detail?: number;
}

/**
 * The base of the user-interface events (mouse, pointer, keyboard, focus),
 * as defined by UI Events: https://w3c.github.io/uievents/#interface-uievent.
 */
export default class UIEvent extends Event {
  _view: unknown;
  _detail: number;

  constructor(type: string, options?: ?UIEventInit) {
    super(type, options);
    this._view = options?.view ?? null;
    this._detail = Number(options?.detail ?? 0);
  }

  get view(): unknown {
    return this._view;
  }

  /**
   * Event-specific detail. For a `click`, the number of clicks; `0` marks an
   * activation that no pointer made, such as a keyboard's.
   */
  get detail(): number {
    return this._detail;
  }
}
