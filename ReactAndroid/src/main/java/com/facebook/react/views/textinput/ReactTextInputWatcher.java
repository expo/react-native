package com.facebook.react.views.textinput;

import android.text.TextWatcher;

public interface ReactTextInputWatcher extends TextWatcher {
  /**
   * This method is called to notify you that, within <code>s</code>,
   * the <code>count</code> characters beginning at <code>start</code>
   * are about to be replaced by new text with length <code>after</code>.
   * It is an error to attempt to make changes to <code>s</code> from
   * this callback.
   */
  public void maybeFireOnContentSizeChanged();
}
