/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 * @format
 */

'use strict';

type FormDataValue = string | {name?: string, type?: string, uri: string};
type FormDataNameValuePair = [string, FormDataValue];

type Headers = {[name: string]: string, ...};
type FormDataPart =
  | {
      string: string,
      headers: Headers,
      ...
    }
  | {
      uri: string,
      headers: Headers,
      name?: string,
      type?: string,
      ...
    };

/**
 * Encode a FormData filename compliant with RFC 2183
 *
 * https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Disposition#directives
 */
function encodeFilename(filename: string): string {
  return encodeURIComponent(filename.replace(/\//g, '_'));
}

/**
 * Polyfill for XMLHttpRequest2 FormData API, allowing multipart POST requests
 * with mixed data (string, native files) to be submitted via XMLHttpRequest.
 *
 * Example:
 *
 *   var photo = {
 *     uri: uriFromCameraRoll,
 *     type: 'image/jpeg',
 *     name: 'photo.jpg',
 *   };
 *
 *   var body = new FormData();
 *   body.append('authToken', 'secret');
 *   body.append('photo', photo);
 *   body.append('title', 'A beautiful photo!');
 *
 *   xhr.open('POST', serverURL);
 *   xhr.send(body);
 */
class FormData {
  _parts: Array<FormDataNameValuePair>;

  constructor() {
    this._parts = [];
  }

  append(key: string, value: FormDataValue) {
    // The XMLHttpRequest spec doesn't specify if duplicate keys are allowed.
    // MDN says that any new values should be appended to existing values.
    // In any case, major browsers allow duplicate keys, so that's what we'll do
    // too. They'll simply get appended as additional form data parts in the
    // request body, leaving the server to deal with them.
    this._parts.push([key, value]);
  }

  getAll(key: string): Array<FormDataValue> {
    return this._parts
      .filter(([name]) => name === key)
      .map(([, value]) => value);
  }

  /*
   * The rest of the `FormData` interface.
   *
   * These are not conveniences. `<form action={fn}>` — React 19's form action —
   * hands this object to application code, and the first thing that code writes
   * is `formData.get('email')`. Without these, every form action written
   * against the web API fails at runtime on `undefined is not a function`,
   * which is how this gap was found.
   */

  /* The FIRST value for a name, or null — not an empty string, which the spec
   * is careful to distinguish so that "absent" and "present but blank" can be
   * told apart. */
  get(key: string): FormDataValue | null {
    for (const [name, value] of this._parts) {
      if (name === key) {
        return value;
      }
    }
    return null;
  }

  has(key: string): boolean {
    return this._parts.some(([name]) => name === key);
  }

  /* Replaces every existing entry for the name with one, keeping the position
   * of the first — the spec's rule, and what stops `set` from reordering a
   * form. */
  set(key: string, value: FormDataValue): void {
    const next: Array<FormDataNameValuePair> = [];
    let replaced = false;
    for (const part of this._parts) {
      if (part[0] !== key) {
        next.push(part);
      } else if (!replaced) {
        next.push([key, value]);
        replaced = true;
      }
      // Later entries for the same name are dropped.
    }
    if (!replaced) {
      next.push([key, value]);
    }
    this._parts = next;
  }

  delete(key: string): void {
    this._parts = this._parts.filter(([name]) => name !== key);
  }

  *entries(): Iterator<[string, FormDataValue]> {
    for (const [name, value] of this._parts) {
      yield [name, value];
    }
  }

  *keys(): Iterator<string> {
    for (const [name] of this._parts) {
      yield name;
    }
  }

  *values(): Iterator<FormDataValue> {
    for (const [, value] of this._parts) {
      yield value;
    }
  }

  // Iterating a `FormData` directly yields its entries, which is what
  // `for (const [name, value] of formData)` and `[...formData]` rely on.
  // $FlowFixMe[unsupported-syntax] computed key on a class
  *[Symbol.iterator](): Iterator<[string, FormDataValue]> {
    yield* this.entries();
  }

  getParts(): Array<FormDataPart> {
    return this._parts.map(([name, value]) => {
      const contentDisposition = 'form-data; name="' + name + '"';

      const headers: Headers = {'content-disposition': contentDisposition};

      // The body part is a "blob", which in React Native just means
      // an object with a `uri` attribute. Optionally, it can also
      // have a `name` and `type` attribute to specify filename and
      // content type (cf. web Blob interface.)
      if (typeof value === 'object' && !Array.isArray(value) && value) {
        if (typeof value.name === 'string') {
          headers['content-disposition'] +=
            `; filename="${encodeFilename(value.name)}"`;
        }
        if (typeof value.type === 'string') {
          headers['content-type'] = value.type;
        }
        return {...value, headers, fieldName: name};
      }
      // Convert non-object values to strings as per FormData.append() spec
      return {string: String(value), headers, fieldName: name};
    });
  }
}

export default FormData;
