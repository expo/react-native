/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

'use strict';

/**
 * CSS Color 4 §12 interpolation: two colors (0xRRGGBBAA integers or
 * `normalizeColorSpace` objects) mixed premultiplied in a named
 * `<color-interpolation-method>`, returned in extended linear sRGB,
 * unclipped. The arithmetic is CSS Color 4 §10's, so it covers only the
 * spaces CSS defines.
 */

const RECTANGULAR_SPACES = new Set([
  'srgb',
  'srgb-linear',
  'display-p3',
  'display-p3-linear',
  'a98-rgb',
  'prophoto-rgb',
  'rec2020',
  'lab',
  'oklab',
  'xyz',
  'xyz-d50',
  'xyz-d65',
]);
const POLAR_SPACES = new Set(['hsl', 'hwb', 'lch', 'oklch']);
const HUE_METHODS = new Set(['shorter', 'longer', 'increasing', 'decreasing']);

/**
 * Parses `in <space> [<hue-method> hue]?` from a list of words, as CSS Color
 * 4 §12.1 writes a `<color-interpolation-method>`. Returns the method and
 * the words it didn't use, or null when the words name no method.
 */
function parseInterpolationMethod(words) {
  const index = words.indexOf('in');
  if (index === -1) {
    return null;
  }
  const space = words[index + 1];
  if (space == null) {
    return {error: true};
  }
  let used = 2;
  let hue = 'shorter';
  if (POLAR_SPACES.has(space)) {
    if (HUE_METHODS.has(words[index + 2]) && words[index + 3] === 'hue') {
      hue = words[index + 2];
      used = 4;
    }
  } else if (!RECTANGULAR_SPACES.has(space)) {
    return {error: true};
  }
  const rest = words.slice(0, index).concat(words.slice(index + used));
  return {method: {space: space === 'xyz' ? 'xyz-d65' : space, hue}, rest};
}

/**
 * The color at `progress` between two colors, mixed in `method`'s space.
 * Null when either color can't be converted by CSS's arithmetic.
 */
function interpolateColor(from, to, progress, method) {
  const fromXYZ = toXYZD65(from);
  const toXYZ = toXYZD65(to);
  if (fromXYZ == null || toXYZ == null) {
    return null;
  }
  let a = fromXYZD65(fromXYZ.xyz, method.space);
  let b = fromXYZD65(toXYZ.xyz, method.space);
  const polar = POLAR_SPACES.has(method.space);
  const hueIndex = method.space === 'hsl' || method.space === 'hwb' ? 0 : 2;

  if (polar) {
    // A powerless hue takes the other color's (CSS Color 4 §12.4)
    const aPowerless = isPowerless(a, method.space);
    const bPowerless = isPowerless(b, method.space);
    if (aPowerless && !bPowerless) {
      a = withHue(a, hueIndex, b[hueIndex]);
    } else if (bPowerless && !aPowerless) {
      b = withHue(b, hueIndex, a[hueIndex]);
    }
    const [h1, h2] = fixupHues(a[hueIndex], b[hueIndex], method.hue);
    a = withHue(a, hueIndex, h1);
    b = withHue(b, hueIndex, h2);
  }

  // Premultiplied (CSS Color 4 §12.3): every channel but hue
  const alpha = fromXYZ.alpha + (toXYZ.alpha - fromXYZ.alpha) * progress;
  const mixed = [0, 1, 2].map(i => {
    if (polar && i === hueIndex) {
      return a[i] + (b[i] - a[i]) * progress;
    }
    const premultiplied =
      a[i] * fromXYZ.alpha +
      (b[i] * toXYZ.alpha - a[i] * fromXYZ.alpha) * progress;
    return alpha === 0 ? 0 : premultiplied / alpha;
  });

  const linear = multiply(
    XYZ_D65_TO_LINEAR_SRGB,
    toXYZD65InSpace(mixed, method.space),
  );
  return {
    space: 'srgb-linear',
    r: linear[0],
    g: linear[1],
    b: linear[2],
    alpha,
  };
}

