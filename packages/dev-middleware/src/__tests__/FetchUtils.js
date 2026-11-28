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
 * Serve the global `fetch` with undici's `request` so that it accepts the
 * self-signed certificate of the HTTPS server created in ServerUtils.
 * This runs with Jest's `beforeAll` and `afterAll`, and restores the original `fetch`.
 */
export function withFetchSelfSignedCertsForAllTests(
  fetchSpy: JestMockFn<Parameters<typeof fetch>, ReturnType<typeof fetch>>,
) {
  const selfSignedCertDispatcher = new Agent({
    connect: {
      rejectUnauthorized: false,
    },
  });

  beforeAll(() => {
    // The global `fetch` runs on the undici bundled with Node, which may not
    // accept a dispatcher from the undici package: Node 26 rejects one from
    // undici 6. The package's own `fetch` throws under Jest, whose
    // `performance` global lacks `markResourceTiming`.
    fetchSpy.mockImplementation(async (url, options) => {
      const {statusCode, body} = await request(url.toString(), {
        ...options,
        dispatcher: selfSignedCertDispatcher,
      });
      return new Response(await body.text(), {status: statusCode});
    });
  });

  afterAll(() => {
    fetchSpy.mockRestore();
  });
}
