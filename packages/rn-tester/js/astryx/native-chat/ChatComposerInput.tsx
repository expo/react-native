// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file ChatComposerInput.tsx — the React Native version (Metro resolves the
 *   vendored `Chat/ChatComposerInput` here)
 *
 * The web composer is a `contenteditable` region that the browser edits and
 * Astryx annotates through the DOM selection API: tokens are spans it inserts
 * at the caret, and a placeholder is an element it lays over the empty region.
 * React Native has no editable region of its own; its text field is the
 * platform's, which brings the keyboard, selection, autocorrect, dictation and
 * the caret with it. So the composer here is a `<textarea>` (the runtime backs
 * it with a multi-line `TextInput`) speaking the same contract: the value and
 * change handler of the composer's context, its placeholder, the focus control
 * the composer's body asks for, and the imperative handle. A token is inserted
 * as the text it serializes to, which is what the web composer submits for it.
 */

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import * as stylex from '@stylexjs/stylex';
import {
  colorVars,
  spacingVars,
  typeScaleVars,
  typographyVars,
} from '../vendor/theme/tokens.stylex';
import {mergeProps} from '../vendor/utils';
import {themeProps} from '../vendor/utils/themeProps';
import {useTranslator} from '../vendor/i18n';
import {useChatComposerContext} from '../vendor/Chat/ChatContext';
import type {
  ChatComposerInputHandle,
  ChatComposerInputProps,
  ChatComposerToken,
} from '../vendor/Chat/ChatComposerInput';

export {ChatComposerTokenElement} from '../vendor/Chat/ChatComposerInput';
export type {
  ChatComposerInputHandle,
  ChatComposerInputProps,
  ChatComposerToken,
  ChatComposerTokenBadge,
  ChatComposerTokenCustom,
  ChatComposerTokenElementProps,
  ChatComposerTrigger,
  ChatComposerTriggerItem,
} from '../vendor/Chat/ChatComposerInput';

// The web composer's line, so a native field is as tall as its lines there
const LINE_HEIGHT_PX = 22;

const styles = stylex.create({
  root: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    minHeight: `${LINE_HEIGHT_PX}px`,
  },
  field: {
    borderWidth: 0,
    padding: 0,
    margin: 0,
    backgroundColor: 'transparent',
    fontSize: typeScaleVars['--text-body-size'],
    lineHeight: `${LINE_HEIGHT_PX}px`,
    fontFamily: typographyVars['--font-family-body'],
    color: colorVars['--color-text-primary'],
    caretColor: colorVars['--color-accent'],
    paddingInline: spacingVars['--spacing-1'],
    minHeight: `${LINE_HEIGHT_PX}px`,
    // The field is the whole input region, so a region taller than a line (the
    // landing composer's three) takes a tap anywhere in it, as the web's does
    flexGrow: 1,
  },
  maxHeight: (height: number) => ({maxHeight: height}),
  disabled: {
    opacity: 0.5,
    pointerEvents: 'none',
  },
});

export function ChatComposerInput(props: ChatComposerInputProps) {
  const t = useTranslator();
  const composerCtx = useChatComposerContext();
  const {
    ref,
    handleRef,
    value: controlledValue = composerCtx?.value,
    onChange: onChangeProp,
    placeholder: placeholderFromProps,
    maxRows = 8,
    label: labelFromProps,
    isDisabled = composerCtx?.isDisabled ?? false,
    xstyle,
    className,
    style,
  } = props;
  const label = labelFromProps ?? t('@astryx.chat.composerInput.label');
  const placeholder =
    placeholderFromProps ??
    composerCtx?.placeholder ??
    t('@astryx.chat.composer.placeholder');

  const [internalValue, setInternalValue] = useState('');
  const value = controlledValue ?? internalValue;
  const valueRef = useRef(value);
  valueRef.current = value;

  const onChange = onChangeProp ?? composerCtx?.onChange;
  const change = useCallback(
    (next: string) => {
      if (controlledValue === undefined) {
        setInternalValue(next);
      }
      onChange?.(next);
    },
    [controlledValue, onChange],
  );

  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const focus = useCallback(() => {
    fieldRef.current?.focus();
  }, []);

  // The composer's body focuses the field through this when it is pressed
  const inputControlRef = composerCtx?.inputControlRef;
  useEffect(() => {
    if (inputControlRef == null) {
      return;
    }
    inputControlRef.current = {focus};
    return () => {
      inputControlRef.current = null;
    };
  }, [inputControlRef, focus]);

  const insertText = useCallback(
    (text: string) => {
      const current = valueRef.current;
      const joiner = current.length === 0 || /\s$/.test(current) ? '' : ' ';
      change(current + joiner + text);
    },
    [change],
  );

  useImperativeHandle(
    handleRef,
    (): ChatComposerInputHandle => ({
      // A token is its serialized text here: the field holds plain text, and
      // that text is what the web composer submits for the token
      insertToken: (token: ChatComposerToken) => {
        insertText(`${token.value} `);
        return undefined;
      },
      expandToken: () => {},
      insertText,
      focus,
      getValue: () => valueRef.current,
    }),
    [insertText, focus],
  );

  return (
    <div
      ref={ref}
      {...mergeProps(
        themeProps('chat-composer-input'),
        stylex.props(styles.root, isDisabled && styles.disabled, xstyle),
        className,
        style,
      )}>
      <textarea
        ref={fieldRef}
        aria-label={label}
        value={value}
        placeholder={placeholder}
        disabled={isDisabled}
        // No `rows`: the runtime's text area (elements/TextArea.js) would hold
        // the field at their height, and without them it is as tall as its
        // lines, so it grows as the web's editable region does, to `maxRows`
        onChange={event => change(event.target.value)}
        {...stylex.props(
          styles.field,
          styles.maxHeight(maxRows * LINE_HEIGHT_PX),
        )}
      />
    </div>
  );
}

ChatComposerInput.displayName = 'ChatComposerInput';
