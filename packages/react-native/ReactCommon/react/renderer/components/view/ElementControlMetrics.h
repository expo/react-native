/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/graphics/Float.h>
#include <react/renderer/graphics/Size.h>

#include <string>

namespace facebook::react {

/*
 * What the platform's own controls measure, asked of REAL ones.
 *
 * The form elements are drawn by platform controls, so their intrinsic sizes
 * are the platform's numbers — a `UITextView`'s text inset, the line box its
 * font lays out in, a pop-up button's chrome. Those numbers used to be written
 * down here, measured once by hand off a simulator. That is wrong twice: it is
 * a transcription of something the OS already knows, and it goes stale in
 * silence the next time the OS changes its mind. A textarea shipped for months
 * reserving thirty points for a sixteen-point inset exactly that way.
 *
 * So nothing here is written down. The platform builds one of each control at
 * startup, measures it, and fills this in — `RCTSwitchSize()` is the same idea
 * and is upstream's, for the same reason. Layout then reads these from the
 * shadow thread, where UIKit cannot be touched.
 *
 * The defaults below are NOT measurements and no layout should be proud of
 * them: they are what each platform used before it learned to ask, kept so
 * that a platform which has not been taught to probe yet draws exactly what it
 * drew before. Android is in that position — see the probe on the iOS side for
 * the shape the Android one would take.
 */
struct ElementControlMetrics {
  /*
   * `<textarea>`: the control's own block inset, and the line box its text
   * lays out in. A `rows={n}` box is `insetBlock + n * lineBox` — the inset
   * counting only when the author states no padding, because that is exactly
   * when the control keeps its own (see `authorStatedPadding`).
   */
  Float textAreaInsetBlock{40};
  Float textAreaLineBox{28};
  /*
   * The part of that inset the platform expresses as the control's PADDING.
   *
   * On Android an `EditText`'s inset IS its padding, and Yoga's padding is
   * written straight onto the view — so padding layout leaves unset is not
   * "nothing", it is zero, and it wipes the control's own. Layout therefore
   * states it: the node folds these onto its style when the author states no
   * block padding, and reserves only the remainder (TextView's own first- and
   * last-line spacing) through the measure. On iOS the inset lives inside the
   * text view and none of it is padding, so both stay zero.
   */
  Float textAreaPaddingTop{0};
  Float textAreaPaddingBottom{0};

  /*
   * `<select>`: everything a pop-up button draws that is not its label, and
   * the size of the font the label is drawn in.
   *
   * `selectProbeIntrinsicWidth` is the whole control's width for
   * `elementSelectProbeTitle()`, and the chrome is that MINUS what the text
   * engine makes of the same string. Stated as a subtraction rather than as a
   * chrome, because the two engines disagree by a point or two on any given
   * string and subtracting cancels the disagreement instead of carrying an
   * allowance for it. Zero means the platform has not probed, and
   * `selectChromeInline` is used as it stands.
   *
   * Android probes no Spinner: its `<select>` draws Material 3's exposed
   * dropdown, the text field's filled surface with a trailing caret, so its
   * block size is the text field's and its chrome is the sheet's field padding
   * plus the caret the element draws.
   */
  Float selectProbeIntrinsicWidth{0};
  Float selectChromeInline{32};
  Float selectLabelFontSize{16};
  Float selectBlockSize{48};

  /*
   * `<input type=file>`: what the control measures for its DEFAULT title,
   * before a file has been picked.
   *
   * Only a default. Once the control is mounted it reports its own intrinsic
   * size for whatever title it is actually showing (ElementControlSizeState) —
   * this is what the first layout uses, which happens before any view exists.
   */
  Float fileDefaultWidth{200};
  Float fileDefaultHeight{48};

  /*
   * `<button>`: how far a pressed control dims its own content.
   *
   * The one part of a standard press that has to be MIRRORED rather than
   * delegated — no API dims subviews a control does not own, and an element's
   * children are exactly that. So the factor is read off a real button in the
   * pressed state rather than written down: if UIKit changes what a pressed
   * button looks like, this follows it.
   *
   * There is no companion for the glass GROW, and not for want of looking.
   * Held under a real tracked press and sampled through it, the control's
   * layer transform stays identity, its bounds do not change, and no layer in
   * its tree scales at all — the effect is a render-server material animation
   * and is not observable from this process. That one stays a measurement; see
   * `EXPElementButtonPressedContentScale`.
   */
  Float buttonPressedContentAlpha{0.75};

