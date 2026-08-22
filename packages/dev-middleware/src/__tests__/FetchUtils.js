/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import type {JSONSerializable} from '../inspector-proxy/types';
import type {RequestOptions} from 'undici';

import {Agent, request} from 'undici';

/**
 * A version of `fetch` that is usable with the HTTPS server created in
 * ServerUtils (which uses a self-signed certificate).
 */
export async function requestLocal(
  url: string,
  options?: RequestOptions,
): Promise<{
  statusCode: number,
  headers: Headers,
  bodyBuffer: Buffer,
}> {
  const {
    statusCode,
    headers: rawHeaders,
    body,
  } = await request(url, {
    ...options,

    // Use undici's `dispatcher` to make it accept self-signed certificates.
    dispatcher:
      options?.dispatcher ??
      new Agent({
        connect: {
          rejectUnauthorized: false,
        },
      }),
  });
  return {
    statusCode,
    bodyBuffer: await body.read(),
    headers: new Headers(rawHeaders),
  };
}

export async function fetchJson<T extends JSONSerializable>(
  url: string,
): Promise<T> {
  const response = await requestLocal(url);
  if (response.statusCode !== 200) {
    throw new Error(`HTTP ${response.statusCode}`);
  }
  if (!response.headers.get('Content-Type')?.startsWith('application/json')) {
    throw new Error('Expected Content-Type: application/json');
  }
  return JSON.parse(response.bodyBuffer.toString());
}

/**
 * Change the global fetch dispatcher to allow self-signed certificates.
 * This runs with Jest's `beforeAll` and `afterAll`, and restores the original dispatcher.
 */
export function withFetchSelfSignedCertsForAllTests(
  fetchSpy: JestMockFn<Parameters<typeof fetch>, ReturnType<typeof fetch>>,
  fetchOriginal: typeof fetch,
) {
  const selfSignedCertDispatcher = new Agent({
    connect: {
      rejectUnauthorized: false,
    },
  });

  beforeAll(() => {
    /*
     * Lets the code under test reach the self-signed HTTPS server these suites
     * start, by serving its `fetch` calls with undici's `request` — the same
     * way every other helper in this file talks to those servers, and the only
     * mechanism here that actually works.
     *
     * Three things were tried first, and each fails on Node 26:
     *
     *  - Passing the dispatcher to the global `fetch`. Node's `fetch` is backed
     *    by its own bundled undici and will not take a dispatcher built by the
     *    copy in `node_modules`; the request fails with a bare "fetch failed",
     *    which reads exactly like a refused certificate rather than an ignored
     *    dispatcher. This is what the suite did, and why it was red.
     *  - Calling the installed undici's own `fetch`. That gets past the
     *    certificate and then dies in `markResourceTiming`, which undici 6
     *    calls and this Node no longer provides.
     *  - Setting `NODE_TLS_REJECT_UNAUTHORIZED` in `beforeAll`. Node reads it
     *    before the suite runs, so it has no effect by then.
     *
     * Only the fields `Device.#fetchText` reads are built, which is the whole
     * surface any caller here uses. A fuller shim would be inventing behaviour
     * nothing exercises.
     */
    fetchSpy.mockImplementation(async (url, options) => {
      const {statusCode, body} = await request(url.toString(), {
        ...options,
        dispatcher: selfSignedCertDispatcher,
      });
      // $FlowFixMe[prop-missing] undici's body does expose `text()`
      const text: string = await body.text();
      // Only the fields the callers read, not a whole `Response`.
      // $FlowFixMe[incompatible-type]
      return {
        ok: statusCode >= 200 && statusCode < 300,
        status: statusCode,
        statusText: '',
        text: async () => text,
      };
    });
  });

  afterAll(() => {
    fetchSpy.mockRestore();
  });
}
