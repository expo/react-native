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

function ownKeys(object, enumerableOnly) {
  var keys = Object.keys(object);
  if (Object.getOwnPropertySymbols) {
    var symbols = Object.getOwnPropertySymbols(object);
    enumerableOnly &&
      (symbols = symbols.filter(function (sym) {
        return Object.getOwnPropertyDescriptor(object, sym).enumerable;
      })),
      keys.push.apply(keys, symbols);
  }
  return keys;
}
function _objectSpread(target) {
  for (var i = 1; i < arguments.length; i++) {
    var source = null != arguments[i] ? arguments[i] : {};
    i % 2
      ? ownKeys(Object(source), !0).forEach(function (key) {
          _defineProperty(target, key, source[key]);
        })
      : Object.getOwnPropertyDescriptors
      ? Object.defineProperties(
          target,
          Object.getOwnPropertyDescriptors(source),
        )
      : ownKeys(Object(source)).forEach(function (key) {
          Object.defineProperty(
            target,
            key,
            Object.getOwnPropertyDescriptor(source, key),
          );
        });
  }
  return target;
}
function _defineProperty(obj, key, value) {
  key = _toPropertyKey(key);
  if (key in obj) {
    Object.defineProperty(obj, key, {
      value: value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  } else {
    obj[key] = value;
  }
  return obj;
}
function _toPropertyKey(arg) {
  var key = _toPrimitive(arg, 'string');
  return typeof key === 'symbol' ? key : String(key);
}
function _toPrimitive(input, hint) {
  if (typeof input !== 'object' || input === null) return input;
  var prim = input[Symbol.toPrimitive];
  if (prim !== undefined) {
    var res = prim.call(input, hint || 'default');
    if (typeof res !== 'object') return res;
    throw new TypeError('@@toPrimitive must return a primitive value.');
  }
  return (hint === 'string' ? String : Number)(input);
}
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
function _iterableToArrayLimit(arr, i) {
  var _i =
    null == arr
      ? null
      : ('undefined' != typeof Symbol && arr[Symbol.iterator]) ||
        arr['@@iterator'];
  if (null != _i) {
    var _s,
      _e,
      _x,
      _r,
      _arr = [],
      _n = !0,
      _d = !1;
    try {
      if (((_x = (_i = _i.call(arr)).next), 0 === i)) {
        if (Object(_i) !== _i) return;
        _n = !1;
      } else
        for (
          ;
          !(_n = (_s = _x.call(_i)).done) &&
          (_arr.push(_s.value), _arr.length !== i);
          _n = !0
        );
    } catch (err) {
      (_d = !0), (_e = err);
    } finally {
      try {
        if (!_n && null != _i.return && ((_r = _i.return()), Object(_r) !== _r))
          return;
      } finally {
        if (_d) throw _e;
      }
    }
    return _arr;
  }
}
function _arrayWithHoles(arr) {
  if (Array.isArray(arr)) return arr;
}
const _require = require('./utils'),
  getConfigType = _require.getConfigType,
  extractNativeModuleName = _require.extractNativeModuleName,
  createParserErrorCapturer = _require.createParserErrorCapturer,
  visit = _require.visit,
  isModuleRegistryCall = _require.isModuleRegistryCall,
  verifyPlatforms = _require.verifyPlatforms;
const _require2 = require('./error-utils'),
  throwIfPropertyValueTypeIsUnsupported =
    _require2.throwIfPropertyValueTypeIsUnsupported,
  throwIfUnsupportedFunctionParamTypeAnnotationParserError =
    _require2.throwIfUnsupportedFunctionParamTypeAnnotationParserError,
  throwIfUnsupportedFunctionReturnTypeAnnotationParserError =
    _require2.throwIfUnsupportedFunctionReturnTypeAnnotationParserError,
  throwIfModuleTypeIsUnsupported = _require2.throwIfModuleTypeIsUnsupported,
  throwIfUnusedModuleInterfaceParserError =
    _require2.throwIfUnusedModuleInterfaceParserError,
  throwIfMoreThanOneModuleRegistryCalls =
    _require2.throwIfMoreThanOneModuleRegistryCalls,
  throwIfWrongNumberOfCallExpressionArgs =
    _require2.throwIfWrongNumberOfCallExpressionArgs,
  throwIfUntypedModule = _require2.throwIfUntypedModule,
  throwIfIncorrectModuleRegistryCallTypeParameterParserError =
    _require2.throwIfIncorrectModuleRegistryCallTypeParameterParserError,
  throwIfIncorrectModuleRegistryCallArgument =
    _require2.throwIfIncorrectModuleRegistryCallArgument,
  throwIfModuleInterfaceNotFound = _require2.throwIfModuleInterfaceNotFound,
  throwIfMoreThanOneModuleInterfaceParserError =
    _require2.throwIfMoreThanOneModuleInterfaceParserError,
  throwIfModuleInterfaceIsMisnamed = _require2.throwIfModuleInterfaceIsMisnamed;
const _require3 = require('./errors'),
  MissingTypeParameterGenericParserError =
    _require3.MissingTypeParameterGenericParserError,
  MoreThanOneTypeParameterGenericParserError =
    _require3.MoreThanOneTypeParameterGenericParserError,
  UnnamedFunctionParamParserError = _require3.UnnamedFunctionParamParserError;
const invariant = require('invariant');
function wrapModuleSchema(nativeModuleSchema, hasteModuleName) {
  return {
    modules: {
      [hasteModuleName]: nativeModuleSchema,
    },
  };
}
function unwrapNullable(x) {
  if (x.type === 'NullableTypeAnnotation') {
    return [x.typeAnnotation, true];
  }
  return [x, false];
}
function wrapNullable(nullable, typeAnnotation) {
  if (!nullable) {
    return typeAnnotation;
  }
  return {
    type: 'NullableTypeAnnotation',
    typeAnnotation,
  };
}
function assertGenericTypeAnnotationHasExactlyOneTypeParameter(
  moduleName,
  /**
   * TODO(T108222691): Use flow-types for @babel/parser
   */
  typeAnnotation,
  parser,
) {
  if (typeAnnotation.typeParameters == null) {
    throw new MissingTypeParameterGenericParserError(
      moduleName,
      typeAnnotation,
      parser,
    );
  }
  const typeAnnotationType = parser.typeParameterInstantiation;
  invariant(
    typeAnnotation.typeParameters.type === typeAnnotationType,
    `assertGenericTypeAnnotationHasExactlyOneTypeParameter: Type parameters must be an AST node of type '${typeAnnotationType}'`,
  );
  if (typeAnnotation.typeParameters.params.length !== 1) {
    throw new MoreThanOneTypeParameterGenericParserError(
      moduleName,
      typeAnnotation,
      parser,
    );
  }
}
function isObjectProperty(property, language) {
  switch (language) {
    case 'Flow':
      return property.type === 'ObjectTypeProperty';
    case 'TypeScript':
      return property.type === 'TSPropertySignature';
    default:
      return false;
  }
}
function parseObjectProperty(
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
) {
  const language = parser.language();
  const name = parser.getKeyName(property, hasteModuleName);
  const _property$optional = property.optional,
    optional = _property$optional === void 0 ? false : _property$optional;
  const languageTypeAnnotation =
    language === 'TypeScript'
      ? property.typeAnnotation.typeAnnotation
      : property.value;
  const _unwrapNullable = unwrapNullable(
      translateTypeAnnotation(
        hasteModuleName,
        languageTypeAnnotation,
        types,
        aliasMap,
        enumMap,
        tryParse,
        cxxOnly,
        parser,
      ),
    ),
    _unwrapNullable2 = _slicedToArray(_unwrapNullable, 2),
    propertyTypeAnnotation = _unwrapNullable2[0],
    isPropertyNullable = _unwrapNullable2[1];
  if (
    propertyTypeAnnotation.type === 'FunctionTypeAnnotation' ||
    propertyTypeAnnotation.type === 'PromiseTypeAnnotation' ||
    propertyTypeAnnotation.type === 'VoidTypeAnnotation'
  ) {
    throwIfPropertyValueTypeIsUnsupported(
      hasteModuleName,
      languageTypeAnnotation,
      property.key,
      propertyTypeAnnotation.type,
    );
  }
  return {
    name,
    optional,
    typeAnnotation: wrapNullable(isPropertyNullable, propertyTypeAnnotation),
  };
}
function translateFunctionTypeAnnotation(
  hasteModuleName,
  // TODO(T108222691): Use flow-types for @babel/parser
  // TODO(T71778680): This is a FunctionTypeAnnotation. Type this.
  functionTypeAnnotation,
  types,
  aliasMap,
  enumMap,
  tryParse,
  cxxOnly,
  translateTypeAnnotation,
  parser,
) {
  const params = [];
  for (const param of parser.getFunctionTypeAnnotationParameters(
    functionTypeAnnotation,
  )) {
    const parsedParam = tryParse(() => {
      if (parser.getFunctionNameFromParameter(param) == null) {
        throw new UnnamedFunctionParamParserError(param, hasteModuleName);
      }
      const paramName = parser.getParameterName(param);
      const _unwrapNullable3 = unwrapNullable(
          translateTypeAnnotation(
            hasteModuleName,
            parser.getParameterTypeAnnotation(param),
            types,
            aliasMap,
            enumMap,
            tryParse,
            cxxOnly,
            parser,
          ),
        ),
        _unwrapNullable4 = _slicedToArray(_unwrapNullable3, 2),
        paramTypeAnnotation = _unwrapNullable4[0],
        isParamTypeAnnotationNullable = _unwrapNullable4[1];
      if (
        paramTypeAnnotation.type === 'VoidTypeAnnotation' ||
        paramTypeAnnotation.type === 'PromiseTypeAnnotation'
      ) {
        return throwIfUnsupportedFunctionParamTypeAnnotationParserError(
          hasteModuleName,
          param.typeAnnotation,
          paramName,
          paramTypeAnnotation.type,
        );
      }
      return {
        name: paramName,
        optional: Boolean(param.optional),
        typeAnnotation: wrapNullable(
          isParamTypeAnnotationNullable,
          paramTypeAnnotation,
        ),
      };
    });
    if (parsedParam != null) {
      params.push(parsedParam);
    }
  }
  const _unwrapNullable5 = unwrapNullable(
      translateTypeAnnotation(
        hasteModuleName,
        parser.getFunctionTypeAnnotationReturnType(functionTypeAnnotation),
        types,
        aliasMap,
        enumMap,
        tryParse,
        cxxOnly,
        parser,
      ),
    ),
    _unwrapNullable6 = _slicedToArray(_unwrapNullable5, 2),
    returnTypeAnnotation = _unwrapNullable6[0],
    isReturnTypeAnnotationNullable = _unwrapNullable6[1];
  throwIfUnsupportedFunctionReturnTypeAnnotationParserError(
    hasteModuleName,
    functionTypeAnnotation,
    'FunctionTypeAnnotation',
    cxxOnly,
    returnTypeAnnotation.type,
  );
  return {
    type: 'FunctionTypeAnnotation',
    returnTypeAnnotation: wrapNullable(
      isReturnTypeAnnotationNullable,
      returnTypeAnnotation,
    ),
    params,
  };
}
function buildPropertySchema(
  hasteModuleName,
  // TODO(T108222691): [TS] Use flow-types for @babel/parser
  // TODO(T71778680): [Flow] This is an ObjectTypeProperty containing either:
  // - a FunctionTypeAnnotation or GenericTypeAnnotation
  // - a NullableTypeAnnoation containing a FunctionTypeAnnotation or GenericTypeAnnotation
  // Flow type this node
  property,
  types,
  aliasMap,
  enumMap,
  tryParse,
  cxxOnly,
  resolveTypeAnnotation,
  translateTypeAnnotation,
  parser,
) {
  let nullable = false;
  let key = property.key,
    value = property.value;
  const methodName = key.name;
  if (parser.language() === 'TypeScript') {
    value =
      property.type === 'TSMethodSignature'
        ? property
        : property.typeAnnotation;
  }
  var _resolveTypeAnnotatio = resolveTypeAnnotation(value, types);
  nullable = _resolveTypeAnnotatio.nullable;
  value = _resolveTypeAnnotatio.typeAnnotation;
  throwIfModuleTypeIsUnsupported(
    hasteModuleName,
    property.value,
    key.name,
    value.type,
    parser,
  );
  return {
    name: methodName,
    optional: Boolean(property.optional),
    typeAnnotation: wrapNullable(
      nullable,
      translateFunctionTypeAnnotation(
        hasteModuleName,
        value,
        types,
        aliasMap,
        enumMap,
        tryParse,
        cxxOnly,
        translateTypeAnnotation,
        parser,
      ),
    ),
  };
}
function buildSchemaFromConfigType(
  configType,
  filename,
  ast,
  wrapComponentSchema,
  buildComponentSchema,
  buildModuleSchema,
  parser,
  resolveTypeAnnotation,
  translateTypeAnnotation,
) {
  switch (configType) {
    case 'component': {
      return wrapComponentSchema(buildComponentSchema(ast, parser));
    }
    case 'module': {
      if (filename === undefined || filename === null) {
        throw new Error('Filepath expected while parasing a module');
      }
      const nativeModuleName = extractNativeModuleName(filename);
      const _createParserErrorCap = createParserErrorCapturer(),
        _createParserErrorCap2 = _slicedToArray(_createParserErrorCap, 2),
        parsingErrors = _createParserErrorCap2[0],
        tryParse = _createParserErrorCap2[1];
      const schema = tryParse(() =>
        buildModuleSchema(
          nativeModuleName,
          ast,
          tryParse,
          parser,
          resolveTypeAnnotation,
          translateTypeAnnotation,
        ),
      );
      if (parsingErrors.length > 0) {
        /**
         * TODO(T77968131): We have two options:
         *  - Throw the first error, but indicate there are more then one errors.
         *  - Display all errors, nicely formatted.
         *
         * For the time being, we're just throw the first error.
         **/

        throw parsingErrors[0];
      }
      invariant(
        schema != null,
        'When there are no parsing errors, the schema should not be null',
      );
      return wrapModuleSchema(schema, nativeModuleName);
    }
    default:
      return {
        modules: {},
      };
  }
}
function buildSchema(
  contents,
  filename,
  wrapComponentSchema,
  buildComponentSchema,
  buildModuleSchema,
  Visitor,
  parser,
  resolveTypeAnnotation,
  translateTypeAnnotation,
) {
  // Early return for non-Spec JavaScript files
  if (
    !contents.includes('codegenNativeComponent') &&
    !contents.includes('TurboModule')
  ) {
    return {
      modules: {},
    };
  }
  const ast = parser.getAst(contents);
  const configType = getConfigType(ast, Visitor);
  return buildSchemaFromConfigType(
    configType,
    filename,
    ast,
    wrapComponentSchema,
    buildComponentSchema,
    buildModuleSchema,
    parser,
    resolveTypeAnnotation,
    translateTypeAnnotation,
  );
}
function createComponentConfig(foundConfig, commandsTypeNames) {
  return _objectSpread(
    _objectSpread({}, foundConfig),
    {},
    {
      commandTypeName:
        commandsTypeNames[0] == null
          ? null
          : commandsTypeNames[0].commandTypeName,
      commandOptionsExpression:
        commandsTypeNames[0] == null
          ? null
          : commandsTypeNames[0].commandOptionsExpression,
    },
  );
}
const parseModuleName = (hasteModuleName, moduleSpec, ast, parser) => {
  const callExpressions = [];
  visit(ast, {
    CallExpression(node) {
      if (isModuleRegistryCall(node)) {
        callExpressions.push(node);
      }
    },
  });
  throwIfUnusedModuleInterfaceParserError(
    hasteModuleName,
    moduleSpec,
    callExpressions,
  );
  throwIfMoreThanOneModuleRegistryCalls(
    hasteModuleName,
    callExpressions,
    callExpressions.length,
  );
  const callExpression = callExpressions[0];
  const typeParameters = parser.callExpressionTypeParameters(callExpression);
  const methodName = callExpression.callee.property.name;
  throwIfWrongNumberOfCallExpressionArgs(
    hasteModuleName,
    callExpression,
    methodName,
    callExpression.arguments.length,
  );
  throwIfIncorrectModuleRegistryCallArgument(
    hasteModuleName,
    callExpression.arguments[0],
    methodName,
  );
  const $moduleName = callExpression.arguments[0].value;
  throwIfUntypedModule(
    typeParameters,
    hasteModuleName,
    callExpression,
    methodName,
    $moduleName,
  );
  throwIfIncorrectModuleRegistryCallTypeParameterParserError(
    hasteModuleName,
    typeParameters,
    methodName,
    $moduleName,
    parser,
  );
  return $moduleName;
};
const buildModuleSchema = (
  hasteModuleName,
  ast,
  tryParse,
  parser,
  resolveTypeAnnotation,
  translateTypeAnnotation,
) => {
  const language = parser.language();
  const types = parser.getTypes(ast);
  const moduleSpecs = Object.values(types).filter(t =>
    parser.isModuleInterface(t),
  );
  throwIfModuleInterfaceNotFound(
    moduleSpecs.length,
    hasteModuleName,
    ast,
    language,
  );
  throwIfMoreThanOneModuleInterfaceParserError(
    hasteModuleName,
    moduleSpecs,
    language,
  );
  const _moduleSpecs = _slicedToArray(moduleSpecs, 1),
    moduleSpec = _moduleSpecs[0];
  throwIfModuleInterfaceIsMisnamed(hasteModuleName, moduleSpec.id, language);

  // Parse Module Name
  const moduleName = parseModuleName(hasteModuleName, moduleSpec, ast, parser);

  // Some module names use platform suffix to indicate platform-exclusive modules.
  // Eventually this should be made explicit in the Flow type itself.
  // Also check the hasteModuleName for platform suffix.
  // Note: this shape is consistent with ComponentSchema.
  const _verifyPlatforms = verifyPlatforms(hasteModuleName, moduleName),
    cxxOnly = _verifyPlatforms.cxxOnly,
    excludedPlatforms = _verifyPlatforms.excludedPlatforms;
  const properties =
    language === 'Flow' ? moduleSpec.body.properties : moduleSpec.body.body;

  // $FlowFixMe[missing-type-arg]
  return properties
    .filter(
      property =>
        property.type === 'ObjectTypeProperty' ||
        property.type === 'TSPropertySignature' ||
        property.type === 'TSMethodSignature',
    )
    .map(property => {
      const aliasMap = {};
      const enumMap = {};
      return tryParse(() => ({
        aliasMap,
        enumMap,
        propertyShape: buildPropertySchema(
          hasteModuleName,
          property,
          types,
          aliasMap,
          enumMap,
          tryParse,
          cxxOnly,
          resolveTypeAnnotation,
          translateTypeAnnotation,
          parser,
        ),
      }));
    })
    .filter(Boolean)
    .reduce(
      (moduleSchema, {aliasMap, enumMap, propertyShape}) => ({
        type: 'NativeModule',
        aliasMap: _objectSpread(
          _objectSpread({}, moduleSchema.aliasMap),
          aliasMap,
        ),
        enumMap: _objectSpread(
          _objectSpread({}, moduleSchema.enumMap),
          enumMap,
        ),
        spec: {
          properties: [...moduleSchema.spec.properties, propertyShape],
        },
        moduleName: moduleSchema.moduleName,
        excludedPlatforms: moduleSchema.excludedPlatforms,
      }),
      {
        type: 'NativeModule',
        aliasMap: {},
        enumMap: {},
        spec: {
          properties: [],
        },
        moduleName,
        excludedPlatforms:
          excludedPlatforms.length !== 0 ? [...excludedPlatforms] : undefined,
      },
    );
};

/**
 * This function is used to find the type of a native component
 * provided the default exports statement from generated AST.
 * @param statement The statement to be parsed.
 * @param foundConfigs The 'mutable' array of configs that have been found.
 * @param parser The language parser to be used.
 * @returns void
 */
function findNativeComponentType(statement, foundConfigs, parser) {
  let declaration = statement.declaration;

  // codegenNativeComponent can be nested inside a cast
  // expression so we need to go one level deeper
  if (
    declaration.type === 'TSAsExpression' ||
    declaration.type === 'TypeCastExpression'
  ) {
    declaration = declaration.expression;
  }
  try {
    if (declaration.callee.name === 'codegenNativeComponent') {
      const typeArgumentParams =
        parser.getTypeArgumentParamsFromDeclaration(declaration);
      const funcArgumentParams = declaration.arguments;
      const nativeComponentType = parser.getNativeComponentType(
        typeArgumentParams,
        funcArgumentParams,
      );
      if (funcArgumentParams.length > 1) {
        nativeComponentType.optionsExpression = funcArgumentParams[1];
      }
      foundConfigs.push(nativeComponentType);
    }
  } catch (e) {
    // ignore
  }
}
function getCommandOptions(commandOptionsExpression) {
  if (commandOptionsExpression == null) {
    return null;
  }
  let foundOptions;
  try {
    foundOptions = commandOptionsExpression.properties.reduce(
      (options, prop) => {
        options[prop.key.name] = (
          (prop && prop.value && prop.value.elements) ||
          []
        ).map(element => element && element.value);
        return options;
      },
      {},
    );
  } catch (e) {
    throw new Error(
      'Failed to parse command options, please check that they are defined correctly',
    );
  }
  return foundOptions;
}
function getOptions(optionsExpression) {
  if (!optionsExpression) {
    return null;
  }
  let foundOptions;
  try {
    foundOptions = optionsExpression.properties.reduce((options, prop) => {
      if (prop.value.type === 'ArrayExpression') {
        options[prop.key.name] = prop.value.elements.map(
          element => element.value,
        );
      } else {
        options[prop.key.name] = prop.value.value;
      }
      return options;
    }, {});
  } catch (e) {
    throw new Error(
      'Failed to parse codegen options, please check that they are defined correctly',
    );
  }
  if (
    foundOptions.paperComponentName &&
    foundOptions.paperComponentNameDeprecated
  ) {
    throw new Error(
      'Failed to parse codegen options, cannot use both paperComponentName and paperComponentNameDeprecated',
    );
  }
  return foundOptions;
}
module.exports = {
  wrapModuleSchema,
  unwrapNullable,
  wrapNullable,
  assertGenericTypeAnnotationHasExactlyOneTypeParameter,
  isObjectProperty,
  parseObjectProperty,
  translateFunctionTypeAnnotation,
  buildPropertySchema,
  buildSchemaFromConfigType,
  buildSchema,
  createComponentConfig,
  parseModuleName,
  buildModuleSchema,
  findNativeComponentType,
  getCommandOptions,
  getOptions,
};
