/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPTextInputCaret.h"

#import "EXPKeyboardTrace.h"

/*
 * Write `next` into the field while leaving the insertion point where the user
 * would expect it.
 *
 * "Stable" has several meanings and they disagree, so this states which one it
 * implements:
 *
 *  - ABSOLUTE. Keep the caret at the same index. Right when the change is after
 *    the caret, wrong whenever anything before it changes length.
 *  - TAIL-ANCHORED. Keep its distance from the END — what React Native's own
 *    `RCTTextInputComponentView` does, and what the `beforeinput` path above
 *    computes. Right for a transform that preserves the tail, wrong for a clamp
 *    that truncates one: `slice(0, 10)` with the caret mid-string would drag it.
 *  - EDIT-ANCHORED. Put it where this particular edit would have left it. Needs
 *    the edit's range, which is why only the pre-commit hook can do it.
 *  - CHANGE-ANCHORED, which is this. Replace only the span that actually
 *    differs and let UIKit adjust the selection the way it does for any edit.
 *    A caret outside that span does not move at all — not because it was saved
 *    and restored, but because nothing under it changed.
 *
 * That last property is why this uses `replaceRange:withText:` rather than
 * assigning `.text`. Assigning replaces the whole document: UIKit drops the
 * selection to the end, every `UITextPosition` held across it belongs to a
 * document that no longer exists, and restoring a saved range is a guess that
 * clamps silently when the new text is shorter. `replaceRange:` is the
 * platform's own editing primitive — the same one typing goes through — so
 * selection adjustment, undo registration and scroll-to-caret are UIKit's job
 * rather than ours to reimplement.
 */
/*
 * Drop the autocorrection UIKit has queued, if any.
 *
 * A correction belongs to the document the user was typing in, and a controlled
 * write replaces that document. UIKit applies it afterwards anyway, against the
 * range it remembers: type "hi teh", send, and the field a send has just
 * emptied fills with "Hitch".
 *
 * There is no API that says "forget it". Announcing the write does not —
 * `textWillChange:`/`textDidChange:` say the document changed, which is true
 * and retracts nothing. Turning the trait off and reloading the input views is
 * what the platform leaves, and it is what UIKit itself does when a field's
 * traits change mid-edit.
 */
/*
 * When the last drop happened, so that the clear a send makes a frame or two
 * later — on the flying balloon's first frame, by design, so the words are
 * never nowhere — does not pay for a second one. The two `reloadInputViews`
 * below cost nine to thirteen milliseconds on a simulator and, by the device's
 * trace, thirty to fifty on a phone; paid on that frame they were the hole at
 * the start of every send's rise. Paid at the tap instead, nothing is moving.
 */
static CFTimeInterval lastDropAt = 0;

void EXPDropPendingCorrection(UIView<UITextInput> *field)
{
  if (!field.isFirstResponder) {
    return;
  }
  const UITextAutocorrectionType correction = field.autocorrectionType;
  if (correction == UITextAutocorrectionTypeNo) {
    return;
  }
  const CFTimeInterval began = CACurrentMediaTime();
  field.autocorrectionType = UITextAutocorrectionTypeNo;
  [field reloadInputViews];
  field.autocorrectionType = correction;
  [field reloadInputViews];
  lastDropAt = CACurrentMediaTime();
  [EXPKeyboardTrace record:@"correction dropped %.0fms", (lastDropAt - began) * 1000.0];
}

