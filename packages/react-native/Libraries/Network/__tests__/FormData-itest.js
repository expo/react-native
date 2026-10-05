/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import FormData from '../FormData';

describe('FormData', function () {
  let formData;

  beforeEach(() => {
    formData = new FormData();
  });

  it('should return non blob null', function () {
    // $FlowFixMe[incompatible-type]
    formData.append('null', null);

    const expectedPart = {
      string: 'null',
      headers: {
        'content-disposition': 'form-data; name="null"',
      },
      fieldName: 'null',
    };
    expect(formData.getParts()[0]).toEqual(expectedPart);
  });

  it('should return blob', function () {
    formData.append('photo', {
      uri: 'arbitrary/path',
      type: 'image/jpeg',
      name: 'photo.jpg',
    });

    const expectedPart = {
      uri: 'arbitrary/path',
      type: 'image/jpeg',
      name: 'photo.jpg',
      headers: {
        'content-disposition': 'form-data; name="photo"; filename="photo.jpg"',
        'content-type': 'image/jpeg',
      },
      fieldName: 'photo',
    };
    expect(formData.getParts()[0]).toEqual(expectedPart);
  });

  it('should return blob with the correct utf-8 handling', function () {
    formData.append('photo', {
      uri: 'arbitrary/path',
      type: 'image/jpeg',
      name: '测试photo.jpg',
    });

    const expectedPart = {
      uri: 'arbitrary/path',
      type: 'image/jpeg',
      name: '测试photo.jpg',
      headers: {
        'content-disposition':
          'form-data; name="photo"; filename="%E6%B5%8B%E8%AF%95photo.jpg"',
        'content-type': 'image/jpeg',
      },
      fieldName: 'photo',
    };
    expect(formData.getParts()[0]).toEqual(expectedPart);
  });

  it('should return non blob array', function () {
    // $FlowFixMe[incompatible-type]
    formData.append('array', [
      true,
      false,
      undefined,
      null,
      {},
      [],
      'string',
      0,
    ]);

    const expectedPart = {
      string: 'true,false,,,[object Object],,string,0',
      headers: {
        'content-disposition': 'form-data; name="array"',
      },
      fieldName: 'array',
    };
    expect(formData.getParts()[0]).toEqual(expectedPart);
  });

  it('should return values based on the given key', function () {
    formData.append('username', 'Chris');
    formData.append('username', 'Bob');

    expect(formData.getAll('username').length).toBe(2);

    expect(formData.getAll('username')).toEqual(['Chris', 'Bob']);

    formData.append('photo', {
      uri: 'arbitrary/path',
      type: 'image/jpeg',
      name: 'photo3.jpg',
    });

    formData.append('photo', {
      uri: 'arbitrary/path',
      type: 'image/jpeg',
      name: 'photo2.jpg',
    });

    const expectedPart = {
      uri: 'arbitrary/path',
      type: 'image/jpeg',
      name: 'photo2.jpg',
    };

    expect(formData.getAll('photo')[1]).toEqual(expectedPart);

    expect(formData.getAll('file').length).toBe(0);
  });

  /*
   * The rest of the interface, added because `<form action={fn}>` hands this
   * object to application code written against the web API — where
   * `formData.get('email')` is the first line of nearly every form action.
   */

  it('get returns the first value, or null when absent', () => {
    formData.append('tag', 'a');
    formData.append('tag', 'b');
    expect(formData.get('tag')).toBe('a');
    // Null rather than an empty string, so "absent" and "present but blank"
    // stay distinguishable.
    expect(formData.get('missing')).toBe(null);
  });

  it('has distinguishes absent from blank', () => {
    formData.append('blank', '');
    expect(formData.has('blank')).toBe(true);
    expect(formData.has('missing')).toBe(false);
  });

  it('set replaces every entry for a name, keeping the first position', () => {
    formData.append('a', '1');
    formData.append('tag', 'x');
    formData.append('b', '2');
    formData.append('tag', 'y');
    formData.set('tag', 'z');
    expect(formData.getAll('tag')).toEqual(['z']);
    // The position of the first entry is kept, so `set` cannot silently
    // reorder a form.
    expect([...formData.keys()]).toEqual(['a', 'tag', 'b']);
  });

  it('set appends when the name is absent', () => {
    formData.append('a', '1');
    formData.set('b', '2');
    expect([...formData.entries()]).toEqual([
      ['a', '1'],
      ['b', '2'],
    ]);
  });

  it('delete removes every entry for a name', () => {
    formData.append('tag', 'a');
    formData.append('keep', 'yes');
    formData.append('tag', 'b');
    formData.delete('tag');
    expect(formData.has('tag')).toBe(false);
    expect(formData.getAll('keep')).toEqual(['yes']);
  });

  it('is iterable, yielding entries in order', () => {
    formData.append('a', '1');
    formData.append('b', '2');
    // Cast because Flow does not recognise `@@iterator` on a class that
    // declares it with a computed key, which is the only way to write it in
    // code Babel also has to compile. Spreading it is exactly the behaviour
    // under test, so the assertion stays as it is.
    expect([...(formData as $FlowFixMe)]).toEqual([
      ['a', '1'],
      ['b', '2'],
    ]);
    expect([...formData.values()]).toEqual(['1', '2']);
  });
});
