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

function _slicedToArray(arr, i) {
  return (
    _arrayWithHoles(arr) ||
    _iterableToArrayLimit(arr, i) ||
    _unsupportedIterableToArray(arr, i) ||
    _nonIterableRest()
  );
}
function _nonIterableRest() {
  throw new TypeError(
    'Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.',
  );
}
function _unsupportedIterableToArray(o, minLen) {
  if (!o) return;
  if (typeof o === 'string') return _arrayLikeToArray(o, minLen);
  var n = Object.prototype.toString.call(o).slice(8, -1);
  if (n === 'Object' && o.constructor) n = o.constructor.name;
  if (n === 'Map' || n === 'Set') return Array.from(o);
  if (n === 'Arguments' || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n))
    return _arrayLikeToArray(o, minLen);
}
function _arrayLikeToArray(arr, len) {
  if (len == null || len > arr.length) len = arr.length;
  for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i];
  return arr2;
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
function _arrayWithHoles(arr) {
  if (Array.isArray(arr)) return arr;
}
const _require = require('../Utils'),
  getEnumName = _require.getEnumName,
  toSafeCppString = _require.toSafeCppString;
const _require2 = require('./Utils'),
  createAliasResolver = _require2.createAliasResolver,
  getModules = _require2.getModules,
  getAreEnumMembersInteger = _require2.getAreEnumMembersInteger;
const _require3 = require('../Utils'),
  indent = _require3.indent;
const _require4 = require('../../parsers/parsers-commons'),
  unwrapNullable = _require4.unwrapNullable;
