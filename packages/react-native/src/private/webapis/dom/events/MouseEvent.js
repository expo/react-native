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

import type EventTarget from './EventTarget';
import type {UIEventInit} from './UIEvent';

import UIEvent from './UIEvent';

export interface MouseEventInit extends UIEventInit {
  readonly screenX?: number;
  readonly screenY?: number;
  readonly clientX?: number;
  readonly clientY?: number;
  readonly ctrlKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
  readonly button?: number;
  readonly buttons?: number;
  readonly relatedTarget?: EventTarget | null;
}

/**
 * A mouse event, as defined by UI Events:
 * https://w3c.github.io/uievents/#interface-mouseevent. Code written for the
 * web dispatches one to stand in for a click that no pointer made (a menu row
 * activated by a key or a press), and reads a pointer event through its
 * members; the pointer events the renderer dispatches carry the same members.
 */
export default class MouseEvent extends UIEvent {
  _screenX: number;
  _screenY: number;
  _clientX: number;
  _clientY: number;
  _ctrlKey: boolean;
  _shiftKey: boolean;
  _altKey: boolean;
  _metaKey: boolean;
  _button: number;
  _buttons: number;
  _relatedTarget: EventTarget | null;

  constructor(type: string, options?: ?MouseEventInit) {
    super(type, options);
    this._screenX = Number(options?.screenX ?? 0);
    this._screenY = Number(options?.screenY ?? 0);
    this._clientX = Number(options?.clientX ?? 0);
    this._clientY = Number(options?.clientY ?? 0);
    this._ctrlKey = Boolean(options?.ctrlKey);
    this._shiftKey = Boolean(options?.shiftKey);
    this._altKey = Boolean(options?.altKey);
    this._metaKey = Boolean(options?.metaKey);
    this._button = Number(options?.button ?? 0);
    this._buttons = Number(options?.buttons ?? 0);
    this._relatedTarget = options?.relatedTarget ?? null;
  }

  get screenX(): number {
    return this._screenX;
  }

  get screenY(): number {
    return this._screenY;
  }

  get clientX(): number {
    return this._clientX;
  }

  get clientY(): number {
    return this._clientY;
  }

  // CSSOM View's aliases: https://drafts.csswg.org/cssom-view/#extensions-to-the-mouseevent-interface.
  // The page is the viewport here, so the page coordinates are the client
  // coordinates.
  get x(): number {
    return this._clientX;
  }

  get y(): number {
    return this._clientY;
  }

  get pageX(): number {
    return this._clientX;
  }

  get pageY(): number {
    return this._clientY;
  }

  get ctrlKey(): boolean {
    return this._ctrlKey;
  }

  get shiftKey(): boolean {
    return this._shiftKey;
  }

  get altKey(): boolean {
    return this._altKey;
  }

  get metaKey(): boolean {
    return this._metaKey;
  }

  get button(): number {
    return this._button;
  }

  get buttons(): number {
    return this._buttons;
  }

  get relatedTarget(): EventTarget | null {
    return this._relatedTarget;
  }

  getModifierState(keyArg: string): boolean {
    switch (keyArg) {
      case 'Alt':
        return this._altKey;
      case 'Control':
        return this._ctrlKey;
      case 'Meta':
        return this._metaKey;
      case 'Shift':
        return this._shiftKey;
      default:
        return false;
    }
  }
}
