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
 * What the platform's own controls measure. The platform builds one of each
 * control at startup, measures it and fills this in, as upstream's
 * `RCTSwitchSize()` does; layout then reads these from the shadow thread,
 * where UIKit cannot be touched. The defaults below are fallbacks for a
 * platform that has not probed, not measurements.
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
  // The part of the inset the platform expresses as padding. An Android
  // `EditText`'s inset is its padding, and Yoga writes padding straight onto
  // the view, so an unset padding is zero and wipes the control's own; the
  // node folds these onto its style when the author states no block padding.
  // On iOS the inset lives inside the text view and both stay zero
  Float textAreaPaddingTop{0};
  Float textAreaPaddingBottom{0};

  // `selectProbeIntrinsicWidth` is the whole control's width for
  // `elementSelectProbeTitle()`; the chrome is that minus what the text engine
  // makes of the same string, so the two engines' disagreement cancels. Zero
  // means not probed and `selectChromeInline` is used as it stands. Android
  // draws Material 3's exposed dropdown, so its chrome is the field padding
  // plus the caret the element draws
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

  // How far a pressed control dims its content, read off a real pressed
  // button since no API dims subviews a control does not own. The glass grow
  // has no companion: it is a render-server animation, not observable from
  // this process (see `EXPElementButtonPressedContentScale`)
  Float buttonPressedContentAlpha{0.75};

  // First-frame defaults; the mounted control reports its own size, and a
  // compact date picker's width changes with its value and mode
  // `UIButtonConfiguration`'s content insets, folded onto the node rather
  // than measured through it because a node with children cannot carry a Yoga
  // measure function. The Android defaults are Material's
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

  // The distance from the top of each control, at the size above, to the
  // baseline of its text, so a control inline in a sentence lines up with it.
  // Zero is not measured and keeps CSS's rule for a box with no line boxes:
  // the bottom margin edge
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
const std::string &elementFileInputDefaultTitle();

/*
 * The string the select's chrome is derived from.
 *
 * Both sides have to measure the SAME string for the subtraction to cancel, so
 * neither side spells it.
 */
const std::string &elementSelectProbeTitle();

/*
 * Published once, before any surface starts, from the platform's main thread.
 * Read from the shadow thread during layout.
 */
void setElementControlMetrics(const ElementControlMetrics &metrics);
ElementControlMetrics elementControlMetrics();

/*
 * The baseline of a control that fills its element's content box and centres
 * its text there, as every one of these does, given what the probe measured at
 * the control's own height. `size` is the element's border box; `contentTop`
 * and `contentBottom` are its padding and border on those edges.
 */
inline Float
elementControlBaseline(Size size, Float contentTop, Float contentBottom, Float probeHeight, Float probeBaseline)
{
  if (probeBaseline <= 0 || probeHeight <= 0) {
    return size.height;
  }
  const auto contentHeight = size.height - contentTop - contentBottom;
  return contentTop + (contentHeight - probeHeight) / 2 + probeBaseline;
}

} // namespace facebook::react