function isPowerless(channels, space) {
  switch (space) {
    case 'hsl':
      return channels[1] === 0;
    case 'hwb':
      return channels[1] + channels[2] >= 100;
    default:
      return channels[1] < 1e-6;
  }
}

function withHue(channels, index, hue) {
  const copy = [...channels];
  copy[index] = hue;
  return copy;
}

// CSS Color 4 §12.4's hue interpolation methods
function fixupHues(h1, h2, method) {
  let a = ((h1 % 360) + 360) % 360;
  let b = ((h2 % 360) + 360) % 360;
  switch (method) {
    case 'shorter':
      if (b - a > 180) {
        a += 360;
      } else if (b - a < -180) {
        b += 360;
      }
      break;
    case 'longer':
      if (b - a > 0 && b - a < 180) {
        a += 360;
      } else if (b - a > -180 && b - a <= 0) {
        b += 360;
      }
      break;
    case 'increasing':
      if (b < a) {
        b += 360;
      }
      break;
    case 'decreasing':
      if (a < b) {
        a += 360;
      }
      break;
  }
  return [a, b];
}

function multiply(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

function inverse(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

const LINEAR_SRGB_TO_XYZ_D65 = [
  [0.41239079926595934, 0.357584339383878, 0.1804807884018343],
  [0.21263900587151027, 0.715168678767756, 0.07219231536073371],
  [0.01933081871559182, 0.11919477979462598, 0.9505321522496607],
];
const XYZ_D65_TO_LINEAR_SRGB = inverse(LINEAR_SRGB_TO_XYZ_D65);
const LINEAR_P3_TO_XYZ_D65 = [
  [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0.0, 0.04511338185890264, 1.043944368900976],
];
const LINEAR_A98_TO_XYZ_D65 = [
  [0.5766690429101305, 0.1855582379065463, 0.1882286462349947],
  [0.29734497525053605, 0.6273635662554661, 0.07529145849399788],
  [0.02703136138641234, 0.07068885253582723, 0.9913375368376388],
];
const LINEAR_PROPHOTO_TO_XYZ_D50 = [
  [0.7977666449006423, 0.13518129740053308, 0.0313477341283922],
  [0.2880748288194013, 0.711835234241873, 0.00008993693872564],
  [0.0, 0.0, 0.8251046025104602],
];
const LINEAR_REC2020_TO_XYZ_D65 = [
  [0.6369580483012914, 0.14461690358620832, 0.1688809751641721],
  [0.2627002120112671, 0.6779980715188708, 0.05930171646986196],
  [0.0, 0.028072693049087428, 1.060985057710791],
];
/*
 * CSS Color HDR §3: PQ (SMPTE ST 2084) and HLG (ARIB STD-B67) signals to
 * linear light where 1 is the SDR reference white of 203 cd/m²; HLG's
 * nominal peak (signal 1) is 1000 cd/m², so its signal 0.75 is reference
 * white.
 */
const PQ_M1 = 2610 / 16384;
const PQ_M2 = (2523 / 4096) * 128;
const PQ_C1 = 3424 / 4096;
const PQ_C2 = (2413 / 4096) * 32;
const PQ_C3 = (2392 / 4096) * 32;
const REFERENCE_WHITE_NITS = 203;

function pqToLinear(signal) {
  const e = Math.pow(Math.max(signal, 0), 1 / PQ_M2);
  const nits =
    10000 * Math.pow(Math.max(e - PQ_C1, 0) / (PQ_C2 - PQ_C3 * e), 1 / PQ_M1);
  return nits / REFERENCE_WHITE_NITS;
}

function linearToPQ(value) {
  const y = Math.max((value * REFERENCE_WHITE_NITS) / 10000, 0);
  const ym1 = Math.pow(y, PQ_M1);
  return Math.pow((PQ_C1 + PQ_C2 * ym1) / (1 + PQ_C3 * ym1), PQ_M2);
}

const HLG_A = 0.17883277;
const HLG_B = 1 - 4 * HLG_A;
const HLG_C = 0.5 - HLG_A * Math.log(4 * HLG_A);

// HLG's inverse OETF (ITU-R BT.2100): scene light on 0–1
function hlgInverseOETF(signal) {
  const s = Math.max(signal, 0);
  return s <= 0.5 ? (s * s) / 3 : (Math.exp((s - HLG_C) / HLG_A) + HLG_B) / 12;
}

function hlgOETF(scene) {
  const e = Math.max(scene, 0);
  return e <= 1 / 12
    ? Math.sqrt(3 * e)
    : HLG_A * Math.log(12 * e - HLG_B) + HLG_C;
}

// CSS Color HDR: a signal of 0.75 is the reference white, so linear light is
// scaled by the scene light at 0.75
const HLG_WHITE_SCENE = hlgInverseOETF(0.75);

function hlgToLinear(signal) {
  return hlgInverseOETF(signal) / HLG_WHITE_SCENE;
}

function linearToHLG(value) {
  return hlgOETF(value * HLG_WHITE_SCENE);
}

const D50_TO_D65 = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];
const D65_TO_D50 = inverse(D50_TO_D65);
const OKLAB_TO_LMS = [
  [1.0, 0.3963377773761749, 0.2158037573099136],
  [1.0, -0.1055613458156586, -0.0638541728258133],
  [1.0, -0.0894841775298119, -1.2914855480194092],
];
const LMS_TO_XYZ_D65 = [
  [1.2268798758459243, -0.5578149944602171, 0.2813910456659647],
  [-0.0405757452148008, 1.112286803280317, -0.0717110580655164],
  [-0.0763729366746601, -0.4214933324022432, 1.5869240198367816],
];
const XYZ_D65_TO_LMS = inverse(LMS_TO_XYZ_D65);
const LMS_TO_OKLAB = inverse(OKLAB_TO_LMS);
const D50_WHITE = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];

