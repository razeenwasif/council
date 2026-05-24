import { describe, test, expect } from 'bun:test';
import { parseQueryString } from './parseQueryString';

describe('parseQueryString', () => {
  test('should return empty object for empty/whitespace inputs', () => {
    expect(parseQueryString('')).toEqual({});
    expect(parseQueryString('?')).toEqual({});
    expect(parseQueryString('#')).toEqual({});
  });

  test('should throw TypeError if input is not a string', () => {
    expect(() => parseQueryString(null as any)).toThrow(TypeError);
    expect(() => parseQueryString(undefined as any)).toThrow(TypeError);
  });

  test('should strip leading ? or #', () => {
    expect(parseQueryString('?a=b')).toEqual({ a: 'b' });
    expect(parseQueryString('#a=b')).toEqual({ a: 'b' });
  });

  test('should split on first equals only', () => {
    expect(parseQueryString('q=a=b')).toEqual({ q: 'a=b' });
    expect(parseQueryString('q===')).toEqual({ q: '==' });
  });

  test('should handle bare keys without equals sign', () => {
    expect(parseQueryString('a')).toEqual({ a: '' });
    expect(parseQueryString('a&b')).toEqual({ a: '', b: '' });
  });

  test('should handle empty segments', () => {
    expect(parseQueryString('&&a=b&&c=d&')).toEqual({ a: 'b', c: 'd' });
  });

  test('should replace + with space and decode percent-escapes', () => {
    expect(parseQueryString('name=John+Doe')).toEqual({ name: 'John Doe' });
    expect(parseQueryString('msg=%E4%B8%AD%E6%96%87')).toEqual({ msg: '中文' });
  });

  test('should handle decoding of plus signs properly', () => {
    // %2B must decode to '+' and NOT a space
    expect(parseQueryString('formula=1%2B2%3D3')).toEqual({ formula: '1+2=3' });
    expect(parseQueryString('a=%2B+b')).toEqual({ a: '+ b' });
  });

  test('should fold duplicate keys into arrays and preserve order', () => {
    expect(parseQueryString('tag=js&tag=ts')).toEqual({ tag: ['js', 'ts'] });
    expect(parseQueryString('tag=js&tag=ts&tag=rust')).toEqual({ tag: ['js', 'ts', 'rust'] });
    expect(parseQueryString('tag=js&other=val&tag=ts')).toEqual({ tag: ['js', 'ts'], other: 'val' });
  });

  test('should gracefully handle malformed percent-escapes without crashing', () => {
    expect(parseQueryString('key=%G1')).toEqual({ key: '%G1' });
    expect(parseQueryString('key=%2')).toEqual({ key: '%2' });
  });

  test('should protect against prototype pollution', () => {
    const result = parseQueryString('__proto__[polluted]=true&constructor=evil&prototype=harmful&a=b');
    expect(result).toEqual({ a: 'b' });
    expect((Object.prototype as any).polluted).toBeUndefined();
  });
});
