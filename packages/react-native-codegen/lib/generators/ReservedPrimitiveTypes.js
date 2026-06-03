'use strict';

const RESERVED_TYPES = {
  ColorPrimitive: {
    cpp: {
      typeName: 'SharedColor',
      localIncludes: ['#include <react/renderer/graphics/Color.h>'],
      conversionIncludes: []
    },
    java: {
      interfaceImports: [],
      delegateImports: ['import com.facebook.react.bridge.ColorPropConverter;']
    }
  },
  ImageSourcePrimitive: {
    cpp: {
      typeName: 'ImageSource',
      localIncludes: ['#include <react/renderer/imagemanager/primitives.h>'],
      conversionIncludes: ['#include <react/renderer/components/image/conversions.h>']
    },
    java: {
      interfaceImports: ['import com.facebook.react.bridge.ReadableMap;'],
      delegateImports: ['import com.facebook.react.bridge.ReadableMap;']
    }
  },
  ImageRequestPrimitive: {
    cpp: {
      typeName: 'ImageRequest',
      localIncludes: ['#include <react/renderer/imagemanager/ImageRequest.h>'],
      conversionIncludes: []
    },
    java: {
      interfaceImports: [],
      delegateImports: []
    }
  },
  PointPrimitive: {
    cpp: {
      typeName: 'Point',
      localIncludes: ['#include <react/renderer/graphics/Point.h>'],
      conversionIncludes: []
    },
    java: {
      interfaceImports: ['import com.facebook.react.bridge.ReadableMap;'],
      delegateImports: ['import com.facebook.react.bridge.ReadableMap;']
    }
  },
  EdgeInsetsPrimitive: {
    cpp: {
      typeName: 'EdgeInsets',
      localIncludes: ['#include <react/renderer/graphics/RectangleEdges.h>'],
      conversionIncludes: []
    },
    java: {
      interfaceImports: ['import com.facebook.react.bridge.ReadableMap;'],
      delegateImports: ['import com.facebook.react.bridge.ReadableMap;']
    }
  },
  DimensionPrimitive: {
    cpp: {
      typeName: 'YGValue',
      localIncludes: ['#include <yoga/Yoga.h>', '#include <react/renderer/core/graphicsConversions.h>'],
      conversionIncludes: ['#include <react/renderer/components/view/conversions.h>']
    },
    java: {
      interfaceImports: ['import com.facebook.yoga.YogaValue;'],
      delegateImports: ['import com.facebook.react.bridge.DimensionPropConverter;']
    }
  }
};
function getCppTypeForReservedPrimitive(name) {
  return RESERVED_TYPES[name].cpp.typeName;
}
function getCppLocalIncludesForReservedPrimitive(name) {
  return RESERVED_TYPES[name].cpp.localIncludes;
}
function getCppConversionIncludesForReservedPrimitive(name) {
  return RESERVED_TYPES[name].cpp.conversionIncludes;
}
function getJavaImportsForReservedPrimitive(name, type) {
  const info = RESERVED_TYPES[name].java;
  return type === 'interface' ? info.interfaceImports : info.delegateImports;
}
module.exports = {
  RESERVED_TYPES,
  getCppTypeForReservedPrimitive,
  getCppLocalIncludesForReservedPrimitive,
  getCppConversionIncludesForReservedPrimitive,
  getJavaImportsForReservedPrimitive
};