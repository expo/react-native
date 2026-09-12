/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import FormContext from './FormContext';
import {splitMenu} from './menuChildren';
import * as React from 'react';
import {Platform} from 'react-native';

// HTML's default `type` is `submit`: a `<button>` inside a `<form>` submits it
// with no `onClick`, and code that does not want that writes `type="button"`

type ButtonProps = {
  children?: React.Node,
  type?: string,
  onClick?: (event: $FlowFixMe) => unknown,
  onPressChange?: (event: $FlowFixMe) => unknown,
  style?: $FlowFixMe,
  // Read here, not only passed through: a stated material decides whether the
  // platform's chrome is kept
  appleVisualEffect?: string,
  ...
};

function Button({
  children,
  type = 'submit',
  onClick,
  style,
  onPressChange,
  appleVisualEffect,
  ...rest
}: ButtonProps): React.Node {
  const form = React.useContext(FormContext);
  const {content, commands} = React.useMemo(
    () => splitMenu(children),
    [children],
  );

  // A chosen command is dispatched to its own `onClick`, so each `<button>`
  // inside the `<menu>` carries its handler as it would anywhere else
  const handleCommand = React.useCallback(
    (event: $FlowFixMe) => {
      const id = event?.nativeEvent?.id;
      const command = commands.find(candidate => candidate.id === id);
      command?.onClick?.(event);
    },
    [commands],
  );

  // The press is reported here for authors and `:active`, and drawn natively
  // (the dim in `EXPElementButtonComponentView`, the ripple in
  // `ElementButtonView`), so no render sits between the finger landing and
  // the feedback
  const handlePressChange = React.useCallback(
    (event: $FlowFixMe) => {
      onPressChange?.(event);
    },
    [onPressChange],
  );

  const handleClick = React.useCallback(
    (event: $FlowFixMe) => {
      onClick?.(event);
      // After the author's handler, which is the DOM's order: that is what
      // lets a handler cancel the submission.
      if (event?.defaultPrevented === true) {
        return;
      }
      if (type === 'submit') {
        form?.submit();
      } else if (type === 'reset') {
        form?.reset();
      }
    },
    [form, onClick, type],
  );

  return (
    // $FlowFixMe[prop-missing] intrinsic
    <element-button-box
      {...rest}
      /* Destructured above to be read, so it is put back */
      appleVisualEffect={appleVisualEffect}
      nodeName="button"
      type={type}
      buttonStyle={buttonProminence(type, form != null)}
      // `borderRadius` counts as claiming the surface, but a round glass button
      // shapes the platform's glass rather than replacing it, so a stated
      // material wins. Only on iOS, where `-apple-visual-effect` means something;
      // elsewhere the author's own box is all there is to go on.
      hasAuthorChrome={
        (Platform.OS !== 'ios' || appleVisualEffect == null) &&
        authorStatesSurface(style)
      }
      style={style}
      onPressChange={handlePressChange}
      onCommand={handleCommand}
      menuCommands={commands.length > 0 ? commands : undefined}
      onClick={handleClick}>
      {content}
    </element-button-box>
  );
}

// A submit button inside a form is the primary action and wears the platform's
// filled style; everything else wears the neutral one (UIKit gray, Material
// tonal)
export function buttonProminence(type: string, inForm: boolean): string {
  return type === 'submit' && inForm ? 'prominent' : 'neutral';
}

// The platform draws its chrome only for a button whose surface the author
// has not claimed with a background or border; both platform views read this
const SURFACE_KEYS = [
  'backgroundColor',
  'borderWidth',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderStartWidth',
  'borderEndWidth',
  'borderColor',
  'borderRadius',
];

export function authorStatesSurface(style: unknown): boolean {
  if (style == null) {
    return false;
  }
  if (Array.isArray(style)) {
    return style.some(entry => authorStatesSurface(entry));
  }
  if (typeof style !== 'object') {
    return false;
  }
  const asObject: {[string]: unknown} = style as $FlowFixMe;
  /*
   * `appearance: 'none'` — CSS's own switch for exactly this. It is the
   * standard property a web author already uses to take over a control's
   * rendering (css-ui-4 §7), so it is honoured here before any inference:
   * stating it dismisses the platform chrome even with no background of the
   * author's own. The inference below remains for the common case, where an
   * author who paints a surface never says the word.
   */
  if (asObject.appearance === 'none') {
    return true;
  }
  return SURFACE_KEYS.some(key => asObject[key] != null);
}

export default Button;
