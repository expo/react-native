/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 *
 * @format
 */

'use strict';

// $FlowFixMe[unclear-type] there's no flowtype for ASTs

const invariant = require('invariant');
function resolveTypeAnnotation(
  // TODO(T71778680): This is an Flow TypeAnnotation. Flow-type this
  typeAnnotation,
  types,
) {
  invariant(
    typeAnnotation != null,
    'resolveTypeAnnotation(): typeAnnotation cannot be null',
  );
  let node = typeAnnotation;
  let nullable = false;
  let typeResolutionStatus = {
    successful: false,
  };
  for (;;) {
    if (node.type === 'NullableTypeAnnotation') {
      nullable = true;
      node = node.typeAnnotation;
      continue;
    }
    if (node.type !== 'GenericTypeAnnotation') {
      break;
    }
    const resolvedTypeAnnotation = types[node.id.name];
    if (resolvedTypeAnnotation == null) {
      break;
    }
    switch (resolvedTypeAnnotation.type) {
      case 'TypeAlias': {
        typeResolutionStatus = {
          successful: true,
          type: 'alias',
          name: node.id.name,
        };
        node = resolvedTypeAnnotation.right;
        break;
      }
      case 'EnumDeclaration': {
        typeResolutionStatus = {
          successful: true,
          type: 'enum',
          name: node.id.name,
        };
        node = resolvedTypeAnnotation.body;
        break;
      }
      default: {
        throw new TypeError(
          `A non GenericTypeAnnotation must be a type declaration ('TypeAlias') or enum ('EnumDeclaration'). Instead, got the unsupported ${resolvedTypeAnnotation.type}.`,
        );
      }
    }
  }
  return {
    nullable: nullable,
    typeAnnotation: node,
    typeResolutionStatus,
  };
}
function getValueFromTypes(value, types) {
  if (value.type === 'GenericTypeAnnotation' && types[value.id.name]) {
    return getValueFromTypes(types[value.id.name].right, types);
  }
  return value;
}
module.exports = {
  getValueFromTypes,
  resolveTypeAnnotation,
};
