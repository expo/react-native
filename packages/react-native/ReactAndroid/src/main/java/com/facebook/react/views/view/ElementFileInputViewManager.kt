/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.widget.Button
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event

/** One chosen file, as `change` reports it — see `ElementFileInputShadowNode.h`. */
internal data class ElementFileDescriptor(
    val name: String,
    val uri: String,
    val type: String,
    val size: Double,
)

/**
 * `<input type="file">` on Android, through the Storage Access Framework.
 *
 * `ACTION_OPEN_DOCUMENT` rather than `ACTION_GET_CONTENT`: it is the modern one, it gives a
 * persistable handle instead of a snapshot, and it is what the system file picker is. Chrome uses
 * the same picker for this input.
 *
 * The file is not read here. What crosses to JavaScript is a `content://` handle, for the reason
 * given in the shadow node: copying every picked file into memory to imitate the web's `File` bytes
 * would make choosing a video an out-of-memory crash.
 */
internal class ElementFileInputView(context: Context) : Button(context) {

  var onFilesChosen: ((List<ElementFileDescriptor>) -> Unit)? = null

  var propAccept: String = ""
  var propMultiple: Boolean = false

  /** Set by the manager, which owns the activity-result plumbing. */
  var onOpenPicker: (() -> Unit)? = null

  /** Held so it can be unregistered when the view goes away. */
  var activityListener: ActivityEventListener? = null

  private var chosenCount: Int = 0

  init {
    isAllCaps = false
    updateLabel()
    setOnClickListener { onOpenPicker?.invoke() }
  }

  fun buildIntent(): Intent =
      Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, propMultiple)

        val mimeTypes = mimeTypesForAccept(propAccept)
        // A single type goes in `type`; several go in `EXTRA_MIME_TYPES` with `type` widened, which
        // is the shape the framework expects and the only one it filters on.
        if (mimeTypes.size == 1) {
          type = mimeTypes.first()
        } else {
          type = "*/*"
          if (mimeTypes.isNotEmpty()) {
            putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes.toTypedArray())
          }
        }
      }

  /**
   * HTML's `accept` translated into MIME types.
   *
   * Both spellings are handled: a MIME type — including a wildcard family, which the framework
   * takes verbatim — and a bare extension like `.pdf`, resolved through the system's own extension
   * map rather than a table kept here. An entry that resolves to nothing is dropped rather than
   * guessed at.
   *
   * (The wildcard is spelled out in prose because Kotlin's block comments nest: writing it
   * literally opens a comment inside this one and swallows the rest of the file.)
   */
  private fun mimeTypesForAccept(accept: String): List<String> =
      accept
          .split(',')
          .map { it.trim() }
          .filter { it.isNotEmpty() }
          .mapNotNull { entry ->
            if (entry.startsWith(".")) {
              android.webkit.MimeTypeMap.getSingleton()
                  .getMimeTypeFromExtension(entry.removePrefix(".").lowercase())
            } else if (entry.contains('/')) {
              entry
            } else {
              null
            }
          }
          .distinct()

  fun reportChosen(files: List<ElementFileDescriptor>) {
    chosenCount = files.size
    updateLabel()
    onFilesChosen?.invoke(files)
  }

  /** Reads what the picker will not tell you directly: the display name and the size. */
  fun describe(uri: Uri): ElementFileDescriptor {
    var name = uri.lastPathSegment.orEmpty()
    var size = 0.0
    context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
      if (cursor.moveToFirst()) {
        val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (nameIndex >= 0 && !cursor.isNull(nameIndex)) {
          name = cursor.getString(nameIndex)
        }
        val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
        if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) {
          size = cursor.getLong(sizeIndex).toDouble()
        }
      }
    }
    return ElementFileDescriptor(
        name = name,
        uri = uri.toString(),
        type = context.contentResolver.getType(uri).orEmpty(),
        size = size,
    )
  }

  /** The button says what is chosen, the way a file input reads in a browser. */
  private fun updateLabel() {
    text =
        when (chosenCount) {
          0 -> "Choose File"
          1 -> "1 file chosen"
          else -> "$chosenCount files chosen"
        }
  }

  fun resetChoice() {
    chosenCount = 0
    updateLabel()
  }
}

@ReactModule(name = ElementFileInputViewManager.REACT_CLASS)
internal class ElementFileInputViewManager : SimpleViewManager<ElementFileInputView>() {

