# Color spaces and HDR in the React Native fork

**Status:** Draft r3, 2026-10-03, for review. Nothing here is built.
**Sources:** exact2's LLP 1082 "Color spaces and HDR" and LLP 1081 "Platform colours" on `ide/exact2` branch `feat/colour-spaces-and-hdr` (55a675ec), with its `apps/color-gallery`. The fork facts are from `frontier` at `0cdeea0eac6`.
**r2 folds the owner's answers (§9):** support is asked of the device and OS at run time, never mapped statically; images mean the fork's `<img>` element for now, designed so expo-image can adopt it later; everything is behind one feature flag and is PR'd; the parser is chosen for semantic and structural soundness; platform capabilities beyond CSS are reachable.

## Summary

React Native is 8-bit sRGB nearly end to end. A colour crosses from JS as a 32-bit ARGB int. On Android it stays an int all the way to the `Paint`. On iOS a colour becomes a `UIColor` with float components, but every path that reads it back (hashing, transitions, `DynamicColorIOS`, gradient hints, `Animated`) squeezes it through an 8-bit int. Upstream added a Display P3 object (`{space, r, g, b, a}`) that native parses, but no JS API produces it, and Android throws the space away. Nothing handles HDR.

This design ports exact2's decisions to React Native and gives Android the iOS treatment. All of it is behind one feature flag, `enableColorSpaces`; with the flag off, behaviour is today's.

1. **A colour names its space, and every space CSS names can be written.** All of CSS Color 4 and CSS Color HDR. A colour that is exactly 8-bit sRGB stays the int it is today, so an sRGB app pays nothing.
2. **The platform manages colour, and the device and OS decide what is supported.** Each host asks its platform at run time for a colour space by its standard name. React Native does only the arithmetic CSS defines.
3. **A picture in `<img>` keeps its own space and precision**, and `dynamic-range-limit` governs HDR, with CSS's `no-limit` default.
4. **What a platform offers beyond CSS stays reachable,** through CSS's own extension points: dashed names for spaces CSS doesn't predefine, and `dynamic-range-limit-mix()` for headroom between CSS's three limits.
5. **Android follows the iOS principles.** It needs one extra step that iOS doesn't (C7), which the framework takes on the app's behalf.

## 1. What exists today

| | iOS | Android |
|---|---|---|
| **Colour wire** | ARGB int, or `{semantic}`, `{dynamic}`, `{space,r,g,b,a}` objects (`processColor.js`, `PlatformColorValueTypes.ios.js`) | ARGB int, or `{resource_paths}`; JS drops `{space}` objects (`PlatformColorValueTypes.android.js:42-45`) |
| **CSS syntax** | hex, `rgb()`, `hsl()`, `hwb()`, names, in JS (`@react-native/normalize-colors`) and, behind `enableNativeCSSParsing`, in C++ (`CSSColor`). Neither parses `color()`, `lab`, `lch`, `oklab`, `oklch` (`CSSColorFunction.h:401` TODO) | same |
| **Native colour** | `UIColor` in sRGB or P3 (`HostPlatformColor.mm:121-134`); floats survive in the `UIColor` | `struct Color { int32_t value; bool isDefined; }`: 8-bit, space discarded (`HostPlatformColor.h:23`) |
| **Read-back** | `getColor()`/`getColorComponents()` go through `getRed:` to 8-bit and mask with `& 0xff`, so extended values wrap rather than clamp (`HostPlatformColor.h:45-54`, `.mm:99-104`) | already 8-bit |
| **Untagged ints** | `ColorComponents.colorSpace` defaults to the process-global space, so with `RCTSetDefaultColorSpace(DisplayP3)` every plain int is drawn as P3 (`fromRawValueShared.cpp:35-43`) | `ColorPropConverter.getColorInstance` builds a colour long from `{space}` (:84-108), then `getColor` reduces it to an int (:142-143) |
| **Dynamic and platform colours** | `DynamicColorIOS` stores four `int32_t`s, so P3 and floats are lost (`HostPlatformColor.h:18-23`) | `PlatformColor` resolves to an int over JNI |
| **Gradients** | `CAGradientLayer` with each stop's `CGColor` (P3 kept); hints computed in 8-bit sRGB (`RCTGradientUtils.mm:240-253`) | `IntArray` stops; hints by `ColorUtils.blendARGB` (`ColorStop.kt:224`) |
| **Transitions** | `interpolateColor`: premultiplied sRGB over 8-bit components; the result takes the global default space (`CSSTransitions.cpp:180-206`) | same |
| **Window** | n/a | `setColorMode(COLOR_MODE_WIDE_COLOR_GAMUT)` only if the app overrides `isWideColorGamutEnabled()` (`ReactActivityDelegate.java:143`); no HDR mode |
| **`<img>`** | `ImageShadowNode` (`ImgTagComponentName`) mounted as `RCTImageComponentView`, whose image view is a `UIImageView` subclass; decoded by `RCTImageUtils.mm` (`CGImageSourceCreateThumbnail`, then a `UIGraphicsImageRenderer` redraw) | mapped to `RCTImageView`, i.e. `ReactImageView` on Fresco (`FabricNameComponentMapping.kt:38`) |
| **`CSS.supports`, `matchMedia`** | none | none |
| **HDR** | none | none |

