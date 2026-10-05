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
 * DOM-CSS-DEVIATION(fieldset-legend-position): the legend is hoisted above
 * the bordered box, as iOS grouped settings and Material label a group,
 * rather than notched into the border; neither platform can erase a border
 * behind a text run. A fieldset with no legend keeps the single box.
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