BOOL EXPWriteTextPreservingCaret(UIView<EXPCaretPreservingTextInput> *field, NSString *next, BOOL quiet)
{
  NSString *current = field.text ?: @"";
  if ([current isEqualToString:next]) {
    return NO;
  }

  /*
   * Text being composed is the input method's. Between the first key of a
   * Japanese or Pinyin word and its commit, the field holds MARKED text;
   * replacing it cancels the candidate session and the user loses what they
   * were half way through spelling. So a controlled value that merely differs
   * waits for the commit, which arrives as an ordinary edit a moment later.
   *
   * EMPTY is the exception, because it cannot be an echo of anything being
   * typed: it is the app saying the field is now empty — a composer clearing
   * itself after a send. Dropped, that write never happens again, because the
   * prop does not change; the field keeps the message it just sent, and the
   * next edit reports that text back and puts it in the app's own state. iOS
   * marks text for its inline predictions as well as for an IME, so this is
   * reachable while typing plain English: send while a prediction is showing
   * and the composer will not clear. `unmarkText` finalises the composition the
   * way the platform does, and the write proceeds.
   */
  if (field.markedTextRange != nil) {
    if (next.length > 0) {
      return NO;
    }
    [field unmarkText];
  }

  /*
   * EMPTY takes the whole-document write, and not to save work.
   *
   * There is no insertion point to preserve in an empty document, and a
   * property write is a different thing to the input system than an edit: it
   * replaces the document rather than editing a range of it, and the
   * correction UIKit had queued against a word in the old one goes with it.
   * `replaceRange:` leaves that correction standing — measured by typing
   * "hi teh", sending it, and watching "Hitch" arrive in the field the send had
   * just emptied.
   */
  if (next.length == 0) {
    field.text = next;
    // Unless the send's tap dropped it a moment ago — see
    // `EXPDropPendingCorrection`. The rebuild is the cost, not the write.
    if (quiet) {
      return YES;
    }
    if (CACurrentMediaTime() - lastDropAt > 1.0) {
      EXPDropPendingCorrection(field);
    }
    return NO;
  }

  // Not being edited: there is no insertion point to preserve, so the cheap
  // path is also the correct one. `isFirstResponder` rather than a class's own
  // `isEditing`, because both backing classes answer it.
  if (!field.isFirstResponder) {
    field.text = next;
    return NO;
  }

  /*
   * The span that actually differs: common prefix, common suffix, whatever is
   * left in between. Boundaries are snapped to composed character sequences so
   * a surrogate pair or a combining mark is never cut in half — comparing UTF-16
   * units alone would happily split an emoji and hand UIKit half of one.
   *
   * A snap may only ever SHRINK a common run, never extend it. The loops below
   * established that a run is common by comparing it; a snap that grew one
   * would be asserting equality nobody checked, and the reconstruction
   * `prefix + replacement + suffix` would stop spelling `next`. U+1D44D and
   * U+1F44D end in the same low surrogate — one pair of code points in every
   * 1024 does — so a scan finds a one-unit "common suffix" that is really half
   * a character the two strings do NOT share. Growing that to the whole
   * sequence swallows the differing high surrogate, the span collapses to
   * nothing, and the controlled value is quietly discarded.
   */
  const NSUInteger currentLength = current.length;
  const NSUInteger nextLength = next.length;
  const NSUInteger shorter = MIN(currentLength, nextLength);

  NSUInteger prefix = 0;
  while (prefix < shorter && [current characterAtIndex:prefix] == [next characterAtIndex:prefix]) {
    prefix++;
  }
  if (prefix > 0 && prefix < currentLength) {
    const NSRange composed = [current rangeOfComposedCharacterSequenceAtIndex:prefix];
    if (composed.location < prefix) {
      prefix = composed.location;
    }
  }

  NSUInteger suffix = 0;
  while (suffix < shorter - prefix &&
         [current characterAtIndex:currentLength - 1 - suffix] == [next characterAtIndex:nextLength - 1 - suffix]) {
    suffix++;
  }
  if (suffix > 0 && suffix < currentLength) {
    const NSUInteger boundary = currentLength - suffix;
    const NSRange composed = [current rangeOfComposedCharacterSequenceAtIndex:boundary];
    if (composed.location != boundary) {
      // The suffix starts in the MIDDLE of a sequence. Move the boundary past
      // the end of that sequence — shrinking the common run — so the whole
      // character falls inside the replaced span rather than being straddled.
      suffix = currentLength - (composed.location + composed.length);
    }
  }

  /*
   * Both snaps only shrink, so `prefix + suffix` cannot have grown past the
   * bound the loops kept it under. Stated as an assertion rather than assumed:
   * these lengths are unsigned, and an overlap here would not be a wrong range
   * but a catastrophic one, wrapping to billions.
   */
  if (prefix + suffix > shorter) {
    suffix = shorter - prefix;
  }

  const NSUInteger replacedLength = currentLength - prefix - suffix;
  const NSUInteger insertedLength = nextLength - prefix - suffix;

  UITextPosition *start = [field positionFromPosition:field.beginningOfDocument offset:(NSInteger)prefix];
  UITextPosition *end = start != nil ? [field positionFromPosition:start offset:(NSInteger)replacedLength] : nil;
  UITextRange *range = (start != nil && end != nil) ? [field textRangeFromPosition:start toPosition:end] : nil;
  if (range == nil) {
    // The offsets did not resolve — fall back rather than leave the field
    // showing text the state has already rejected. A whole-document assignment
    // takes the queued correction with it, so nothing is owed.
    field.text = next;
    return NO;
  }

  /*
   * Where the insertion point ends up.
   *
   * `replaceRange:withText:` leaves the caret at the END of what it wrote,
   * which is right for a user's own edit and wrong for this: a controlled
   * write is a reconciliation the user did not perform, and a caret parked
   * after it is exactly the jump this function exists to avoid. UIKit does not
   * offer "replace but leave the selection alone", so the mapping is done here
   * — the selection is read before the edit and placed after it.
   *
   * A position maps by where it sits relative to the changed span:
   *  - before it, nothing under it moved, so it does not move;
   *  - after it, everything before it grew or shrank by the same amount, so it
   *    shifts by that difference;
   *  - inside it, the text it pointed at is gone, and the end of the
   *    replacement is the only defensible place left.
   *
   * Both ends of a range map the same way, so a selection survives as a
   * selection rather than collapsing to a caret.
   */
  const NSInteger delta = (NSInteger)insertedLength - (NSInteger)replacedLength;
  const NSInteger spanStart = (NSInteger)prefix;
  const NSInteger spanEnd = spanStart + (NSInteger)replacedLength;
  UITextRange *selection = field.selectedTextRange;
  NSInteger selStart = -1;
  NSInteger selEnd = -1;
  if (selection != nil) {
    selStart = [field offsetFromPosition:field.beginningOfDocument toPosition:selection.start];
    selEnd = [field offsetFromPosition:field.beginningOfDocument toPosition:selection.end];
  }

  /*
   * A pending AUTOCORRECTION belongs to the document the user was typing in,
   * and this write replaces that document.
   *
   * UIKit applies the correction it has queued after the write lands, against
   * the range it remembers — reproduced on a device and on the simulator by
   * typing "Teh" and sending it: the message goes as "Teh", the field is
   * cleared by the send, and "The" then appears in the empty field. In a
   * browser `el.value = ''` drops any correction in flight; the element has to
   * say the same thing.
   *
   * `textWillChange:`/`textDidChange:` is how a programmatic change is
   * announced to the input system. `replaceRange:` announces the edit itself,
   * but that is the edit — not the fact that the document the keyboard was
   * reasoning about is gone.
   */
  [field.inputDelegate textWillChange:field];
  [field replaceRange:range withText:[next substringWithRange:NSMakeRange(prefix, insertedLength)]];
  [field.inputDelegate textDidChange:field];

  // And whatever correction was queued against the words this write replaced —
  // unless the host is mid-animation, in which case the drop is OWED rather
  // than skipped: it rebuilds the keyboard, and there is no frame of a send
  // that can afford it.
  BOOL owesDrop = NO;
  if (replacedLength > 0) {
    if (quiet) {
      owesDrop = YES;
    } else {
      EXPDropPendingCorrection(field);
    }
  }

  if (selStart < 0) {
    return owesDrop;
  }
  const auto mapOffset = [&](NSInteger offset) -> NSInteger {
    if (offset <= spanStart) {
      return offset;
    }
    if (offset >= spanEnd) {
      return offset + delta;
    }
    return spanStart + (NSInteger)insertedLength;
  };
  const NSInteger length = (NSInteger)(field.text ?: @"").length;
  const NSInteger mappedStart = MAX(0, MIN(length, mapOffset(selStart)));
  const NSInteger mappedEnd = MAX(mappedStart, MIN(length, mapOffset(selEnd)));
  UITextPosition *mappedStartPosition =
      [field positionFromPosition:field.beginningOfDocument offset:mappedStart];
  UITextPosition *mappedEndPosition =
      [field positionFromPosition:field.beginningOfDocument offset:mappedEnd];
  if (mappedStartPosition != nil && mappedEndPosition != nil) {
    /*
     * The input delegate is TOLD, and the keyboard's shift key is why.
     *
     * `-replaceRange:withText:` is a `UITextInput` mutation and announces
     * itself, but assigning `selectedTextRange` is a plain property write and
     * does not. UIKit decides autocapitalization from the document around the
     * insertion point, and it only re-reads that document when the delegate
     * says the selection moved — so a caret placed this way is invisible to it
     * and the keyboard keeps whatever shift state it had.
     *
     * Sending a message is where that shows. The field goes from "hello" to
     * empty, the caret is mapped to offset 0 of an empty document, and the
     * keyboard is never told: it still believes it is mid-sentence and the next
     * letter is typed in lower case. Reported from a device: "after sending a
     * message and clearing the text field, the text field's autocapitalization
     * isn't re-triggered."
     *
     * React Native's own text input has the same pairing —
     * `-setSelectedTextRange:notifyDelegate:` exists for exactly this — and
     * this is that call spelled out, because the protocol this writes through
     * has no such method.
     */
    [field.inputDelegate selectionWillChange:field];
    field.selectedTextRange = [field textRangeFromPosition:mappedStartPosition
                                                toPosition:mappedEndPosition];
    [field.inputDelegate selectionDidChange:field];
  }
  return owesDrop;
}