const signed = (fn, v) => Math.sign(v) * fn(Math.abs(v));
const srgbToLinear = v =>
  signed(x => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4), v);
const linearToSRGB = v =>
  signed(x => (x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055), v);
const a98ToLinear = v => signed(x => x ** (563 / 256), v);
const linearToA98 = v => signed(x => x ** (256 / 563), v);
const proPhotoToLinear = v =>
  signed(x => (x <= 16 / 512 ? x / 16 : x ** 1.8), v);
const linearToProPhoto = v =>
  signed(x => (x < 1 / 512 ? x * 16 : x ** (1 / 1.8)), v);
const REC2020_ALPHA = 1.09929682680944;
const REC2020_BETA = 0.018053968510807;
const rec2020ToLinear = v =>
  signed(
    x =>
      x < REC2020_BETA * 4.5
        ? x / 4.5
        : ((x + REC2020_ALPHA - 1) / REC2020_ALPHA) ** (1 / 0.45),
    v,
  );
const linearToRec2020 = v =>
  signed(
    x =>
      x < REC2020_BETA
        ? x * 4.5
        : REC2020_ALPHA * x ** 0.45 - (REC2020_ALPHA - 1),
    v,
  );

const KAPPA = 24389 / 27;
const EPSILON = 216 / 24389;

function labToXYZD50([l, a, b]) {
  const f1 = (l + 16) / 116;
  const f0 = a / 500 + f1;
  const f2 = f1 - b / 200;
  const x = f0 ** 3 > EPSILON ? f0 ** 3 : (116 * f0 - 16) / KAPPA;
  const y = l > KAPPA * EPSILON ? ((l + 16) / 116) ** 3 : l / KAPPA;
  const z = f2 ** 3 > EPSILON ? f2 ** 3 : (116 * f2 - 16) / KAPPA;
  return [x * D50_WHITE[0], y * D50_WHITE[1], z * D50_WHITE[2]];
}

function xyzD50ToLab(xyz) {
  const f = xyz.map((v, i) => {
    const scaled = v / D50_WHITE[i];
    return scaled > EPSILON ? Math.cbrt(scaled) : (KAPPA * scaled + 16) / 116;
  });
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}

function oklabToXYZD65(lab) {
  const lms = multiply(OKLAB_TO_LMS, lab).map(v => v ** 3);
  return multiply(LMS_TO_XYZ_D65, lms);
}

