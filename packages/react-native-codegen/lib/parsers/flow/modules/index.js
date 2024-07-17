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

function _slicedToArray(r, e) {
  return (
    _arrayWithHoles(r) ||
    _iterableToArrayLimit(r, e) ||
    _unsupportedIterableToArray(r, e) ||
    _nonIterableRest()
  );
}
function _nonIterableRest() {
  throw new TypeError(
    'Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.',
  );
}
function _unsupportedIterableToArray(r, a) {
  if (r) {
    if ('string' == typeof r) return _arrayLikeToArray(r, a);
    var t = {}.toString.call(r).slice(8, -1);
    return (
      'Object' === t && r.constructor && (t = r.constructor.name),
      'Map' === t || 'Set' === t
        ? Array.from(r)
        : 'Arguments' === t ||
          /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t)
        ? _arrayLikeToArray(r, a)
        : void 0
    );
  }
}
function _arrayLikeToArray(r, a) {
  (null == a || a > r.length) && (a = r.length);
  for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
  return n;
}
function _iterableToArrayLimit(r, l) {
  var t =
    null == r
      ? null
      : ('undefined' != typeof Symbol && r[Symbol.iterator]) || r['@@iterator'];
  if (null != t) {
    var e,
      n,
      i,
      u,
      a = [],
      f = !0,
      o = !1;
    try {
      if (((i = (t = t.call(r)).next), 0 === l)) {
        if (Object(t) !== t) return;
        f = !1;
      } else
        for (
          ;
          !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l);
          f = !0
        );
    } catch (r) {
      (o = !0), (n = r);
    } finally {
      try {
        if (!f && null != t.return && ((u = t.return()), Object(u) !== u))
          return;
      } finally {
        if (o) throw n;
      }
    }
    return a;
  }
}
function _arrayWithHoles(r) {
  if (Array.isArray(r)) return r;
}
const _require = require('../../errors'),
  UnsupportedEnumDeclarationParserError =
    _require.UnsupportedEnumDeclarationParserError,
  UnsupportedGenericParserError = _require.UnsupportedGenericParserError,
  UnsupportedTypeAnnotationParserError =
    _require.UnsupportedTypeAnnotationParserError;
const _require2 = require('../../parsers-commons'),
  assertGenericTypeAnnotationHasExactlyOneTypeParameter =
    _require2.assertGenericTypeAnnotationHasExactlyOneTypeParameter,
  parseObjectProperty = _require2.parseObjectProperty,
  unwrapNullable = _require2.unwrapNullable,
  wrapNullable = _require2.wrapNullable;
const _require3 = require('../../parsers-primitives'),
  emitArrayType = _require3.emitArrayType,
  emitCommonTypes = _require3.emitCommonTypes,
  emitDictionary = _require3.emitDictionary,
  emitFunction = _require3.emitFunction,
  emitPromise = _require3.emitPromise,
  emitRootTag = _require3.emitRootTag,
  emitUnion = _require3.emitUnion,
  typeAliasResolution = _require3.typeAliasResolution,
  typeEnumResolution = _require3.typeEnumResolution;