Three consequences, as in exact2:

- **An author can't write a P3 colour** that reaches the screen in its own space, and can't write `oklch()` at all.
- **A wide colour is wrong on Android everywhere**, and wrong on iOS as soon as it animates, sits in a `DynamicColorIOS`, or forms a gradient hint.
- **An HDR photo in `<img>` is an SDR photo.**

## 2. Principles

Exact2's, which the owner ruled on for LLP 1081 and 1082, restated for React Native, with this review's additions.

- **The web is the standard for names, syntax and semantics.** Untagged colours and pictures are sRGB. Interpolation spaces, gamut mapping and `dynamic-range-limit`'s initial value are CSS's.
- **Standards, not vendors.** A space is named by CSS, or by its standard as a dashed name (`--dci-p3`). Nothing author-facing is spelled `ios-`, `android-` or `cg-`.
- **The platform manages colour; React Native never does.** No ICC parsing, no colour-management library, no conversion to the display's space, no tone mapping by hand.
- **Support is the device's and the OS's, asked at run time.** Which colour spaces, image formats, depths and dynamic ranges work depends on the OS version and the hardware. Nothing is decided from a static table of what a platform "has". The host asks the platform when it first needs an answer, and caches it for the process, or until the display changes.
- **Platform capabilities beyond CSS are reachable.** Where a platform can do more than CSS describes (a colour space CSS doesn't predefine, finer control of HDR headroom, deeper bitmaps), the design exposes it through the CSS mechanism that describes it most closely, and it is simply unavailable where the platform can't.
- **The OS decides how the display is driven.** React Native tags content with its space and asks for a dynamic range. It never reads the current headroom to tone-map.
- **On native platforms the OS resolves platform colours** (LLP 1081): a `PlatformColor` or `DynamicColorIOS` is resolved by the platform where it draws, never snapshotted to 8-bit sRGB.
- **Pay for what you use.** An app of 8-bit sRGB colours and pictures costs exactly what it costs today.
- **Everything lands upstream-ready:** behind `enableColorSpaces`, in reviewable PRs, each with its tests.

## 3. Decisions: colour values

### C1. Colour spaces by standard name, resolved by the platform at run time

**The names** are CSS Color 4's predefined spaces (`srgb`, `srgb-linear`, `display-p3`, `display-p3-linear`, `a98-rgb`, `prophoto-rgb`, `rec2020`, `xyz`, `xyz-d50`, `xyz-d65`), CSS Color HDR's (`rec2100-pq`, `rec2100-hlg`, `rec2100-linear`), and dashed standard names for spaces CSS doesn't predefine (C5). The list of names is data in one place, `react/renderer/graphics/ColorSpace.h`. It says nothing about which platform supports which.

**Resolution happens on the device.** Each host turns a name into a platform colour space the first time it meets it, by asking the platform:
- **iOS:** `CGColorSpaceCreateWithName` with the standard's `kCGColorSpace…` name. A name the OS doesn't know, or one it returns `NULL` for, is unsupported on this device.
- **Android:** `ColorSpace.get(ColorSpace.Named.valueOf("<NAME>"))`, looked up by string. A constant added in a later API level is then found on the OS versions that have it and reported as unsupported on those that don't, with no API-level table in our code. Below API 26 there is no `ColorSpace` class, which the same lookup reports.
- The answer is cached per name for the process.

**When the platform doesn't support a space,** CSS's own definition decides what happens:
- **A CSS predefined space or a CSS function** (`lab`, `oklch`, …) is defined by CSS arithmetic (CSS Color 4 §10 and its sample code). The value is converted once, by that arithmetic, into the widest space the platform does support, without clipping: extended linear sRGB where it exists, else sRGB. This is computing a CSS value, as a browser does, not colour management.
- **A dashed space** has no CSS definition, so converting it would be colour management. It is unsupported: in development a warning names the space and says the device doesn't provide it, and the prop takes its initial value, as an invalid colour does today. An app that wants a fallback asks first with `CSS.supports` (C8).

**The display is not consulted here.** A P3 colour on an sRGB panel is still a P3 colour; the OS maps it to the panel, and maps it again if the content moves to another display. Display facts matter only for decisions the OS can't make for us, such as decoding an HDR picture (I3).

### C2. The colour value carries its space; sRGB stays an int

- **The common case doesn't change.** A colour that is exactly 8-bit sRGB (hex, legacy `rgb()`, `hsl()`, `hwb()`, a name, when it quantizes exactly) stays the ARGB int on the wire and in `SharedColor`.
- **Everything else is a wide colour,** `{space, components, alpha}` in floats. That covers any `color()`, `lab`/`lch`/`oklab`/`oklch`, a non-integer or out-of-range `rgb()`, and every HDR space.
- **Untagged is sRGB.** Under the flag an int is always sRGB, whatever the process-global default colour space says, because CSS says so. With the flag off the global default keeps its current meaning. When the flag defaults on and is removed, the global default goes with it.

**Per platform:**

- **iOS.** `Color` keeps its `UIColor`, built from a `CGColor` in the resolved space (C1). The 8-bit read-back paths go: `getColorComponents()` returns floats with their space, and the hash uses the floats and the space. `DynamicColorIOS` holds four `SharedColor`s, not four ints, so each variant keeps its space and precision.
- **Android.** `Color` holds a 64-bit `@ColorLong`, Android's own colour encoding. For sRGB that is the ARGB int shifted left 32 bits, so the int path keeps its meaning. A wide colour is packed by `Color.pack(r, g, b, a, space)` with the space resolved in C1, on the Java side where the resolution lives. The long reaches every place that paints:
  - view props: `ColorPropConverter` returns the long; `BackgroundDrawable`, `BorderDrawable`, outline and `BackgroundStyleApplicator` take `@ColorLong` and call `Paint.setColor(long)`;
  - text: the MapBuffer carries the long (`putLong`), and the foreground span sets `TextPaint.setColor(long)`;
  - shadows: `Paint.setShadowLayer(..., long)`;
  - gradients: the `long[]` constructors of `LinearGradient`, `RadialGradient` and `SweepGradient`.

  Whether the running OS accepts colour longs is asked the same way as in C1, not assumed from an API level. Where it doesn't, the colour is converted by C1's rule and painted as an int.
- **Cost.** Android's `Color` grows from 8 to 16 bytes in every colour prop, unless `isDefined` can be folded into the long as a reserved bit pattern; that has to be checked against Android's packing rules first. The per-OS prop-size guards record whichever is chosen.

### C3. Parsing: one CSS colour parser, in JS, where every colour is already normalized

**Decision (r3):** `@react-native/normalize-colors`, behind `processColor`, is the one parser for colour syntax. r2 chose the C++ `CSSColor` parser; a fact found while starting stage 1 reversed that:

- **Android views read the raw JS prop values.** Fabric on Android hands view managers `rawProps` (`FabricMountingManager.cpp`), and C++ serializes its own parsed props only under `enablePropsUpdateReconciliationAndroid`, which defaults to off. A C++-only parser would leave `ColorPropConverter` needing a second CSS parser in Java for backgrounds, borders and every other view colour.
- **`processColor` already normalizes every colour before it crosses to native,** and its output, an int or `{space, r, g, b, a}`, is already read by C++ (`fromRawValue`) and by Android (`ColorPropConverter`). Extending that shape keeps one grammar, one place where strings become values, and the native layers reading structured values only.
- **JS-thread `Animated` keeps working** with modern colours, since the parser is where it already reads colours.

**The wire value:**
- sRGB that quantizes exactly to 8 bits stays the ARGB int.
- An RGB-model space crosses as upstream's `{space, r, g, b, a}`, with C1's names.
- A Lab-model colour crosses as `{space, components: [l, a, b], alpha}` in `lab` (D50, as CSS defines it) or `oklab`. `lch()` and `oklch()` are converted to their rectangular forms by CSS's own polar-to-rectangular arithmetic, so native meets two Lab spaces, not four.
- An XYZ colour crosses as `{space, components: [x, y, z], alpha}`.

**C++ `CSSColor`** stays the experimental native-parsing path (`enableNativeCSSParsing`). One shared test corpus (CSS Color 4's WPT parsing cases, vendored as data) holds both parsers to the same answers until the native path either replaces the JS one or is removed.

**Serialization** follows CSS Color 4 §15.

### C4. CSS arithmetic only where CSS computes, in the space CSS names

React Native computes colours in four places. Each follows CSS Color 4 §12 and works in floats:

- **Gradients.** `in <space> [<hue-method>]` in `linear-gradient()`, `radial-gradient()` and `conic-gradient()`. Without it: Oklab when any stop is a modern colour, otherwise today's sRGB path. Neither `CAGradientLayer` nor Android's shaders interpolate in a chosen space, so a non-legacy ramp is sampled 16 times per segment in that space and handed over in extended linear sRGB, as exact2 does. Hints use the same mixing.
- **Transitions and animations** (`CSSTransitions.cpp`). If either endpoint is modern, both move in premultiplied Oklab; two legacy colours stay in premultiplied sRGB. The finished value is the target colour as written. Keyframe colours change from `std::optional<int32_t>` to `SharedColor`.
- **Native-driver `Animated`** (`InterpolationAnimatedNode.cpp`) uses the same mixer.
- **`color-mix()`**, with CSS's default Oklab. The JS helper in `rn-tester/js/astryx/colorMix.js` goes away.

A computation over a dashed colour is refused, since converting it would be colour management.

### C5. Spaces beyond CSS: dashed standard names

Platforms ship spaces CSS doesn't predefine. They are written as CSS Color 5 writes a profile, a dashed name, and named by their standard:

| name | standard | iOS asks for | Android asks for |
|---|---|---|---|
| `--dci-p3` | SMPTE RP 431-2 | `kCGColorSpaceDCIP3` | `DCI_P3` |
| `--rec709` | ITU-R BT.709 | `kCGColorSpaceITUR_709` | `BT709` |
| `--aces-cg` | ACES AP1, linear | `kCGColorSpaceACESCGLinear` | `ACESCG` |
| `--aces` | ACES AP0, linear | | `ACES` |
| `--ntsc-1953`, `--smpte-c` | | | `NTSC_1953`, `SMPTE_C` |
| `--display-p3-pq`, `--display-p3-hlg`, `--rec709-pq`, `--rec709-hlg`, `--rec2020-srgb-transfer`, `--gray-gamma-2.2`, `--gray-linear` | as LLP 1082 D1 | the matching `kCGColorSpace…` | |

The columns say which identifier each host asks for, not what is supported: whether the answer is a colour space is up to the device (C1). A blank means the platform has no identifier to ask with.

**Custom ICC profiles** (`@color-profile`) are not in this design. Android has no public API that builds a `ColorSpace` from ICC bytes, and React Native has no at-rule surface. iOS could (`CGColorSpace(iccData:)`) when a consumer asks.

### C6. Platform colours stay the platform's (LLP 1081)

- **iOS:** a `PlatformColor` or `DynamicColorIOS` is a `UIColor` resolved by UIKit against the view's traits where it draws. Transitions and gradients that need its value resolve it with the view's `traitCollection` into floats, in extended range, never through `getColor()`'s 8-bit int. That fixes LLP 1081 §10.1's three defects for React Native: gamut clipped, a snapshot per trait set, and 8 bits.
- **Android:** colour resources are ARGB ints, so a resolved `PlatformColor` is exactly sRGB and loses nothing.
- **The gallery measures which iOS system colours are P3,** in light, dark and both with Increased Contrast (LLP 1081 §6).

### C7. Android: the window must be asked to show wide colour and HDR

**What this is.** On iOS, every view is colour-matched to the screen all the time: a P3 colour in any view shows as P3 on a P3 screen, and React Native does nothing. Android is different. An Android window draws into one surface, and that surface has a *colour mode* the app chooses:

- **Default mode:** the surface is sRGB. A P3 colour or a P3 photo is converted to sRGB and clipped, even on a P3 screen.
- **Wide colour gamut mode:** the surface can hold P3, so P3 content shows as P3. It costs more memory and bandwidth on some devices, which is why it isn't the default.
- **HDR mode (API 34):** the surface can also go brighter than SDR white, which HDR pictures need.

So on Android, showing a wide colour takes two things: a colour in its space (C2), and a window in a mode that keeps it. Today React Native sets wide mode only if an app overrides `isWideColorGamutEnabled()`, and never HDR mode.

**Decision:** the framework sets the mode for the app, so an author writes `color(display-p3 1 0 0)` and sees it, as on iOS.
- The host keeps a count of mounted views that need wide gamut: a wide colour in their props, or a wide or deep picture. While it is above zero, and the display reports wide gamut support (`Display.isWideColorGamut()`, asked at run time), the window is in wide mode. When it drops to zero, the window returns to default.
- While an HDR picture is visible and its `dynamic-range-limit` isn't `standard`, the window is in HDR mode, which includes wide gamut.
- `isWideColorGamutEnabled()` stays as an app-wide override that pins wide mode on.
- **Stage 0 measures** whether a switch is visible and what each mode costs in memory on a Pixel. If switching is visible, the fallback is to switch on the first wide content and stay wide for the activity's life, and the design records that.

### C8. Asking what is supported

An app sometimes needs to know before it chooses a colour. `CSS.supports('color', 'color(--dci-p3 1 0 0)')`, CSS's own API, answers from C1's run-time resolution on this device. The fork has no `CSS.supports` today, so this adds it, with only the colour case answered at first.

## 4. Decisions: images in `<img>`

Scope: the fork's `<img>` element on the framework image view (`ImageShadowNode`, mounted as `RCTImageComponentView` on iOS and `ReactImageView` on Android), on both platforms (ruling 6). In an app with the Expo runtime, `<img>` resolves to expo-image today; that backing waits. Everything author-facing is CSS (`dynamic-range-limit`, the display media features), so expo-image can adopt the same props later by reading the same inherited style, without a second API.

### I1. Classify at decode: standard, wide, deep, HDR

Exact2's classes, unchanged:

| class | what puts a picture in it | stored |
|---|---|---|
| standard | ≤ 8 bits, sRGB or untagged | as today, 4 B/px |
| wide | ≤ 8 bits, any other RGB profile | 8-bit in its own space, 4 B/px |
| deep | > 8 bits, SDR | 16-bit float in its own space, 8 B/px |
| HDR | gain map, PQ or HLG transfer, float | the HDR rendition where the display and the limit allow it, otherwise the platform's SDR rendition |

The class is read from the file's header. What the device can decode and store (HEIC, AVIF, gain maps, `RGBA_F16`, `RGBA_1010102`) is asked of the platform, not assumed.

### I2. Decoding

- **iOS** (`RCTImageUtils.mm`): keep the source's space instead of redrawing into the renderer's default format; allow float for deep sources; for HDR use `kCGImageSourceDecodeRequest` to get the HDR or SDR rendition. The view is a `UIImageView`, so `preferredImageDynamicRange` does the layer work exact2 had to do by hand.
- **Android** (Fresco under `ReactImageView`): `BitmapFactory` and `ImageDecoder` keep a picture's colour space, and its gain map where the OS supports gain maps. Fresco's decode options can override the colour space. Stage 0 records what Fresco actually returns per fixture. The fix asks Fresco to keep the source's space, decode deep sources to `RGBA_F16`, and keep the gain map.
- **Budgets.** Fresco's cache and iOS's image cache count bytes. A deep or HDR bitmap is charged its 8 B/px, and exact2's fallback ladder applies where we choose the decode: HDR, then the SDR rendition, then 8 bits in its own space, then half resolution.

### I3. `dynamic-range-limit`, and headroom beyond CSS's three values

A new inherited style prop from CSS Color HDR: `standard | constrained | no-limit`, initial `no-limit`, paint-only.

- **iOS:** the image view's `preferredImageDynamicRange`: `standard` → `.standard`, `constrained` → `.constrainedHigh`, `no-limit` → `.high`.
- **Android:** per element, `standard` shows the SDR rendition (the bitmap without its gain map). The window's HDR mode follows C7.
- **The default is CSS's on both platforms.** UIKit's image view otherwise defers to its trait collection. This is exact2's ruling: consistency, with one inherited prop to switch.
- **Beyond CSS's three values:** CSS Color HDR also defines `dynamic-range-limit-mix()`, which blends limits to a point between them. Where the OS has `Window.setDesiredHdrHeadroom` (Android 15), it is honoured as a number. On a platform that offers only discrete levels, the mix rounds to the nearest level, which is declared. That is how a platform capability finer than CSS's keywords stays reachable through CSS's own syntax.
- **Declared deviation, Android:** headroom is per window, so two HDR pictures on one screen with different limits share the most permissive one's headroom. Per-element `standard` still holds, because that picture is decoded to SDR.

### I4. Display facts

`matchMedia('(color-gamut: p3)')` and `matchMedia('(dynamic-range: high)')`, as Media Queries 5 spells them, with change events. The fork has no `matchMedia` today, so these would be its first features. Sources, asked at run time: iOS `traitCollection.displayGamut` and `UIScreen.potentialEDRHeadroom`; Android `Display.isWideColorGamut()`, `Display.isHdr()` and `getHighestHdrSdrRatio()` where the OS has it. Decisions use the potential headroom, never the current one. Tests pin both facts.

## 5. Out of scope

- **expo-image**, until after `<img>` (§4's API is shared, so adopting it is wiring, not design).
- **Video and canvas.** React Native core has neither.
- **Custom ICC `color-profile`** (C5).
- **Gain-map compositing at 8 bits** (LLP 1082 D7a).
- **HDR CSS colours drawn brighter than SDR white.** The value holds them (C2). Drawing them bright needs an EDR layer on iOS and the HDR window on Android, in a later stage.

## 6. Verification

- **V1. Parsing and values (blocking).** Fantom and C++ unit tests: the vendored WPT colour-parsing cases through `normalize-colors` (Jest), and through C++'s `CSSColor` for the forms it parses; int versus wide storage; serialization; `in <space>` gradients and Oklab transitions against CSS Color 4's examples; C1's fallback arithmetic for an unsupported space, by injecting "unsupported" into the resolver. Android: a JVM test that the long reaching the `Paint` equals `Color.pack` of the same value.
- **V2. What reaches the screen (simulator and emulator).** A debug-only sampler renders the window into an extended-range float buffer and reads points: iOS `UIGraphicsImageRenderer` with `preferredRange = .extended`; Android `PixelCopy` into an `RGBA_F16` bitmap in `LINEAR_EXTENDED_SRGB`. A `color(display-p3 1 0 0)` box should read about `[1.225, -0.042, -0.020]` in extended linear sRGB, the value exact2 measured on macOS. Screenshots stay 8-bit sRGB.
- **V3. The platform as the oracle.** Each fixture drawn by `<img>` and by a plain `UIImageView` or Android `ImageView` with HDR allowed, sampled the same way and compared.
- **V4. The browser as the oracle.** The gallery's colours and fixtures rendered in Chrome and Safari through the fork's browser-oracle harness, read back through a `display-p3` canvas.
- **V5. A person on real panels.** An iPhone with an XDR display and a Pixel with an HDR panel: exact2's seam test (each wide fixture beside a box of its patch colour, with no visible seam), HDR under each limit, and Android's mode switching.
- **V6. Cost.** An sRGB feed's bytes and decode time are identical before and after; a P3 feed's bytes are identical; deep and HDR report 2×; Android memory per window mode.

**Fixtures:** exact2's `scripts/fixtures/color/` set (F1–F20, under 2 MiB, each with a JSON of expected class and patch values) is copied into RNTester's assets as is.

**The gallery:** an RNTester "Color gallery" screen ported from exact2's `apps/color-gallery`: CSS spaces as rows of red, green, blue, mid and white chips; dashed spaces, each marked supported or not on this device; the `<img>` image-profile grid; HDR under each limit side by side, with a segmented control for the page's limit; text, shadows, gradients in each interpolation space, and a transition. It shows the display's gamut and dynamic range.

## 7. Landing order and PRs

Each stage is one or more PRs behind `enableColorSpaces`, each leaving the gate green.

0. **Measure, no product code.** Copy the fixtures, build the gallery against today's code, and record per platform what `<img>` decodes each fixture to, which iOS system colours are P3, and the cost of Android's window modes. Results go into §10.
1. **The flag, the space names and run-time resolution** (C1), with `CSS.supports` for colours (C8).
2. **The parser** (C3): `normalize-colors` learns CSS Color 4 and emits the wide wire value; the WPT corpus, shared with C++'s `CSSColor`.
3. **The colour value on iOS** (C2, C6): wide `SharedColor`, float read-back, `DynamicColorIOS` keeping its space, untagged is sRGB under the flag.
4. **Android's colour longs and window mode** (C2, C7).
5. **Interpolation** (C4): gradients `in <space>`, transitions, native-driver `Animated`, `color-mix()`.
6. **Wide and deep pictures in `<img>`** (I1, I2).
7. **HDR in `<img>`** (I3, I4), including `dynamic-range-limit-mix()` where the OS takes a headroom number.
8. **Later, on demand:** HDR CSS colours drawn bright; expo-image adopting §4.

## 8. Open questions

1. **`CSS.supports` and `matchMedia`.** The fork has neither. Adding them for colour (C8, I4) follows the web; the smaller alternative is a colour-only module. Recommendation: the web APIs, scoped to the colour cases at first.
2. **Android window mode.** Automatic (C7, recommended) once stage 0 shows the switch is invisible, or opt-in per app as upstream does today?

## 9. Rulings (2026-10-03)

1. **"Color space support depends on device and OS version. No static mappings."** C1 resolves every space on the device at run time; C5's table only lists which identifier each host asks with.
2. **"For images, for now let's just work on our HTML img element we made but we do want expo-image compatible in the future."** §4 is scoped to `<img>`, and its API is CSS, so expo-image can adopt it.
3. **"The plan is for everything in the fork to be PR'd. If we change the global default color space we probably should do this color space work under a flag."** Everything is behind `enableColorSpaces`; with it off, the global default keeps today's meaning (C2, §7).
4. **"For parser. Do what is semantically correct and leads to structurally sound code."** C3 (r3): `processColor`'s parser in JS is the one parser, because every native consumer, including Android's view managers that read raw JS props, already takes its output. C++'s `CSSColor` stays the experimental path, held to the same tests.
5. **"It would be good to allow for platform capabilities when they surpass CSS's."** A principle in §2: dashed spaces (C5), `dynamic-range-limit-mix()` as a headroom number (I3), and asking for decode formats rather than assuming them (I1).

6. **"Let's do 2 for now."** `<img>` work targets the framework image view on both platforms; expo-image adopts §4's CSS later.
7. **"Use css grid for the tester demos."** The gallery's tables, picture grid and segmented controls are CSS grid.

## 11. As built (2026-10-04, overnight)

On `feature/color-spaces`, behind `enableColorSpaces` (default off; RNTester turns it on). Flow reports no errors; the full Fantom suite passes (297 suites, 4,427 tests).

- **Parser** (`@react-native/normalize-colors/colorSpaces`): `color()` in every CSS Color 4 and CSS Color HDR space and the dashed standard spaces, `lab()`, `lch()`, `oklab()`, `oklch()`, with CSS's parsed-value rules. Legacy colors stay ints; a rich color is `{space, …named channels…, alpha}` with CSS's relative-color channel names. `normalizeColor` returns it under the flag, so `processColor`, `DynamicColorIOS` and JS-thread `Animated` all see it. A throwaway measurement found `alpha` and `a` allocate the same JS heap; `alpha` rendered 5–7% slower than `a` on 1,000 all-wide views in Fantom's unoptimized build, and was kept for CSS's naming.
- **Interpolation** (`@react-native/normalize-colors/colorInterpolation`): CSS Color 4 §12 in every interpolation space, premultiplied, with the four hue methods and powerless hues.
- **Gradients** (`processBackgroundImage`): `in <space> [<hue> hue]`; a gradient with a method, or a stop in its own space, has each stretch expanded into 16 stops computed in that space. Lengths and hints leave the gradient to the platform.
- **C++** (`ColorSpaceValue.h`): the names, the value, CSS's arithmetic to extended linear sRGB for fallbacks, Oklab mixing. `fromRawValue` reads every object shape; an integer is always sRGB under the flag.
- **iOS**: a `CGColor` in `CGColorSpaceCreateWithName`'s answer, else CSS's arithmetic (Lab and LCH always: Core Graphics' Lab gamut-maps). Float read-backs; `DynamicColorIOS` keeps each variant. Every chip on the simulator reads CSS's value. `--aces`, `--ntsc-1953`, `--smpte-c` have no iOS space and draw nothing.
- **Transitions**: Oklab when an end is in its own space, exact at the end. Verified on the simulator.
- **Android**: each space resolved through `ColorSpace.Named.valueOf` at run time; linear P3 and BT.2020 built from the platform's primaries; non-RGB colors converted by `ColorSpace.connect` (a `Paint` only draws RGB color longs). Color longs reach backgrounds, box shadows and text (through an interned table in the C++ color's padding and a new MapBuffer key). A window asks once for wide-gamut or HDR mode. Android has `--aces`, `--ntsc-1953`, `--smpte-c`, which iOS lacks.
- **Images**: `dynamicRangeLimit` on `Image` maps to `preferredImageDynamicRange` on iOS 17+; on Android a gain-map picture asks for the window's HDR mode (`constrained` draws as `no-limit` there).
- **Demos**: "Color spaces (CSS)" with core components only, "Color in HTML elements" with `<img>` and text-level elements; CSS grid; both with the sampler.

**Also built (2026-10-04, later):** `dynamic-range-limit` is inherited, through the cascade's `TextAttributes` bag, with both image nodes as cascade consumers publishing the effective value in their state. `CSS.supports` (colors and `dynamic-range-limit`) and `matchMedia` (`color-gamut`, `dynamic-range`, `video-dynamic-range`, `prefers-color-scheme`, with change events) are globals behind the flag, answered by a `DisplayCapabilities` core module that asks the OS for the display's gamut and headroom and for a dashed space's availability. HDR colors draw brighter than white: iOS sets a layer's preferred dynamic range (iOS 26) or its extended-range switch (iOS 17–25) for an HDR background or uniform border, and Android asks for the window's HDR mode for any HDR color long; "HDR" is a luminance above SDR white's, so a wide-gamut red stays SDR. Wide border colors draw on Android.

**Not yet:** on iOS, HDR text, shadows and gradients still draw at SDR white; HDR on a real panel (neither the simulator nor the emulator shows it).

**Found on the way:**
- A `Text` that is a direct child of a grid container lays out (Fantom: 100 × 23) but doesn't paint on iOS.
- `TA_KEY_VERTICAL_ALIGN` and `TA_KEY_WHITE_SPACE` share MapBuffer key 32, in C++ and Kotlin.
- A HEIC `<img>` crashed Android (fixed on `feature/android-heic`, verified: HEIC pictures now load).
- expo-image on iOS clips P3 PNG and HEIC to sRGB and draws nothing for 10-bit PQ and HLG HEIC.

## 10. Stage 0 results

RNTester has a "Color gallery" screen (branch `feature/color-spaces`) with the fixtures bundled, a switch to draw its pictures through `<img>` or the framework image view (`Image`), and a sampler (V2) that reads the window back in extended linear sRGB floats: `ScreenshotManager.sample` on both platforms, driven by the gallery's "Sample every chip and picture" button, which logs one `COLOR_SAMPLE` JSON line per point.

**Measured, extended linear sRGB, the fixture's red patch** (expected values are exact2's):

| fixture | expected | iOS, framework view | iOS, `<img>` = expo-image | Android, framework view (Fresco) |
|---|---|---|---|---|
| sRGB PNG | 1, 0, 0 | 1, 0, 0 | 0.979, 0.001, 0.001 | 1, 0, 0 |
| Display P3 PNG | 1.225, -0.042, -0.020 | 1.225, -0.042, -0.020 | 0.979, 0.001, 0.001 | 1, 0, 0 |
| Display P3 JPEG | 1.225, -0.042, -0.020 | 1.214, -0.042, -0.020 | 1.189, -0.040, -0.018 | 1, 0, 0 |
| Display P3 HEIC | 1.225, -0.042, -0.020 | 1.214, -0.042, -0.020 | 0.979, 0.001, 0.001 | skipped (crash) |
| Adobe RGB JPEG | 1.398, 0, 0 | 1.387, 0, 0 | 1.357, 0.001, 0.001 | 1, 0, 0 |
| ProPhoto 16-bit TIFF | 2.034, -0.229, -0.009 | 2.034, -0.229, -0.009 | 1.991, -0.223, -0.007 | doesn't draw |

What the table says:
- **iOS's framework image view already keeps a picture's own colour space**: every wide fixture reads back within lossy-codec error, and the PQ cICP PNG reads its HDR values above 1 (max error 0.001 against nits ÷ 203), so the bitmap holds HDR. Whether the panel shows it brighter than white can't be seen on the simulator. For iOS `<img>`, images work is mostly HDR control (I3), not decoding.
- **expo-image clips some wide pictures and offsets every colour slightly**: P3 PNG and P3 HEIC come back as sRGB red, while P3 JPEG, Adobe RGB and ProPhoto keep their gamut, and its sRGB red reads 0.979 rather than 1. That is a bug list for when expo-image adopts §4.
- **Android clips every wide picture to sRGB**, consistent with Fresco keeping the source space (above) and the window composing in sRGB (C7). A wide-gamut device would confirm which.
- **Colour chips:** every non-legacy chip reads the page background on both platforms, as the screenshots showed.


**Android, emulator (API 36), framework image view (Fresco 3.7.0):**
- **`<img>` is backed by `ReactImageView` on Fresco**, not expo-image, because RNTester's Android build has no Expo runtime.
- **A HEIC `<img>` crashes the app.** Fresco reads a HEIF's EXIF orientation through `androidx.exifinterface`, which neither Fresco's POMs nor ReactAndroid declare, so the first HEIC throws `NoClassDefFoundError` on the network thread and kills the process. This is a framework bug independent of colour, worth its own PR. The gallery skips HEIC on Android until it is fixed.
- **Fresco keeps a picture's own colour space by default.** In `DefaultRawBitmapDecoder` (bytecode, 3.7.0), `inPreferredColorSpace` is set only when `forceSrgbColorSpace` is on or a colour space is passed; otherwise `BitmapFactory` decodes into the file's own space. ReactAndroid passes neither. So the decode side of wide pictures may already be right, and what clips them is the window's default sRGB mode (C7). Confirming that needs V2's sampler or a wide display.
- **TIFF and OpenEXR don't draw**; Android's decoders don't take them. PQ AVIF and the gain-map JPEGs draw their SDR form. The 16-bit cICP PQ PNG draws as raw black and white patches, so its PQ transfer isn't applied.
- **No CSS colour beyond the legacy forms parses**: every `color()`, `lab()`, `lch()`, `oklab()`, `oklch()` and dashed chip is empty, and P3 shadows and text draw nothing or the default colour. Every `in <space>` gradient draws nothing; only the legacy gradient draws.
- **The emulator's display is sRGB and SDR** (`Device supports wide color: 0`, no HDR types), so window-mode cost, wide output and HDR can only be measured on a real device such as a Pixel.

**iOS 27 simulator, RNTester Debug:**
- **`<img>` is backed by expo-image here**, not `RCTImageComponentView`, because RNTester's iOS app boots the Expo runtime and the element picks expo-image whenever it is present (`expo-intrinsics/src/index.js`). So on iOS, in any app with Expo, work on `<img>` pictures is work on expo-image (SDWebImage). §4 needs a ruling on this.
- **What draws:** every 8-bit and 16-bit sRGB, P3, Adobe RGB, CMYK and gray fixture; the ProPhoto TIFF; the OpenEXR (clipped); the PQ cICP PNG and the PQ AVIF as tone-mapped SDR ramps; both gain-map files as their SDR base.
- **What doesn't:** the 10-bit PQ HEIC and the HLG HEIC draw nothing, while the 8-bit P3 HEIC and the gain-map HEIC do. ImageIO decodes those files (exact2's stage 0 did), so the failure is in expo-image's path; it needs a look before HDR work.
- **No CSS colour beyond the legacy forms parses**, the same as Android: every modern chip is empty, P3 text and shadows draw nothing or the default, and every `in <space>` gradient draws nothing.
- **Not yet measured:** stored colour space and depth per picture, and which system colours are P3. Both need the extended-range sampler (V2), which is the first piece of apparatus to build.

## 12. Review fold

One adversarial review of the series by another model family (`color-spaces-and-hdr.review.codex.md`: codex, `gpt-6.1-sol` at xhigh, blind, from a brief with fourteen fear items), verdict NOT READY with 24 findings. Every finding is taken: 17 fixed, 3 fixed in part with the remainder declared, 4 recorded as limitations in `dom-css-limitations.md` (`android-transition-frames-are-srgb`, `android-color-table-is-finite`, `android-text-and-outline-colors-are-srgb`, the API snapshots). The two findings that changed a design decision: HDR is decided by the unit cube of linear Rec. 2020 rather than by luminance, so a saturated color brighter than any SDR display's can show draws in extended range; and `CSS.supports` asks the device about every space, since an Android older than 8 draws none of them. The fold is itemised at the end of the review file.

**Second review (2026-10-04, evening):** Codex (`gpt-6.1-sol`, xhigh) reviewed the reworked series at 2c28da6e75c from a brief of eleven fear items centred on Debug/Release parity and the cascade's copy-on-write, and returned NOT READY with 21 findings; the verbatim review and each disposition are in `color-spaces-and-hdr.review.codex.md`. The shadow-tree finding was the one the author had already fixed in "Keep copy-on-write along the cascade in release builds" (the box borrows an atomic inline from the element tree, so the cascade reaches it on the clone the attachment layout makes). The rest were folded: Animated's native configuration, `matchMedia`'s registration ledger and modifier grammar, `CSS.supports`'s general enclosed terms, the dependents trait after a child becomes a consumer, the iOS state path through `invalidateLayer`, and on Android the limit carried to text spans, the window mode deferred until a view's limit lands, and gradients and shadows asking for and re-asking under it. Four limitations were added to the register (`android-textinput-colors-are-srgb`, `android-paints-are-srgb-before-api-29`, `android-linear-channels-stop-at-the-extended-range`, `ios-17-constrained-is-no-limit`).