  public companion object {
    public const val REACT_CLASS: String = "element-file-input"

    /**
     * Request code for the picker. Constant because only one picker can be open at a time — the
     * system picker is modal — so the view that opened it is the one waiting.
     */
    private const val REQUEST_CODE: Int = 0xF11E
  }

  override fun getName(): String = REACT_CLASS

  /** The view whose picker is open, if any. */
  private var pendingView: ElementFileInputView? = null

  override fun createViewInstance(context: ThemedReactContext): ElementFileInputView {
    val view = ElementFileInputView(context)

    view.onFilesChosen = { files ->
      UIManagerHelper.getEventDispatcher(context)
          ?.dispatchEvent(
              ElementFileChangeEvent(UIManagerHelper.getSurfaceId(view), view.id, files))
    }

    val listener =
        object : ActivityEventListener {
          override fun onActivityResult(
              activity: Activity,
              requestCode: Int,
              resultCode: Int,
              data: Intent?
          ) {
            if (requestCode != REQUEST_CODE) {
              return
            }
            val target = pendingView ?: return
            pendingView = null
            // A cancelled picker reports nothing at all, as in a browser: it leaves the input
            // untouched rather than clearing a previous choice.
            if (resultCode != Activity.RESULT_OK || data == null) {
              return
            }

            val uris = mutableListOf<Uri>()
            data.clipData?.let { clip ->
              for (index in 0 until clip.itemCount) {
                clip.getItemAt(index).uri?.let { uris.add(it) }
              }
            }
            // A single pick arrives in `data` rather than in `clipData`.
            if (uris.isEmpty()) {
              data.data?.let { uris.add(it) }
            }
            if (uris.isNotEmpty()) {
              target.reportChosen(uris.map { target.describe(it) })
            }
          }

          override fun onNewIntent(intent: Intent) = Unit
        }
    // Registered on the *application* context, not on this themed one.
    //
    // `ThemedReactContext` wraps a `ReactApplicationContext` rather than
    // extending it, so it carries its own listener list — while `ReactHostImpl`
    // dispatches activity results to `currentReactContext`, which is the
    // application context. A listener added to the themed context therefore
    // sits somewhere nothing ever dispatches to: measured, the picker opened
    // and `onActivityResult` was never called, not even with `RESULT_CANCELED`.
    context.reactApplicationContext.addActivityEventListener(listener)
    view.activityListener = listener

    view.onOpenPicker = {
      val activity = context.currentActivity
      if (activity != null) {
        pendingView = view
        activity.startActivityForResult(view.buildIntent(), REQUEST_CODE)
      }
    }

    return view
  }

  @ReactProp(name = "accept")
  public fun setAccept(view: ElementFileInputView, accept: String?) {
    view.propAccept = accept.orEmpty()
  }

  @ReactProp(name = "multiple")
  public fun setMultiple(view: ElementFileInputView, multiple: Boolean) {
    view.propMultiple = multiple
  }

  @ReactProp(name = "disabled")
  public fun setDisabled(view: ElementFileInputView, disabled: Boolean) {
    view.isEnabled = !disabled
  }

  override fun onDropViewInstance(view: ElementFileInputView) {
    super.onDropViewInstance(view)
    if (pendingView === view) {
      pendingView = null
    }
    view.activityListener?.let { listener ->
      (view.context as? ThemedReactContext)?.reactApplicationContext?.removeActivityEventListener(
          listener)
    }
    view.activityListener = null
    view.resetChoice()
  }

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any>? {
    val export = super.getExportedCustomDirectEventTypeConstants() ?: mutableMapOf()
    export["topElementChange"] = mapOf("registrationName" to "onChange")
    return export
  }
}

private class ElementFileChangeEvent(
    surfaceId: Int,
    viewTag: Int,
    private val files: List<ElementFileDescriptor>
) : Event<ElementFileChangeEvent>(surfaceId, viewTag) {
  override fun getEventName(): String = "topElementChange"

  override fun canCoalesce(): Boolean = false

  override fun getEventData(): WritableMap {
    val list: WritableArray = Arguments.createArray()
    files.forEach { file ->
      list.pushMap(
          Arguments.createMap().apply {
            putString("name", file.name)
            putString("uri", file.uri)
            putString("type", file.type)
            putDouble("size", file.size)
          })
    }
    return Arguments.createMap().apply { putArray("files", list) }
  }
}