  /*
   * `<input type=text>` and the date/time family: what those controls measure
   * before either has anything to show.
   *
   * Defaults only, like the file input's — the mounted control reports its own
   * size for whatever it is actually displaying, and a compact date picker's
   * width genuinely changes with its value and its mode.
   */
  /*
   * `<button>`: the control's own content insets.
   *
   * A button's padding is the platform's — `UIButtonConfiguration` states it,
   * and it is what makes a button's label sit where a native one's does. The
   * sheet carried 7 and 12 for iOS, measured by hand. These are folded onto
   * the node rather than measured through it, because a button's box is laid
   * out around CHILDREN and a node with children cannot carry a Yoga measure
   * function.
   *
   * The Android defaults are Material's, as the sheet stated them, kept so a
   * platform that does not probe draws exactly what it drew before.
   */
  Float buttonPaddingBlock{4};
  Float buttonPaddingInline{24};

  /*
   * `<input type=color>`: what a real `UIColorWell` measures.
   *
   * Constant, unlike the fields and the file button — a well shows a colour,
   * not content, so its size does not move with what it is displaying. No
   * state needed; the probe is the whole answer.
   */
  Float colorWellWidth{64};
  Float colorWellHeight{48};

  /*
   * `<input>`'s intrinsic width: a field sized for twenty characters, HTML's
   * default `size`, measured on the platform's own field. It does not follow
   * what the field holds, as a browser's does not.
   */
  Float textFieldDefaultWidth{200};
  Float textFieldDefaultHeight{48};
  /*
   * `<input type=date|time|datetime-local>`: one default per type, because the
   * three are three different controls — a time is a third the width of a date
   * and time — and the node knows its type before the first layout. The value a
   * picker then shows moves its width by a few points, which the mounted picker
   * reports.
   */
  Float datePickerDefaultWidth{220};
  Float datePickerDefaultHeight{48};
  Float timePickerDefaultWidth{220};
  Float timePickerDefaultHeight{48};
  Float dateTimePickerDefaultWidth{220};
  Float dateTimePickerDefaultHeight{48};

  /*
   * Where each control's text sits: the distance from the top of the control,
   * at the size above, to the baseline of the text it draws — the title of a
   * `<select>`, the value of a field or a picker. Probed from the real control,
   * like everything else here, so a control inline in a sentence lines its text
   * up with the sentence's instead of standing on the line by its bottom edge.
   *
   * Zero is "not measured", and keeps CSS's rule for a box with no line boxes:
   * the bottom margin edge.
   */
  Float selectBaseline{0};
  Float textFieldBaseline{0};
  Float datePickerBaseline{0};
  Float timePickerBaseline{0};
  Float dateTimePickerBaseline{0};
};


/*
 * The title `<input type=file>` shows before anything is chosen.
 *
 * Here rather than beside the control, because the startup probe has to
 * measure a button carrying the SAME string the element will show — a default
 * width for some other title is a button that resizes the moment it appears.
 */
const std::string& elementFileInputDefaultTitle();

/*
 * The string the select's chrome is derived from.
 *
 * Both sides have to measure the SAME string for the subtraction to cancel, so
 * neither side spells it.
 */
const std::string& elementSelectProbeTitle();

/*
 * Published once, before any surface starts, from the platform's main thread.
 * Read from the shadow thread during layout.
 */
void setElementControlMetrics(const ElementControlMetrics& metrics);
ElementControlMetrics elementControlMetrics();

/*
 * The baseline of a control that fills its element's content box and centres
 * its text there, as every one of these does, given what the probe measured at
 * the control's own height. `size` is the element's border box; `contentTop`
 * and `contentBottom` are its padding and border on those edges.
 */
inline Float elementControlBaseline(
    Size size,
    Float contentTop,
    Float contentBottom,
    Float probeHeight,
    Float probeBaseline) {
  if (probeBaseline <= 0 || probeHeight <= 0) {
    return size.height;
  }
  const auto contentHeight = size.height - contentTop - contentBottom;
  return contentTop + (contentHeight - probeHeight) / 2 + probeBaseline;
}

} // namespace facebook::react
