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
import * as React from 'react';

/**
 * `<button>` — the box, plus the thing everyone forgets: inside a form, a
 * button submits it.
 *
 * HTML's default for `type` is `submit`, not `button`. A `<button>Save</button>`
 * inside a `<form>` submits it with no `onClick` at all, and that default is
 * the single most surprising behaviour in HTML forms for anyone who has only
 * written buttons with click handlers. Getting it right matters more than it
 * looks: code ported from the web relies on it, and code that does *not* want
 * it writes `type="button"`, which only works if the default is the other way.
 *
 * Outside a form there is nothing to submit, so the default is inert and the
 * element behaves exactly as the plain box it was.
 */

type ButtonProps = {
  children?: React.Node,
  type?: string,
  onClick?: (event: $FlowFixMe) => unknown,
  onPressChange?: (event: $FlowFixMe) => unknown,
  style?: $FlowFixMe,
  ...
};

function Button({
  children,
  type = 'submit',
  onClick,
  style,
  onPressChange,
  ...rest
}: ButtonProps): React.Node {
  const form = React.useContext(FormContext);

  /*
   * The press is REPORTED here and DRAWN natively, and those are deliberately
   * two different things.
   *
   * This used to keep `pressed` in React state and apply `opacity: 0.6` to the
   * element while it was held. It was visible, so it looked finished, and it
   * was wrong three times over:
   *
   *  - **It went through JavaScript.** The native view already tracks the press
   *    at the view level so that a press inside a scroll view waits out
   *    `delaysContentTouches`. Routing the *appearance* back through a React
   *    state update threw that away and put a render on the path between the
   *    finger landing and anything happening — the round trip the native
   *    tracking exists to avoid.
   *  - **0.6 was invented.** Measured on a real `UIButton`, UIKit's highlight
   *    multiplies the whole button by alpha 0.75: a gray button's fill goes
   *    41/255 to 31/255 and a filled one's goes 255 to 191, both a factor of
   *    0.75 within a rounding error.
   *  - **Android does not dim at all.** Its press is a ripple from the touch
   *    point, tinted `?attr/colorControlHighlight` — the framework's own button
   *    background is literally a `<ripple>`. Dimming an Android button is as
   *    foreign as rippling an iOS one, and doing the same thing on both is how
   *    a control ends up looking like neither platform.
   *
   * Each platform now draws its own, in its own view: the dim in
   * `EXPElementButtonComponentView`, the ripple in `ElementButtonView`. The
   * event is still reported, because authors and `:active` want it — what it no
   * longer does is drive the pixels.
   */
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
      nodeName="button"
      type={type}
      buttonStyle={buttonProminence(type, form != null)}
      hasAuthorChrome={authorStatesSurface(style)}
      style={style}
      onPressChange={handlePressChange}
      onClick={handleClick}>
      {children}
    </element-button-box>
  );
}

/**
 * Which of the platform's two button styles this element gets, decided by
 * HTML's own semantics rather than by taste. A submit button is the form's
 * primary action — and `submit` is `<button>`'s DEFAULT type — so it wears the
 * style each platform gives a primary action (UIKit's filled configuration,
 * Material's filled button). Everything else, and a submit button outside any
 * form (where submitting is inert), wears the neutral one (UIKit's gray,
 * Material's tonal).
 */
export function buttonProminence(type: string, inForm: boolean): string {
  return type === 'submit' && inForm ? 'prominent' : 'neutral';
}

/**
 * Whether the author has claimed the button's surface.
 *
 * The platform draws the chrome — the real `UIButton` layer on iOS, the
 * Material construction on Android — only for an unstyled button. An author
 * background or border means the author owns the appearance, and the
 * platform's drawing underneath it would be neither the author's design nor
 * the platform's. Computed here, where the style prop is, and read by both
 * platform views.
 */
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