const ModuleClassDeclarationTemplate = ({
  hasteModuleName,
  moduleProperties,
  structs,
  enums,
}) => {
  return `${enums}
  ${structs}class JSI_EXPORT ${hasteModuleName}CxxSpecJSI : public TurboModule {
protected:
  ${hasteModuleName}CxxSpecJSI(std::shared_ptr<CallInvoker> jsInvoker);

public:
  ${indent(moduleProperties.join('\n'), 2)}

};`;
};
const ModuleSpecClassDeclarationTemplate = ({
  hasteModuleName,
  moduleName,
  moduleProperties,
}) => {
  return `template <typename T>
class JSI_EXPORT ${hasteModuleName}CxxSpec : public TurboModule {
public:
  jsi::Value get(jsi::Runtime &rt, const jsi::PropNameID &propName) override {
    return delegate_.get(rt, propName);
  }

  static constexpr std::string_view kModuleName = "${moduleName}";

protected:
  ${hasteModuleName}CxxSpec(std::shared_ptr<CallInvoker> jsInvoker)
    : TurboModule(std::string{${hasteModuleName}CxxSpec::kModuleName}, jsInvoker),
      delegate_(static_cast<T*>(this), jsInvoker) {}

private:
  class Delegate : public ${hasteModuleName}CxxSpecJSI {
  public:
    Delegate(T *instance, std::shared_ptr<CallInvoker> jsInvoker) :
      ${hasteModuleName}CxxSpecJSI(std::move(jsInvoker)), instance_(instance) {}

    ${indent(moduleProperties.join('\n'), 4)}

  private:
    T *instance_;
  };

  Delegate delegate_;
};`;
};
const FileTemplate = ({modules}) => {
  return `/**
 * This code was generated by [react-native-codegen](https://www.npmjs.com/package/react-native-codegen).
 *
 * Do not edit this file as changes may cause incorrect behavior and will be lost
 * once the code is regenerated.
 *
 * ${'@'}generated by codegen project: GenerateModuleH.js
 */

#pragma once

#include <ReactCommon/TurboModule.h>
#include <react/bridging/Bridging.h>

namespace facebook {
namespace react {

${modules.join('\n\n')}

} // namespace react
} // namespace facebook
`;
};
function translatePrimitiveJSTypeToCpp(
  moduleName,
  nullableTypeAnnotation,
  optional,
  createErrorMessage,
  resolveAlias,
  enumMap,
) {
  const _unwrapNullable = unwrapNullable(nullableTypeAnnotation),
    _unwrapNullable2 = _slicedToArray(_unwrapNullable, 2),
    typeAnnotation = _unwrapNullable2[0],
    nullable = _unwrapNullable2[1];
  const isRequired = !optional && !nullable;
  let realTypeAnnotation = typeAnnotation;
  if (realTypeAnnotation.type === 'TypeAliasTypeAnnotation') {
    realTypeAnnotation = resolveAlias(realTypeAnnotation.name);
  }
  function wrap(type) {
    return isRequired ? type : `std::optional<${type}>`;
  }
  switch (realTypeAnnotation.type) {
    case 'ReservedTypeAnnotation':
      switch (realTypeAnnotation.name) {
        case 'RootTag':
          return wrap('double');
        default:
          realTypeAnnotation.name;
          throw new Error(createErrorMessage(realTypeAnnotation.name));
      }
    case 'VoidTypeAnnotation':
      return 'void';
    case 'StringTypeAnnotation':
      return wrap('jsi::String');
    case 'NumberTypeAnnotation':
      return wrap('double');
    case 'DoubleTypeAnnotation':
      return wrap('double');
    case 'FloatTypeAnnotation':
      return wrap('double');
    case 'Int32TypeAnnotation':
      return wrap('int');
    case 'BooleanTypeAnnotation':
      return wrap('bool');
    case 'EnumDeclaration':
      switch (realTypeAnnotation.memberType) {
        case 'NumberTypeAnnotation':
          return getAreEnumMembersInteger(
            enumMap[realTypeAnnotation.name].members,
          )
            ? wrap('int')
            : wrap('double');
        case 'StringTypeAnnotation':
          return wrap('jsi::String');
        default:
          throw new Error(createErrorMessage(realTypeAnnotation.type));
      }
    case 'GenericObjectTypeAnnotation':
      return wrap('jsi::Object');
    case 'UnionTypeAnnotation':
      switch (typeAnnotation.memberType) {
        case 'NumberTypeAnnotation':
          return wrap('double');
        case 'ObjectTypeAnnotation':
          return wrap('jsi::Object');
        case 'StringTypeAnnotation':
          return wrap('jsi::String');
        default:
          throw new Error(createErrorMessage(realTypeAnnotation.type));
      }
    case 'ObjectTypeAnnotation':
      return wrap('jsi::Object');
    case 'ArrayTypeAnnotation':
      return wrap('jsi::Array');
    case 'FunctionTypeAnnotation':
      return wrap('jsi::Function');
    case 'PromiseTypeAnnotation':
      return wrap('jsi::Value');
    case 'MixedTypeAnnotation':
      return wrap('jsi::Value');
    default:
      realTypeAnnotation.type;
      throw new Error(createErrorMessage(realTypeAnnotation.type));
  }
}
function createStructsString(moduleName, aliasMap, resolveAlias, enumMap) {
  const getCppType = v =>
    translatePrimitiveJSTypeToCpp(
      moduleName,
      v.typeAnnotation,
      false,
      typeName => `Unsupported type for param "${v.name}". Found: ${typeName}`,
      resolveAlias,
      enumMap,
    );
  return Object.keys(aliasMap)
    .map(alias => {
      const value = aliasMap[alias];
      if (value.properties.length === 0) {
        return '';
      }
      const structName = `${moduleName}Base${alias}`;
      const templateParameterWithTypename = value.properties
        .map((v, i) => `typename P${i}`)
        .join(', ');
      const templateParameter = value.properties
        .map((v, i) => 'P' + i)
        .join(', ');
      const debugParameterConversion = value.properties
        .map(
          (v, i) => `  static ${getCppType(v)} ${
            v.name
          }ToJs(jsi::Runtime &rt, P${i} value) {
    return bridging::toJs(rt, value);
  }`,
        )
        .join('\n\n');
      return `
#pragma mark - ${structName}

template <${templateParameterWithTypename}>
struct ${structName} {
${value.properties.map((v, i) => '  P' + i + ' ' + v.name).join(';\n')};
  bool operator==(const ${structName} &other) const {
    return ${value.properties
      .map(v => `${v.name} == other.${v.name}`)
      .join(' && ')};
  }
};

template <${templateParameterWithTypename}>
struct ${structName}Bridging {
  static ${structName}<${templateParameter}> fromJs(
      jsi::Runtime &rt,
      const jsi::Object &value,
      const std::shared_ptr<CallInvoker> &jsInvoker) {
    ${structName}<${templateParameter}> result{
${value.properties
  .map(
    (v, i) =>
      `      bridging::fromJs<P${i}>(rt, value.getProperty(rt, "${v.name}"), jsInvoker)`,
  )
  .join(',\n')}};
    return result;
  }

#ifdef DEBUG
${debugParameterConversion}
#endif

  static jsi::Object toJs(
      jsi::Runtime &rt,
      const ${structName}<${templateParameter}> &value,
      const std::shared_ptr<CallInvoker> &jsInvoker) {
    auto result = facebook::jsi::Object(rt);
${value.properties
  .map((v, i) => {
    if (v.optional) {
      return `    if (value.${v.name}) {
      result.setProperty(rt, "${v.name}", bridging::toJs(rt, value.${v.name}.value(), jsInvoker));
    }`;
    } else {
      return `    result.setProperty(rt, "${v.name}", bridging::toJs(rt, value.${v.name}, jsInvoker));`;
    }
  })
  .join('\n')}
    return result;
  }
};

`;
    })
    .join('\n');
}
const EnumTemplate = ({
  enumName,
  values,
  fromCases,
  toCases,
  nativeEnumMemberType,
}) => {
  const _ref =
      nativeEnumMemberType === 'std::string'
        ? [
            'const jsi::String &rawValue',
            'std::string value = rawValue.utf8(rt);',
            'jsi::String',
          ]
        : [
            'const jsi::Value &rawValue',
            'double value = (double)rawValue.asNumber();',
            'jsi::Value',
          ],
    _ref2 = _slicedToArray(_ref, 3),
    fromValue = _ref2[0],
    fromValueConversion = _ref2[1],
    toValue = _ref2[2];
  return `
#pragma mark - ${enumName}

enum ${enumName} { ${values} };

template <>
struct Bridging<${enumName}> {
  static ${enumName} fromJs(jsi::Runtime &rt, ${fromValue}) {
    ${fromValueConversion}
    ${fromCases}
  }

  static ${toValue} toJs(jsi::Runtime &rt, ${enumName} value) {
    ${toCases}
  }
};`;
};
function generateEnum(moduleName, origEnumName, members, memberType) {
  const enumName = getEnumName(moduleName, origEnumName);
  const nativeEnumMemberType =
    memberType === 'StringTypeAnnotation'
      ? 'std::string'
      : getAreEnumMembersInteger(members)
      ? 'int32_t'
      : 'float';
  const getMemberValueAppearance = value =>
    memberType === 'StringTypeAnnotation'
      ? `"${value}"`
      : `${value}${nativeEnumMemberType === 'float' ? 'f' : ''}`;
  const fromCases =
    members
      .map(
        member => `if (value == ${getMemberValueAppearance(member.value)}) {
      return ${enumName}::${toSafeCppString(member.name)};
    }`,
      )
      .join(' else ') +
    ` else {
      throw jsi::JSError(rt, "No appropriate enum member found for value");
    }`;
  const toCases =
    members
      .map(
        member => `if (value == ${enumName}::${toSafeCppString(member.name)}) {
      return bridging::toJs(rt, ${getMemberValueAppearance(member.value)});
    }`,
      )
      .join(' else ') +
    ` else {
      throw jsi::JSError(rt, "No appropriate enum member found for enum value");
    }`;
  return EnumTemplate({
    enumName,
    values: members.map(member => member.name).join(', '),
    fromCases,
    toCases,
    nativeEnumMemberType,
  });
}
function createEnums(moduleName, enumMap, resolveAlias) {
  return Object.entries(enumMap)
    .map(([enumName, enumNode]) => {
      return generateEnum(
        moduleName,
        enumName,
        enumNode.members,
        enumNode.memberType,
      );
    })
    .filter(Boolean)
    .join('\n');
}
function translatePropertyToCpp(
  moduleName,
  prop,
  resolveAlias,
  enumMap,
  abstract = false,
) {
  const _unwrapNullable3 = unwrapNullable(prop.typeAnnotation),
    _unwrapNullable4 = _slicedToArray(_unwrapNullable3, 1),
    propTypeAnnotation = _unwrapNullable4[0];
  const params = propTypeAnnotation.params.map(
    param => `std::move(${param.name})`,
  );
  const paramTypes = propTypeAnnotation.params.map(param => {
    const translatedParam = translatePrimitiveJSTypeToCpp(
      moduleName,
      param.typeAnnotation,
      param.optional,
      typeName =>
        `Unsupported type for param "${param.name}" in ${prop.name}. Found: ${typeName}`,
      resolveAlias,
      enumMap,
    );
    return `${translatedParam} ${param.name}`;
  });
  const returnType = translatePrimitiveJSTypeToCpp(
    moduleName,
    propTypeAnnotation.returnTypeAnnotation,
    false,
    typeName => `Unsupported return type for ${prop.name}. Found: ${typeName}`,
    resolveAlias,
    enumMap,
  );

  // The first param will always be the runtime reference.
  paramTypes.unshift('jsi::Runtime &rt');
  const method = `${returnType} ${prop.name}(${paramTypes.join(', ')})`;
  if (abstract) {
    return `virtual ${method} = 0;`;
  }
  return `${method} override {
  static_assert(
      bridging::getParameterCount(&T::${prop.name}) == ${paramTypes.length},
      "Expected ${prop.name}(...) to have ${paramTypes.length} parameters");

  return bridging::callFromJs<${returnType}>(
      rt, &T::${prop.name}, jsInvoker_, ${['instance_', ...params].join(', ')});
}`;
}
module.exports = {
  generate(libraryName, schema, packageName, assumeNonnull = false) {
    const nativeModules = getModules(schema);
    const modules = Object.keys(nativeModules).flatMap(hasteModuleName => {
      const _nativeModules$hasteM = nativeModules[hasteModuleName],
        aliasMap = _nativeModules$hasteM.aliasMap,
        enumMap = _nativeModules$hasteM.enumMap,
        properties = _nativeModules$hasteM.spec.properties,
        moduleName = _nativeModules$hasteM.moduleName;
      const resolveAlias = createAliasResolver(aliasMap);
      const structs = createStructsString(
        moduleName,
        aliasMap,
        resolveAlias,
        enumMap,
      );
      const enums = createEnums(moduleName, enumMap, resolveAlias);
      return [
        ModuleClassDeclarationTemplate({
          hasteModuleName,
          moduleProperties: properties.map(prop =>
            translatePropertyToCpp(
              moduleName,
              prop,
              resolveAlias,
              enumMap,
              true,
            ),
          ),
          structs,
          enums,
        }),
        ModuleSpecClassDeclarationTemplate({
          hasteModuleName,
          moduleName,
          moduleProperties: properties.map(prop =>
            translatePropertyToCpp(moduleName, prop, resolveAlias, enumMap),
          ),
        }),
      ];
    });
    const fileName = `${libraryName}JSI.h`;
    const replacedTemplate = FileTemplate({
      modules,
    });
    return new Map([[fileName, replacedTemplate]]);
  },
};