function translateTypeAnnotation(
  hasteModuleName,
  /**
   * TODO(T71778680): Flow-type this node.
   */
  flowTypeAnnotation,
  types,
  aliasMap,
  enumMap,
  tryParse,
  cxxOnly,
  parser,
) {
  const resolveTypeAnnotationFN = parser.getResolveTypeAnnotationFN();
  const _resolveTypeAnnotatio = resolveTypeAnnotationFN(
      flowTypeAnnotation,
      types,
      parser,
    ),
    nullable = _resolveTypeAnnotatio.nullable,
    typeAnnotation = _resolveTypeAnnotatio.typeAnnotation,
    typeResolutionStatus = _resolveTypeAnnotatio.typeResolutionStatus;
  switch (typeAnnotation.type) {
    case 'GenericTypeAnnotation': {
      switch (parser.getTypeAnnotationName(typeAnnotation)) {
        case 'RootTag': {
          return emitRootTag(nullable);
        }
        case 'Promise': {
          return emitPromise(
            hasteModuleName,
            typeAnnotation,
            parser,
            nullable,
            types,
            aliasMap,
            enumMap,
            tryParse,
            cxxOnly,
            translateTypeAnnotation,
          );
        }
        case 'Array':
        case '$ReadOnlyArray': {
          return emitArrayType(
            hasteModuleName,
            typeAnnotation,
            parser,
            types,
            aliasMap,
            enumMap,
            cxxOnly,
            nullable,
            translateTypeAnnotation,
          );
        }
        case '$ReadOnly': {
          assertGenericTypeAnnotationHasExactlyOneTypeParameter(
            hasteModuleName,
            typeAnnotation,
            parser,
          );
          const _unwrapNullable = unwrapNullable(
              translateTypeAnnotation(
                hasteModuleName,
                typeAnnotation.typeParameters.params[0],
                types,
                aliasMap,
                enumMap,
                tryParse,
                cxxOnly,
                parser,
              ),
            ),
            _unwrapNullable2 = _slicedToArray(_unwrapNullable, 2),
            paramType = _unwrapNullable2[0],
            isParamNullable = _unwrapNullable2[1];
          return wrapNullable(nullable || isParamNullable, paramType);
        }
        default: {
          const commonType = emitCommonTypes(
            hasteModuleName,
            types,
            typeAnnotation,
            aliasMap,
            enumMap,
            tryParse,
            cxxOnly,
            nullable,
            parser,
          );
          if (!commonType) {
            throw new UnsupportedGenericParserError(
              hasteModuleName,
              typeAnnotation,
              parser,
            );
          }
          return commonType;
        }
      }
    }
    case 'ObjectTypeAnnotation': {
      // if there is any indexer, then it is a dictionary
      if (typeAnnotation.indexers) {
        const indexers = typeAnnotation.indexers.filter(
          member => member.type === 'ObjectTypeIndexer',
        );
        if (indexers.length > 0) {
          // check the property type to prevent developers from using unsupported types
          // the return value from `translateTypeAnnotation` is unused
          const propertyType = indexers[0].value;
          const valueType = translateTypeAnnotation(
            hasteModuleName,
            propertyType,
            types,
            aliasMap,
            enumMap,
            tryParse,
            cxxOnly,
            parser,
          );
          // no need to do further checking
          return emitDictionary(nullable, valueType);
        }
      }
      const objectTypeAnnotation = {
        type: 'ObjectTypeAnnotation',
        // $FlowFixMe[missing-type-arg]
        properties: [...typeAnnotation.properties, ...typeAnnotation.indexers]
          .map(property => {
            return tryParse(() => {
              return parseObjectProperty(
                flowTypeAnnotation,
                property,
                hasteModuleName,
                types,
                aliasMap,
                enumMap,
                tryParse,
                cxxOnly,
                nullable,
                translateTypeAnnotation,
                parser,
              );
            });
          })
          .filter(Boolean),
      };
      return typeAliasResolution(
        typeResolutionStatus,
        objectTypeAnnotation,
        aliasMap,
        nullable,
      );
    }
    case 'FunctionTypeAnnotation': {
      return emitFunction(
        nullable,
        hasteModuleName,
        typeAnnotation,
        types,
        aliasMap,
        enumMap,
        tryParse,
        cxxOnly,
        translateTypeAnnotation,
        parser,
      );
    }
    case 'UnionTypeAnnotation': {
      return emitUnion(nullable, hasteModuleName, typeAnnotation, parser);
    }
    case 'StringLiteralTypeAnnotation': {
      // 'a' is a special case for 'a' | 'b' but the type name is different
      return wrapNullable(nullable, {
        type: 'UnionTypeAnnotation',
        memberType: 'StringTypeAnnotation',
      });
    }
    case 'EnumStringBody':
    case 'EnumNumberBody': {
      if (
        typeAnnotation.type === 'EnumNumberBody' &&
        typeAnnotation.members.some(m => {
          var _m$init;
          return (
            m.type === 'EnumNumberMember' &&
            !Number.isInteger(
              (_m$init = m.init) === null || _m$init === void 0
                ? void 0
                : _m$init.value,
            )
          );
        })
      ) {
        throw new UnsupportedEnumDeclarationParserError(
          hasteModuleName,
          typeAnnotation,
          parser.language(),
        );
      }
      return typeEnumResolution(
        typeAnnotation,
        typeResolutionStatus,
        nullable,
        hasteModuleName,
        enumMap,
        parser,
      );
    }
    default: {
      const commonType = emitCommonTypes(
        hasteModuleName,
        types,
        typeAnnotation,
        aliasMap,
        enumMap,
        tryParse,
        cxxOnly,
        nullable,
        parser,
      );
      if (!commonType) {
        throw new UnsupportedTypeAnnotationParserError(
          hasteModuleName,
          typeAnnotation,
          parser.language(),
        );
      }
      return commonType;
    }
  }
}
module.exports = {
  flowTranslateTypeAnnotation: translateTypeAnnotation,
};