function xyzD65ToOKLab(xyz) {
  const lms = multiply(XYZ_D65_TO_LMS, xyz).map(Math.cbrt);
  return multiply(LMS_TO_OKLAB, lms);
}

function rectangularToPolar([l, a, b]) {
  const hue = (Math.atan2(b, a) * 180) / Math.PI;
  return [l, Math.hypot(a, b), (hue + 360) % 360];
}

function polarToRectangular([l, c, h]) {
  const radians = (h * Math.PI) / 180;
  return [l, c * Math.cos(radians), c * Math.sin(radians)];
}

function hslToSRGB([h, s, l]) {
  s /= 100;
  l /= 100;
  const f = n => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function srgbToHSL([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (min + max) / 2;
  const d = max - min;
  let h = NaN;
  let s = 0;
  if (d !== 0) {
    s = l === 0 || l === 1 ? 0 : (max - l) / Math.min(l, 1 - l);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h *= 60;
  }
  // A color outside sRGB's gamut can come out with negative saturation, which
  // CSS Color 4's sample code turns round to the opposite hue
  if (s < 0) {
    h += 180;
    s = Math.abs(s);
  }
  if (h >= 360) {
    h -= 360;
  }
  return [Number.isNaN(h) ? 0 : h, s * 100, l * 100];
}

function hwbToSRGB([h, w, b]) {
  w /= 100;
  b /= 100;
  if (w + b >= 1) {
    const gray = w / (w + b);
    return [gray, gray, gray];
  }
  return hslToSRGB([h, 100, 50]).map(v => v * (1 - w - b) + w);
}

function srgbToHWB(rgb) {
  const [h] = srgbToHSL(rgb);
  const w = Math.min(...rgb);
  const b = 1 - Math.max(...rgb);
  return [h, w * 100, b * 100];
}

// A space's coordinates to XYZ-D65
function toXYZD65InSpace(c, space) {
  switch (space) {
    case 'srgb':
      return multiply(LINEAR_SRGB_TO_XYZ_D65, c.map(srgbToLinear));
    case 'srgb-linear':
      return multiply(LINEAR_SRGB_TO_XYZ_D65, c);
    case 'display-p3':
      return multiply(LINEAR_P3_TO_XYZ_D65, c.map(srgbToLinear));
    case 'display-p3-linear':
      return multiply(LINEAR_P3_TO_XYZ_D65, c);
    case 'a98-rgb':
      return multiply(LINEAR_A98_TO_XYZ_D65, c.map(a98ToLinear));
    case 'prophoto-rgb':
      return multiply(
        D50_TO_D65,
        multiply(LINEAR_PROPHOTO_TO_XYZ_D50, c.map(proPhotoToLinear)),
      );
    case 'rec2020':
      return multiply(LINEAR_REC2020_TO_XYZ_D65, c.map(rec2020ToLinear));
    case 'rec2100-linear':
      return multiply(LINEAR_REC2020_TO_XYZ_D65, c);
    case 'rec2100-pq':
      return multiply(LINEAR_REC2020_TO_XYZ_D65, c.map(pqToLinear));
    case 'rec2100-hlg':
      return multiply(LINEAR_REC2020_TO_XYZ_D65, c.map(hlgToLinear));
    case 'xyz-d65':
      return c;
    case 'xyz-d50':
      return multiply(D50_TO_D65, c);
    case 'lab':
      return multiply(D50_TO_D65, labToXYZD50(c));
    case 'lch':
      return multiply(D50_TO_D65, labToXYZD50(polarToRectangular(c)));
    case 'oklab':
      return oklabToXYZD65(c);
    case 'oklch':
      return oklabToXYZD65(polarToRectangular(c));
    case 'hsl':
      return toXYZD65InSpace(hslToSRGB(c), 'srgb');
    case 'hwb':
      return toXYZD65InSpace(hwbToSRGB(c), 'srgb');
    default:
      return null;
  }
}

// XYZ-D65 to a space's coordinates
function fromXYZD65(xyz, space) {
  const linearSRGB = () => multiply(XYZ_D65_TO_LINEAR_SRGB, xyz);
  switch (space) {
    case 'srgb':
      return linearSRGB().map(linearToSRGB);
    case 'srgb-linear':
      return linearSRGB();
    case 'display-p3':
      return multiply(inverse(LINEAR_P3_TO_XYZ_D65), xyz).map(linearToSRGB);
    case 'display-p3-linear':
      return multiply(inverse(LINEAR_P3_TO_XYZ_D65), xyz);
    case 'a98-rgb':
      return multiply(inverse(LINEAR_A98_TO_XYZ_D65), xyz).map(linearToA98);
    case 'prophoto-rgb':
      return multiply(
        inverse(LINEAR_PROPHOTO_TO_XYZ_D50),
        multiply(D65_TO_D50, xyz),
      ).map(linearToProPhoto);
    case 'rec2020':
      return multiply(inverse(LINEAR_REC2020_TO_XYZ_D65), xyz).map(
        linearToRec2020,
      );
    case 'rec2100-linear':
      return multiply(inverse(LINEAR_REC2020_TO_XYZ_D65), xyz);
    case 'rec2100-pq':
      return multiply(inverse(LINEAR_REC2020_TO_XYZ_D65), xyz).map(linearToPQ);
    case 'rec2100-hlg':
      return multiply(inverse(LINEAR_REC2020_TO_XYZ_D65), xyz).map(linearToHLG);
    case 'xyz-d65':
      return xyz;
    case 'xyz-d50':
      return multiply(D65_TO_D50, xyz);
    case 'lab':
      return xyzD50ToLab(multiply(D65_TO_D50, xyz));
    case 'lch':
      return rectangularToPolar(xyzD50ToLab(multiply(D65_TO_D50, xyz)));
    case 'oklab':
      return xyzD65ToOKLab(xyz);
    case 'oklch':
      return rectangularToPolar(xyzD65ToOKLab(xyz));
    case 'hsl':
      return srgbToHSL(linearSRGB().map(linearToSRGB));
    case 'hwb':
      return srgbToHWB(linearSRGB().map(linearToSRGB));
    default:
      return null;
  }
}

/*
 * A color, as `normalizeColor` or `normalizeColorSpace` gives it, in
 * XYZ-D65 with its alpha. Null for a space CSS doesn't define.
 */
function toXYZD65(color) {
  if (typeof color === 'number') {
    /* eslint-disable no-bitwise */
    const rgba = color >>> 0;
    const srgb = [rgba >>> 24, (rgba >>> 16) & 0xff, (rgba >>> 8) & 0xff].map(
      v => v / 255,
    );
    return {xyz: toXYZD65InSpace(srgb, 'srgb'), alpha: (rgba & 0xff) / 255};
    /* eslint-enable no-bitwise */
  }
  if (color == null || typeof color.space !== 'string') {
    return null;
  }
  let channels;
  if ('r' in color) {
    channels = [color.r, color.g, color.b];
  } else if ('x' in color) {
    channels = [color.x, color.y, color.z];
  } else if ('c' in color) {
    channels = [color.l, color.c, color.h];
  } else {
    channels = [color.l, color.a, color.b];
  }
  const xyz = toXYZD65InSpace(channels, color.space);
  return xyz == null ? null : {xyz, alpha: color.alpha ?? 1};
}

/*
 * The nearest 8-bit sRGB integer (clipped), for APIs that take only an
 * integer; null for a space CSS doesn't define
 */
function approximateSRGB(color) {
  if (typeof color === 'number') {
    return color;
  }
  const converted = toXYZD65(color);
  if (converted == null) {
    return null;
  }
  const rgb = fromXYZD65(converted.xyz, 'srgb');
  const channel = v => Math.round(Math.min(Math.max(v, 0), 1) * 255);
  const alpha = Math.round(Math.min(Math.max(converted.alpha, 0), 1) * 255);
  /* eslint-disable no-bitwise */
  return (
    ((channel(rgb[0]) << 24) |
      (channel(rgb[1]) << 16) |
      (channel(rgb[2]) << 8) |
      alpha) >>>
    0
  );
  /* eslint-enable no-bitwise */
}

module.exports = {approximateSRGB, interpolateColor, parseInterpolationMethod};
