/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 * @format
 */

'use strict';

/**
 * The keyboard, and what has to move out of its way.
 *
 * These screens are built to be *checked*, not just looked at. Each field is
 * numbered and each one is a fixed height, so a screenshot answers a precise
 * question — which field is the last fully visible one — rather than an
 * impressionistic one about whether things look about right.
 *
 * The cases are the ones that break: a field near the bottom of a long form, a
 * form too short to scroll, and a composer that has to stay against the keyboard
 * through an interactive drag, which is the case no notification describes.
 *
 * `@noflow`: the intrinsics have no JSX types.
 */

import NativeKeyboardAccessory from '../../../../expo-intrinsics/src/NativeKeyboardAccessory';
import {
  CARD_COLOR,
  GROUPED_PAGE_COLOR,
  LABEL_COLOR,
  SEPARATOR_COLOR,
} from '../HTMLElements/themed';
import * as React from 'react';
import {useCallback, useRef, useState} from 'react';
import {Keyboard, ScrollView, TextInput, View} from 'react-native';

const FIELD_HEIGHT = 56;

const Field = React.forwardRef(function Field({index}, ref) {
  return (
    <div
      style={{
        height: FIELD_HEIGHT,
        justifyContent: 'center',
        paddingInline: 16,
        borderBottomWidth: 1,
        borderColor: SEPARATOR_COLOR,
        backgroundColor: CARD_COLOR,
      }}>
      {/* `TextInput` rather than `<input>`: the intrinsic renders a custom
          Fabric component with no ref forwarding and no focus command, so
          nothing can focus it programmatically. That gap is worth closing on its
          own, but it would make this screen impossible to drive. */}
      <TextInput
        ref={ref}
        placeholder={`field ${index}`}
        style={{fontSize: 17, color: LABEL_COLOR, height: 36}}
      />
    </div>
  );
});

/**
 * Focus is driven from buttons rather than by tapping the fields directly.
 *
 * Not for the reader's convenience: a synthetic tap cannot focus a text field on
 * this platform — it reaches buttons perfectly well, but UIKit's own field
 * gesture does not accept it — so a screen that could only be focused by tapping
 * a field could not be checked automatically at all. Buttons make every case here
 * reachable by a script, and by anyone reading it.
 */
function FocusBar({targets}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        gap: 8,
        padding: 8,
        backgroundColor: CARD_COLOR,
        borderBottomWidth: 1,
        borderColor: SEPARATOR_COLOR,
      }}>
      {targets.map(({label, onPress}) => (
        <button key={label} onClick={onPress}>
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * A form longer than the screen. With the keyboard up, the content below it must
 * still be reachable: scrolled to the end, the last field has to sit above the
 * keyboard rather than behind it.
 */
function LongForm() {
  const refs = useRef([]);
  const focus = index => () => refs.current[index]?.focus();
  const fields = [];
  for (let i = 1; i <= 24; i++) {
    fields.push(
      <Field key={i} index={i} ref={node => (refs.current[i] = node)} />,
    );
  }
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        backgroundColor: GROUPED_PAGE_COLOR,
      }}>
      <FocusBar
        targets={[
          {label: 'Focus 2', onPress: focus(2)},
          {label: 'Focus 24', onPress: focus(24)},
          {label: 'Dismiss', onPress: () => Keyboard.dismiss()},
        ]}
      />
      {/* The scroll view is the thing under test: its bottom inset has to follow
          the keyboard, per frame, including while a finger drags it away. */}
      <ScrollHost>{fields}</ScrollHost>
    </div>
  );
}

/**
 * The same form, too short to scroll. Nothing can move out of the way by
 * scrolling here, so this is the case that shows whether the container itself
 * responds.
 */
function ShortForm() {
  return (
    <div
      style={{
        borderWidth: 1,
        borderColor: SEPARATOR_COLOR,
        backgroundColor: GROUPED_PAGE_COLOR,
      }}>
      <Field index={1} />
      <Field index={2} />
    </div>
  );
}

/**
 * A chat composer: a bar that has to stay against the top of the keyboard at
 * every moment of every transition, including a drag that no notification
 * describes.
 */
function Composer() {
  const [sent, setSent] = useState([]);
  const [draft, setDraft] = useState('');
  const input = useRef(null);
  const send = useCallback(() => {
    if (draft.length === 0) {
      return;
    }
    setSent(previous => [...previous, draft]);
    setDraft('');
  }, [draft]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        borderWidth: 1,
        borderColor: SEPARATOR_COLOR,
        backgroundColor: GROUPED_PAGE_COLOR,
      }}>
      <FocusBar
        targets={[
          {label: 'Focus composer', onPress: () => input.current?.focus()},
          {label: 'Dismiss', onPress: () => Keyboard.dismiss()},
        ]}
      />
      <ScrollHost>
        {sent.map((message, i) => (
          <div
            key={i}
            style={{
              alignSelf: 'flex-end',
              margin: 8,
              paddingBlock: 8,
              paddingInline: 12,
              borderRadius: 18,
              backgroundColor: '#0b74ff',
            }}>
            <span style={{color: 'white', fontSize: 16}}>{message}</span>
          </div>
        ))}
      </ScrollHost>
      {/* The bar is part of the keyboard: it sits on top of whatever obstructs
          the bottom of the window and follows it every frame it moves. The
          element owns its own position, so there is no layout here saying where
          the bottom of the screen is. */}
      <NativeKeyboardAccessory
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          padding: 8,
          borderTopWidth: 1,
          borderColor: SEPARATOR_COLOR,
          backgroundColor: CARD_COLOR,
        }}>
        <TextInput
          ref={input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message"
          style={{
            flex: 1,
            height: 36,
            paddingInline: 12,
            borderRadius: 18,
            backgroundColor: GROUPED_PAGE_COLOR,
            fontSize: 16,
          }}
        />
        <button onClick={send}>Send</button>
      </NativeKeyboardAccessory>
    </div>
  );
}

/**
 * A scroll container that avoids the keyboard. Kept in one place so every case
 * on this screen is exercising the same thing.
 */
function ScrollHost({children}) {
  return (
    <ScrollView
      style={{flex: 1}}
      automaticallyAdjustKeyboardInsets={true}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export default {
  title: 'Keyboard and scroll views',
  category: 'UI',
  description:
    'What has to move out of the keyboard\u2019s way, and whether it stays with it.',
  examples: [
    {
      name: 'longForm',
      fullBleed: true,
      title: 'A form longer than the screen',
      description:
        'Scrolled to the end with the keyboard up, field 24 is fully visible rather than behind it.',
      render: () => <LongForm />,
    },
    {
      name: 'shortForm',
      fullBleed: true,
      title: 'A form too short to scroll',
      description:
        'Nothing can move by scrolling, so this shows whether the container itself responds.',
      render: () => <ShortForm />,
    },
    {
      name: 'composer',
      fullBleed: true,
      title: 'A chat composer',
      description:
        'The bar stays against the keyboard through the transition, including a finger drag.',
      render: () => <Composer />,
    },
  ],
};
