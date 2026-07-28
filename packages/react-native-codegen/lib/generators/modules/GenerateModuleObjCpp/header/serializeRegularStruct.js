'use strict';

const {
  unwrapNullable
} = require('../../../../parsers/parsers-commons');
const {
  capitalize
} = require('../../../Utils');
const {
  getNamespacedStructName,
  getSafePropertyName
} = require('../Utils');
const {
  toObjCType
} = require('./serializeStructUtils');
const StructTemplate = ({
  hasteModuleName,
  structName,
  structProperties
}) => `namespace JS {
  namespace ${hasteModuleName} {
    struct ${structName} {
      ${structProperties}

      ${structName}(NSDictionary *const v) : _v(v) {}
    private:
      NSDictionary *_v;
    };
  }
}

@interface RCTCxxConvert (${hasteModuleName}_${structName})
+ (RCTManagedPointer *)JS_${hasteModuleName}_${structName}:(id)json;
@end`;
const MethodTemplate = ({
  returnType,
  returnValue,
  hasteModuleName,
  structName,
  propertyName,
  safePropertyName
}) => `inline ${returnType}JS::${hasteModuleName}::${structName}::${safePropertyName}() const
{
  id const p = _v[@"${propertyName}"];
  return ${returnValue};
}`;
function toObjCValue(hasteModuleName, nullableTypeAnnotation, value, depth, isOptional = false) {
  const [typeAnnotation, nullable] = unwrapNullable(nullableTypeAnnotation);
  const isRequired = !nullable && !isOptional;
  const RCTBridgingTo = (type, arg) => {
    const args = [value, arg].filter(Boolean).join(', ');
    return isRequired ? `RCTBridgingTo${type}(${args})` : `RCTBridgingToOptional${type}(${args})`;
  };
  switch (typeAnnotation.type) {
    case 'ReservedTypeAnnotation':
      switch (typeAnnotation.name) {
        case 'RootTag':
          return RCTBridgingTo('Double');
        default:
          typeAnnotation.name;
          throw new Error(`Couldn't convert into ObjC type: ${typeAnnotation.type}"`);
      }
    case 'StringTypeAnnotation':
      return RCTBridgingTo('String');
    case 'StringLiteralTypeAnnotation':
      return RCTBridgingTo('String');
    case 'UnionTypeAnnotation':
      return !isRequired ? `!RCTNilIfNull(${value}) ? std::optional<NSObject *>{} : std::optional<NSObject *>(${value})` : value;
    case 'NumberTypeAnnotation':
      return RCTBridgingTo('Double');
    case 'NumberLiteralTypeAnnotation':
      return RCTBridgingTo('Double');
    case 'FloatTypeAnnotation':
      return RCTBridgingTo('Double');
    case 'Int32TypeAnnotation':
      return RCTBridgingTo('Double');
    case 'DoubleTypeAnnotation':
      return RCTBridgingTo('Double');
    case 'BooleanTypeAnnotation':
      return RCTBridgingTo('Bool');
    case 'BooleanLiteralTypeAnnotation':
      return RCTBridgingTo('Bool');
    case 'EnumDeclaration':
      switch (typeAnnotation.memberType) {
        case 'NumberTypeAnnotation':
          return RCTBridgingTo('Double');
        case 'StringTypeAnnotation':
          return RCTBridgingTo('String');
        default:
          throw new Error(`Couldn't convert enum into ObjC value: ${typeAnnotation.type}"`);
      }
    case 'GenericObjectTypeAnnotation':
      return value;
    case 'ArrayTypeAnnotation':
      const {
        elementType
      } = typeAnnotation;
      if (elementType.type === 'AnyTypeAnnotation') {
        return value;
      }
      const localVarName = `itemValue_${depth}`;
      const elementObjCType = toObjCType(hasteModuleName, elementType, 'REGULAR');
      const elementObjCValue = toObjCValue(hasteModuleName, elementType, localVarName, depth + 1);
      return RCTBridgingTo('Vec', `^${elementObjCType}(id ${localVarName}) { return ${elementObjCValue}; }`);
    case 'TypeAliasTypeAnnotation':
      const structName = capitalize(typeAnnotation.name);
      const namespacedStructName = getNamespacedStructName(hasteModuleName, structName);
      return !isRequired ? `(${value} == nil ? std::nullopt : std::make_optional(${namespacedStructName}(${value})))` : `${namespacedStructName}(${value})`;
    default:
      typeAnnotation.type;
      throw new Error(`Couldn't convert into ObjC value: ${typeAnnotation.type}"`);
  }
}
function serializeRegularStruct(hasteModuleName, struct) {
  const declaration = StructTemplate({
    hasteModuleName: hasteModuleName,
    structName: struct.name,
    structProperties: struct.properties.map(property => {
      const {
        typeAnnotation,
        optional
      } = property;
      const safePropName = getSafePropertyName(property);
      const returnType = toObjCType(hasteModuleName, typeAnnotation, 'REGULAR', optional);
      const padding = ' '.repeat(returnType.endsWith('*') ? 0 : 1);
      return `${returnType}${padding}${safePropName}() const;`;
    }).join('\n      ')
  });
  const methods = struct.properties.map(property => {
    const {
      typeAnnotation,
      optional,
      name: propName
    } = property;
    const safePropertyName = getSafePropertyName(property);
    const returnType = toObjCType(hasteModuleName, typeAnnotation, 'REGULAR', optional);
    const returnValue = toObjCValue(hasteModuleName, typeAnnotation, 'p', 0, optional);
    const padding = ' '.repeat(returnType.endsWith('*') ? 0 : 1);
    return MethodTemplate({
      hasteModuleName,
      structName: struct.name,
      returnType: returnType + padding,
      returnValue: returnValue,
      propertyName: propName,
      safePropertyName
    });
  }).join('\n');
  return {
    methods,
    declaration
  };
}
module.exports = {
  serializeRegularStruct
};