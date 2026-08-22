/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import * as React from 'react';

/**
 * `<fieldset>` and its `<legend>`, spoken in the platforms' own form
 * language.
 *
 * A browser draws the legend STRADDLING the fieldset's top border — a
 * special fieldset layout that interrupts the border behind the text.
 * Neither platform can erase a border behind a text run, and neither
 * platform's forms speak that idiom anyway: iOS grouped settings and
 * Material both set a group's label ABOVE the group's surface. So a fieldset
 * with a legend hoists it out of the bordered box and makes it exactly that
 * header; the legend's user-agent margin supplies the platform's
 * label-to-surface gap.
 *
 * DOM-CSS-DEVIATION(fieldset-legend-position): the legend sits above the box
 * rather than notched into its border — the platforms' form conventions take
 * precedence over html.css's fieldset layout. Informational, not a warning.
 *
 * A fieldset with NO legend keeps the single bordered box, so nothing else
 * pays for the structure.
 */

type FieldsetProps = {
  children?: React.Node,
  style?: unknown,
  ...
};

function isLegend(child: React.Node): boolean {
  return (
    typeof child === 'object' &&
    child != null &&
    (child as $FlowFixMe).type === 'legend'
  );
}

export default function Fieldset(props: FieldsetProps): React.Node {
  // $FlowFixMe[prop-missing] React 19 delivers `ref` as an ordinary prop.
  const {children, style, ref, ...rest} = props;
  const kids = React.Children.toArray(children);
  const legends = kids.filter(isLegend);

  if (legends.length === 0) {
    return (
      // $FlowFixMe[prop-missing] intrinsic
      <element-fieldset {...rest} ref={ref} nodeName="fieldset" style={style}>
        {kids}
      </element-fieldset>
    );
  }

  const body = kids.filter(child => !isLegend(child));
  return (
    // The author's style stays on the ELEMENT (this wrapper): margins, width
    // and positioning all mean the fieldset as a whole. The user-agent
    // border and padding stay on the box the controls live in.
    // $FlowFixMe[prop-missing] intrinsic
    <div {...rest} ref={ref} nodeName="fieldset" style={style}>
      {legends}
      {/* $FlowFixMe[prop-missing] intrinsic */}
      <element-fieldset>{body}</element-fieldset>
    </div>
  );
}
